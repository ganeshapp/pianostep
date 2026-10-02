import { describe, expect, it } from 'vitest';
import { buildPerformanceNotes, unrollMeasures } from '../src/core/model/performance';
import { buildKeyPresses } from '../src/core/model/physical';
import type { Hand, HandMapping, KeyPress, PerformanceNote } from '../src/core/types';
import { ScoreBuilder, spellSharp } from './helpers/sourceBuilder';

let serial = 0;
function pn(hand: Hand, midi: number, startTick: number, endTick: number, extra: Partial<PerformanceNote> = {}): PerformanceNote {
  const id = extra.id ?? `n${serial++}`;
  return {
    id,
    sourceNoteIds: [id],
    occ: 0,
    partId: 'P1',
    staff: hand === 'R' ? 1 : 2,
    voice: '1',
    hand,
    midi,
    spelled: spellSharp(midi),
    startTick,
    endTick,
    ...extra,
  };
}

function view(presses: KeyPress[]): [string, number, number, number, string[]][] {
  return presses.map((p) => [p.hand, p.midi, p.startTick, p.endTick, p.noteIds]);
}

const PIANO: HandMapping = {
  staffHands: { 'P1:1': 'R', 'P1:2': 'L' },
  excludedParts: [],
  source: 'two-staff-part',
  description: '',
};

describe('buildKeyPresses', () => {
  it('a unison in two voices is one press listing both notes, held to the longer end', () => {
    const { presses, warnings } = buildKeyPresses([
      pn('R', 60, 0, 8, { id: 'a', voice: '1' }),
      pn('R', 60, 0, 16, { id: 'b', voice: '2' }),
    ]);
    expect(view(presses)).toEqual([['R', 60, 0, 16, ['a', 'b']]]);
    expect(presses[0].id).toBe('R:60:0');
    expect(warnings).toEqual([]);
  });

  it('a held whole note overlapped by a quarter in another voice is struck again and held to the later end', () => {
    // Whole E4 in voice 1, quarter E4 in voice 2 on beat 3, through the real pipeline.
    const s = new ScoreBuilder()
      .measures(2)
      .note({ measure: 0, beat: 0, dur: 4, midi: 64, voice: '1' })
      .note({ measure: 0, beat: 2, dur: 1, midi: 64, voice: '2' })
      .build();
    const { occurrences } = unrollMeasures(s);
    const { notes } = buildPerformanceNotes(s, occurrences, PIANO);
    const { presses, warnings } = buildKeyPresses(notes, occurrences);
    expect(view(presses)).toEqual([
      ['R', 64, 0, 8, ['P1:0:0@0']],
      ['R', 64, 8, 16, ['P1:0:1@0']],
    ]);
    expect(warnings).toEqual([
      {
        code: 'voice-overlap-same-key',
        severity: 'info',
        message:
          'Two voices in one hand use the same key at the same time; the key is struck again at the second note and held until both notes end.',
        measures: ['1'],
        count: 1,
      },
    ]);
  });

  it('an overlapping later note that outlasts the first keeps its own end', () => {
    const { presses } = buildKeyPresses([pn('L', 48, 0, 8, { id: 'a' }), pn('L', 48, 4, 20, { id: 'b' })]);
    expect(view(presses)).toEqual([
      ['L', 48, 0, 4, ['a']],
      ['L', 48, 4, 20, ['b']],
    ]);
  });

  it('a note starting exactly when the previous one ends is a plain rearticulation without a warning', () => {
    const { presses, warnings } = buildKeyPresses([pn('R', 62, 0, 4, { id: 'a' }), pn('R', 62, 4, 8, { id: 'b' })]);
    expect(view(presses)).toEqual([
      ['R', 62, 0, 4, ['a']],
      ['R', 62, 4, 8, ['b']],
    ]);
    expect(warnings).toEqual([]);
  });

  it('the same key in both hands stays separate per hand', () => {
    const { presses } = buildKeyPresses([pn('L', 60, 0, 8, { id: 'l' }), pn('R', 60, 4, 12, { id: 'r' })]);
    expect(view(presses)).toEqual([
      ['L', 60, 0, 8, ['l']],
      ['R', 60, 4, 12, ['r']],
    ]);
  });

  it('zero-length notes are dropped and do not re-strike a held key', () => {
    const { presses, warnings } = buildKeyPresses([
      pn('R', 67, 0, 16, { id: 'held' }),
      pn('R', 67, 8, 8, { id: 'empty' }),
      pn('R', 72, 4, 4, { id: 'alone' }),
    ]);
    expect(view(presses)).toEqual([['R', 67, 0, 16, ['held']]]);
    expect(warnings).toEqual([
      { code: 'zero-length-note', severity: 'info', message: 'Some notes have no length and are left out.', count: 2 },
    ]);
  });

  it('sorts by start, then right hand before left, then pitch', () => {
    const { presses } = buildKeyPresses([
      pn('L', 40, 0, 4),
      pn('R', 76, 0, 4),
      pn('L', 36, 0, 4),
      pn('R', 72, 0, 4),
      pn('R', 74, 4, 8),
      pn('L', 43, 2, 4),
    ]);
    expect(presses.map((p) => [p.startTick, p.hand, p.midi])).toEqual([
      [0, 'R', 72],
      [0, 'R', 76],
      [0, 'L', 36],
      [0, 'L', 40],
      [2, 'L', 43],
      [4, 'R', 74],
    ]);
  });

  it('uses the loudest velocity of a unison', () => {
    const { presses } = buildKeyPresses([
      pn('R', 60, 0, 4, { velocity: 50 }),
      pn('R', 60, 0, 4, { velocity: 90 }),
      pn('R', 62, 0, 4),
    ]);
    expect(presses.map((p) => p.velocity)).toEqual([90, undefined]);
  });

  it('three overlapping voices on one key yield three presses that never release early', () => {
    const { presses, warnings } = buildKeyPresses([
      pn('R', 64, 0, 16, { id: 'a' }),
      pn('R', 64, 4, 8, { id: 'b' }),
      pn('R', 64, 6, 10, { id: 'c' }),
    ]);
    expect(view(presses)).toEqual([
      ['R', 64, 0, 4, ['a']],
      ['R', 64, 4, 6, ['b']],
      ['R', 64, 6, 16, ['c']],
    ]);
    expect(warnings.map((w) => [w.code, w.count])).toEqual([['voice-overlap-same-key', 2]]);
  });
});
