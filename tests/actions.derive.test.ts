import { describe, expect, it } from 'vitest';
import { clipPresses, deriveSteps, rangeTicks } from '../src/core/actions/derive';
import type { Hand, HandCell, StepSequence } from '../src/core/types';
import {
  HOLD,
  L,
  R,
  REST,
  add,
  buildPresses,
  change,
  keys,
  measuresFromLengths,
  press,
  rel,
  replace,
  repress,
} from './helpers/pressBuilder';
import {
  heldIntoPassage,
  longLhHold,
  melodyWithRepeats,
  releaseBetweenBlue,
  releaseBetweenOtherHand,
  releaseBetweenRest,
  repeatInsideChord,
  repeatWhileHeld,
  restThenEntry,
  rhNoteLhChord,
  trailingRest,
  tripletsVsEighths,
  workedExample,
} from './helpers/actionFixtures';

const BOTH: Hand[] = ['R', 'L'];

const ticks = (seq: StepSequence): number[] => seq.steps.map((s) => s.tick);
const cells = (seq: StepSequence, h: Hand): HandCell[] => seq.steps.map((s) => s.cells[h]!);
const field = (seq: StepSequence, f: 'attacks' | 'releases' | 'heldBefore' | 'heldAfter', h: Hand): number[][] =>
  seq.steps.map((s) => s[f][h]!);
const releaseOnly = (seq: StepSequence): boolean[] => seq.steps.map((s) => s.releaseOnly);

describe('rangeTicks', () => {
  // A 4-tick pickup, two full measures, and a short final measure.
  const measures = measuresFromLengths([4, 16, 16, 8]);

  it('covers the whole piece for a null range', () => {
    expect(rangeTicks(measures, null)).toEqual({ startTick: 0, endTick: 44 });
  });

  it('spans only the first occurrence', () => {
    expect(rangeTicks(measures, { startOcc: 0, endOcc: 0 })).toEqual({ startTick: 0, endTick: 4 });
  });

  it('spans only the last occurrence', () => {
    expect(rangeTicks(measures, { startOcc: 3, endOcc: 3 })).toEqual({ startTick: 36, endTick: 44 });
  });

  it('spans inner occurrences inclusively, tolerating reversed or out-of-bounds input', () => {
    expect(rangeTicks(measures, { startOcc: 1, endOcc: 2 })).toEqual({ startTick: 4, endTick: 36 });
    expect(rangeTicks(measures, { startOcc: 2, endOcc: 1 })).toEqual({ startTick: 4, endTick: 36 });
    expect(rangeTicks(measures, { startOcc: -3, endOcc: 99 })).toEqual({ startTick: 0, endTick: 44 });
  });

  it('is empty when there are no measures', () => {
    expect(rangeTicks([], null)).toEqual({ startTick: 0, endTick: 0 });
  });
});

describe('clipPresses', () => {
  const presses = buildPresses([R('C4', 0, 8), R('D4', 8, 16), L('C3', 4, 20), R('E4', 16, 24), L('G3', 20, 24)]);

  it('clips to [start, end), flags carried presses and drops presses outside', () => {
    const clipped = clipPresses(presses, BOTH, 8, 20);
    expect(clipped.map((p) => [p.hand, p.midi, p.startTick, p.endTick, p.carried ?? false])).toEqual([
      ['R', 62, 8, 16, false],
      ['L', 48, 8, 20, true],
      ['R', 64, 16, 20, false],
    ]);
  });

  it('keeps only the requested hands and does not mutate the input', () => {
    const clipped = clipPresses(presses, ['R'], 8, 20);
    expect(clipped.map((p) => p.midi)).toEqual([62, 64]);
    expect(presses.find((p) => p.midi === 48)!.startTick).toBe(4);
    expect(presses.some((p) => p.carried)).toBe(false);
  });
});

describe('deriveSteps fixtures (§6, §7, §17)', () => {
  it('1: single-hand melody with replacements, a repeated note and a repeated chord', () => {
    const seq = deriveSteps(melodyWithRepeats(), BOTH, null);
    expect(ticks(seq)).toEqual([0, 4, 8, 12, 14, 16, 24]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      replace(press('D4')),
      // Repeated D4 with nothing else held: a normal stack, never '—'.
      replace(press('D4')),
      replace(press('E4'), press('C4')),
      replace(press('E4'), press('C4')),
      replace(press('G4')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual(Array(7).fill(HOLD));
    expect(field(seq, 'attacks', 'R')).toEqual([[60], [62], [62], [60, 64], [60, 64], [67], []]);
    expect(field(seq, 'releases', 'R')).toEqual([[], [60], [62], [62], [60, 64], [60, 64], [67]]);
    expect(field(seq, 'heldBefore', 'R')[2]).toEqual([62]);
    expect(field(seq, 'heldAfter', 'R')[2]).toEqual([62]);
    expect(releaseOnly(seq)).toEqual([false, false, false, false, false, false, true]);
    expect(seq.steps.map((s) => s.occ)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(seq.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('2: RH note and LH chord share one column', () => {
    const seq = deriveSteps(rhNoteLhChord(), BOTH, null);
    expect(ticks(seq)).toEqual([0, 8]);
    expect(seq.steps[0].cells).toStrictEqual({ R: replace(press('E4')), L: replace(press('G3'), press('C3')) });
    expect(seq.steps[1].cells).toStrictEqual({ R: REST, L: REST });
    expect(seq.steps[0].attacks).toEqual({ R: [64], L: [48, 55] });
    expect(seq.steps[0].heldAfter).toEqual({ R: [64], L: [48, 55] });
    expect(seq.steps[1].releases).toEqual({ R: [64], L: [48, 55] });
    expect(seq.steps[1].heldAfter).toEqual({ R: [], L: [] });
  });

  it('3: a long LH hold shows — while the RH changes', () => {
    const seq = deriveSteps(longLhHold(), BOTH, null);
    expect(ticks(seq)).toEqual([0, 4, 8, 12, 16]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), HOLD, HOLD, HOLD, REST]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      replace(press('D4')),
      replace(press('E4')),
      replace(press('F4')),
      REST,
    ]);
    expect(field(seq, 'heldAfter', 'L')).toEqual([[48], [48], [48], [48], []]);
    expect(field(seq, 'attacks', 'L')).toEqual([[48], [], [], [], []]);
  });

  it('4: the §6 worked example, exactly', () => {
    const seq = deriveSteps(workedExample(), ['R'], null);
    expect(ticks(seq)).toEqual([0, 4, 8, 12, 16]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      change(add('E4')),
      change(add('G4'), rel('E4')),
      change(rel('G4'), add('F4')),
      REST,
    ]);
    expect(field(seq, 'heldAfter', 'R')).toEqual([keys('C4'), keys('C4', 'E4'), keys('C4', 'G4'), keys('C4', 'F4'), []]);
    expect(releaseOnly(seq)).toEqual([false, false, false, false, true]);
  });

  it('5: a repeated note while another is held is a red re-press', () => {
    const seq = deriveSteps(repeatWhileHeld(), ['R'], null);
    expect(ticks(seq)).toEqual([0, 4, 8, 12, 16]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      change(add('E4')),
      change(repress('E4')),
      change(rel('E4')),
      REST,
    ]);
    const s = seq.steps[2];
    expect(s.attacks.R).toEqual([64]);
    expect(s.releases.R).toEqual([64]);
    // Held sets are identical before and after: only the attack list shows the repeat.
    expect(s.heldBefore.R).toEqual([60, 64]);
    expect(s.heldAfter.R).toEqual([60, 64]);
    expect(s.releaseOnly).toBe(false);
  });

  it('5b: a repress inside a mixed chord change is written once, ordered highest first', () => {
    const seq = deriveSteps(repeatInsideChord(), ['R'], null);
    expect(cells(seq, 'R')[2]).toStrictEqual(change(add('A4'), rel('G4'), repress('E4')));
    expect(seq.steps[2].attacks.R).toEqual(keys('E4', 'A4'));
    expect(seq.steps[2].releases.R).toEqual(keys('E4', 'G4'));
  });

  it('6a: a note ending between attacks while another continues gives a blue release-only step', () => {
    const seq = deriveSteps(releaseBetweenBlue(), ['R'], null);
    expect(ticks(seq)).toEqual([0, 6, 8, 16]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('E4'), press('C4')),
      change(rel('E4')),
      change(add('G4')),
      REST,
    ]);
    expect(releaseOnly(seq)).toEqual([false, true, false, true]);
  });

  it('6b: the only note ending between attacks gives a "." release-only step', () => {
    const seq = deriveSteps(releaseBetweenRest(), ['R'], null);
    expect(ticks(seq)).toEqual([0, 6, 8, 12]);
    expect(cells(seq, 'R')).toStrictEqual([replace(press('C4')), REST, replace(press('D4')), REST]);
    expect(releaseOnly(seq)).toEqual([false, true, false, true]);
  });

  it('6c: a release-only step from the other hand shows — for the holding hand', () => {
    const seq = deriveSteps(releaseBetweenOtherHand(), BOTH, null);
    expect(ticks(seq)).toEqual([0, 6, 8, 16]);
    expect(cells(seq, 'R')).toStrictEqual([replace(press('E4')), HOLD, HOLD, REST]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), REST, replace(press('G3')), REST]);
    expect(releaseOnly(seq)).toEqual([false, true, false, true]);
  });

  it('8: different rhythms in the two hands produce the union of step ticks', () => {
    const seq = deriveSteps(tripletsVsEighths(), BOTH, null);
    expect(ticks(seq)).toEqual([0, 4, 6, 8, 12]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C5')),
      replace(press('D5')),
      HOLD,
      replace(press('E5')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), HOLD, replace(press('G3')), HOLD, REST]);
    expect(seq.endTick).toBe(48);
  });

  it('9a: a rest then an entry, and the final note keeps its full duration', () => {
    const seq = deriveSteps(restThenEntry(), ['R'], null);
    expect(seq.startTick).toBe(0);
    expect(ticks(seq)).toEqual([4, 8, 12, 16]);
    expect(cells(seq, 'R')).toStrictEqual([replace(press('C4')), REST, replace(press('E4')), REST]);
    expect(seq.steps[0].heldBefore.R).toEqual([]);
    expect(seq.steps[3].tick - seq.steps[2].tick).toBe(4);
    expect(seq.steps[3].releases.R).toEqual([64]);
  });

  it('9b: a final note that stops early is released at its own end; the passage still ends at the bar', () => {
    const seq = deriveSteps(trailingRest(), ['R'], null);
    expect(ticks(seq)).toEqual([4, 8, 12, 14]);
    expect(seq.endTick).toBe(16);
  });

  it('10: a passage starting with held notes carries them in as the starting setup', () => {
    const seq = deriveSteps(heldIntoPassage(), BOTH, { startOcc: 1, endOcc: 1 });
    expect(seq.range).toEqual({ startOcc: 1, endOcc: 1 });
    expect(seq.startTick).toBe(16);
    expect(seq.endTick).toBe(32);
    expect(ticks(seq)).toEqual([16, 20, 24, 28, 32]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('E4', { carried: true })),
      replace(press('G4')),
      REST,
      replace(press('A4')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3', { carried: true })), HOLD, HOLD, HOLD, REST]);
    expect(seq.steps[0].heldBefore).toEqual({ R: [], L: [] });
    expect(seq.steps[0].attacks).toEqual({ R: [64], L: [48] });
    expect(field(seq, 'heldAfter', 'L')).toEqual([[48], [48], [48], [48], []]);
    // The passage end (tick 32, also the start of occurrence 2) belongs to the last selected occurrence.
    expect(seq.steps.map((s) => s.occ)).toEqual([1, 1, 1, 1, 1]);
    // A4 crosses the passage end and is released at endTick; D4 ended exactly at the start and is absent.
    expect(seq.steps[4].releases).toEqual({ R: [69], L: [48] });
    expect(seq.presses.map((p) => [p.hand, p.midi, p.startTick, p.endTick, p.carried ?? false])).toEqual([
      ['R', 64, 16, 20, true],
      ['L', 48, 16, 32, true],
      ['R', 67, 20, 24, false],
      ['R', 69, 28, 32, false],
    ]);
    expect(seq.usedKeys).toEqual([48, 64, 67, 69]);
    expect(seq.usedKeysByHand).toEqual({ R: [64, 67, 69], L: [48] });
  });

  it('10b: occurrences across a two-measure passage, including a step at the inner bar line', () => {
    const seq = deriveSteps(heldIntoPassage(), BOTH, { startOcc: 1, endOcc: 2 });
    expect(seq.endTick).toBe(48);
    expect(ticks(seq)).toEqual([16, 20, 24, 28, 32, 34, 36, 40]);
    expect(seq.steps.map((s) => s.occ)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(cells(seq, 'R').slice(3)).toStrictEqual([
      replace(press('A4')),
      change(add('B4')),
      change(rel('B4')),
      REST,
      HOLD,
    ]);
    expect(cells(seq, 'L')[7]).toStrictEqual(REST);
    expect(seq.usedKeys).toEqual([48, 64, 67, 69, 71]);
  });

  it('10c: the whole piece starts clean and puts the final release in the last occurrence', () => {
    const seq = deriveSteps(heldIntoPassage(), BOTH, null);
    expect(seq.range).toEqual({ startOcc: 0, endOcc: 2 });
    expect(seq.steps[0].cells).toStrictEqual({ R: HOLD, L: replace(press('C3')) });
    expect(seq.presses.some((p) => p.carried)).toBe(false);
    expect(seq.steps[1].cells.R).toStrictEqual(replace(press('D4')));
  });
});

describe('hand filtering (§8, fixture 13)', () => {
  it('RH only keeps only RH ticks and cells', () => {
    const seq = deriveSteps(tripletsVsEighths(), ['R'], null);
    expect(seq.hands).toEqual(['R']);
    expect(ticks(seq)).toEqual([0, 4, 8, 12]);
    expect(seq.steps.every((s) => Object.keys(s.cells).join() === 'R')).toBe(true);
    expect(cells(seq, 'R')).toStrictEqual([replace(press('C5')), replace(press('D5')), replace(press('E5')), REST]);
    expect(seq.usedKeysByHand).toEqual({ R: keys('C5', 'D5', 'E5') });
    expect(seq.usedKeys).toEqual(keys('C5', 'D5', 'E5'));
  });

  it('LH only keeps only LH ticks and cells', () => {
    const seq = deriveSteps(tripletsVsEighths(), ['L'], null);
    expect(seq.hands).toEqual(['L']);
    expect(ticks(seq)).toEqual([0, 6, 12]);
    expect(seq.steps.every((s) => Object.keys(s.cells).join() === 'L')).toBe(true);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), replace(press('G3')), REST]);
  });

  it('LH only on a long hold collapses to its press and release', () => {
    const seq = deriveSteps(longLhHold(), ['L'], null);
    expect(ticks(seq)).toEqual([0, 16]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), REST]);
  });

  it('a hand with nothing to play in the passage yields no steps rather than empty ones', () => {
    const seq = deriveSteps(melodyWithRepeats(), ['L'], null);
    expect(seq.steps).toEqual([]);
    expect(seq.usedKeys).toEqual([]);
    expect(seq.usedKeysByHand).toEqual({ L: [] });
  });

  it('never emits an empty practice step, and hand order is canonical (R, L)', () => {
    for (const fixture of [tripletsVsEighths, longLhHold, releaseBetweenOtherHand, heldIntoPassage]) {
      for (const hands of [['R'], ['L'], ['L', 'R']] as Hand[][]) {
        const seq = deriveSteps(fixture(), hands, null);
        expect(seq.hands).toEqual(hands.length === 2 ? ['R', 'L'] : hands);
        for (const s of seq.steps) {
          const acted = seq.hands.some((h) => s.attacks[h]!.length > 0 || s.releases[h]!.length > 0);
          expect(acted).toBe(true);
        }
      }
    }
  });
});

describe('cell form', () => {
  it('never mixes normal tokens with red/blue tokens and orders tokens highest first', () => {
    const all = [
      melodyWithRepeats,
      rhNoteLhChord,
      longLhHold,
      workedExample,
      repeatWhileHeld,
      repeatInsideChord,
      releaseBetweenBlue,
      releaseBetweenOtherHand,
      heldIntoPassage,
    ].flatMap((f) => deriveSteps(f(), BOTH, null).steps.flatMap((s) => Object.values(s.cells)));
    for (const cell of all) {
      const actions = new Set(cell.tokens.map((t) => t.action));
      if (cell.kind === 'replace') expect([...actions]).toEqual(['press']);
      if (cell.kind === 'change') expect(actions.has('press')).toBe(false);
      if (cell.kind === 'hold' || cell.kind === 'rest') expect(cell.tokens).toEqual([]);
      const midis = cell.tokens.map((t) => t.midi);
      expect(midis).toEqual([...midis].sort((a, b) => b - a));
      expect(new Set(midis).size).toBe(midis.length);
    }
  });

  it('labels tokens with sharp-only scientific names', () => {
    const seq = deriveSteps(
      { presses: buildPresses([R(61, 0, 4), R(70, 0, 4), L(21, 0, 4)]), measures: measuresFromLengths([16]), endTick: 16 },
      BOTH,
      null,
    );
    expect(seq.steps[0].cells.R!.tokens.map((t) => t.label)).toEqual(['A#4', 'C#4']);
    expect(seq.steps[0].cells.L!.tokens.map((t) => t.label)).toEqual(['A0']);
  });
});
