import { describe, expect, it } from 'vitest';
import { NO_PRESSES_REASON, chooseTitle, prepareScore } from '../src/core/model/prepare';
import { ScoreBuilder } from './helpers/sourceBuilder';

/** Two-staff piano piece with a repeat, a tie and a tempo. */
function sample(): ScoreBuilder {
  return new ScoreBuilder()
    .meta({ title: 'Little Piece', composer: 'Anon.', arranger: 'Someone' })
    .measure({ forward: true })
    .measure({ backward: true })
    .measure()
    .tempo(0, 0, 90)
    .note({ staff: 1, measure: 0, beat: 0, dur: 2, midi: 72 })
    .note({ staff: 1, measure: 0, beat: 2, dur: 2, midi: 74, tieStart: true })
    .note({ staff: 1, measure: 1, beat: 0, dur: 1, midi: 74, tieStop: true })
    .note({ staff: 1, measure: 1, beat: 1, dur: 3, midi: 76 })
    .note({ staff: 1, measure: 2, beat: 0, dur: 4, midi: 72 })
    .note({ staff: 2, measure: 0, beat: 0, dur: 4, midi: 48 })
    .note({ staff: 2, measure: 1, beat: 0, dur: 4, midi: 43 })
    .note({ staff: 2, measure: 2, beat: 0, dur: 4, midi: 48 });
}

describe('prepareScore', () => {
  it('builds the full performance model of a ready piece', () => {
    const p = prepareScore(sample().build());
    expect(p.meta).toEqual({ title: 'Little Piece', composer: 'Anon.', arranger: 'Someone' });
    expect(p.handMapping.source).toBe('two-staff-part');
    expect(p.measures.map((o) => o.label)).toEqual(['1', '2', '1 (2nd time)', '2 (2nd time)', '3']);
    expect(p.tempo).toEqual({ ticksPerQuarter: 4, points: [{ tick: 0, qpm: 90 }], defaulted: false });
    expect(p.presses.map((k) => [k.hand, k.midi, k.startTick, k.endTick])).toEqual([
      ['R', 72, 0, 8],
      ['L', 48, 0, 16],
      ['R', 74, 8, 20],
      ['L', 43, 16, 32],
      ['R', 76, 20, 32],
      ['R', 72, 32, 40],
      ['L', 48, 32, 48],
      ['R', 74, 40, 52],
      ['L', 43, 48, 64],
      ['R', 76, 52, 64],
      ['R', 72, 64, 80],
      ['L', 48, 64, 80],
    ]);
    expect(p.notes).toHaveLength(12);
    expect(p.notes.find((n) => n.startTick === 40)?.sourceNoteIds).toEqual(['P1:0:1', 'P1:1:0']);
    expect(p.endTick).toBe(80);
    expect(p.range).toEqual({ min: 43, max: 76 });
    expect(p.warnings).toEqual([]);
    expect(p.readiness).toBe('ready');
    expect(p.readinessReasons).toEqual([]);
  });

  it('a file without tempo gets 120 qpm and an info warning, and stays ready', () => {
    const s = new ScoreBuilder().measures(1).note({ measure: 0, dur: 1, midi: 60 }).note({ staff: 2, measure: 0, dur: 1, midi: 48 }).build();
    const p = prepareScore(s);
    expect(p.tempo).toEqual({ ticksPerQuarter: 4, points: [{ tick: 0, qpm: 120 }], defaulted: true });
    expect(p.warnings).toEqual([
      {
        code: 'no-tempo-in-file',
        severity: 'info',
        message: 'The file does not give a tempo, so the app chose 120 quarter notes per minute.',
        count: 1,
      },
    ]);
    expect(p.readiness).toBe('ready');
  });

  it('review warnings make the piece "review" and become the reasons', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Melody', staves: 1 })
      .measures(1)
      .tempo(0, 0, 100)
      .note({ measure: 0, dur: 1, midi: 60 })
      .build();
    const p = prepareScore(s);
    expect(p.readiness).toBe('review');
    expect(p.readinessReasons).toEqual([
      'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
    ]);
  });

  it('no presses after mapping is unsupported', () => {
    const p = prepareScore(new ScoreBuilder().measures(2).tempo(0, 0, 100).build());
    expect(p.presses).toEqual([]);
    expect(p.range).toBeNull();
    expect(p.endTick).toBe(32);
    expect(p.readiness).toBe('unsupported');
    expect(p.readinessReasons).toEqual([NO_PRESSES_REASON]);
  });

  it('an error-severity warning is unsupported even with notes', () => {
    const s = sample()
      .warning({ code: 'other', severity: 'error', message: 'This file uses a feature the app cannot read.' })
      .build();
    const p = prepareScore(s);
    expect(p.readiness).toBe('unsupported');
    expect(p.readinessReasons).toEqual(['This file uses a feature the app cannot read.']);
  });

  it('aggregates warnings per code across the source and model stages', () => {
    const s = new ScoreBuilder()
      .measure({ forward: true })
      .measure({ endingStart: [1], endingStop: 'stop', backward: true })
      .measure({ endingStart: [2], endingStop: 'discontinue' })
      .tempo(0, 0, 100)
      .note({ measure: 1, beat: 3, dur: 1, midi: 64, tieStart: true })
      .note({ measure: 2, beat: 0, dur: 1, midi: 64, tieStop: true })
      .note({ staff: 2, measure: 0, beat: 0, dur: 4, midi: 48 })
      .warning({
        code: 'tie-unmatched',
        severity: 'info',
        message: 'Some tied notes could not be joined to the note before them, so they are played as new notes.',
        measures: ['7'],
        count: 2,
      })
      .warning({ code: 'cross-staff-notes', severity: 'review', message: 'Some notes cross between the staves.', measures: ['2'], count: 1 })
      .build();
    const p = prepareScore(s);
    expect(p.warnings).toEqual([
      {
        code: 'tie-unmatched',
        severity: 'info',
        message: 'Some tied notes could not be joined to the note before them, so they are played as new notes.',
        measures: ['7', '3'],
        count: 3,
      },
      { code: 'cross-staff-notes', severity: 'review', message: 'Some notes cross between the staves.', measures: ['2'], count: 1 },
    ]);
    expect(p.readiness).toBe('review');
    expect(p.readinessReasons).toEqual(['Some notes cross between the staves.']);
  });

  it('warning messages never expose internal ids', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 3 })
      .part({ id: 'P2', name: 'Ossia', staves: 1 })
      .part({ id: 'P3', name: 'Violin', staves: 1 })
      .measure({ dalSegno: true })
      .note({ part: 'P1', staff: 1, measure: 0, dur: 4, midi: 64 })
      .note({ part: 'P1', staff: 1, measure: 0, beat: 2, dur: 1, midi: 64, voice: '2' })
      .note({ part: 'P1', staff: 3, measure: 0, dur: 0, midi: 40 })
      .note({ part: 'P1', staff: 3, measure: 0, dur: 1, midi: 120 })
      .note({ part: 'P2', measure: 0, dur: 1, midi: 70 })
      .note({ part: 'P3', measure: 0, dur: 1, midi: 70 })
      .build();
    const p = prepareScore(s);
    expect(p.warnings.map((w) => w.code).sort()).toEqual(
      [
        'alternative-part-excluded',
        'jump-unsupported',
        'multiple-instruments',
        'extra-parts-excluded',
        'unclear-hand-mapping',
        'no-tempo-in-file',
        'voice-overlap-same-key',
        'zero-length-note',
        'out-of-piano-range',
      ].sort(),
    );
    for (const w of p.warnings) expect(w.message).not.toMatch(/\bP\d\b|P\d:|@\d/);
    expect(p.warnings.find((w) => w.code === 'out-of-piano-range')).toEqual({
      code: 'out-of-piano-range',
      severity: 'review',
      message: 'Some notes are outside the 88 keys of a piano. They are kept as written, but the keyboard cannot show them.',
      measures: ['1'],
      count: 1,
    });
    expect(p.readiness).toBe('review');
  });

  it('does not repeat an out-of-range warning the parser already gave', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .tempo(0, 0, 100)
      .note({ measure: 0, dur: 1, midi: 110 })
      .warning({ code: 'out-of-piano-range', severity: 'review', message: 'Out of range.', measures: ['1'], count: 1 })
      .build();
    expect(prepareScore(s).warnings).toEqual([
      { code: 'out-of-piano-range', severity: 'review', message: 'Out of range.', measures: ['1'], count: 1 },
    ]);
  });

  it('applies overrides', () => {
    const s = sample().build();
    const p = prepareScore(s, { staffHands: { 'P1:1': 'L', 'P1:2': 'R' }, reason: 'Swapped staves.' });
    expect(p.handMapping.source).toBe('override');
    expect(p.presses[0]).toMatchObject({ hand: 'R', midi: 48, startTick: 0 });
    expect(p.readiness).toBe('ready');
  });
});

describe('prepareScore: one hand asked to reach too far at once', () => {
  /** A treble chord struck in measure 2 (and only there) over a bass note in measure 1. */
  function chordIn(midis: number[], staff = 1): ReturnType<ScoreBuilder['build']> {
    return new ScoreBuilder()
      .measures(3)
      .tempo(0, 0, 90)
      .note({ staff: 2, measure: 0, dur: 4, midi: 43 })
      .chord({ staff, measure: 1, beat: 1, dur: 1, midis })
      .note({ staff: 1, measure: 2, dur: 4, midi: 72 })
      .build();
  }

  it('a chord wider than a tenth in one hand needs review and names its measure', () => {
    // B3 D4 F#4 with F#5 (19 semitones), as in a Gymnopédie edition that writes the left hand's chords in the treble staff.
    const p = prepareScore(chordIn([59, 62, 66, 78]));
    const w = p.warnings.find((x) => x.code === 'hand-span-too-wide');
    expect(w).toMatchObject({ severity: 'review', measures: ['2'], count: 1 });
    expect(p.readiness).toBe('review');
    expect(p.readinessReasons).toEqual([w!.message]);
    expect(w!.message).not.toMatch(/these measures/);
  });

  it('a tenth (16 semitones) is still within reach', () => {
    const p = prepareScore(chordIn([48, 64]));
    expect(p.warnings.map((x) => x.code)).not.toContain('hand-span-too-wide');
    expect(p.readiness).toBe('ready');
  });

  it('only keys struck together count: a held note and a later wide reach are not one chord', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .tempo(0, 0, 90)
      .note({ staff: 1, measure: 0, beat: 0, dur: 4, midi: 84 })
      .note({ staff: 1, measure: 0, beat: 1, dur: 1, midi: 60 })
      .note({ staff: 2, measure: 0, beat: 0, dur: 4, midi: 36 })
      .build();
    expect(prepareScore(s).warnings.map((x) => x.code)).not.toContain('hand-span-too-wide');
  });

  it('both hands together may span the keyboard', () => {
    const s = new ScoreBuilder()
      .measures(1)
      .tempo(0, 0, 90)
      .chord({ staff: 1, measure: 0, dur: 4, midis: [72, 84] })
      .chord({ staff: 2, measure: 0, dur: 4, midis: [24, 36] })
      .build();
    expect(prepareScore(s).warnings.map((x) => x.code)).not.toContain('hand-span-too-wide');
  });
});

describe('chooseTitle', () => {
  it('falls back from title to the first credit line to "Untitled"', () => {
    expect(chooseTitle(new ScoreBuilder().meta({ title: 'Für Elise', credits: ['Other'] }).build())).toBe('Für Elise');
    expect(chooseTitle(new ScoreBuilder().meta({ title: '   ', credits: ['', '  Gymnopédie No. 1\nErik Satie'] }).build())).toBe(
      'Gymnopédie No. 1',
    );
    expect(chooseTitle(new ScoreBuilder().meta({ title: null, credits: [] }).build())).toBe('Untitled');
    expect(prepareScore(new ScoreBuilder().meta({ title: null, credits: ['Prelude'] }).build()).meta.title).toBe('Prelude');
  });
});
