import { describe, expect, it } from 'vitest';
import { detectHandMapping } from '../src/core/model/hands';
import { buildPerformanceNotes, unrollMeasures } from '../src/core/model/performance';
import type { ScoreWarning, SourcePart } from '../src/core/types';
import { ScoreBuilder } from './helpers/sourceBuilder';

function codes(ws: ScoreWarning[]): [string, string][] {
  return ws.map((w) => [w.code, w.severity]);
}

/** Adds `count` quarter notes of `midi` to a part/staff across measure 0.. as needed. */
function fill(b: ScoreBuilder, part: string, staff: number, midi: number, count: number): ScoreBuilder {
  for (let k = 0; k < count; k++) b.note({ part, staff, measure: Math.floor(k / 4), beat: k % 4, dur: 1, midi });
  return b;
}

describe('detectHandMapping: automatic rules', () => {
  it('two-staff part: staff 1 is the right hand, staff 2 the left hand', () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 2, clefs: { 1: 'G', 2: 'F' } }).measures(1);
    fill(b, 'P1', 1, 72, 2);
    fill(b, 'P1', 2, 48, 2);
    const { mapping, warnings } = detectHandMapping(b.build());
    expect(mapping).toEqual({
      staffHands: { 'P1:1': 'R', 'P1:2': 'L' },
      excludedParts: [],
      source: 'two-staff-part',
      description: 'The upper staff of “Piano” is played by the right hand and the lower staff by the left hand.',
    });
    expect(warnings).toEqual([]);
  });

  it('never splits by middle C: staff 1 notes below C4 still go to the right hand', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2 })
      .measures(1)
      .note({ staff: 1, measure: 0, beat: 0, dur: 1, midi: 55 })
      .note({ staff: 1, measure: 0, beat: 1, dur: 1, midi: 43 })
      .note({ staff: 2, measure: 0, beat: 0, dur: 1, midi: 62 })
      .note({ staff: 2, measure: 0, beat: 1, dur: 1, midi: 74 })
      .build();
    const { mapping } = detectHandMapping(s);
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, mapping);
    expect(notes.map((n) => [n.midi, n.hand])).toEqual([
      [55, 'R'],
      [62, 'L'],
      [43, 'R'],
      [74, 'L'],
    ]);
  });

  it('two single-staff parts: the higher one is the right hand, whatever the order', () => {
    for (const upperFirst of [true, false]) {
      const b = new ScoreBuilder();
      const upper = { id: 'PU', name: 'Piano 1', staves: 1, clefs: { 1: 'G' } };
      const lower = { id: 'PL', name: 'Piano 2', staves: 1, clefs: { 1: 'F' } };
      if (upperFirst) b.part(upper).part(lower);
      else b.part(lower).part(upper);
      b.measures(1);
      fill(b, 'PU', 1, 67, 2);
      fill(b, 'PU', 1, 76, 1);
      fill(b, 'PL', 1, 41, 3);
      const { mapping, warnings } = detectHandMapping(b.build());
      expect(mapping).toEqual({
        staffHands: { 'PU:1': 'R', 'PL:1': 'L' },
        excludedParts: [],
        source: 'two-single-staff-parts',
        description: '“Piano 1” is played by the right hand and “Piano 2” by the left hand.',
      });
      expect(warnings).toEqual([
        {
          code: 'hands-from-separate-parts',
          severity: 'info',
          message: 'The two hands come from two separate parts: “Piano 1” for the right hand and “Piano 2” for the left hand.',
          count: 1,
        },
      ]);
    }
  });

  describe('two single-staff parts that may not be a piano piece', () => {
    function twoParts(upper: Partial<SourcePart>, lower: Partial<SourcePart>): ReturnType<typeof detectHandMapping> {
      const b = new ScoreBuilder()
        .part({ id: 'PU', name: '', staves: 1, clefs: { 1: 'G' } })
        .part({ id: 'PL', name: '', staves: 1, clefs: { 1: 'F' } })
        .measures(1);
      fill(b, 'PU', 1, 76, 4);
      fill(b, 'PL', 1, 48, 4);
      const s = b.build();
      s.parts[0] = { ...s.parts[0], ...upper };
      s.parts[1] = { ...s.parts[1], ...lower };
      return detectHandMapping(s);
    }

    it('a violin and a cello need review, with the pitch-based hands as a best guess', () => {
      const { mapping, warnings } = twoParts({ name: 'Violin', midiPrograms: [41] }, { name: 'Violoncello', midiPrograms: [43] });
      expect(mapping.staffHands).toEqual({ 'PU:1': 'R', 'PL:1': 'L' });
      expect(codes(warnings)).toEqual([
        ['hands-from-separate-parts', 'info'],
        ['multiple-instruments', 'review'],
      ]);
      expect(warnings[1].message).toBe(
        '“Violin” and “Violoncello” do not look like piano parts, so this file may be for other instruments. The higher part is given to the right hand and the lower part to the left hand as a best guess.',
      );
    });

    it('a flute with a piano part needs review and names only the flute', () => {
      const { warnings } = twoParts({ name: 'Flute', instrumentSounds: ['wind.flutes.flute'] }, { name: 'Piano' });
      expect(warnings.find((w) => w.code === 'multiple-instruments')?.message).toMatch(/^“Flute” does not look like a piano part/);
    });

    it.each([
      ['both named "Piano"', { name: 'Piano' }, { name: 'Piano' }],
      ['"Piano" and "Grand Piano"', { name: 'Piano' }, { name: 'Grand Piano' }],
      ['unnamed, with a General MIDI piano program', { midiPrograms: [1] }, { midiPrograms: [1] }],
      ['unnamed, with a keyboard sound', { instrumentSounds: ['keyboard.piano'] }, { instrumentSounds: ['keyboard.piano.grand'] }],
      ['named after the hands', { name: 'Right Hand' }, { name: 'L.H.' }],
      ['unnamed, with nothing declared', {}, {}],
    ])('two parts %s stay a ready two-hand piece', (_label, upper, lower) => {
      const { warnings } = twoParts(upper, lower);
      expect(codes(warnings)).toEqual([['hands-from-separate-parts', 'info']]);
    });
  });

  it('two single-staff parts with equal average pitch: the treble-clef part is the right hand', () => {
    const b = new ScoreBuilder()
      .part({ id: 'A', name: 'A', staves: 1, clefs: { 1: 'F' } })
      .part({ id: 'B', name: 'B', staves: 1, clefs: { 1: 'G' } })
      .measures(1);
    fill(b, 'A', 1, 60, 2);
    fill(b, 'B', 1, 60, 2);
    expect(detectHandMapping(b.build()).mapping.staffHands).toEqual({ 'B:1': 'R', 'A:1': 'L' });
  });

  it('an ossia part found by its words is left out (review)', () => {
    const b = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2 })
      .part({ id: 'P2', name: 'Part 2', staves: 1, words: ['Ossia'] })
      .measures(10);
    fill(b, 'P1', 1, 72, 30);
    fill(b, 'P1', 2, 48, 30);
    fill(b, 'P2', 1, 74, 12);
    const { mapping, warnings } = detectHandMapping(b.build());
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(mapping.excludedParts).toEqual(['P2']);
    expect(mapping.source).toBe('two-staff-part');
    expect(warnings).toEqual([
      {
        code: 'alternative-part-excluded',
        severity: 'review',
        message:
          '“Part 2” looks like an alternative version of the music, so it is left out and never played together with the main music.',
        count: 1,
      },
    ]);
  });

  it('a tiny part (under 3% of the largest) next to a two-staff part is an alternative', () => {
    const tiny = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, pitchedNoteCount: 200 })
      .part({ id: 'P2', name: 'Piano', staves: 1, pitchedNoteCount: 5 })
      .measures(1)
      .build();
    const r = detectHandMapping(tiny);
    expect(r.mapping.excludedParts).toEqual(['P2']);
    expect(r.mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(codes(r.warnings)).toEqual([['alternative-part-excluded', 'review']]);

    // Exactly 3% is not "fewer than 3%": it is treated as another instrument.
    const notTiny = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, pitchedNoteCount: 200 })
      .part({ id: 'P2', name: 'Flute', staves: 1, pitchedNoteCount: 6 })
      .measures(1)
      .build();
    const r2 = detectHandMapping(notTiny);
    expect(r2.mapping.excludedParts).toEqual(['P2']);
    expect(codes(r2.warnings)).toEqual([
      ['multiple-instruments', 'review'],
      ['extra-parts-excluded', 'review'],
    ]);
  });

  it('a "PianoVoorslagen" part (ornament realisation) is left out', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, pitchedNoteCount: 400 })
      .part({ id: 'P2', name: 'PianoVoorslagen', staves: 2, pitchedNoteCount: 120 })
      .measures(1)
      .build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping).toEqual({
      staffHands: { 'P1:1': 'R', 'P1:2': 'L' },
      excludedParts: ['P2'],
      source: 'two-staff-part',
      description: 'The upper staff of “Piano” is played by the right hand and the lower staff by the left hand.',
    });
    expect(codes(warnings)).toEqual([['alternative-part-excluded', 'review']]);
  });

  it('the largest part is never treated as an alternative, even if its words mention ornaments', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, words: ['ornaments ad lib.'], pitchedNoteCount: 300 })
      .measures(1)
      .build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(warnings).toEqual([]);
  });

  it('single staff: everything to the right hand (review)', () => {
    const s = new ScoreBuilder().part({ id: 'P1', name: 'Melody', staves: 1, pitchedNoteCount: 10 }).measures(1).build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping).toEqual({
      staffHands: { 'P1:1': 'R' },
      excludedParts: [],
      source: 'single-staff',
      description: '“Melody” has a single staff, so all of its notes are given to the right hand.',
    });
    expect(warnings).toEqual([
      {
        code: 'single-staff-part',
        severity: 'review',
        message:
          'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
        count: 1,
      },
    ]);
  });

  it('three staves: top staff right hand, bottom staff left hand, middle left out (unclear)', () => {
    const s = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3, pitchedNoteCount: 10 }).measures(1).build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
    expect(mapping.source).toBe('unclear');
    expect(warnings).toEqual([
      {
        code: 'unclear-hand-mapping',
        severity: 'review',
        message:
          'The piano music is written on 3 staves. The top staff is given to the right hand and the bottom staff to the left hand; the middle staff is left out.',
        count: 1,
      },
    ]);

    const four = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 4, pitchedNoteCount: 10 }).measures(1).build();
    const r4 = detectHandMapping(four);
    expect(r4.mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:4': 'L' });
    expect(r4.warnings[0].message).toContain('the 2 middle staves are left out');
  });

  it('multiple instruments: the first two-staff part is used and the rest are left out (review)', () => {
    const s = new ScoreBuilder()
      .part({ id: 'V', name: 'Violin', staves: 1, pitchedNoteCount: 80 })
      .part({ id: 'P', name: 'Piano', staves: 2, pitchedNoteCount: 100 })
      .part({ id: 'P2', name: 'Piano II', staves: 2, pitchedNoteCount: 120 })
      .part({ id: 'C', name: 'Cello', staves: 1, pitchedNoteCount: 60 })
      .part({ id: 'E', name: 'Empty', staves: 1, pitchedNoteCount: 0 })
      .measures(1)
      .build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping).toEqual({
      staffHands: { 'P:1': 'R', 'P:2': 'L' },
      excludedParts: ['V', 'P2', 'C'],
      source: 'two-staff-part',
      description: 'The upper staff of “Piano” is played by the right hand and the lower staff by the left hand.',
    });
    expect(warnings).toEqual([
      {
        code: 'multiple-instruments',
        severity: 'review',
        message: 'This file contains more than one instrument or player. Only “Piano” is used for practice.',
        count: 1,
      },
      {
        code: 'extra-parts-excluded',
        severity: 'review',
        message: '“Violin”, “Piano II” and “Cello” are left out.',
        count: 1,
      },
    ]);
  });

  it('several single-staff parts and no two-staff part: unclear, best guess on the largest part', () => {
    const s = new ScoreBuilder()
      .part({ id: 'A', name: 'Flute', staves: 1, pitchedNoteCount: 50 })
      .part({ id: 'B', name: 'Oboe', staves: 1, pitchedNoteCount: 70 })
      .part({ id: 'C', name: 'Bassoon', staves: 1, pitchedNoteCount: 40 })
      .measures(1)
      .build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping.staffHands).toEqual({ 'B:1': 'R' });
    expect(mapping.excludedParts).toEqual(['A', 'C']);
    expect(mapping.source).toBe('unclear');
    expect(codes(warnings)).toEqual([
      ['multiple-instruments', 'review'],
      ['extra-parts-excluded', 'review'],
      ['single-staff-part', 'review'],
      ['unclear-hand-mapping', 'review'],
    ]);
  });

  it('parts without notes are ignored; no notes at all is unclear with an empty map', () => {
    const s = new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, pitchedNoteCount: 0 })
      .measures(1)
      .build();
    const { mapping, warnings } = detectHandMapping(s);
    expect(mapping).toEqual({
      staffHands: {},
      excludedParts: [],
      source: 'unclear',
      description: 'No part with notes to play was found.',
    });
    expect(warnings).toEqual([]);
  });
});

describe('detectHandMapping: overrides', () => {
  const build = () =>
    new ScoreBuilder()
      .part({ id: 'P1', name: 'Piano', staves: 2, pitchedNoteCount: 300 })
      .part({ id: 'P2', name: 'Ossia', staves: 1, pitchedNoteCount: 30 })
      .measures(1)
      .build();

  it('excludeParts + staffHands replace the automatic map, with an info warning quoting the reason', () => {
    const { mapping, warnings } = detectHandMapping(build(), {
      excludeParts: ['P2'],
      staffHands: { 'P1:1': 'L', 'P1:2': 'R' },
      reason: 'The staves are swapped in this arrangement.',
    });
    expect(mapping).toEqual({
      staffHands: { 'P1:1': 'L', 'P1:2': 'R' },
      excludedParts: ['P2'],
      source: 'override',
      description: 'The hands follow a checked setting for this arrangement: The staves are swapped in this arrangement.',
    });
    expect(warnings).toEqual([
      {
        code: 'other',
        severity: 'info',
        message: 'The hands follow a checked setting for this arrangement: The staves are swapped in this arrangement.',
        count: 1,
      },
      {
        code: 'alternative-part-excluded',
        severity: 'info',
        message: '“Ossia” is an alternative version of the music and is left out.',
        count: 1,
      },
    ]);
  });

  it('excludeParts alone confirms the exclusion and keeps automatic mapping for the rest', () => {
    const { mapping, warnings } = detectHandMapping(build(), { excludeParts: ['P2'], reason: 'Ossia checked.' });
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(mapping.excludedParts).toEqual(['P2']);
    expect(mapping.source).toBe('two-staff-part');
    expect(codes(warnings)).toEqual([
      ['other', 'info'],
      ['alternative-part-excluded', 'info'],
    ]);
  });

  it('staffHands alone leaves unreferenced parts out', () => {
    const { mapping } = detectHandMapping(build(), { staffHands: { 'P1:1': 'R', 'P1:2': 'L' } });
    expect(mapping.excludedParts).toEqual(['P2']);
    expect(mapping.source).toBe('override');
    expect(mapping.description).toBe('The hands follow a checked setting for this arrangement.');
  });

  it('an override naming a part that is not in the file needs review', () => {
    const { mapping, warnings } = detectHandMapping(build(), {
      staffHands: { 'P1:1': 'R', 'P9:1': 'L' },
    });
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R' });
    expect(codes(warnings)).toEqual([
      ['other', 'info'],
      ['unclear-hand-mapping', 'review'],
    ]);
  });

  it('an empty override object behaves like no override', () => {
    expect(detectHandMapping(build(), {})).toEqual(detectHandMapping(build()));
    expect(detectHandMapping(build(), { voiceHands: [] })).toEqual(detectHandMapping(build()));
  });
});

describe('detectHandMapping and buildPerformanceNotes: a checked voice -> hand rule', () => {
  /**
   * Gymnopédie-style layout: the left hand's beat-2 chords are written in
   * voice 1 of the treble staff, the melody in voice 2, the bass on staff 2.
   * Measure 3's voice-1 chord really is the right hand's.
   */
  const build = () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 2 }).measures(3, { time: [3, 4] });
    for (let m = 0; m < 3; m++) {
      b.note({ staff: 2, voice: '5', measure: m, beat: 0, dur: 1, midi: 43 });
      b.chord({ staff: 1, voice: '1', measure: m, beat: 1, dur: 2, midis: [59, 62, 66] });
      b.note({ staff: 1, voice: '2', measure: m, beat: 0, dur: 3, midi: 78 });
    }
    return b.build();
  };
  const rule = { voiceHands: [{ part: 'P1', voice: '1', hand: 'L' as const, measures: [[0, 1]] as [number, number][] }], reason: 'Checked.' };

  it('gives the voice to the named hand in the named measures only, and says so', () => {
    const s = build();
    const { mapping, warnings } = detectHandMapping(s, rule);
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(mapping.voiceHands).toEqual(rule.voiceHands);
    expect(mapping.description).toBe(
      'The upper staff of “Piano” is played by the right hand and the lower staff by the left hand. In measures 1–2, one voice of “Piano” is played by the left hand, whatever staff it is written on.',
    );
    expect(codes(warnings)).toEqual([['other', 'info']]);
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, mapping);
    const handsAt = (m: number) => notes.filter((n) => n.voice === '1' && s.notes.find((x) => x.id === n.sourceNoteIds[0])?.measureIndex === m).map((n) => n.hand);
    expect(handsAt(0)).toEqual(['L', 'L', 'L']);
    expect(handsAt(1)).toEqual(['L', 'L', 'L']);
    expect(handsAt(2)).toEqual(['R', 'R', 'R']);
    expect(notes.filter((n) => n.voice === '2').every((n) => n.hand === 'R')).toBe(true);
  });

  it('a rule without measures applies everywhere', () => {
    const s = build();
    const { mapping } = detectHandMapping(s, { voiceHands: [{ part: 'P1', voice: '1', hand: 'L' }] });
    expect(mapping.description).toContain('One voice of “Piano” is played by the left hand, whatever staff it is written on.');
    const { notes } = buildPerformanceNotes(s, unrollMeasures(s).occurrences, mapping);
    expect(notes.filter((n) => n.voice === '1').every((n) => n.hand === 'L')).toBe(true);
  });

  it('a rule naming a part that is not in the file needs review and is ignored', () => {
    const { mapping, warnings } = detectHandMapping(build(), { voiceHands: [{ part: 'P9', voice: '1', hand: 'L' }] });
    expect(mapping.voiceHands).toBeUndefined();
    expect(codes(warnings)).toContainEqual(['unclear-hand-mapping', 'review']);
  });
});
