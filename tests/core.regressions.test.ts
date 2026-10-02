/**
 * Regression tests for core import and model defects found in review: hidden
 * playback notes (written-out ornaments and doublings), glissandos, damaged
 * or hostile structure (absurd parts x measures, impossible pitches), warning
 * measure lists, and plain-language hand-mapping reasons. Each runs a small
 * MusicXML document (or the library file that exposed it) end to end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { roundTrip } from '../src/core/actions/interpret';
import { detectHandMapping } from '../src/core/model/hands';
import { mergeWarnings, WarningBag } from '../src/core/model/performance';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { WarningSink } from '../src/core/musicxml/warnings';
import { midiToLabel } from '../src/core/pitch';
import type { Hand, PreparedScore, StepSequence } from '../src/core/types';
import { ImportError } from '../src/core/xml';
import { ScoreBuilder } from './helpers/sourceBuilder';
import { cpuMs } from './helpers/cpuTime';

const LIBRARY = join(__dirname, '..', 'public', 'scores');

function prepareLibrary(file: string): PreparedScore {
  return prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(LIBRARY, file))), file));
}

/* ------------------------------------------------------------------------ */
/* A small MusicXML writer: one part "Piano" with two staves                 */
/* ------------------------------------------------------------------------ */

interface NoteSpec {
  /** "C#4", "Bb3"; omit for a rest. */
  key?: string;
  dur: number;
  voice?: number;
  staff?: number;
  chord?: boolean;
  grace?: boolean;
  tie?: ('start' | 'stop')[];
  hidden?: boolean;
  /** Extra elements inside <notations>. */
  notations?: string;
}

function pitchXml(key: string): string {
  const m = /^([A-G])(#|b)?(\d)$/.exec(key);
  if (!m) throw new Error(`bad key ${key}`);
  const alter = m[2] === '#' ? '<alter>1</alter>' : m[2] === 'b' ? '<alter>-1</alter>' : '';
  return `<pitch><step>${m[1]}</step>${alter}<octave>${m[3]}</octave></pitch>`;
}

function note(n: NoteSpec): string {
  const attrs = n.hidden ? ' print-object="no"' : '';
  const body = n.key ? pitchXml(n.key) : '<rest/>';
  const ties = (n.tie ?? []).map((t) => `<tie type="${t}"/>`).join('');
  const tied = (n.tie ?? []).map((t) => `<tied type="${t}"/>`).join('');
  const notations = n.notations || tied ? `<notations>${tied}${n.notations ?? ''}</notations>` : '';
  const duration = n.grace ? '' : `<duration>${n.dur}</duration>`;
  return (
    `<note${attrs}>${n.grace ? '<grace/>' : ''}${n.chord ? '<chord/>' : ''}${body}${duration}${ties}` +
    `<voice>${n.voice ?? 1}</voice><staff>${n.staff ?? 1}</staff>${notations}</note>`
  );
}

const notes = (...specs: NoteSpec[]): string => specs.map(note).join('');
const backup = (dur: number): string => `<backup><duration>${dur}</duration></backup>`;

/** 4/4, two staves; `extraAttributes` go into the first measure's <attributes>. */
function scoreXml(divisions: number, measures: string[], extraAttributes = ''): string {
  const body = measures
    .map((content, i) => {
      const attributes =
        i === 0
          ? `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time>` +
            '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>' +
            `<clef number="2"><sign>F</sign><line>4</line></clef>${extraAttributes}</attributes>`
          : '';
      return `<measure number="${i + 1}">${attributes}${content}</measure>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${body}</part></score-partwise>`
  );
}

function prepareXml(xml: string): PreparedScore {
  return prepareScore(parseMusicXml(xml));
}

/** "R C4 0-144": hand, key and tick span of every press. */
function pressList(p: PreparedScore, hand?: Hand): string[] {
  return p.presses
    .filter((x) => hand === undefined || x.hand === hand)
    .map((x) => `${x.hand} ${midiToLabel(x.midi)} ${x.startTick}-${x.endTick}`);
}

function checkedSteps(p: PreparedScore, hands: Hand[], range: { startOcc: number; endOcc: number } | null = null): StepSequence {
  const seq = deriveSteps(p, hands, range);
  expect(roundTrip(seq).mismatches).toEqual([]);
  return seq;
}

const codes = (p: PreparedScore): string[] => p.warnings.map((w) => w.code);

/** "+F#4" / "F4" / "-A4" / "." / "—" for one hand's cell. */
function cellText(seq: StepSequence, index: number, hand: Hand): string {
  const c = seq.steps[index].cells[hand];
  if (!c) return '';
  if (c.kind === 'hold') return '—';
  if (c.kind === 'rest') return '.';
  return c.tokens.map((t) => (t.action === 'press' ? '' : t.action === 'add' ? '+' : '-') + t.label).join(',');
}

/** Each step of a passage as "beat: RH-cell | LH-cell", beats counted from 1 in the step's measure. */
function stepLines(p: PreparedScore, seq: StepSequence): string[] {
  const tpq = p.source.ticksPerQuarter;
  return seq.steps.map((s, i) => {
    const o = p.measures[s.occ];
    const beat = (s.tick - o.startTick) / tpq + 1;
    const cells = seq.hands.map((h) => cellText(seq, i, h)).join(' | ');
    return `m${o.label} ${beat}: ${cells}`;
  });
}

/* ------------------------------------------------------------------------ */
/* Written-out ornaments that start partway through the note                 */
/* ------------------------------------------------------------------------ */

describe('a written-out ornament that starts after the note is struck (a turn after a held note)', () => {
  // divisions 16 (quarter = 16, 64th = 1); ticksPerQuarter 48, so one division = 3 ticks.
  const turn = '<ornaments><turn/></ornaments>';
  const lhRest = backup(64) + notes({ dur: 64, voice: 5, staff: 2 });

  it('the main note is struck on its beat and held until the hidden turn takes over', () => {
    // Quarter E5, then F4 dotted eighth with a turn whose hidden notes start on its last 16th, then A4.
    const p = prepareXml(
      scoreXml(16, [
        notes({ key: 'E5', dur: 16 }, { key: 'F4', dur: 12, notations: turn }, { key: 'A4', dur: 4 }, { key: 'C5', dur: 32 }) +
          backup(48) +
          notes(
            { dur: 8, voice: 2 },
            { key: 'F4', dur: 1, voice: 2, hidden: true },
            { key: 'G4', dur: 1, voice: 2, hidden: true },
            { key: 'F4', dur: 1, voice: 2, hidden: true },
            { key: 'E4', dur: 1, voice: 2, hidden: true },
            { dur: 36, voice: 2 },
          ) +
          lhRest,
      ]),
    );
    expect(pressList(p, 'R')).toEqual([
      'R E5 0-48',
      'R F4 48-72',
      'R F4 72-75',
      'R G4 75-78',
      'R F4 78-81',
      'R E4 81-84',
      'R A4 84-96',
      'R C5 96-192',
    ]);
    expect(codes(p)).not.toContain('ornament-not-played');
    expect(p.warnings.find((w) => w.code === 'other')?.message).toBe(
      'Where the file spells out a trill or other ornament with hidden notes, those notes are played in place of the main note shown, from where they start.',
    );
    expect(p.readiness).toBe('ready');
    checkedSteps(p, ['R', 'L']);
  });

  it('a tied note whose turn starts partway through it keeps sounding, tied, until the turn', () => {
    // C5 eighth, D5 eighth tied to D5 eighth with a turn (the hidden turn takes its last 16th), F5.
    const p = prepareXml(
      scoreXml(16, [
        notes(
          { key: 'C5', dur: 8 },
          { key: 'D5', dur: 8, tie: ['start'] },
          { key: 'D5', dur: 8, tie: ['stop'], notations: turn },
          { key: 'F5', dur: 40 },
        ) +
          backup(64) +
          notes(
            { dur: 20, voice: 2 },
            { key: 'D#5', dur: 1, voice: 2, hidden: true },
            { key: 'D5', dur: 1, voice: 2, hidden: true },
            { key: 'C5', dur: 1, voice: 2, hidden: true },
            { key: 'D5', dur: 1, voice: 2, hidden: true },
            { dur: 40, voice: 2 },
          ) +
          lhRest,
      ]),
    );
    expect(pressList(p, 'R')).toEqual([
      'R C5 0-24',
      'R D5 24-60',
      'R D#5 60-63',
      'R D5 63-66',
      'R C5 66-69',
      'R D5 69-72',
      'R F5 72-192',
    ]);
    for (const code of ['ornament-not-played', 'tie-unmatched']) expect(codes(p)).not.toContain(code);
    const seq = checkedSteps(p, ['R']);
    // No rest before the final release: the D5 is never let go early.
    expect(seq.steps.slice(0, -1).map((_, i) => cellText(seq, i, 'R'))).not.toContain('.');
  });

  it('Pathétique, 2nd movement m20-21: the tied D5 is held into its turn, and F4 is struck on beat 2 of m21', () => {
    const p = prepareLibrary('Sonate_No._8_Pathetique_2nd_Movement.mxl');
    expect(p.readiness).toBe('ready');
    const m20 = p.measures.find((o) => o.number === '20')!;
    const m21 = p.measures.find((o) => o.number === '21')!;
    const tpq = p.source.ticksPerQuarter;
    const seq = checkedSteps(p, ['R'], { startOcc: m20.occ, endOcc: m21.occ });
    const lines = stepLines(p, seq);
    // Beat 2 of either measure is never a rest: the score holds D5 there (m20) and strikes F4 (m21).
    expect(lines).not.toContain('m20 2: .');
    expect(lines).not.toContain('m21 2: .');
    expect(lines).toContain('m21 2: F4');
    expect(lines).toContain('m21 2.5: F4');
    expect(lines.indexOf('m21 2: F4')).toBe(lines.indexOf('m21 2.5: F4') - 1);
    // The D5 struck on beat 1.5 of m20 (tied over beat 2) sounds until its turn starts at beat 2.25.
    const d5 = p.presses.find((x) => x.hand === 'R' && midiToLabel(x.midi) === 'D5' && x.startTick === m20.startTick + tpq / 2);
    expect(d5?.endTick).toBe(m20.startTick + (tpq * 5) / 4);
    // F4 lasts from beat 2 to the turn on beat 2.5.
    const f4 = p.presses.find((x) => x.hand === 'R' && midiToLabel(x.midi) === 'F4' && x.startTick === m21.startTick + tpq);
    expect(f4?.endTick).toBe(m21.startTick + (tpq * 3) / 2);
  });
});

/* ------------------------------------------------------------------------ */
/* Hidden playback notes that double a printed note in the other hand        */
/* ------------------------------------------------------------------------ */

describe('hidden playback notes that repeat a key the other hand is holding', () => {
  it('are left out (with an info note); hidden notes on other keys still sound', () => {
    // RH F#4+A4 half notes; hidden LH grace notes roll D3 A3 F#4 A4 into the LH D3 below them.
    const p = prepareXml(
      scoreXml(4, [
        notes({ key: 'F#4', dur: 8 }, { key: 'A4', dur: 8, chord: true }, { dur: 8 }) +
          backup(16) +
          notes(
            { key: 'A3', dur: 0, voice: 5, staff: 2, grace: true, hidden: true },
            { key: 'F#4', dur: 0, voice: 5, staff: 2, grace: true, hidden: true },
            { key: 'A4', dur: 0, voice: 5, staff: 2, grace: true, hidden: true },
            { key: 'D3', dur: 8, voice: 5, staff: 2 },
            { dur: 8, voice: 5, staff: 2 },
          ),
      ]),
    );
    const lh = pressList(p, 'L').map((x) => x.split(' ')[1]);
    expect(lh).toEqual(['A3', 'D3']);
    expect(pressList(p, 'R')).toEqual(['R F#4 0-96', 'R A4 0-96']);
    const other = p.warnings.find((w) => w.code === 'other' && w.message.includes('other hand is already holding'));
    expect(other).toMatchObject({ severity: 'info', measures: ['1'] });
    expect(p.readiness).toBe('ready');
    checkedSteps(p, ['R', 'L']);
  });

  it('a hidden note in the same hand, or one tied into a printed note, is kept', () => {
    const p = prepareXml(
      scoreXml(4, [
        // RH C5 whole with a hidden C5 doubling it in the same hand; LH hidden G2 tied into a printed G2.
        notes({ key: 'C5', dur: 16 }) +
          backup(16) +
          notes({ key: 'C5', dur: 4, voice: 2, hidden: true }, { dur: 12, voice: 2 }) +
          backup(16) +
          notes(
            { key: 'G2', dur: 8, voice: 5, staff: 2, hidden: true, tie: ['start'] },
            { key: 'G2', dur: 8, voice: 5, staff: 2, tie: ['stop'] },
          ),
      ]),
    );
    expect(pressList(p, 'L')).toEqual(['L G2 0-192']);
    expect(pressList(p, 'R')).toEqual(['R C5 0-192']);
    expect(p.warnings.some((w) => w.message.includes('other hand is already holding'))).toBe(false);
  });

  it('a hidden note in the other hand on a key that hand has let go of is kept', () => {
    const p = prepareXml(
      scoreXml(4, [
        notes({ key: 'C4', dur: 4 }, { dur: 12 }) + backup(16) + notes({ dur: 4, voice: 5, staff: 2 }, { key: 'C4', dur: 4, voice: 5, staff: 2, hidden: true }, { dur: 8, voice: 5, staff: 2 }),
      ]),
    );
    expect(pressList(p)).toEqual(['R C4 0-48', 'L C4 48-96']);
  });

  it('G minor Bach (Original) m65: the LH never strikes F#4 or A4 while the RH holds them, and still rolls D3 A3 C4', () => {
    const p = prepareLibrary('G_Minor_Bach_Original.mxl');
    expect(p.readiness).toBe('ready');
    const m65 = p.measures.find((o) => o.number === '65')!;
    const end = m65.startTick + m65.durationTicks;
    const inM65 = p.presses.filter((x) => x.startTick >= m65.startTick && x.startTick < end);
    const rh = inM65.filter((x) => x.hand === 'R');
    for (const x of inM65.filter((y) => y.hand === 'L')) {
      const held = rh.some((r) => r.midi === x.midi && r.startTick <= x.startTick && x.startTick < r.endTick);
      expect(held, `LH ${midiToLabel(x.midi)} at ${x.startTick} while the RH holds it`).toBe(false);
    }
    const lhLabels = inM65.filter((x) => x.hand === 'L').map((x) => midiToLabel(x.midi));
    for (const k of ['D3', 'A3', 'C4']) expect(lhLabels).toContain(k);
    expect(lhLabels).not.toContain('F#4');
    expect(lhLabels).not.toContain('A4');
    checkedSteps(p, ['R', 'L'], { startOcc: m65.occ, endOcc: m65.occ });
  });
});

/* ------------------------------------------------------------------------ */
/* Glissando                                                                 */
/* ------------------------------------------------------------------------ */

describe('glissando and slide marks', () => {
  for (const mark of ['glissando', 'slide']) {
    it(`a <${mark}> marks the piece for review; its two end notes are played as before`, () => {
      const p = prepareXml(
        scoreXml(1, [
          notes(
            { key: 'C4', dur: 2, notations: `<${mark} type="start" line-type="wavy"/>` },
            { key: 'C6', dur: 2, notations: `<${mark} type="stop"/>` },
          ) +
            backup(4) +
            notes({ key: 'C3', dur: 4, voice: 5, staff: 2 }),
        ]),
      );
      expect(pressList(p)).toEqual(['R C4 0-96', 'L C3 0-192', 'R C6 96-192']);
      const w = p.warnings.find((x) => x.code === 'glissando-not-played');
      expect(w).toMatchObject({ severity: 'review', measures: ['1'], count: 1 });
      expect(w?.message).toMatch(/only its first and last notes are played/);
      expect(p.readiness).toBe('review');
    });
  }
});

/* ------------------------------------------------------------------------ */
/* Damaged or hostile structure                                              */
/* ------------------------------------------------------------------------ */

/** One part with `measures` one-note measures, plus `extraParts` parts holding one empty measure each. */
function manyPartsXml(measures: number, extraParts: number): string {
  const first =
    '<part id="P0"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>' +
    Array.from({ length: measures - 1 }, (_, i) => `<measure number="${i + 2}"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join('') +
    '</part>';
  const rest = Array.from({ length: extraParts }, (_, i) => `<part id="Q${i}"><measure/></part>`).join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list/>${first}${rest}</score-partwise>`;
}

describe('a tiny file with thousands of parts and measures', () => {
  it('is refused at once with a readable error instead of exhausting memory (6000 parts x 6000 measures)', () => {
    const xml = manyPartsXml(6000, 6000);
    const mxl = zipSync({ 'score.musicxml': strToU8(xml) }, { level: 9 });
    expect(mxl.length).toBeLessThan(40_000);
    let error: unknown = null;
    // CPU time, so a busy machine cannot fail it.
    const ms = cpuMs(() => {
      try {
        loadSourceScore(mxl, 'parts.mxl');
      } catch (e) {
        error = e;
      }
    });
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe('too-large');
    expect((error as ImportError).message).toBe('This score has too many parts and measures to open safely.');
    // Reading the XML itself takes most of this; the parts x measures work never starts.
    expect(ms).toBeLessThan(3000);
  });

  it('more than 200 parts, or more than 200,000 part-measures, is refused; a large real score is not', () => {
    const code = (xml: string): string | null => {
      try {
        parseMusicXml(xml);
        return null;
      } catch (e) {
        return e instanceof ImportError ? e.code : String(e);
      }
    };
    expect(code(manyPartsXml(1, 200))).toBe('too-large');
    expect(code(manyPartsXml(2000, 100))).toBe('too-large');
    // 40 parts of 2000 measures (80,000 part-measures) still opens.
    expect(code(manyPartsXml(2000, 39))).toBeNull();
  });

  it('a part with fewer measures than the others takes no work for the measures it lacks, and keeps its time signature', () => {
    // P1 has 500 measures; P2 has only 2 and sets 3/4, which P1 never states, so every column is 3/4.
    const p1 =
      '<part id="P1">' +
      Array.from({ length: 500 }, (_, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions></attributes>' : ''}<note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration></note></measure>`).join('') +
      '</part>';
    const p2 =
      '<part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration></note></measure>' +
      '<measure number="2"><note><pitch><step>D</step><octave>3</octave></pitch><duration>3</duration></note></measure></part>';
    const s = parseMusicXml(
      `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>RH</part-name></score-part><score-part id="P2"><part-name>LH</part-name></score-part></part-list>${p1}${p2}</score-partwise>`,
    );
    expect(s.measures.length).toBe(500);
    expect(s.measures.every((m) => m.timeSignature?.beats === 3 && m.timeSignature.beatType === 4)).toBe(true);
    expect(s.measures[499].startTick).toBe(499 * 3 * s.ticksPerQuarter);
    expect(s.notes.length).toBe(502);
    expect(s.warnings.map((w) => w.code)).not.toContain('measure-length-mismatch');
  });
});

describe('pitches no keyboard has', () => {
  const melody = (d: string) =>
    scoreXml(1, [
      notes({ key: 'C5', dur: 1 }) +
        `<note>${d}<duration>1</duration><voice>1</voice><staff>1</staff></note>` +
        notes({ key: 'E5', dur: 1 }, { key: 'F5', dur: 1 }) +
        backup(4) +
        notes({ key: 'C3', dur: 4, voice: 5, staff: 2 }),
    ]);


  it('a transposition far too large to be real is ignored, with a note', () => {
    const p = prepareXml(scoreXml(1, [notes({ key: 'C5', dur: 4 }) + backup(4) + notes({ key: 'C3', dur: 4, voice: 5, staff: 2 })], '<transpose><chromatic>100000000</chromatic></transpose>'));
    expect(pressList(p)).toEqual(['R C5 0-192', 'L C3 0-192']);
    expect(p.warnings.find((w) => w.code === 'other')?.message).toContain('A transposition in the file is too large to be real, so it was ignored.');
  });

  it.each([
    // MusicXML octaves run from 0 to 9.
    ['an octave of 100000', '<pitch><step>D</step><octave>100000</octave></pitch>'],
    ['an octave of 10', '<pitch><step>D</step><octave>10</octave></pitch>'],
    ['a negative octave', '<pitch><step>D</step><octave>-3</octave></pitch>'],
    // B9 (MIDI 131) is a readable MusicXML pitch, but no keyboard or sound has it.
    ['B9', '<pitch><step>B</step><octave>9</octave></pitch>'],
    ['an alteration of 1e8 semitones', '<pitch><step>D</step><alter>1e8</alter><octave>5</octave></pitch>'],
    ['an alteration of -1e8 semitones', '<pitch><step>D</step><alter>-100000000</alter><octave>5</octave></pitch>'],
  ])('a note beyond every keyboard (%s) is left out, never reaches the presses, and the piece is marked for review', (_, pitch) => {
    const p = prepareXml(melody(pitch));
    expect(pressList(p)).toEqual(['R C5 0-48', 'L C3 0-192', 'R E5 96-144', 'R F5 144-192']);
    expect(p.source.notes.every((n) => n.midi >= 0 && n.midi <= 127)).toBe(true);
    expect(p.warnings.find((w) => w.code === 'out-of-piano-range')?.severity).toBe('review');
    expect(p.warnings.find((w) => w.code === 'other')?.message).toContain('pitched beyond the range of any keyboard and were left out');
    expect(p.readiness).toBe('review');
  });

  it('a large but valid alteration still names a key (a library file of Mozart Sonata No. 16 spells D4 as F3 with nine sharps)', () => {
    const p = prepareXml(melody('<pitch><step>F</step><alter>9</alter><octave>4</octave></pitch>'));
    expect(pressList(p, 'R')).toEqual(['R C5 0-48', 'R D5 48-96', 'R E5 96-144', 'R F5 144-192']);
  });
});

/* ------------------------------------------------------------------------ */
/* Warning measure lists                                                     */
/* ------------------------------------------------------------------------ */

describe('warning measure lists say when they were cut short', () => {
  const label = (i: number) => String(i + 1);

  it('several notes in one measure: the list is complete, not truncated', () => {
    const sink = new WarningSink();
    sink.add('ornament-not-played', 0);
    sink.add('ornament-not-played', 0);
    const [w] = sink.toList(label);
    expect(w).toMatchObject({ count: 2, measures: ['1'] });
    expect(w.measuresTruncated).toBeUndefined();
  });

  it('more than 20 measures: 20 are listed and the list is marked truncated', () => {
    const sink = new WarningSink();
    for (let i = 0; i < 25; i++) sink.add('cross-staff-notes', i);
    const [w] = sink.toList(label);
    expect(w.measures?.length).toBe(20);
    expect(w.measuresTruncated).toBe(true);
  });

  it('WarningBag and mergeWarnings set the flag only when a measure really did not fit', () => {
    const bag = new WarningBag();
    bag.add('tie-unmatched', 'info', 'x', ['1']);
    bag.add('tie-unmatched', 'info', 'x', ['1']);
    expect(bag.list()[0].measuresTruncated).toBeUndefined();
    for (let i = 2; i <= 20; i++) bag.add('tie-unmatched', 'info', 'x', [String(i)]);
    bag.add('tie-unmatched', 'info', 'x', ['20']);
    expect(bag.list()[0].measuresTruncated).toBeUndefined();
    bag.add('tie-unmatched', 'info', 'x', ['21']);
    expect(bag.list()[0]).toMatchObject({ measuresTruncated: true });
    expect(bag.list()[0].measures?.length).toBe(20);

    const twenty = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const full = mergeWarnings([{ code: 'other', severity: 'info', message: 'a', measures: twenty }], [{ code: 'other', severity: 'info', message: 'b', measures: ['3'] }]);
    expect(full[0].measuresTruncated).toBeUndefined();
    const more = mergeWarnings([{ code: 'other', severity: 'info', message: 'a', measures: twenty }], [{ code: 'other', severity: 'info', message: 'b', measures: ['21'] }]);
    expect(more[0].measuresTruncated).toBe(true);
    const carried = mergeWarnings([{ code: 'other', severity: 'info', message: 'a', measures: ['1'], measuresTruncated: true }]);
    expect(carried[0].measuresTruncated).toBe(true);
  });

  it('a library piece: lists of fewer than 20 measures are complete even when many notes are affected', () => {
    const p = prepareLibrary('Mozart_-_Piano_Sonata_No._16_-_Allegro.mxl');
    const listed = p.warnings.filter((w) => w.measures !== undefined);
    expect(listed.some((w) => (w.count ?? 0) > w.measures!.length)).toBe(true);
    for (const w of listed) if (w.measures!.length < 20) expect(w.measuresTruncated, w.code).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ */
/* Hand-mapping reasons never ask the learner to read the staff              */
/* ------------------------------------------------------------------------ */

describe('readiness reasons for one-handed mappings', () => {
  const asksToRead = /check whether|which hand should|belong(s)? to the left hand/i;

  it('a single-staff part: says what the app does, without asking to check the notation', () => {
    const p = prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'f-single-staff.musicxml')))));
    expect(p.readiness).toBe('review');
    expect(p.readinessReasons.join(' ')).not.toMatch(asksToRead);
    expect(p.readinessReasons).toContain(
      'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
    );
  });

  it('a part where only one staff carries the main music: the same plain wording', () => {
    // Three staves; the second is hidden (an alternative) and the third is empty.
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(1);
    for (let k = 0; k < 4; k++) b.note({ staff: 1, voice: '1', measure: 0, beat: k, dur: 1, midi: 72 });
    b.note({ staff: 2, voice: '2', measure: 0, beat: 0, dur: 4, midi: 55 });
    const s = b.build();
    s.parts[0] = { ...s.parts[0], hiddenStaves: [2] };
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R' });
    const w = warnings.find((x) => x.code === 'unclear-hand-mapping');
    expect(w?.severity).toBe('review');
    expect(w?.message).toBe(
      'Only the top staff of the piano music has the main music, so the app gives all of it to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
    );
    expect(w?.message).not.toMatch(asksToRead);
  });
});
