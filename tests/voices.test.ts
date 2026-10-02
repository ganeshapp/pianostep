/**
 * Voice home staves and cross-staff hand assignment (§10, §12): which hand
 * plays a note drawn on the other hand's staff.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPerformanceNotes, unrollMeasures } from '../src/core/model/performance';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { midiToLabel } from '../src/core/pitch';
import type { HandMapping, PreparedScore, SourceScore } from '../src/core/types';
import { voiceHomeStaves } from '../src/core/voices';
import { ScoreBuilder } from './helpers/sourceBuilder';

const SCORES_DIR = join(__dirname, '..', 'public', 'scores');
const PIANO: HandMapping = { staffHands: { 'P1:1': 'R', 'P1:2': 'L' }, excludedParts: [], source: 'two-staff-part', description: '' };

function library(file: string): PreparedScore {
  return prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(SCORES_DIR, file))), file));
}

/** Notes of the first occurrence of a written measure, per hand, as "label@offset". */
function handsIn(p: PreparedScore, number: string): { R: string[]; L: string[] } {
  const o = p.measures.find((m) => m.number === number);
  if (!o) throw new Error(`no measure ${number}`);
  const out = { R: [] as string[], L: [] as string[] };
  for (const n of p.notes) if (n.occ === o.occ) out[n.hand].push(`${midiToLabel(n.midi)}@${n.startTick - o.startTick}`);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Imported MusicXML                                                         */
/* ------------------------------------------------------------------------ */

const ATTRS =
  '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
  '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';

function n(step: string, octave: number, dur: number, staff: number, voice: string | null, extra = ''): string {
  const v = voice === null ? '' : `<voice>${voice}</voice>`;
  return `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${v}<staff>${staff}</staff></note>`;
}

function score(measures: string[], software: string | null = null): string {
  const enc = software ? `<identification><encoding><software>${software}</software></encoding></identification>` : '';
  const body = measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? ATTRS : ''}${m}</measure>`).join('');
  return `<?xml version="1.0"?><score-partwise version="4.0">${enc}<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}

function pressesOf(xml: string): string {
  const p = prepareScore(parseMusicXml(xml));
  return p.presses.map((k) => `${k.hand}${midiToLabel(k.midi)}@${k.startTick}`).join(' ');
}

describe('a voice id reused on both staves never moves a staff to the other hand', () => {
  /** Right hand E5 D5 C5 B4 over a left-hand whole-note C3, both written as the same voice. */
  const reused = (voice: string | null) =>
    score([
      n('E', 5, 1, 1, voice) + n('D', 5, 1, 1, voice) + n('C', 5, 1, 1, voice) + n('B', 4, 1, 1, voice) +
        '<backup><duration>4</duration></backup>' +
        n('C', 3, 4, 2, voice),
    ]);

  it('voice 1 on both staves: the bass staff stays with the left hand', () => {
    expect(pressesOf(reused('1'))).toBe('RE5@0 LC3@0 RD5@48 RC5@96 RB4@144');
    const s = parseMusicXml(reused('1'));
    expect(s.notes.filter((x) => x.crossStaff)).toEqual([]);
    expect(s.warnings.map((w) => w.code)).not.toContain('cross-staff-notes');
  });

  it('no <voice> element at all (every note reads as voice 1): same result', () => {
    expect(pressesOf(reused(null))).toBe('RE5@0 LC3@0 RD5@48 RC5@96 RB4@144');
  });

  it('a reused voice that never overlaps itself still keeps a staff that has no voice of its own', () => {
    // Voice 1 plays the right hand in measure 1 and the left hand in measure 2.
    const xml = score([
      n('E', 5, 1, 1, '1') + n('D', 5, 1, 1, '1') + n('C', 5, 1, 1, '1') + n('B', 4, 1, 1, '1'),
      n('C', 3, 2, 2, '1') + n('G', 2, 2, 2, '1'),
    ]);
    expect(pressesOf(xml)).toBe('RE5@0 RD5@48 RC5@96 RB4@144 LC3@192 LG2@288');
  });
});

describe('files that number voices separately on each staff', () => {
  const rest = (dur: number, staff: number, voice: string) =>
    `<note><rest/><duration>${dur}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  const back = '<backup><duration>4</duration></backup>';

  it('voice 2 is the right-hand alto in measures 1-2 and the left-hand tenor in measure 3', () => {
    // Voice 1 is the melody on the treble staff and the bass on the bass staff at the same time.
    const xml = score(
      [
        n('E', 5, 4, 1, '1') + back + n('C', 5, 1, 1, '2') + n('C', 5, 1, 1, '2') + n('B', 4, 1, 1, '2') + n('B', 4, 1, 1, '2') + back + n('C', 3, 4, 2, '1'),
        n('D', 5, 4, 1, '1') + back + n('A', 4, 1, 1, '2') + n('A', 4, 1, 1, '2') + n('G', 4, 1, 1, '2') + n('G', 4, 1, 1, '2') + back + n('G', 2, 4, 2, '1'),
        n('C', 5, 4, 1, '1') + back + n('C', 2, 4, 2, '1') + back + n('E', 3, 2, 2, '2') + n('G', 3, 2, 2, '2'),
      ],
      'Some Other Editor 1.0',
    );
    const p = prepareScore(parseMusicXml(xml));
    expect(handsIn(p, '3')).toEqual({ R: ['C5@0'], L: ['C2@0', 'E3@0', 'G3@96'] });
    expect(p.source.notes.filter((x) => x.crossStaff)).toEqual([]);
    expect(p.warnings.map((w) => w.code)).not.toContain('cross-staff-notes');
  });

  it('the hands take turns in voice 1, and the left hand has a voice 2 once', () => {
    const xml = score(
      [
        n('C', 5, 1, 1, '1') + n('D', 5, 1, 1, '1') + n('E', 5, 1, 1, '1') + n('F', 5, 1, 1, '1') + back + rest(4, 2, '1'),
        rest(4, 1, '1') + back + n('C', 3, 1, 2, '1') + n('D', 3, 1, 2, '1') + n('E', 3, 1, 2, '1') + n('F', 3, 1, 2, '1'),
        n('G', 5, 4, 1, '1') + back + rest(4, 2, '1'),
        rest(4, 1, '1') + back + n('G', 2, 4, 2, '2'),
      ],
      'Finale v26',
    );
    const p = prepareScore(parseMusicXml(xml));
    expect(handsIn(p, '2')).toEqual({ R: [], L: ['C3@0', 'D3@48', 'E3@96', 'F3@144'] });
    expect(handsIn(p, '4')).toEqual({ R: [], L: ['G2@0'] });
    expect(p.warnings.map((w) => w.code)).not.toContain('cross-staff-notes');
  });

  it('voice 1 = right hand and voice 2 = left hand: a right-hand measure drawn wholly on the bass staff stays cross-staff', () => {
    // The MusicXML tutorial's piano layout numbers voices for the whole part. In measure 3 the right-hand
    // line (voice 1) is drawn on the bass staff while the left hand's own voice 2 sounds there, so the
    // hands are not taking turns in voice 1: those notes are the right hand's, and that is flagged.
    const rh = (staff: number, notes: [string, number][]) => notes.map(([step, oct]) => n(step, oct, 1, staff, '1')).join('');
    const measure = (staff: number, notes: [string, number][], lh: [string, number]) => rh(staff, notes) + back + n(lh[0], lh[1], 4, 2, '2');
    const xml = score([
      measure(1, [['C', 5], ['E', 5], ['G', 5], ['E', 5]], ['C', 3]),
      measure(1, [['D', 5], ['F', 5], ['A', 5], ['F', 5]], ['G', 2]),
      measure(2, [['G', 3], ['B', 3], ['D', 4], ['B', 3]], ['G', 2]),
      measure(1, [['C', 5], ['G', 4], ['E', 4], ['C', 4]], ['C', 3]),
    ]);
    const p = prepareScore(parseMusicXml(xml));
    expect(p.source.notes.filter((x) => x.measureIndex === 2 && x.voice === '1').map((x) => x.crossStaff)).toEqual([true, true, true, true]);
    expect(handsIn(p, '3')).toEqual({ R: ['G3@0', 'B3@48', 'D4@96', 'B3@144'], L: ['G2@0'] });
    expect(p.warnings.find((w) => w.code === 'cross-staff-notes')).toMatchObject({ severity: 'review', measures: ['3'] });
    expect(p.readiness).toBe('review');
  });
});

describe('MuseScore exports: the voice number names the staff (voices 1-4 staff 1, 5-8 staff 2)', () => {
  /**
   * Measure 1: a voice-1 melody over bass voice 5. Measure 2: an upper-voice
   * chord (voice 2) written on the bass staff under the melody, as in the
   * closing bars of Chopin's E minor Prelude.
   */
  const measures = [
    n('E', 5, 1, 1, '1') + n('D', 5, 1, 1, '1') + n('C', 5, 1, 1, '1') + n('B', 4, 1, 1, '1') +
      '<backup><duration>4</duration></backup>' +
      n('E', 2, 4, 2, '5'),
    n('E', 4, 4, 1, '1') +
      '<backup><duration>4</duration></backup>' +
      n('G', 3, 4, 2, '2') + n('B', 3, 4, 2, '2', '<chord/>') +
      '<backup><duration>4</duration></backup>' +
      n('E', 2, 4, 2, '5'),
  ];
  const expected = 'RE5@0 LE2@0 RD5@48 RC5@96 RB4@144 RG3@192 RB3@192 RE4@192 LE2@192';

  it('an upper voice drawn entirely on the bass staff is played by the right hand and flagged cross-staff', () => {
    const xml = score(measures, 'MuseScore 3.6.2');
    expect(pressesOf(xml)).toBe(expected);
    const s = parseMusicXml(xml);
    expect(s.notes.filter((x) => x.crossStaff).map((x) => midiToLabel(x.midi))).toEqual(['G3', 'B3']);
    expect(s.warnings.find((w) => w.code === 'cross-staff-notes')?.measures).toEqual(['2']);
  });

  it('a file from another program that uses the same numbering is read the same way', () => {
    expect(pressesOf(score(measures, 'Some Editor 1.0'))).toBe(expected);
    expect(pressesOf(score(measures))).toBe(expected);
  });

  it('a file from another program that numbers its voices 1 and 2 per hand is read by the staff', () => {
    // Voice 2 is the whole left hand here: with no voice numbered 5 or above, the numbers say nothing about staves.
    const xml = score([n('E', 4, 4, 1, '1') + '<backup><duration>4</duration></backup>' + n('E', 2, 4, 2, '2')], 'Some Editor 1.0');
    expect(pressesOf(xml)).toBe('RE4@0 LE2@0');
  });
});

describe('voiceHomeStaves without a voice numbering', () => {
  function build(software: string | null, add: (b: ScoreBuilder) => ScoreBuilder): SourceScore {
    const s = add(new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 2 }).measures(2)).build();
    return { ...s, software };
  }

  it('a voice split evenly between the staves is decided measure by measure, not given wholly to the upper staff', () => {
    const s = build(null, (b) =>
      b
        .note({ staff: 1, voice: '1', measure: 0, beat: 0, dur: 4, midi: 76 })
        .note({ staff: 1, voice: '1', measure: 1, beat: 0, dur: 4, midi: 76 })
        // Voice 6: two notes in the treble in measure 1, two in the bass in measure 2.
        .note({ staff: 1, voice: '6', measure: 0, beat: 0, dur: 2, midi: 67 })
        .note({ staff: 1, voice: '6', measure: 0, beat: 2, dur: 2, midi: 69 })
        .note({ staff: 2, voice: '6', measure: 1, beat: 0, dur: 2, midi: 34 })
        .note({ staff: 2, voice: '6', measure: 1, beat: 2, dur: 2, midi: 36 }),
    );
    const home = voiceHomeStaves(s.notes, () => 2, null);
    expect(s.notes.map((x) => [x.midi, home.get(x)])).toEqual([
      [67, 1],
      [76, 1],
      [69, 1],
      [34, 2],
      [76, 1],
      [36, 2],
    ]);
  });

  it('a voice that moves to the other staff far from its home-staff notes is the other hand there', () => {
    // Voice 2 is an alto on the treble staff in measures 1-2 and a tenor on the bass staff in measure 5;
    // the other voices (1 treble, 3 bass) never change staff.
    const s = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 2 }).measures(5);
    for (let m = 0; m < 5; m++) {
      s.note({ staff: 1, voice: '1', measure: m, dur: 4, midi: 76 });
      s.note({ staff: 2, voice: '3', measure: m, dur: 4, midi: 36 });
    }
    for (let m = 0; m < 2; m++) for (let k = 0; k < 4; k++) s.note({ staff: 1, voice: '2', measure: m, beat: k, dur: 1, midi: 67 });
    s.note({ staff: 2, voice: '2', measure: 4, beat: 0, dur: 2, midi: 52 }).note({ staff: 2, voice: '2', measure: 4, beat: 2, dur: 2, midi: 55 });
    const score = { ...s.build(), software: null };
    const home = voiceHomeStaves(score.notes, () => 2, null);
    expect(score.notes.filter((x) => x.voice === '2' && x.measureIndex === 4).map((x) => home.get(x))).toEqual([2, 2]);
    expect(score.notes.filter((x) => x.voice === '2' && x.measureIndex < 2).every((x) => home.get(x) === 1)).toBe(true);
  });

  it('a voice that dips to the other staff next to its home-staff notes is still cross-staff', () => {
    // As above, but the tenor notes come in measure 3, right after the alto's measure 2.
    const s = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 2 }).measures(3);
    for (let m = 0; m < 3; m++) {
      s.note({ staff: 1, voice: '1', measure: m, dur: 4, midi: 76 });
      s.note({ staff: 2, voice: '3', measure: m, dur: 4, midi: 36 });
    }
    for (let m = 0; m < 2; m++) for (let k = 0; k < 4; k++) s.note({ staff: 1, voice: '2', measure: m, beat: k, dur: 1, midi: 67 });
    s.note({ staff: 2, voice: '2', measure: 2, beat: 0, dur: 2, midi: 59 });
    const score = { ...s.build(), software: null };
    const home = voiceHomeStaves(score.notes, () => 2, null);
    expect(score.notes.filter((x) => x.voice === '2' && x.measureIndex === 2).map((x) => home.get(x))).toEqual([1]);
  });

  it('a voice mostly on one staff keeps its home there: its few notes on the other staff are cross-staff', () => {
    const s = build(null, (b) =>
      b
        .note({ staff: 2, voice: '5', measure: 0, beat: 0, dur: 1, midi: 48 })
        .note({ staff: 2, voice: '5', measure: 0, beat: 1, dur: 1, midi: 55 })
        .note({ staff: 1, voice: '5', measure: 0, beat: 2, dur: 1, midi: 64, crossStaff: true })
        .note({ staff: 1, voice: '1', measure: 0, beat: 0, dur: 4, midi: 72 }),
    );
    const home = voiceHomeStaves(s.notes, () => 2, null);
    expect(s.notes.map((x) => [x.midi, home.get(x)])).toEqual([
      [48, 2],
      [72, 1],
      [55, 2],
      [64, 2],
    ]);
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(notes.map((x) => [x.midi, x.hand])).toEqual([
      [48, 'L'],
      [72, 'R'],
      [55, 'L'],
      [64, 'L'],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Library regressions                                                       */
/* ------------------------------------------------------------------------ */

describe('library: cross-staff voices go to the hand of their voice', () => {
  it("Chopin Prelude Op. 28 No. 4: the closing chords written on the bass staff are the right hand's", () => {
    const p = library('Prlude_No._4_in_E_Minor_Op._28_-_Frdric_Chopin.mxl');
    expect(handsIn(p, '24')).toEqual({
      R: ['E3@0', 'F#3@0', 'B3@0', 'E4@0', 'D#3@96', 'F#3@96', 'B3@96', 'D#4@96'],
      L: ['B1@0', 'B2@0', 'B1@96', 'F#2@96', 'B2@96'],
    });
    expect(handsIn(p, '25')).toEqual({ R: ['E3@0', 'G3@0', 'B3@0', 'E4@0'], L: ['E1@0', 'E2@0'] });
    // ...and the piece now says that some notes cross staves.
    expect(p.warnings.find((w) => w.code === 'cross-staff-notes')?.measures).toEqual(['24', '25']);
    expect(p.readiness).toBe('review');
  });

  it('Chopin Prelude Op. 28 No. 4 (other edition): the right-hand turn in measure 16 stays in the right hand', () => {
    const p = library('Prlude_Opus_28_No._4_in_E_Minor__Chopin.mxl');
    const m16 = handsIn(p, '16');
    for (const k of ['B4@0', 'A#4@36', 'A4@84', 'A#4@90']) {
      expect(m16.R).toContain(k);
      expect(m16.L).not.toContain(k);
    }
  });

  it('Moonlight Sonata, 3rd movement: the bass A#1 of voice 6 in measure 164 is played by the left hand', () => {
    const p = library('Sonate_No._14_Moonlight_3rd_Movement.mxl');
    const o = p.measures.find((m) => m.number === '164')!;
    const v6 = p.notes.filter((x) => x.occ === o.occ && x.voice === '6');
    expect(v6.map((x) => `${x.hand}${midiToLabel(x.midi)}`)).toEqual(['LA#1', 'LC#3']);
    expect(handsIn(p, '164').R).not.toContain('A#1@0');
    const o13 = p.measures.find((m) => m.number === '13')!;
    expect(new Set(p.notes.filter((x) => x.occ === o13.occ && x.voice === '6').map((x) => x.hand))).toEqual(new Set(['L']));
  });

  it("Mariage d'Amour: the left-hand arpeggio of voice 6 climbing into the treble in measure 81 stays in the left hand", () => {
    const p = library('Mariage_dAmour.mxl');
    const o = p.measures.find((m) => m.number === '81')!;
    const v6 = p.notes.filter((x) => x.occ === o.occ && x.voice === '6');
    expect(v6.length).toBeGreaterThan(10);
    expect(new Set(v6.map((x) => x.hand))).toEqual(new Set(['L']));
  });
});
