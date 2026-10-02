import { describe, expect, it } from 'vitest';
import { buildPerformanceNotes, unrollMeasures } from '../src/core/model/performance';
import type { HandMapping, PerformanceNote } from '../src/core/types';
import { ScoreBuilder, measureIndexes, occSummary } from './helpers/sourceBuilder';

describe('unrollMeasures: repeats and endings', () => {
  it('written order when there are no marks', () => {
    const s = new ScoreBuilder().measures(3).build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [2, 1, '3'],
    ]);
    expect(occurrences.map((o) => [o.occ, o.startTick, o.durationTicks])).toEqual([
      [0, 0, 16],
      [1, 16, 16],
      [2, 32, 16],
    ]);
    expect(warnings).toEqual([]);
  });

  it('simple ||: :|| repeat with a pickup measure', () => {
    const s = new ScoreBuilder()
      .measure({ number: '0', implicit: true, durationTicks: 4 })
      .measure({ number: '1', forward: true })
      .measure({ number: '2', backward: true })
      .measure({ number: '3' })
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '0'],
      [1, 1, '1'],
      [2, 1, '2'],
      [1, 2, '1 (2nd time)'],
      [2, 2, '2 (2nd time)'],
      [3, 1, '3'],
    ]);
    expect(occurrences.map((o) => o.startTick)).toEqual([0, 4, 20, 36, 52, 68]);
    expect(occurrences.map((o) => o.number)).toEqual(['0', '1', '2', '1', '2', '3']);
    expect(warnings).toEqual([]);
  });

  it('times=3 plays the section three times', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ backward: 3 })
      .measure()
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [0, 3, '1 (3rd time)'],
      [1, 3, '2 (3rd time)'],
      [2, 1, '3'],
    ]);
  });

  it('1st and 2nd endings', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure()
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'discontinue' })
      .measure()
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [2, 1, '3'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [3, 1, '4'],
      [4, 1, '5'],
    ]);
  });

  it('multi-measure endings', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1] })
      .measure({ endingStop: 'stop', backward: true })
      .measure({ endingStart: [2] })
      .measure({ endingStop: 'discontinue' })
      .measure()
      .build();
    expect(measureIndexes(unrollMeasures(s).occurrences)).toEqual([0, 1, 2, 0, 3, 4, 5]);
  });

  it('ending "1, 2" plus a 3rd ending (repeat count taken from the ending numbers)', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1, 2], endingStop: 'stop', backward: true })
      .measure({ endingStart: [3], endingStop: 'discontinue' })
      .measure()
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [0, 3, '1 (3rd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
    ]);
  });

  it('three separate endings, each of the first two with its own repeat sign', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'stop', backward: true })
      .measure({ endingStart: [3], endingStop: 'discontinue' })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [2, 1, '3'],
      [0, 3, '1 (3rd time)'],
      [3, 1, '4'],
    ]);
  });

  it('a 1st ending without a backward repeat sign still returns to the section start', () => {
    const s = new ScoreBuilder()
      .measure()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop' })
      .measure({ endingStart: [2], endingStop: 'discontinue' })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [2, 1, '3'],
      [1, 2, '2 (2nd time)'],
      [3, 1, '4'],
      [4, 1, '5'],
    ]);
    expect(warnings).toEqual([]);
  });

  it('a final ending that is never closed runs to the end', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2] })
      .measure()
      .build();
    expect(measureIndexes(unrollMeasures(s).occurrences)).toEqual([0, 1, 0, 2, 3]);
  });

  it('a backward repeat without a forward repeat goes back to the piece start', () => {
    const s = new ScoreBuilder().measure().measure({ backward: true }).measure().build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [2, 1, '3'],
    ]);
  });

  it('a second backward repeat without a forward repeat goes back to just after the previous one', () => {
    const s = new ScoreBuilder()
      .measure()
      .measure({ backward: true })
      .measure()
      .measure({ backward: true })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
      [2, 2, '3 (2nd time)'],
      [3, 2, '4 (2nd time)'],
    ]);
  });

  it('a backward repeat after a final ending goes back to just after that ending', () => {
    const s = new ScoreBuilder()
      .measure()
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'stop' })
      .measure()
      .measure({ backward: true })
      .build();
    expect(measureIndexes(unrollMeasures(s).occurrences)).toEqual([0, 1, 0, 2, 3, 4, 3, 4]);
  });

  it('two consecutive repeat sections', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ backward: true })
      .measure({ forward: true })
      .measure({ backward: true })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
      [2, 2, '3 (2nd time)'],
      [3, 2, '4 (2nd time)'],
    ]);
  });

  it.each([
    ['closed by a stop', 'stop' as const],
    ['closed by a discontinue', 'discontinue' as const],
    ['left open', undefined],
  ])('a 2nd ending that also opens the next repeated section is played (%s)', (_label, endingStop) => {
    // |: 1 | [1. 2 :| [2. ||: 3 | 4 :| 5
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop, forward: true })
      .measure({ backward: true })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
      [2, 2, '3 (2nd time)'],
      [3, 2, '4 (2nd time)'],
      [4, 1, '5'],
    ]);
    expect(warnings).toEqual([]);
  });

  it.each([
    [
      'after a first measure',
      // 1 | ||:[1. 2 :|| | [2. 3 | 4
      (b: ScoreBuilder) =>
        b
          .measure()
          .measure({ forward: true, endingStart: [1], endingStop: 'stop', backward: true })
          .measure({ endingStart: [2], endingStop: 'discontinue' })
          .measure(),
      ['1', '2', '3', '4'],
    ],
    [
      'followed by more music',
      // 1 | ||:[1. 2 :|| | [2. 3 | 4 | 5
      (b: ScoreBuilder) =>
        b
          .measure()
          .measure({ forward: true, endingStart: [1], endingStop: 'stop', backward: true })
          .measure({ endingStart: [2], endingStop: 'discontinue' })
          .measure()
          .measure(),
      ['1', '2', '3', '4', '5'],
    ],
    [
      'at the very start of the piece',
      // ||:[1. 1 :|| | [2. 2 | 3
      (b: ScoreBuilder) =>
        b
          .measure({ forward: true, endingStart: [1], endingStop: 'stop', backward: true })
          .measure({ endingStart: [2], endingStop: 'discontinue' })
          .measure(),
      ['1', '2', '3'],
    ],
    [
      'with a two-measure 1st ending',
      // 1 | ||:[1. 2 | 3 :|| | [2. 4 | 5
      (b: ScoreBuilder) =>
        b
          .measure()
          .measure({ forward: true, endingStart: [1] })
          .measure({ endingStop: 'stop', backward: true })
          .measure({ endingStart: [2], endingStop: 'discontinue' })
          .measure(),
      ['1', '2', '3', '4', '5'],
    ],
  ])('a 1st ending that starts on the ||: is skipped on the repeat and the 2nd ending is played (%s)', (_label, build, labels) => {
    const s = build(new ScoreBuilder()).build();
    const { occurrences, warnings } = unrollMeasures(s);
    // The 1st ending sounds once; going back to its own ||: means the
    // section's 2nd pass, which takes the 2nd ending.
    expect(occurrences.map((o) => o.label)).toEqual(labels);
    expect(warnings).toEqual([]);
  });
});

describe('unrollMeasures: D.C., D.S., Fine and Coda', () => {
  it('D.C. al Fine: inner repeats are not taken after the jump', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ backward: true })
      .measure({ fine: true })
      .measure({ daCapo: true })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '2 (2nd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
      [0, 3, '1 (3rd time)'],
      [1, 3, '2 (3rd time)'],
      [2, 2, '3 (2nd time)'],
    ]);
  });

  it('D.C. takes the last ending after the jump', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'discontinue', fine: true })
      .measure({ daCapo: true })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [0, 2, '1 (2nd time)'],
      [2, 1, '3'],
      [3, 1, '4'],
      [0, 3, '1 (3rd time)'],
      [2, 2, '3 (2nd time)'],
    ]);
  });

  it('D.S. al Fine', () => {
    const s = new ScoreBuilder()
      .measure()
      .measure({ segno: true, forward: true })
      .measure({ backward: true })
      .measure({ fine: true })
      .measure({ dalSegno: true })
      .build();
    expect(occSummary(unrollMeasures(s).occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [2, 1, '3'],
      [1, 2, '2 (2nd time)'],
      [2, 2, '3 (2nd time)'],
      [3, 1, '4'],
      [4, 1, '5'],
      [1, 3, '2 (3rd time)'],
      [2, 3, '3 (3rd time)'],
      [3, 2, '4 (2nd time)'],
    ]);
  });

  it('D.S. al Coda jumps at To Coda to the Coda measure', () => {
    const s = new ScoreBuilder()
      .measure()
      .measure({ segno: true })
      // MusicXML often puts a coda sign at the "To Coda" spot as well.
      .measure({ toCoda: true, coda: true })
      .measure()
      .measure({ dalSegno: true })
      .measure({ coda: true })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '2'],
      [2, 1, '3'],
      [3, 1, '4'],
      [4, 1, '5'],
      [1, 2, '2 (2nd time)'],
      [2, 2, '3 (2nd time)'],
      [5, 1, '6'],
      [6, 1, '7'],
    ]);
    expect(occurrences.map((o) => o.startTick)).toEqual([0, 16, 32, 48, 64, 80, 96, 112, 128]);
    expect(warnings).toEqual([]);
  });

  it('D.C. without Fine plays to the end once more', () => {
    const s = new ScoreBuilder().measure().measure({ daCapo: true }).measure().build();
    expect(measureIndexes(unrollMeasures(s).occurrences)).toEqual([0, 1, 0, 1, 2]);
  });
});

describe('unrollMeasures: malformed structures fall back to written order', () => {
  const straight = (n: number) => Array.from({ length: n }, (_, i) => [i, 1, String(i + 1)]);

  it('D.S. without a segno', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ backward: true })
      .measure({ dalSegno: true })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual(straight(4));
    expect(warnings).toEqual([
      {
        code: 'jump-unsupported',
        severity: 'review',
        message:
          'A "D.C.", "D.S." or "To Coda" instruction could not be followed because the sign it points to is missing, so the piece is played straight through as written, without repeats or jumps.',
        measures: ['3'],
        count: 1,
      },
    ]);
  });

  it('To Coda without a Coda measure', () => {
    const s = new ScoreBuilder()
      .measure({ toCoda: true })
      .measure({ daCapo: true })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual(straight(3));
    expect(warnings.map((w) => [w.code, w.severity, w.measures])).toEqual([['jump-unsupported', 'review', ['1']]]);
  });

  it('an ending with no readable number', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [], endingStop: 'stop', backward: true })
      .measure()
      .build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual(straight(3));
    expect(warnings.map((w) => [w.code, w.severity, w.measures])).toEqual([['repeats-unsupported', 'review', ['2']]]);
    expect(warnings[0].message).toContain('played straight through');
  });

  it('a repeat count that would unroll beyond 8x the measure count', () => {
    const s = new ScoreBuilder().measure({ forward: true }).measure({ backward: 50 }).build();
    const { occurrences, warnings } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual(straight(2));
    expect(warnings.map((w) => [w.code, w.severity])).toEqual([['repeats-unsupported', 'review']]);
  });

  it('an empty score has no occurrences', () => {
    expect(unrollMeasures(new ScoreBuilder().build())).toEqual({ occurrences: [], warnings: [] });
  });
});

const PIANO: HandMapping = {
  staffHands: { 'P1:1': 'R', 'P1:2': 'L' },
  excludedParts: [],
  source: 'two-staff-part',
  description: '',
};

function spans(notes: PerformanceNote[]): [number, number, number, string[]][] {
  return notes.map((n) => [n.midi, n.startTick, n.endTick, n.sourceNoteIds]);
}

describe('buildPerformanceNotes: ties in performance order', () => {
  it('merges a tie across a barline into one sounding note', () => {
    const s = new ScoreBuilder()
      .measures(2)
      .note({ measure: 0, beat: 2, dur: 2, midi: 60, tieStart: true })
      .note({ measure: 1, beat: 0, dur: 1, midi: 60, tieStop: true })
      .build();
    const { notes, warnings } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(spans(notes)).toEqual([[60, 8, 20, ['P1:0:0', 'P1:1:0']]]);
    expect(notes[0].id).toBe('P1:0:0@0');
    expect(notes[0].hand).toBe('R');
    expect(warnings).toEqual([]);
  });

  it('a tie chain of three notes is one note', () => {
    const s = new ScoreBuilder()
      .measures(3)
      .note({ measure: 0, dur: 4, midi: 48, staff: 2, tieStart: true })
      .note({ measure: 1, dur: 4, midi: 48, staff: 2, tieStart: true, tieStop: true })
      .note({ measure: 2, dur: 2, midi: 48, staff: 2, tieStop: true })
      .build();
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(spans(notes)).toEqual([[48, 0, 40, ['P1:0:0', 'P1:1:0', 'P1:2:0']]]);
    expect(notes[0].hand).toBe('L');
  });

  it('ties in chords match by pitch', () => {
    const s = new ScoreBuilder()
      .measures(2)
      .chord({ measure: 0, dur: 4, midis: [60, 64, 67], tieStart: true })
      .note({ measure: 1, dur: 2, midi: 60, tieStop: true })
      .note({ measure: 1, dur: 2, midi: 64, tieStop: true, chord: true })
      .note({ measure: 1, dur: 1, midi: 67, chord: true })
      .build();
    const { notes, warnings } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(spans(notes)).toEqual([
      [60, 0, 24, ['P1:0:0', 'P1:1:0']],
      [64, 0, 24, ['P1:0:1', 'P1:1:1']],
      [67, 0, 16, ['P1:0:2']],
      [67, 16, 20, ['P1:1:2']],
    ]);
    expect(warnings).toEqual([]);
  });

  it('prefers the open tie in the same voice', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .note({ measure: 0, beat: 0, dur: 2, midi: 64, voice: '1', tieStart: true })
      .note({ measure: 0, beat: 0, dur: 2, midi: 64, voice: '2', tieStart: true })
      .note({ measure: 0, beat: 2, dur: 2, midi: 64, voice: '2', tieStop: true })
      .build();
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(notes.map((n) => [n.voice, n.startTick, n.endTick])).toEqual([
      ['1', 0, 8],
      ['2', 0, 16],
    ]);
  });

  it('a tie leading out of a repeated section only joins on the pass that continues', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ backward: true })
      .measure()
      .note({ measure: 0, dur: 1, midi: 67 })
      .note({ measure: 1, beat: 3, dur: 1, midi: 64, tieStart: true })
      .note({ measure: 2, beat: 0, dur: 1, midi: 64, tieStop: true })
      .build();
    const { notes, warnings } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(spans(notes)).toEqual([
      [67, 0, 4, ['P1:0:0']],
      [64, 28, 32, ['P1:1:0']],
      [67, 32, 36, ['P1:0:0']],
      [64, 60, 68, ['P1:1:0', 'P1:2:0']],
    ]);
    expect(notes.map((n) => n.id)).toEqual(['P1:0:0@0', 'P1:1:0@1', 'P1:0:0@2', 'P1:1:0@3']);
    expect(warnings).toEqual([]);
  });

  it('a tie into the 2nd ending joins only when the performance predecessor holds the tied note', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'discontinue' })
      // G4 from measure 1 is tied into both endings: joins each time.
      .note({ measure: 0, beat: 3, dur: 1, midi: 67, tieStart: true })
      .note({ measure: 1, beat: 0, dur: 1, midi: 67, tieStop: true })
      .note({ measure: 2, beat: 0, dur: 1, midi: 67, tieStop: true })
      // E4 is written tied from the 1st ending into the 2nd ending, but in
      // performance the 2nd ending follows measure 1, so it is struck again.
      .note({ measure: 1, beat: 3, dur: 1, midi: 64, tieStart: true })
      .note({ measure: 2, beat: 0, dur: 2, midi: 64, tieStop: true })
      .build();
    const occs = unrollMeasures(s).occurrences;
    expect(measureIndexes(occs)).toEqual([0, 1, 0, 2]);
    const { notes, warnings } = buildPerformanceNotes(s, occs, PIANO);
    expect(spans(notes)).toEqual([
      [67, 12, 20, ['P1:0:0', 'P1:1:0']],
      [64, 28, 32, ['P1:1:1']],
      [67, 44, 52, ['P1:0:0', 'P1:2:0']],
      [64, 48, 56, ['P1:2:1']],
    ]);
    expect(warnings).toEqual([
      {
        code: 'tie-unmatched',
        severity: 'info',
        message: 'Some tied notes could not be joined to the note before them, so they are played as new notes.',
        measures: ['3'],
        count: 1,
      },
    ]);
  });

  it('drops notes on unmapped staves and excluded parts', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 3 })
      .part({ id: 'P2', name: 'Ossia', staves: 1 })
      .measures(1)
      .note({ part: 'P1', staff: 1, measure: 0, dur: 1, midi: 72 })
      .note({ part: 'P1', staff: 2, measure: 0, dur: 1, midi: 60 })
      .note({ part: 'P1', staff: 3, measure: 0, dur: 1, midi: 48 })
      .note({ part: 'P2', staff: 1, measure: 0, dur: 1, midi: 74 })
      .build();
    const mapping: HandMapping = {
      staffHands: { 'P1:1': 'R', 'P1:3': 'L', 'P2:1': 'R' },
      excludedParts: ['P2'],
      source: 'unclear',
      description: '',
    };
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, mapping);
    expect(notes.map((n) => [n.midi, n.hand])).toEqual([
      [48, 'L'],
      [72, 'R'],
    ]);
  });

  it('a cross-staff note keeps the hand of its voice', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .note({ staff: 2, voice: '5', measure: 0, beat: 0, dur: 1, midi: 48 })
      .note({ staff: 2, voice: '5', measure: 0, beat: 1, dur: 1, midi: 55 })
      .note({ staff: 1, voice: '5', measure: 0, beat: 2, dur: 1, midi: 64, crossStaff: true })
      .note({ staff: 1, voice: '1', measure: 0, beat: 0, dur: 4, midi: 72 })
      .build();
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(notes.map((n) => [n.midi, n.staff, n.hand])).toEqual([
      [48, 2, 'L'],
      [72, 1, 'R'],
      [55, 2, 'L'],
      [64, 1, 'L'],
    ]);
  });

  it('keeps velocity and spelling from the first segment', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .note({ measure: 0, dur: 1, midi: 61, velocity: 80 })
      .build();
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, PIANO);
    expect(notes[0].velocity).toBe(80);
    expect(notes[0].spelled).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(notes[0].occ).toBe(0);
    expect(notes[0].partId).toBe('P1');
  });
});
