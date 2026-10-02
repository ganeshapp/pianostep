import { extractMusicXmlText } from '../mxl';
import { isOnPiano, midiFromSpelled } from '../pitch';
import type { EndingMark, SourceMeasure, SourceNote, SourcePart, SourceScore, SourceTempo } from '../types';
import { measureDisplayNumbers } from '../measures';
import { voiceHomeStaves } from '../voices';
import { ImportError, parseXmlSafely, rejectUnsafeXml } from '../xml';
import { attr, childElements, childText, nameOf } from './dom';
import { readMetadata } from './metadata';
import { lcm } from './notation';
import {
  PITCH_BEYOND_KEYS,
  PartReader,
  divisionsValue,
  type DraftNote,
  type MeasureSource,
  type NavMarks,
  type PartMeasure,
  type PartResult,
  type TimeSignature,
} from './part';
import { WarningSink } from './warnings';

/** Extra resolution so grace notes can be given short exact lengths. */
const BASE_TICKS = 48;
const MAX_TICKS_PER_QUARTER = 1_000_000_000;
const SCORE_ROOT = /<(?:[A-Za-z_][\w.-]*:)?score-(?:partwise|timewise)[\s>/]/;
/**
 * Structure no real score comes near (the library peaks at 2 parts and 524
 * measure columns; a large orchestral score has some 40 parts of 2000
 * measures). A tiny damaged or hostile file can declare thousands of parts
 * and measures, and the work done per part and measure column would exhaust
 * the page's memory, so such a file is refused with a readable error.
 */
export const MAX_PARTS = 200;
/** Most parts x measure columns. */
export const MAX_PART_MEASURES = 200_000;

/** A note number MIDI and the app's sound can carry (0-127). */
function isMidiNumber(midi: number): boolean {
  return Number.isInteger(midi) && midi >= 0 && midi <= 127;
}

interface PartLayout {
  id: string;
  name: string;
  instrument: PartDeclaration;
  /** Index-aligned measure columns; holes mean the part has no such measure. */
  measures: (MeasureSource | undefined)[];
}

/** What a <score-part> declares about its instrument. */
interface PartDeclaration {
  name: string;
  instrumentNames: string[];
  sounds: string[];
  midiPrograms: number[];
}

const MAX_INSTRUMENTS = 16;

function undeclared(): PartDeclaration {
  return { name: '', instrumentNames: [], sounds: [], midiPrograms: [] };
}

function readScorePart(sp: Element): PartDeclaration {
  const d: PartDeclaration = { name: childText(sp, 'part-name') ?? '', instrumentNames: [], sounds: [], midiPrograms: [] };
  for (const c of childElements(sp)) {
    const name = nameOf(c);
    if (name === 'score-instrument') {
      const n = childText(c, 'instrument-name');
      if (n && d.instrumentNames.length < MAX_INSTRUMENTS) d.instrumentNames.push(n);
      const s = childText(c, 'instrument-sound');
      if (s && d.sounds.length < MAX_INSTRUMENTS) d.sounds.push(s);
    } else if (name === 'midi-instrument') {
      const p = Number(childText(c, 'midi-program') ?? '');
      if (Number.isInteger(p) && p >= 1 && p <= 128 && d.midiPrograms.length < MAX_INSTRUMENTS) d.midiPrograms.push(p);
    }
  }
  return d;
}

function partDeclarations(root: Element): Map<string, PartDeclaration> {
  const parts = new Map<string, PartDeclaration>();
  const list = childElements(root).find((c) => nameOf(c) === 'part-list');
  if (!list) return parts;
  for (const sp of childElements(list)) {
    if (nameOf(sp) !== 'score-part') continue;
    const id = attr(sp, 'id');
    if (id !== null && !parts.has(id)) parts.set(id, readScorePart(sp));
  }
  return parts;
}

function partwiseLayout(root: Element): PartLayout[] {
  const declared = partDeclarations(root);
  const parts: PartLayout[] = [];
  for (const el of childElements(root)) {
    if (nameOf(el) !== 'part') continue;
    const id = attr(el, 'id') ?? `P${parts.length + 1}`;
    const measures = childElements(el)
      .filter((m) => nameOf(m) === 'measure')
      .map((m) => ({ attrs: m, content: m }));
    const instrument = declared.get(id) ?? undeclared();
    parts.push({ id, name: instrument.name, instrument, measures });
  }
  return parts;
}

/** Regroups a timewise score (measures containing parts) into per-part columns. */
function timewiseLayout(root: Element): PartLayout[] {
  const byId = new Map<string, PartLayout>();
  for (const [id, instrument] of partDeclarations(root)) byId.set(id, { id, name: instrument.name, instrument, measures: [] });
  let index = 0;
  for (const m of childElements(root)) {
    if (nameOf(m) !== 'measure') continue;
    for (const p of childElements(m)) {
      if (nameOf(p) !== 'part') continue;
      const id = attr(p, 'id') ?? 'P1';
      let layout = byId.get(id);
      if (!layout) {
        layout = { id, name: '', instrument: undeclared(), measures: [] };
        byId.set(id, layout);
      }
      layout.measures[index] = { attrs: m, content: p };
    }
    index++;
  }
  return [...byId.values()].filter((p) => p.measures.length > 0);
}

function ticksPerQuarter(root: Element): number {
  let tpq = BASE_TICKS;
  const list = root.getElementsByTagName('divisions');
  for (let i = 0; i < list.length; i++) {
    const d = divisionsValue(list.item(i)?.textContent ?? null);
    if (d !== null) tpq = lcm(tpq, d);
  }
  if (tpq > MAX_TICKS_PER_QUARTER) {
    throw new ImportError('unsupported', 'The note lengths in this file are divided too finely to read.');
  }
  return tpq;
}

/**
 * The navigation marks of one measure column, merged over every part. Bar
 * lines (repeats, endings) are usually written in every part, but words and
 * signs (D.C., Fine, To Coda, segno) are often written under one part only,
 * which need not be the first: a mark in any part counts. Endings are
 * combined without duplicates; the first part with a backward repeat gives
 * its repeat count.
 */
function mergeMarks(list: readonly NavMarks[]): NavMarks {
  const endings: EndingMark[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    for (const e of m.endings) {
      const key = `${e.type}:${e.numbers.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endings.push({ numbers: [...e.numbers], type: e.type });
    }
  }
  const any = (flag: keyof Omit<NavMarks, 'repeatBackwardTimes' | 'endings'>): boolean => list.some((m) => m[flag]);
  return {
    repeatForward: any('repeatForward'),
    repeatBackwardTimes: list.find((m) => m.repeatBackwardTimes !== null)?.repeatBackwardTimes ?? null,
    endings,
    segno: any('segno'),
    coda: any('coda'),
    fine: any('fine'),
    daCapo: any('daCapo'),
    dalSegno: any('dalSegno'),
    toCoda: any('toCoda'),
  };
}

function buildMeasures(results: PartResult[], columns: number, tpq: number, warnings: WarningSink): SourceMeasure[] {
  // A part has cells only for the measures it has, so the work here follows
  // the measures actually written, not parts x columns. Cells are grouped by
  // column once, in part order.
  const byColumn: { part: number; cell: PartMeasure }[][] = [];
  results.forEach((r, part) => r.measures.forEach((cell, i) => (byColumn[i] ??= []).push({ part, cell })));
  // The time signature in force in each part. A part without a measure in
  // some column keeps the one it last had; the first part (in order) that has
  // one gives the column's time signature.
  const timeOf: (TimeSignature | null)[] = results.map(() => null);
  let firstTimed = -1;
  const findFirstTimed = (from: number): number => {
    for (let p = from; p < timeOf.length; p++) if (timeOf[p] !== null) return p;
    return -1;
  };
  const measures: SourceMeasure[] = [];
  let start = 0;
  for (let i = 0; i < columns; i++) {
    const column = byColumn[i] ?? [];
    for (const { part, cell } of column) {
      timeOf[part] = cell.time;
      if (cell.time !== null && (firstTimed < 0 || part < firstTimed)) firstTimed = part;
      else if (cell.time === null && part === firstTimed) firstTimed = findFirstTimed(part + 1);
    }
    const present = column.map((c) => c.cell).filter((c) => c.present);
    const first = present[0];
    const time = firstTimed >= 0 ? timeOf[firstTimed] : null;
    let content = 0;
    for (const c of present) if (c.length > content) content = c.length;
    const signatureLength = time ? Math.round((time.beats * 4 * tpq) / time.beatType) : 0;
    const implicit = first?.implicit ?? false;
    if (!implicit && content > 0 && time && content !== signatureLength) {
      warnings.add('measure-length-mismatch', i);
    }
    const marks = mergeMarks(present.filter((c) => c.hasMarks).map((c) => c.marks));
    const duration = content > 0 ? content : signatureLength;
    const measure: SourceMeasure = {
      index: i,
      number: first?.number ?? String(i + 1),
      startTick: start,
      durationTicks: duration,
      implicit,
      ...marks,
    };
    if (time) measure.timeSignature = { beats: time.beats, beatType: time.beatType };
    measures.push(measure);
    start += duration;
  }
  return measures;
}

/**
 * Visible notes whose sound the file gives to hidden notes instead. This is
 * how a written-out ornament is stored: the visible trill note is shown, and
 * invisible notes on the same staff play the trill during its time. The
 * visible note is either silenced (`dynamics="0"`) or carries the ornament
 * sign while the hidden notes include its pitch. Playing both would strike the
 * main note on top of its own ornament.
 *
 * The hidden notes replace the visible note from where the first of them
 * starts. An ornament can start partway through the note (a turn after a held
 * note, as in Beethoven's dotted-note turns): the note is then still struck
 * and held until the hidden notes take over. The value for each replaced
 * note is how many ticks of it are kept (0: none, it is left out).
 */
function replacedByHiddenNotes(drafts: readonly DraftNote[], measures: SourceMeasure[]): Map<DraftNote, number> {
  const replaced = new Map<DraftNote, number>();
  const candidates = drafts.filter((d) => d.printed && (d.muted || d.ornament));
  if (candidates.length === 0) return replaced;
  const hidden = drafts.filter((d) => !d.printed && !d.muted);
  if (hidden.length === 0) return replaced;
  const onset = (d: DraftNote) => measures[d.refMeasure].startTick + d.local;
  const pitch = (d: DraftNote) => midiFromSpelled(d.spelled) + d.transpose;
  const hiddenDuring = (v: DraftNote): DraftNote[] => {
    const start = onset(v);
    const end = start + v.duration;
    return hidden.filter((h) => h.staff === v.staff && onset(h) < end && onset(h) + h.duration > start);
  };
  /** Ticks of `v` before the first of the hidden notes sounding over it. */
  const kept = (v: DraftNote, during: readonly DraftNote[]): number =>
    Math.max(0, during.reduce((first, h) => Math.min(first, onset(h)), Infinity) - onset(v));
  for (const v of candidates) {
    const during = hiddenDuring(v);
    if (during.length > 0 && (v.muted || during.some((h) => pitch(h) === pitch(v)))) replaced.set(v, kept(v, during));
  }
  if (replaced.size === 0) return replaced;
  // A tied continuation of a replaced note is replaced too while the hidden notes still sound over it.
  const continuations = drafts.filter((d) => d.printed && d.tieStop && !replaced.has(d)).sort((a, b) => onset(a) - onset(b));
  for (const c of continuations) {
    const tiedFrom = [...replaced.keys()].some(
      (v) => v.staff === c.staff && pitch(v) === pitch(c) && onset(v) + v.duration === onset(c),
    );
    if (!tiedFrom) continue;
    const during = hiddenDuring(c);
    if (during.length > 0) replaced.set(c, kept(c, during));
  }
  return replaced;
}

function buildNotes(
  results: PartResult[],
  measures: SourceMeasure[],
  warnings: WarningSink,
  stavesOf: (partId: string) => number,
  software: string | null,
): SourceNote[] {
  const notes: SourceNote[] = [];
  for (const r of results) {
    const replaced = replacedByHiddenNotes(r.notes, measures);
    for (const d of r.notes) {
      /** Ticks kept of a note whose sound the file gives to hidden notes (see replacedByHiddenNotes). */
      const keep = replaced.get(d);
      if (keep !== undefined) {
        warnings.add(
          'other',
          d.measureIndex,
          1,
          'Where the file spells out a trill or other ornament with hidden notes, those notes are played in place of the main note shown, from where they start.',
        );
        if (keep === 0) continue;
      }
      if (d.muted && !d.printed) {
        // Neither shown nor heard in the file: nothing to practise.
        warnings.add('other', d.measureIndex, 1, 'Notes the file both hides and silences are left out.');
        continue;
      }
      // Shown in the music, so played (at the loudness around it) and expected
      // in Follow me; for a note the hidden notes take over, only its part
      // before them. Its ornament is then played by the hidden notes.
      if (d.muted) warnings.add('silent-notes-played', d.measureIndex);
      if (d.ornament && keep === undefined) warnings.add('ornament-not-played', d.measureIndex);
      const midi = midiFromSpelled(d.spelled) + d.transpose;
      if (!isMidiNumber(midi)) {
        // Beyond any keyboard or sound (a damaged pitch or transposition): nothing can play it.
        warnings.add('out-of-piano-range', d.measureIndex);
        warnings.add('other', d.measureIndex, 1, PITCH_BEYOND_KEYS);
        continue;
      }
      const note: SourceNote = {
        id: `${d.partId}:${d.measureIndex}:${d.ordinal}`,
        partId: d.partId,
        staff: d.staff,
        voice: d.voice,
        measureIndex: d.measureIndex,
        onsetTick: measures[d.refMeasure].startTick + d.local,
        durationTicks: keep ?? d.duration,
        midi,
        spelled: d.spelled,
        tieStart: d.tieStart,
        tieStop: d.tieStop,
        grace: d.grace,
        chord: d.chord,
        tuplet: d.tuplet,
        printed: d.printed,
        crossStaff: false,
      };
      if (d.velocity !== undefined) note.velocity = d.velocity;
      if (!Number.isInteger(d.spelled.alter)) warnings.add('microtone-rounded', d.measureIndex);
      if (!isOnPiano(midi)) warnings.add('out-of-piano-range', d.measureIndex);
      notes.push(note);
    }
  }
  const home = voiceHomeStaves(notes, stavesOf, software);
  for (const n of notes) {
    if (home.get(n) !== n.staff) {
      n.crossStaff = true;
      warnings.add('cross-staff-notes', n.measureIndex);
    }
  }
  return notes.sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi);
}

/** Tempo marks in source ticks; at a shared tick the earliest part wins, within a part the last mark wins. */
function buildTempos(results: PartResult[], measures: SourceMeasure[]): SourceTempo[] {
  const byTick = new Map<number, { part: number; tempo: SourceTempo }>();
  results.forEach((r, part) => {
    for (const t of r.tempos) {
      const tick = measures[t.measureIndex].startTick + t.local;
      const existing = byTick.get(tick);
      if (!existing || existing.part === part) {
        byTick.set(tick, { part, tempo: { tick, measureIndex: t.measureIndex, qpm: t.qpm } });
      }
    }
  });
  return [...byTick.values()].map((v) => v.tempo).sort((a, b) => a.tick - b.tick);
}

/**
 * MusicXML text -> SourceScore (written order, exact integer ticks).
 * Throws ImportError for unsafe, malformed or non-MusicXML input.
 */
export function parseMusicXml(xmlText: string): SourceScore {
  rejectUnsafeXml(xmlText);
  if (!SCORE_ROOT.test(xmlText)) throw new ImportError('not-musicxml');
  const doc = parseXmlSafely(xmlText);
  const root = doc.documentElement;
  const warnings = new WarningSink();

  let layout: PartLayout[];
  const rootName = nameOf(root);
  if (rootName === 'score-partwise') {
    layout = partwiseLayout(root);
  } else if (rootName === 'score-timewise') {
    layout = timewiseLayout(root);
    warnings.add('timewise-converted');
  } else {
    throw new ImportError('not-musicxml');
  }
  let columns = 0;
  for (const p of layout) if (p.measures.length > columns) columns = p.measures.length;
  if (layout.length === 0 || columns === 0) throw new ImportError('empty-score');
  if (layout.length > MAX_PARTS || layout.length * columns > MAX_PART_MEASURES) {
    throw new ImportError(
      'too-large',
      'This score has too many parts and measures to open safely.',
      `${layout.length} parts, ${columns} measures`,
    );
  }

  const tpq = ticksPerQuarter(root);
  const meta = readMetadata(root);
  const results = layout.map((p) => {
    const reader = new PartReader(p.id, tpq, warnings);
    // Only the measures the part has (a timewise file can leave holes).
    p.measures.forEach((m, i) => reader.readMeasure(i, m));
    return reader.finish();
  });

  const measures = buildMeasures(results, columns, tpq, warnings);
  const staves = new Map(layout.map((p, i) => [p.id, results[i].staves]));
  const notes = buildNotes(results, measures, warnings, (id) => staves.get(id) ?? 1, meta.software);
  const tempos = buildTempos(results, measures);
  const display = measureDisplayNumbers(measures);

  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.partId, (counts.get(n.partId) ?? 0) + 1);
  const parts: SourcePart[] = layout.map((p, i) => {
    const part: SourcePart = {
      id: p.id,
      name: p.name,
      staves: results[i].staves,
      clefs: results[i].clefs,
      pitchedNoteCount: counts.get(p.id) ?? 0,
      words: results[i].words,
      hiddenStaves: results[i].hiddenStaves,
    };
    if (Object.keys(results[i].staffDetails).length > 0) part.staffDetails = results[i].staffDetails;
    const { instrumentNames, sounds, midiPrograms } = p.instrument;
    if (instrumentNames.length > 0) part.instrumentNames = instrumentNames;
    if (sounds.length > 0) part.instrumentSounds = sounds;
    if (midiPrograms.length > 0) part.midiPrograms = midiPrograms;
    return part;
  });

  return {
    ...meta,
    ticksPerQuarter: tpq,
    parts,
    measures,
    notes,
    tempos,
    pedalMarks: results.reduce((sum, r) => sum + r.pedalMarks, 0),
    warnings: warnings.toList((i) => display[i] ?? String(i + 1)),
  };
}

/** File bytes (.musicxml, .xml or .mxl, detected by content) -> SourceScore. */
export function loadSourceScore(bytes: Uint8Array, fileName?: string): SourceScore {
  return parseMusicXml(extractMusicXmlText(bytes, fileName));
}
