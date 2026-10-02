import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import {
  listenStepTimes,
  passageDurationListen,
  passageDurationSteady,
  steadyStepTimes,
} from '../src/core/actions/timing';
import { L, R, buildMeasures, buildScore, tempoMap } from './helpers/pressBuilder';

// ticksPerQuarter 4: at 120 qpm one tick is 0.125 s; at 60 qpm it is 0.25 s.
const TEMPO = tempoMap([
  [0, 120],
  [16, 60],
]);

// Steps at ticks 0, 4, 16, 20, 24; the piece ends at 32 after an 8-tick rest.
const SCORE = buildScore([R('C4', 0, 4), R('E4', 4, 16), R('G4', 16, 20), R('A4', 20, 24)], buildMeasures(2));

function expectClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
}

describe('listenStepTimes', () => {
  const seq = deriveSteps(SCORE, ['R'], null);

  it('follows the tempo map across a tempo change', () => {
    expect(seq.steps.map((s) => s.tick)).toEqual([0, 4, 16, 20, 24]);
    expectClose(listenStepTimes(seq, TEMPO, 1), [0, 0.5, 2, 3, 4]);
  });

  it('speed 0.5 doubles and speed 2 halves every time', () => {
    expectClose(listenStepTimes(seq, TEMPO, 0.5), [0, 1, 4, 6, 8]);
    expectClose(listenStepTimes(seq, TEMPO, 2), [0, 0.25, 1, 1.5, 2]);
  });

  it('measures from the passage start, not from the piece start', () => {
    const passage = deriveSteps(SCORE, ['R'], { startOcc: 1, endOcc: 1 });
    expect(passage.startTick).toBe(16);
    expectClose(listenStepTimes(passage, TEMPO, 1), [0, 1, 2]);
  });

  it('handles a tempo change inside a passage that begins with a carried note', () => {
    const tempo = tempoMap([
      [0, 120],
      [24, 240],
    ]);
    const passage = deriveSteps(
      buildScore([L('C3', 0, 32), R('E4', 16, 28)], buildMeasures(2)),
      ['R', 'L'],
      { startOcc: 1, endOcc: 1 },
    );
    expect(passage.steps.map((s) => s.tick)).toEqual([16, 28, 32]);
    // 16..24 at 120 qpm = 1 s, then 4 ticks at 240 qpm = 0.25 s, then 4 more.
    expectClose(listenStepTimes(passage, tempo, 1), [0, 1.25, 1.5]);
    expect(passageDurationListen(passage, tempo, 1)).toBeCloseTo(1.5, 9);
  });

  it('rejects a non-positive or non-finite speed', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => listenStepTimes(seq, TEMPO, bad)).toThrow(RangeError);
      expect(() => passageDurationListen(seq, TEMPO, bad)).toThrow(RangeError);
    }
  });
});

describe('passageDurationListen', () => {
  const seq = deriveSteps(SCORE, ['R'], null);

  it('runs to the passage end, keeping trailing rest ticks after the last step', () => {
    expect(seq.steps[seq.steps.length - 1].tick).toBe(24);
    expect(seq.endTick).toBe(32);
    // 16 ticks at 120 qpm (2 s) + 16 ticks at 60 qpm (4 s), of which the last 8 are rest.
    expect(passageDurationListen(seq, TEMPO, 1)).toBeCloseTo(6, 9);
    expect(passageDurationListen(seq, TEMPO, 0.5)).toBeCloseTo(12, 9);
    expect(passageDurationListen(seq, TEMPO, 2)).toBeCloseTo(3, 9);
  });

  it('is measured from the passage start', () => {
    const passage = deriveSteps(SCORE, ['R'], { startOcc: 1, endOcc: 1 });
    expect(passageDurationListen(passage, TEMPO, 1)).toBeCloseTo(4, 9);
  });

  it('still has a length when the selected hand has nothing to play', () => {
    const silent = deriveSteps(SCORE, ['L'], null);
    expect(silent.steps).toEqual([]);
    expect(listenStepTimes(silent, TEMPO, 1)).toEqual([]);
    expect(passageDurationListen(silent, TEMPO, 1)).toBeCloseTo(6, 9);
  });
});

describe('steady steps', () => {
  const seq = deriveSteps(SCORE, ['R'], null);

  it('spaces steps evenly, whatever the rhythm', () => {
    expect(steadyStepTimes(seq, 1)).toEqual([0, 1, 2, 3, 4]);
    expectClose(steadyStepTimes(seq, 0.75), [0, 0.75, 1.5, 2.25, 3]);
  });

  it('gives one interval per step as the passage duration', () => {
    expect(passageDurationSteady(seq, 1)).toBe(5);
    expect(passageDurationSteady(seq, 0.75)).toBeCloseTo(3.75, 9);
    expect(passageDurationSteady(deriveSteps(SCORE, ['L'], null), 1)).toBe(0);
  });

  it('differs observably from Listen timing on an uneven rhythm', () => {
    const gaps = (t: number[]) => t.slice(1).map((v, i) => v - t[i]);
    expectClose(gaps(listenStepTimes(seq, TEMPO, 1)), [0.5, 1.5, 1, 1]);
    expectClose(gaps(steadyStepTimes(seq, 1)), [1, 1, 1, 1]);
  });

  it('rejects a non-positive step length', () => {
    expect(() => steadyStepTimes(seq, 0)).toThrow(RangeError);
    expect(() => passageDurationSteady(seq, -2)).toThrow(RangeError);
  });
});
