import type {
  Hand,
  HandMapping,
  MeasureOccurrence,
  PerformanceNote,
  ScoreWarning,
  SourceMeasure,
  SourceNote,
  SourceScore,
  TempoMap,
  TempoPoint,
  VoiceHandOverride,
  WarningCode,
  WarningSeverity,
} from '../types';
import { measureDisplayNumbers } from '../measures';
import { voiceHomeStaves } from '../voices';
import { DEFAULT_QPM } from './tempo';

export { tickToSeconds, secondsToTick, tempoAt, DEFAULT_QPM } from './tempo';

/* ------------------------------------------------------------------------ */
/* Warning aggregation (shared by the model modules)                         */
/* ------------------------------------------------------------------------ */

const MAX_WARNING_MEASURES = 20;
const SEVERITY_RANK: Record<WarningSeverity, number> = { info: 0, review: 1, error: 2 };

/**
 * Adds measures to a warning's list without duplicates, keeping at most 20.
 * When a new measure does not fit, the warning is marked `measuresTruncated`,
 * so "and others" is only ever said about measures that are really missing.
 */
function addMeasures(target: ScoreWarning, more: readonly string[]): void {
  const list = (target.measures ??= []);
  for (const m of more) {
    if (list.includes(m)) continue;
    if (list.length >= MAX_WARNING_MEASURES) {
      target.measuresTruncated = true;
      return;
    }
    list.push(m);
  }
}

/**
 * Collects warnings keeping one entry per code: the first message wins, the
 * severity is the highest seen, `count` adds up and up to 20 measures are kept.
 */
export class WarningBag {
  private readonly byCode = new Map<WarningCode, ScoreWarning>();

  add(code: WarningCode, severity: WarningSeverity, message: string, measures: readonly string[] = [], count = 1): void {
    const existing = this.byCode.get(code);
    if (!existing) {
      const w: ScoreWarning = { code, severity, message, count };
      if (measures.length) addMeasures(w, measures);
      this.byCode.set(code, w);
      return;
    }
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) existing.severity = severity;
    existing.count = (existing.count ?? 1) + count;
    if (measures.length) addMeasures(existing, measures);
  }

  list(): ScoreWarning[] {
    return [...this.byCode.values()].map((w) => (w.measures ? { ...w, measures: [...w.measures] } : { ...w }));
  }
}

/**
 * Merges warning lists from several stages into one entry per code. Distinct
 * messages for the same code are joined so no explanation is lost. A list cut
 * short anywhere stays marked `measuresTruncated`.
 */
export function mergeWarnings(...lists: readonly ScoreWarning[][]): ScoreWarning[] {
  const byCode = new Map<WarningCode, ScoreWarning>();
  for (const list of lists) {
    for (const w of list) {
      const existing = byCode.get(w.code);
      if (!existing) {
        const copy: ScoreWarning = { ...w, count: w.count ?? 1 };
        if (w.measures) {
          copy.measures = [...w.measures].slice(0, MAX_WARNING_MEASURES);
          if (w.measures.length > MAX_WARNING_MEASURES) copy.measuresTruncated = true;
        }
        byCode.set(w.code, copy);
        continue;
      }
      if (SEVERITY_RANK[w.severity] > SEVERITY_RANK[existing.severity]) existing.severity = w.severity;
      if (!existing.message.includes(w.message)) existing.message = `${existing.message} ${w.message}`;
      existing.count = (existing.count ?? 1) + (w.count ?? 1);
      if (w.measuresTruncated) existing.measuresTruncated = true;
      if (w.measures?.length) addMeasures(existing, w.measures);
    }
  }
  return [...byCode.values()];
}

/* ------------------------------------------------------------------------ */
/* Repeat / jump unrolling                                                   */
/* ------------------------------------------------------------------------ */

export interface UnrollResult {
  occurrences: MeasureOccurrence[];
  warnings: ScoreWarning[];
}

interface EndingSpan {
  start: number;
  end: number;
  numbers: number[];
  group: number;
  lastInGroup: boolean;
  groupMax: number;
  hasExplicitBackward: boolean;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "12" the first time, then "12 (2nd time)", ... for a measure's display number (see measureDisplayNumbers). */
export function occurrenceLabel(displayNumber: string, pass: number): string {
  return pass <= 1 ? displayNumber : `${displayNumber} (${ordinal(pass)} time)`;
}

/** Reads ending brackets into spans; returns null when a bracket has no usable number. */
function findEndingSpans(measures: SourceMeasure[]): EndingSpan[] | { badMeasure: number } {
  const raw: { start: number; end: number; numbers: number[] }[] = [];
  let open: { start: number; numbers: number[] } | null = null;
  for (const m of measures) {
    // A bracket whose end the file never marks cannot run on into a new
    // repeated section: it stops before the next forward repeat sign.
    if (open && m.repeatForward && m.index > open.start) {
      raw.push({ ...open, end: m.index - 1 });
      open = null;
    }
    const startMark = m.endings.find((e) => e.type === 'start');
    if (startMark) {
      if (open) raw.push({ ...open, end: m.index - 1 });
      if (startMark.numbers.length === 0) return { badMeasure: m.index };
      open = { start: m.index, numbers: [...startMark.numbers] };
    }
    // ...and a volta bracket always ends at the repeat sign that closes it.
    if (open && (m.endings.some((e) => e.type !== 'start') || m.repeatBackwardTimes !== null)) {
      raw.push({ ...open, end: m.index });
      open = null;
    }
  }
  if (open) raw.push({ ...open, end: measures.length - 1 });

  const spans: EndingSpan[] = [];
  let group = -1;
  raw.forEach((r, k) => {
    const prev = k > 0 ? raw[k - 1] : null;
    // Brackets belong to one volta group when they are adjacent and numbered upwards (1 | 2 | 3).
    const continues = prev !== null && r.start === prev.end + 1 && Math.min(...r.numbers) > Math.max(...prev.numbers);
    if (!continues) group++;
    let hasExplicitBackward = false;
    for (let i = r.start; i <= r.end; i++) if (measures[i].repeatBackwardTimes !== null) hasExplicitBackward = true;
    spans.push({ ...r, group, lastInGroup: true, groupMax: 0, hasExplicitBackward });
  });
  for (let k = 0; k < spans.length; k++) {
    const members = spans.filter((s) => s.group === spans[k].group);
    spans[k].groupMax = Math.max(...members.flatMap((s) => s.numbers));
    spans[k].lastInGroup = members[members.length - 1] === spans[k];
  }
  return spans;
}

function writtenOrder(measures: SourceMeasure[]): number[] {
  return measures.map((m) => m.index);
}

function toOccurrences(measures: SourceMeasure[], order: number[]): MeasureOccurrence[] {
  const display = measureDisplayNumbers(measures);
  const seen = new Map<number, number>();
  let tick = 0;
  return order.map((measureIndex, occ) => {
    const m = measures[measureIndex];
    // `pass` counts how often this measure has sounded so far, so (number, pass) is unique.
    const pass = (seen.get(measureIndex) ?? 0) + 1;
    seen.set(measureIndex, pass);
    const o: MeasureOccurrence = {
      occ,
      measureIndex,
      number: display[measureIndex],
      pass,
      startTick: tick,
      durationTicks: m.durationTicks,
      label: occurrenceLabel(display[measureIndex], pass),
    };
    tick += m.durationTicks;
    return o;
  });
}

type UnrollOutcome = { order: number[] } | { failure: 'repeats-unsupported' | 'jump-unsupported'; measures: number[] };

function simulate(measures: SourceMeasure[]): UnrollOutcome {
  const n = measures.length;
  const spansOrBad = findEndingSpans(measures);
  if (!Array.isArray(spansOrBad)) return { failure: 'repeats-unsupported', measures: [spansOrBad.badMeasure] };
  const spans = spansOrBad;
  const spanAt = new Map<number, EndingSpan>();
  const spanStarting = new Map<number, EndingSpan>();
  for (const s of spans) {
    spanStarting.set(s.start, s);
    for (let i = s.start; i <= s.end; i++) spanAt.set(i, s);
  }

  /** Total plays of the section closed at measure i, or null when i closes no section. */
  const backwardTimes = (i: number): number | null => {
    const explicit = measures[i].repeatBackwardTimes;
    const span = spanAt.get(i);
    if (explicit !== null) return span ? Math.max(explicit, span.groupMax) : explicit;
    // A non-final ending without a repeat sign still has to send the player back,
    // otherwise the later endings could never be reached.
    if (span && i === span.end && !span.lastInGroup && !span.hasExplicitBackward) return span.groupMax;
    return null;
  };

  const order: number[] = [];
  const limit = 8 * n;
  const takenJumps = new Set<number>();
  let i = 0;
  let sectionStart = 0;
  let sectionPass = 1;
  let jumped = false;
  let arrivedByRepeat = false;

  while (i < n) {
    const m = measures[i];
    const arrived = arrivedByRepeat;
    arrivedByRepeat = false;

    // An ending is chosen by the pass of the section it closes, so check it
    // before a forward repeat on the same measure starts a new section (a
    // 2nd ending that also opens the next repeated section). Going back to
    // such a measure's own forward repeat sign always plays it: its bracket
    // belongs to the section that closed before it. A 1st ending that itself
    // carries the forward repeat ("||: [1. ... :|| [2. ...") belongs to the
    // section it opens, so it is still checked against that section's pass.
    const entering = spanStarting.get(i);
    const closesEarlierSection =
      entering !== undefined && spans.some((s) => s.group === entering.group && s.start < entering.start);
    if (entering && !(arrived && m.repeatForward && i === sectionStart && closesEarlierSection)) {
      // After a D.C./D.S. the conventional reading takes the last ending.
      const pass = jumped ? entering.groupMax : sectionPass;
      if (!entering.numbers.includes(pass)) {
        const next = entering.end + 1;
        if (spanStarting.get(next)?.group !== entering.group) {
          sectionStart = next;
          sectionPass = 1;
        }
        i = next;
        continue;
      }
    }
    if (m.repeatForward && !arrived && !jumped) {
      sectionStart = i;
      sectionPass = 1;
    }

    order.push(i);
    if (order.length > limit) return { failure: 'repeats-unsupported', measures: [] };

    if (jumped && m.fine) break;
    if (jumped && m.toCoda) {
      let coda = -1;
      for (let k = i + 1; k < n; k++) {
        if (measures[k].coda) {
          coda = k;
          break;
        }
      }
      if (coda < 0) return { failure: 'jump-unsupported', measures: [i] };
      i = coda;
      continue;
    }

    if (!jumped) {
      const times = backwardTimes(i);
      const span = spanAt.get(i);
      if (times !== null) {
        if (sectionPass < times) {
          sectionPass++;
          i = sectionStart;
          arrivedByRepeat = true;
          continue;
        }
        sectionStart = i + 1;
        sectionPass = 1;
      } else if (span && span.end === i && span.lastInGroup && !(sectionStart >= span.start && measures[sectionStart].repeatForward)) {
        // The final ending closes its section, unless a forward repeat inside
        // it has already opened the next one.
        sectionStart = i + 1;
        sectionPass = 1;
      }
    }

    if ((m.daCapo || m.dalSegno) && !takenJumps.has(i)) {
      takenJumps.add(i);
      let target = 0;
      if (m.dalSegno) {
        target = -1;
        for (let k = i; k >= 0; k--) {
          if (measures[k].segno) {
            target = k;
            break;
          }
        }
        if (target < 0) return { failure: 'jump-unsupported', measures: [i] };
      }
      jumped = true;
      i = target;
      continue;
    }
    i++;
  }
  return { order };
}

const FALLBACK_MESSAGES: Record<'repeats-unsupported' | 'jump-unsupported', string> = {
  'repeats-unsupported':
    'The repeat signs in this piece could not be followed, so it is played straight through as written, without repeats.',
  'jump-unsupported':
    'A "D.C.", "D.S." or "To Coda" instruction could not be followed because the sign it points to is missing, so the piece is played straight through as written, without repeats or jumps.',
};

export function unrollMeasures(source: SourceScore): UnrollResult {
  const measures = source.measures;
  const outcome = simulate(measures);
  if ('order' in outcome) return { occurrences: toOccurrences(measures, outcome.order), warnings: [] };
  const bag = new WarningBag();
  const display = measureDisplayNumbers(measures);
  bag.add(
    outcome.failure,
    'review',
    FALLBACK_MESSAGES[outcome.failure],
    outcome.measures.map((k) => display[k]),
  );
  return { occurrences: toOccurrences(measures, writtenOrder(measures)), warnings: bag.list() };
}

/* ------------------------------------------------------------------------ */
/* Tempo map                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * An upbeat (pickup) first measure: marked implicit, or shorter than its time
 * signature (some files leave the implicit flag out).
 */
function isPickup(m: SourceMeasure, ticksPerQuarter: number): boolean {
  if (m.implicit) return true;
  const ts = m.timeSignature;
  if (!ts || m.durationTicks <= 0) return false;
  return m.durationTicks < Math.round((ts.beats * 4 * ticksPerQuarter) / ts.beatType);
}

/**
 * The file's first tempo mark (in written order), and whether it counts as
 * the opening tempo. It does when it is written in the first measure, or in
 * the first full measure after a pickup: the mark is then meant from the
 * start (an upbeat or a mark placed a little late). A first mark further in
 * leaves the opening unmarked, so the opening plays at the app's default.
 */
function firstTempoMark(source: SourceScore): { tempo: SourceScore['tempos'][number]; opens: boolean } | null {
  let first: SourceScore['tempos'][number] | null = null;
  for (const t of source.tempos) if (first === null || t.tick < first.tick) first = t;
  if (first === null) return null;
  const opens =
    first.measureIndex === 0 ||
    (first.measureIndex === 1 && source.measures.length > 0 && isPickup(source.measures[0], source.ticksPerQuarter));
  return { tempo: first, opens };
}

export function buildTempoMap(source: SourceScore, occurrences: MeasureOccurrence[]): TempoMap {
  const tpq = source.ticksPerQuarter;
  const tempos = [...source.tempos].sort((a, b) => a.tick - b.tick);
  const first = firstTempoMark(source);
  if (first === null) {
    return { ticksPerQuarter: tpq, points: [{ tick: 0, qpm: DEFAULT_QPM }], defaulted: true };
  }
  const byMeasure = new Map<number, typeof tempos>();
  for (const t of tempos) {
    const list = byMeasure.get(t.measureIndex) ?? [];
    list.push(t);
    byMeasure.set(t.measureIndex, list);
  }
  // The tempo in force is tracked in performance order. A first mark at the
  // start (see firstTempoMark) also applies from the very start; otherwise the
  // unmarked opening plays at the app's default until the first mark.
  const opening = first.opens ? first.tempo.qpm : DEFAULT_QPM;
  let current = opening;
  /** Tempo in force when each written measure was first entered. */
  const entryQpm = new Map<number, number>();
  const raw: TempoPoint[] = [];
  occurrences.forEach((o, k) => {
    const m = source.measures[o.measureIndex];
    const continuous = k > 0 && occurrences[k - 1].measureIndex === o.measureIndex - 1;
    if (!continuous) {
      // Back to a measure already played (repeat, D.C., D.S.): resume at the
      // tempo it had then, not at whatever the later measure ended with.
      // Forward past skipped measures (a later ending, To Coda): keep the
      // tempo in force, because the marks in the skipped measures never sounded.
      current = entryQpm.get(o.measureIndex) ?? current;
      raw.push({ tick: o.startTick, qpm: current });
    }
    if (!entryQpm.has(o.measureIndex)) entryQpm.set(o.measureIndex, current);
    for (const t of byMeasure.get(o.measureIndex) ?? []) {
      raw.push({ tick: o.startTick + (t.tick - m.startTick), qpm: t.qpm });
      current = t.qpm;
    }
  });

  const points: TempoPoint[] = [];
  for (const p of raw) {
    const last = points[points.length - 1];
    if (last && last.tick === p.tick) last.qpm = p.qpm;
    else points.push({ ...p });
  }
  if (points.length === 0) points.push({ tick: 0, qpm: opening });
  if (points[0].tick > 0) points.unshift({ tick: 0, qpm: opening });
  const compact = points.filter((p, k) => k === 0 || p.qpm !== points[k - 1].qpm);
  return { ticksPerQuarter: tpq, points: compact, defaulted: false };
}

export function noTempoWarning(): ScoreWarning {
  return {
    code: 'no-tempo-in-file',
    severity: 'info',
    message: `The file does not give a tempo, so the app chose ${DEFAULT_QPM} quarter notes per minute.`,
    count: 1,
  };
}

/**
 * Info note for a file whose first tempo mark comes after the opening (see
 * firstTempoMark), so the opening plays at the app's default tempo. Null when
 * the file has no tempo at all (noTempoWarning) or marks it from the start.
 */
export function openingTempoWarning(source: SourceScore): ScoreWarning | null {
  const first = firstTempoMark(source);
  if (first === null || first.opens) return null;
  const measure = measureDisplayNumbers(source.measures)[first.tempo.measureIndex];
  return {
    code: 'opening-tempo-defaulted',
    severity: 'info',
    message:
      `The opening has no tempo mark, so the app plays it at ${DEFAULT_QPM} quarter notes per minute ` +
      `until the first marked tempo (measure ${measure}).`,
    count: 1,
  };
}

/* ------------------------------------------------------------------------ */
/* Performance notes and tie merging                                         */
/* ------------------------------------------------------------------------ */

export interface PerformanceNotesResult {
  notes: PerformanceNote[];
  warnings: ScoreWarning[];
}

interface OpenTie {
  note: PerformanceNote;
  /** Voice/staff of the most recent tied segment. */
  voice: string;
  staff: number;
  /** Occurrence of the most recent tied segment. */
  occ: number;
}

/**
 * The open tie a tie-stop note continues. Normally the tied note ends exactly
 * where the stop note starts. Failing that, a short silence is bridged: a
 * broken chord written as single notes, each tied into the chord that follows
 * ("let ring"), or a tie across a small gap left by the file's rounding, both
 * mean "keep holding the key". The bridge is at most `maxGap` ticks, stays on
 * the same voice or staff, and never crosses a repeat or jump (the two
 * occurrences must also be neighbours in written order). Any new strike of the
 * key closes the gap for good (see the pruning in buildPerformanceNotes).
 */
function findTiePartner(
  list: readonly OpenTie[],
  n: SourceNote,
  start: number,
  o: MeasureOccurrence,
  occurrences: readonly MeasureOccurrence[],
  maxGap: number,
): OpenTie | undefined {
  const exact = list.filter((t) => t.note.endTick === start);
  if (exact.length > 0) {
    return exact.find((t) => t.voice === n.voice) ?? exact.find((t) => t.staff === n.staff) ?? exact[0];
  }
  const follows = (occ: number): boolean =>
    occ === o.occ || (occ === o.occ - 1 && occurrences[occ]?.measureIndex === o.measureIndex - 1);
  const bridged = list
    .filter((t) => t.note.endTick < start && start - t.note.endTick <= maxGap && follows(t.occ))
    .sort((a, b) => b.note.endTick - a.note.endTick);
  return bridged.find((t) => t.voice === n.voice) ?? bridged.find((t) => t.staff === n.staff);
}

/** The hand a checked voice rule (`HandMapping.voiceHands`) gives this note, if any. */
export function voiceHandOf(
  rules: readonly VoiceHandOverride[] | undefined,
  note: Pick<SourceNote, 'partId' | 'voice' | 'measureIndex'>,
): Hand | undefined {
  if (!rules) return undefined;
  for (const r of rules) {
    if (r.part !== note.partId || r.voice.trim() !== note.voice.trim()) continue;
    if (!r.measures || r.measures.some(([a, b]) => note.measureIndex >= a && note.measureIndex <= b)) return r.hand;
  }
  return undefined;
}

export function buildPerformanceNotes(
  source: SourceScore,
  occurrences: MeasureOccurrence[],
  mapping: HandMapping,
): PerformanceNotesResult {
  const byMeasure = new Map<number, SourceNote[]>();
  for (const n of source.notes) {
    const list = byMeasure.get(n.measureIndex) ?? [];
    list.push(n);
    byMeasure.set(n.measureIndex, list);
  }
  for (const list of byMeasure.values()) list.sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi);
  const stavesOf = new Map(source.parts.map((p) => [p.id, p.staves]));
  const home = voiceHomeStaves(source.notes, (id) => stavesOf.get(id) ?? 1, source.software);
  const excluded = new Set(mapping.excludedParts);

  const handOf = (n: SourceNote): Hand | undefined => {
    if (excluded.has(n.partId)) return undefined;
    // A checked voice rule wins over the staff the note is drawn on.
    const checked = voiceHandOf(mapping.voiceHands, n);
    if (checked) return checked;
    const drawn = mapping.staffHands[`${n.partId}:${n.staff}`];
    if (!n.crossStaff) return drawn;
    // A cross-staff note is drawn on another staff but still belongs to the
    // hand that plays its voice (e.g. a left-hand arpeggio climbing into the treble).
    const homeStaff = home.get(n) ?? n.staff;
    return mapping.staffHands[`${n.partId}:${homeStaff}`] ?? drawn;
  };

  const bag = new WarningBag();
  const out: PerformanceNote[] = [];
  const open = new Map<string, OpenTie[]>();

  for (const o of occurrences) {
    const m = source.measures[o.measureIndex];
    for (const n of byMeasure.get(o.measureIndex) ?? []) {
      const start = o.startTick + (n.onsetTick - m.startTick);
      const end = start + n.durationTicks;
      const tieKey = `${n.partId}|${n.midi}`;
      const hand = handOf(n);

      if (n.tieStop) {
        const match = findTiePartner(open.get(tieKey) ?? [], n, start, o, occurrences, source.ticksPerQuarter);
        if (match) {
          match.note.endTick = Math.max(match.note.endTick, end);
          match.note.sourceNoteIds.push(n.id);
          match.voice = n.voice;
          match.staff = n.staff;
          match.occ = o.occ;
          if (!n.tieStart) open.set(tieKey, (open.get(tieKey) ?? []).filter((t) => t !== match));
          continue;
        }
        if (hand !== undefined) {
          bag.add(
            'tie-unmatched',
            'info',
            'Some tied notes could not be joined to the note before them, so they are played as new notes.',
            [o.number],
          );
        }
      }
      if (hand === undefined) continue;

      const pn: PerformanceNote = {
        id: `${n.id}@${o.occ}`,
        sourceNoteIds: [n.id],
        occ: o.occ,
        partId: n.partId,
        staff: n.staff,
        voice: n.voice,
        hand,
        midi: n.midi,
        spelled: n.spelled,
        startTick: start,
        endTick: end,
      };
      if (n.velocity !== undefined) pn.velocity = n.velocity;
      out.push(pn);
      // The key is struck afresh, so no earlier tie may bridge past this point.
      const pending = open.get(tieKey);
      if (pending) open.set(tieKey, pending.filter((t) => t.note.endTick >= start));
      if (n.tieStart) {
        const list = open.get(tieKey) ?? [];
        list.push({ note: pn, voice: n.voice, staff: n.staff, occ: o.occ });
        open.set(tieKey, list);
      }
    }
  }
  const kept = withoutHiddenCrossHandDoubles(out, source, occurrences, bag);
  kept.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  return { notes: kept, warnings: bag.list() };
}

/**
 * Hidden notes (print-object="no") are the file's own playback help: they
 * sound, but nothing in the printed music shows them. Some files add hidden
 * notes that repeat keys of printed notes, such as a rolled chord written out
 * in hidden grace notes in the other hand's staff. Where such a note would
 * strike a key the other hand is already holding for a printed note, no
 * pianist could play it without letting go of that key, so it is left out
 * (with an info note). Only notes made of hidden notes alone are left out,
 * after ties are joined, so a hidden note tied into a printed one stays.
 * Doublings within one hand are reconciled by physical.ts instead.
 */
function withoutHiddenCrossHandDoubles(
  notes: PerformanceNote[],
  source: SourceScore,
  occurrences: readonly MeasureOccurrence[],
  bag: WarningBag,
): PerformanceNote[] {
  const hiddenIds = new Set(source.notes.filter((n) => !n.printed).map((n) => n.id));
  if (hiddenIds.size === 0) return notes;
  const hiddenOnly = (pn: PerformanceNote): boolean => pn.sourceNoteIds.every((id) => hiddenIds.has(id));
  /** Per key: the printed notes and the hidden-only notes, each in start order. */
  const byKey = new Map<number, { printed: PerformanceNote[]; hidden: PerformanceNote[] }>();
  for (const pn of notes) {
    let entry = byKey.get(pn.midi);
    if (!entry) byKey.set(pn.midi, (entry = { printed: [], hidden: [] }));
    (hiddenOnly(pn) ? entry.hidden : entry.printed).push(pn);
  }
  const dropped = new Set<PerformanceNote>();
  for (const { printed, hidden } of byKey.values()) {
    if (hidden.length === 0 || printed.length === 0) continue;
    printed.sort((a, b) => a.startTick - b.startTick);
    hidden.sort((a, b) => a.startTick - b.startTick);
    // Sweep: the latest end of a printed note already struck, per hand.
    const heldUntil: Record<Hand, number> = { R: -Infinity, L: -Infinity };
    let k = 0;
    for (const h of hidden) {
      while (k < printed.length && printed[k].startTick <= h.startTick) {
        const p = printed[k++];
        heldUntil[p.hand] = Math.max(heldUntil[p.hand], p.endTick);
      }
      const other: Hand = h.hand === 'R' ? 'L' : 'R';
      if (heldUntil[other] > h.startTick) dropped.add(h);
    }
  }
  if (dropped.size === 0) return notes;
  // Reported in playing order, so the measure list reads front to back.
  for (const pn of [...dropped].sort((a, b) => a.startTick - b.startTick)) {
    const o = occurrences[pn.occ];
    bag.add(
      'other',
      'info',
      'Hidden playback notes that repeat a key the other hand is already holding are left out.',
      o ? [o.number] : [],
    );
  }
  return notes.filter((pn) => !dropped.has(pn));
}
