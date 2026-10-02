import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { eventsFromPresses, interpretCells, roundTrip } from '../src/core/actions/interpret';
import type { Hand, HandCell, PassageRange, StepSequence } from '../src/core/types';
import { HOLD, L, R, add, buildPresses, change, keys, measuresFromLengths, press, rel, replace } from './helpers/pressBuilder';
import type { PressSpec, ScoreInput } from './helpers/pressBuilder';
import {
  ALL_FIXTURES,
  releaseBetweenBlue,
  releaseBetweenRest,
  repeatWhileHeld,
  workedExample,
} from './helpers/actionFixtures';

const SELECTIONS: Hand[][] = [['R', 'L'], ['R'], ['L']];

/** Deep copy so mutations never leak into the derived original. */
const clone = (seq: StepSequence): StepSequence => JSON.parse(JSON.stringify(seq)) as StepSequence;

function stepAt(seq: StepSequence, tick: number) {
  const s = seq.steps.find((x) => x.tick === tick);
  if (!s) throw new Error(`no step at tick ${tick}`);
  return s;
}

function setCell(seq: StepSequence, tick: number, hand: Hand, cell: HandCell): StepSequence {
  const copy = clone(seq);
  stepAt(copy, tick).cells[hand] = cell;
  return copy;
}

describe('independence (§17)', () => {
  it('interpret.ts does not import derive.ts', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/core/actions/interpret.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*derive['"]/);
    expect(src).not.toMatch(/heldBefore|heldAfter|releaseOnly/);
  });

  it('roundTrip reads nothing from a step but tick and cells', () => {
    const seq = deriveSteps(repeatWhileHeld(), ['R'], null);
    const read = new Set<string>();
    const guarded = {
      ...seq,
      steps: seq.steps.map(
        (s) =>
          new Proxy(s, {
            get(target, prop, receiver) {
              read.add(String(prop));
              if (prop !== 'tick' && prop !== 'cells') throw new Error(`read step.${String(prop)}`);
              return Reflect.get(target, prop, receiver);
            },
          }),
      ),
    };
    expect(roundTrip(guarded).ok).toBe(true);
    expect([...read].sort()).toEqual(['cells', 'tick']);
  });

  it('roundTrip ignores derived attack/release/held fields entirely', () => {
    const seq = clone(deriveSteps(workedExample(), ['R'], null));
    for (const s of seq.steps) {
      s.attacks = { R: [1] };
      s.releases = {};
      s.heldBefore = { R: [2, 3] };
      s.heldAfter = {};
    }
    expect(roundTrip(seq)).toEqual({ ok: true, mismatches: [] });
  });
});

describe('interpretCells', () => {
  it('replays the §6 worked example into per-hand attacks and releases', () => {
    const seq = deriveSteps(workedExample(), ['R'], null);
    const result = interpretCells(seq.steps, ['R']);
    expect(result.errors).toEqual([]);
    expect(result.finalHeld).toEqual({ R: [] });
    expect(result.events.R).toEqual([
      { tick: 0, attacks: keys('C4'), releases: [] },
      { tick: 4, attacks: keys('E4'), releases: [] },
      { tick: 8, attacks: keys('G4'), releases: keys('E4') },
      { tick: 12, attacks: keys('F4'), releases: keys('G4') },
      { tick: 16, attacks: [], releases: keys('C4', 'F4') },
    ]);
  });

  it('a red re-press on a held key releases and strikes it again', () => {
    const result = interpretCells(
      [
        { tick: 0, cells: { R: replace(press('E4'), press('C4')) } },
        { tick: 4, cells: { R: change(add('E4', { repress: true })) } },
      ],
      ['R'],
    );
    expect(result.errors).toEqual([]);
    expect(result.events.R![1]).toEqual({ tick: 4, attacks: [64], releases: [64] });
    expect(result.finalHeld.R).toEqual([60, 64]);
  });

  it('"." on a silent hand is a no-op, but a step where nobody acts is reported', () => {
    const result = interpretCells(
      [
        { tick: 0, cells: { R: replace(press('C4')), L: { kind: 'rest', tokens: [] } } },
        { tick: 4, cells: { R: HOLD, L: HOLD } },
      ],
      ['R', 'L'],
    );
    expect(result.events.L).toEqual([]);
    expect(result.errors).toEqual(['step 1 (tick 4): no hand presses or releases anything']);
  });

  it('reports notation it cannot apply', () => {
    const errorsFor = (cells: HandCell[]) =>
      interpretCells(
        cells.map((c, i) => ({ tick: i * 4, cells: { R: c } })),
        ['R'],
      ).errors;
    expect(errorsFor([replace(press('C4')), change(rel('D4'))])).toContain(
      'step 1 (tick 4) R: blue release of 62, which is not held',
    );
    expect(errorsFor([replace(press('C4')), change(add('D4', { repress: true }))])).toContain(
      'step 1 (tick 4) R: red re-press of 62, which is not held',
    );
    expect(errorsFor([replace(press('E4'), press('C4')), change(add('E4'))])).toContain(
      'step 1 (tick 4) R: red 64 is already held but not marked as a re-press',
    );
    expect(errorsFor([replace(press('C4'), add('E4'))])).toContain(
      'step 0 (tick 0) R: normal stack mixed with red/blue tokens',
    );
    expect(errorsFor([replace(press('C4')), change(press('E4'), add('D4'))])).toContain(
      'step 1 (tick 4) R: red/blue change mixed with normal-stack tokens',
    );
    expect(errorsFor([change(add('C4'))])).toContain(
      "step 0 (tick 0) R: red/blue change where no key keeps sounding (should be a normal stack or '.')",
    );
    expect(errorsFor([replace(press('C4'), press('E4'))])).toContain(
      'step 0 (tick 0) R: tokens are not ordered highest first',
    );
  });
});

describe('eventsFromPresses', () => {
  it('lists a rearticulation as a release and an attack at the same tick', () => {
    const events = eventsFromPresses(buildPresses([R('C4', 0, 4), R('C4', 4, 8), L('C3', 0, 8)]), ['R']);
    expect(events).toEqual({
      R: [
        { tick: 0, attacks: [60], releases: [] },
        { tick: 4, attacks: [60], releases: [60] },
        { tick: 8, attacks: [], releases: [60] },
      ],
    });
  });
});

describe('roundTrip on the named fixtures', () => {
  for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
    it(`${name} round-trips for every hand selection and range`, () => {
      const score = fixture();
      const ranges: (PassageRange | null)[] = [null, ...score.measures.map((m) => ({ startOcc: m.occ, endOcc: m.occ }))];
      for (const hands of SELECTIONS) {
        for (const range of ranges) {
          const result = roundTrip(deriveSteps(score, hands, range));
          expect(result.mismatches).toEqual([]);
          expect(result.ok).toBe(true);
        }
      }
    });
  }
});

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomScore(rand: () => number): ScoreInput {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  // Optional 4-tick pickup and a short last bar, otherwise 8-tick measures.
  const lengths = rand() < 0.3 ? [4, 8, 8, 8, 4] : [8, 8, 8, 8];
  const total = lengths.reduce((a, b) => a + b, 0);
  const specs: PressSpec[] = [];
  for (const hand of ['R', 'L'] as Hand[]) {
    const base = hand === 'R' ? 60 : 43;
    // A small key pool forces chords (shared starts) and repeated keys.
    const pool = new Set<number>();
    const poolSize = int(2, 5);
    while (pool.size < poolSize) pool.add(base + int(0, 11));
    const grid = [1, 2, 4][int(0, 2)];
    for (const midi of pool) {
      // One key in one hand never overlaps itself (physical.ts guarantees
      // this); back-to-back presses (gap 0) are rearticulations.
      let cursor = int(0, 3) * grid;
      while (cursor < total) {
        const gap = rand() < 0.4 ? 0 : int(1, 3) * grid;
        const start = cursor + gap;
        if (start >= total) break;
        const end = Math.min(start + int(1, 6) * grid, total);
        if (end <= start) break;
        specs.push(hand === 'R' ? R(midi, start, end) : L(midi, start, end));
        cursor = end;
      }
    }
  }
  const measures = measuresFromLengths(lengths);
  return { presses: buildPresses(specs), measures, endTick: total };
}

/** Structural invariants of the derived fields the engine and Follow me rely on. */
function invariantErrors(seq: StepSequence): string[] {
  const errs: string[] = [];
  const fromPresses = eventsFromPresses(seq.presses, seq.hands);
  for (const h of seq.hands) {
    const derived = seq.steps
      .map((s) => ({ tick: s.tick, attacks: s.attacks[h]!, releases: s.releases[h]! }))
      .filter((e) => e.attacks.length > 0 || e.releases.length > 0);
    if (JSON.stringify(derived) !== JSON.stringify(fromPresses[h])) errs.push(`${h}: attacks/releases differ from presses`);
    seq.steps.forEach((s, i) => {
      const before = s.heldBefore[h]!;
      const expectedAfter = [...new Set([...before.filter((k) => !s.releases[h]!.includes(k)), ...s.attacks[h]!])].sort((a, b) => a - b);
      if (JSON.stringify(s.heldAfter[h]) !== JSON.stringify(expectedAfter)) errs.push(`${h} step ${i}: heldAfter inconsistent`);
      const prev = i === 0 ? [] : seq.steps[i - 1].heldAfter[h]!;
      if (JSON.stringify(before) !== JSON.stringify(prev)) errs.push(`${h} step ${i}: heldBefore != previous heldAfter`);
      const cell = s.cells[h]!;
      const actions = new Set(cell.tokens.map((t) => t.action));
      if (cell.kind === 'replace' && (actions.size !== 1 || !actions.has('press'))) errs.push(`${h} step ${i}: mixed replace`);
      if (cell.kind === 'change' && actions.has('press')) errs.push(`${h} step ${i}: mixed change`);
      if (cell.tokens.some((t, j) => j > 0 && cell.tokens[j - 1].midi <= t.midi)) errs.push(`${h} step ${i}: token order`);
    });
    const last = seq.steps[seq.steps.length - 1];
    if (last && last.heldAfter[h]!.length > 0) errs.push(`${h}: keys still held after the last step`);
  }
  seq.steps.forEach((s, i) => {
    const attacked = seq.hands.some((h) => s.attacks[h]!.length > 0);
    const released = seq.hands.some((h) => s.releases[h]!.length > 0);
    if (s.releaseOnly === attacked) errs.push(`step ${i}: releaseOnly flag wrong`);
    if (!attacked && !released) errs.push(`step ${i}: empty step`);
    if (s.index !== i) errs.push(`step ${i}: index ${s.index}`);
    if (s.tick < seq.startTick || s.tick > seq.endTick) errs.push(`step ${i}: tick outside passage`);
    if (s.occ < seq.range.startOcc || s.occ > seq.range.endOcc) errs.push(`step ${i}: occ outside range`);
  });
  return errs;
}

describe('roundTrip property test (seeded)', () => {
  it('500 random two-hand press sets round-trip for every hand selection and random ranges', () => {
    const rand = lcg(0x5eed);
    const seen = { repress: 0, carried: 0, releaseOnly: 0, change: 0, replaceChord: 0, steps: 0 };
    for (let n = 0; n < 500; n++) {
      const score = randomScore(rand);
      const count = score.measures.length;
      const ranges: (PassageRange | null)[] = [null];
      for (let r = 0; r < 2; r++) {
        const a = Math.floor(rand() * count);
        const b = a + Math.floor(rand() * (count - a));
        ranges.push({ startOcc: a, endOcc: b });
      }
      for (const hands of SELECTIONS) {
        for (const range of ranges) {
          const seq = deriveSteps(score, hands, range);
          const result = roundTrip(seq);
          result.mismatches.push(...invariantErrors(seq));
          if (result.mismatches.length > 0) {
            throw new Error(`case ${n} hands ${hands.join('')} range ${JSON.stringify(range)}:\n${result.mismatches.join('\n')}`);
          }
          seen.steps += seq.steps.length;
          for (const s of seq.steps) {
            if (s.releaseOnly) seen.releaseOnly++;
            for (const c of Object.values(s.cells)) {
              if (c.kind === 'change') seen.change++;
              if (c.kind === 'replace' && c.tokens.length > 1) seen.replaceChord++;
              if (c.tokens.some((t) => t.repress)) seen.repress++;
              if (c.tokens.some((t) => t.carried)) seen.carried++;
            }
          }
        }
      }
    }
    // The generator really exercises every notation feature.
    for (const [feature, count] of Object.entries(seen)) {
      expect(count, feature).toBeGreaterThan(100);
    }
  });
});

describe('roundTrip mutations must fail', () => {
  it('(a) a repress add-token replaced by a hold cell', () => {
    // The LH also moves at tick 8, so the column stays non-empty after the mutation.
    const score = {
      presses: buildPresses([R('C4', 0, 16), R('E4', 4, 8), R('E4', 8, 12), L('C3', 0, 8), L('G3', 8, 16)]),
      measures: measuresFromLengths([16]),
      endTick: 16,
    };
    const seq = deriveSteps(score, ['R', 'L'], null);
    expect(roundTrip(seq).ok).toBe(true);
    expect(stepAt(seq, 8).cells.R).toStrictEqual(change(add('E4', { repress: true })));
    const result = roundTrip(setCell(seq, 8, 'R', HOLD));
    expect(result.ok).toBe(false);
    // Held sets agree before and after tick 8 either way; only the attack
    // comparison sees the dropped repeat.
    expect(result.mismatches).toEqual(['R @ tick 8: source has attacks [64] releases [64], notation gives nothing']);
  });

  it("(a') the same mutation with one hand also leaves an empty column", () => {
    const seq = deriveSteps(repeatWhileHeld(), ['R'], null);
    const result = roundTrip(setCell(seq, 8, 'R', HOLD));
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'step 2 (tick 8): no hand presses or releases anything',
      'R @ tick 8: source has attacks [64] releases [64], notation gives nothing',
    ]);
  });

  it('(b) a blue release-only step deleted', () => {
    const seq = deriveSteps(releaseBetweenBlue(), ['R'], null);
    const mutated = clone(seq);
    mutated.steps = mutated.steps.filter((s) => s.tick !== 6).map((s, index) => ({ ...s, index }));
    const result = roundTrip(mutated);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'R @ tick 6: source has attacks [] releases [64], notation gives nothing',
      'R @ tick 16: source has attacks [] releases [60, 67], notation gives attacks [] releases [60, 64, 67]',
    ]);
  });

  it("(b') a '.' release-only step deleted", () => {
    const seq = deriveSteps(releaseBetweenRest(), ['R'], null);
    const mutated = clone(seq);
    mutated.steps = mutated.steps.filter((s) => s.tick !== 6);
    const result = roundTrip(mutated);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'R @ tick 6: source has attacks [] releases [60], notation gives nothing',
      'R @ tick 8: source has attacks [62] releases [], notation gives attacks [62] releases [60]',
    ]);
  });

  it('(c) a blue token removed', () => {
    const seq = deriveSteps(workedExample(), ['R'], null);
    expect(stepAt(seq, 8).cells.R).toStrictEqual(change(add('G4'), rel('E4')));
    const mutated = setCell(seq, 8, 'R', change(add('G4')));
    const result = roundTrip(mutated);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'R @ tick 8: source has attacks [67] releases [64], notation gives attacks [67] releases []',
      'R @ tick 16: source has attacks [] releases [60, 65], notation gives attacks [] releases [60, 64, 65]',
    ]);
  });

  it('(d) a normal stack turned into red tokens, so earlier keys wrongly continue', () => {
    const score = { presses: buildPresses([R('C4', 0, 4), R('E4', 0, 4), R('G4', 4, 8)]), measures: measuresFromLengths([8]), endTick: 8 };
    const seq = deriveSteps(score, ['R'], null);
    expect(stepAt(seq, 4).cells.R).toStrictEqual(replace(press('G4')));
    const mutated = setCell(seq, 4, 'R', change(add('G4')));
    const result = roundTrip(mutated);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'R @ tick 4: source has attacks [67] releases [60, 64], notation gives attacks [67] releases []',
      'R @ tick 8: source has attacks [] releases [67], notation gives attacks [] releases [60, 64, 67]',
    ]);
  });

  it("(d') red tokens over a continuing key turned into a normal stack", () => {
    const seq = deriveSteps(workedExample(), ['R'], null);
    const mutated = setCell(seq, 4, 'R', replace(press('E4')));
    const result = roundTrip(mutated);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain(
      'R @ tick 4: source has attacks [64] releases [], notation gives attacks [64] releases [60]',
    );
  });

  it('a carried press dropped from the starting setup', () => {
    const seq = deriveSteps(
      { presses: buildPresses([L('C3', 0, 32), R('E4', 16, 20)]), measures: measuresFromLengths([16, 16]), endTick: 32 },
      ['R', 'L'],
      { startOcc: 1, endOcc: 1 },
    );
    expect(seq.steps[0].cells.L).toStrictEqual(replace(press('C3', { carried: true })));
    const result = roundTrip(setCell(seq, 16, 'L', HOLD));
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      'step 2 (tick 32): no hand presses or releases anything',
      'L @ tick 16: source has attacks [48] releases [], notation gives nothing',
      'L @ tick 32: source has attacks [] releases [48], notation gives nothing',
    ]);
  });
});
