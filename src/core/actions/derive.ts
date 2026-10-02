import { HANDS } from '../types';
import type {
  ActionStep,
  Hand,
  HandCell,
  KeyPress,
  MeasureOccurrence,
  NoteToken,
  PassageRange,
  PreparedScore,
  StepSequence,
} from '../types';
import { midiToLabel } from '../pitch';

export interface TickSpan {
  startTick: number;
  endTick: number;
}

interface ResolvedRange {
  range: PassageRange;
  firstIndex: number;
  lastIndex: number;
}

function clampIndex(value: number, length: number): number {
  return Math.min(Math.max(Math.trunc(value), 0), length - 1);
}

/**
 * Turns a (possibly null, reversed or out-of-bounds) range into array indices.
 * `occ` is the 0-based performance index, so it doubles as the array index.
 */
function resolveRange(measures: readonly MeasureOccurrence[], range: PassageRange | null): ResolvedRange {
  if (measures.length === 0) {
    return { range: { startOcc: 0, endOcc: 0 }, firstIndex: -1, lastIndex: -1 };
  }
  let firstIndex = 0;
  let lastIndex = measures.length - 1;
  if (range) {
    const a = clampIndex(range.startOcc, measures.length);
    const b = clampIndex(range.endOcc, measures.length);
    firstIndex = Math.min(a, b);
    lastIndex = Math.max(a, b);
  }
  return {
    range: { startOcc: measures[firstIndex].occ, endOcc: measures[lastIndex].occ },
    firstIndex,
    lastIndex,
  };
}

/** Tick span of a passage: `[first occurrence start, last occurrence end)`. Null = whole piece. */
export function rangeTicks(measures: readonly MeasureOccurrence[], range: PassageRange | null): TickSpan {
  const { firstIndex, lastIndex } = resolveRange(measures, range);
  if (firstIndex < 0) return { startTick: 0, endTick: 0 };
  const last = measures[lastIndex];
  return { startTick: measures[firstIndex].startTick, endTick: last.startTick + last.durationTicks };
}

const HAND_ORDER: Record<Hand, number> = { R: 0, L: 1 };

function comparePresses(a: KeyPress, b: KeyPress): number {
  return a.startTick - b.startTick || HAND_ORDER[a.hand] - HAND_ORDER[b.hand] || a.midi - b.midi;
}

/**
 * Presses of the included hands that intersect `[startTick, endTick)`, clipped
 * to the passage. A press already down before the passage starts is part of
 * the starting setup: it is re-dated to `startTick` and flagged `carried`.
 */
export function clipPresses(
  presses: readonly KeyPress[],
  hands: readonly Hand[],
  startTick: number,
  endTick: number,
): KeyPress[] {
  const out: KeyPress[] = [];
  for (const p of presses) {
    if (!hands.includes(p.hand)) continue;
    const s = Math.max(p.startTick, startTick);
    const e = Math.min(p.endTick, endTick);
    if (e <= s) continue;
    const clipped: KeyPress = { ...p, noteIds: [...p.noteIds], startTick: s, endTick: e };
    if (p.startTick < startTick) clipped.carried = true;
    else delete clipped.carried;
    out.push(clipped);
  }
  return out.sort(comparePresses);
}

const ascending = (a: number, b: number): number => a - b;
const descending = (a: number, b: number): number => b - a;

function token(midi: number, action: NoteToken['action'], repress: boolean, carried: boolean): NoteToken {
  const t: NoteToken = { midi, label: midiToLabel(midi), action };
  if (repress) t.repress = true;
  if (carried) t.carried = true;
  return t;
}

/**
 * Canonical §6 cell for one hand at one instant.
 * `before` = keys held just before t, `starts` = S, `ends` = E.
 */
function cellFor(
  before: ReadonlySet<number>,
  starts: ReadonlySet<number>,
  ends: ReadonlySet<number>,
  carried: ReadonlySet<number>,
): HandCell {
  const continuing = [...before].filter((k) => !ends.has(k));
  if (starts.size === 0 && ends.size === 0) return { kind: 'hold', tokens: [] };
  if (starts.size === 0 && continuing.length === 0) return { kind: 'rest', tokens: [] };
  if (continuing.length === 0) {
    // Nothing survives this instant, so a plain stack says it all; a key that
    // ends and restarts here is struck again by the stack's implicit release.
    const tokens = [...starts].sort(descending).map((k) => token(k, 'press', false, carried.has(k)));
    return { kind: 'replace', tokens };
  }
  // Something keeps sounding: blue for what stops, red for what is struck.
  // A key that ends and restarts at the same instant is a rearticulation and
  // is written once, as a red re-press, never as blue + red.
  const releases = [...ends].filter((k) => !starts.has(k)).map((k) => token(k, 'release', false, false));
  const adds = [...starts].map((k) => token(k, 'add', before.has(k), carried.has(k)));
  const tokens = [...releases, ...adds].sort((a, b) => b.midi - a.midi);
  return { kind: 'change', tokens };
}

interface HandIndex {
  starts: Map<number, Set<number>>;
  ends: Map<number, Set<number>>;
  carried: Set<number>;
}

function addTo(map: Map<number, Set<number>>, tick: number, midi: number): void {
  let set = map.get(tick);
  if (!set) {
    set = new Set();
    map.set(tick, set);
  }
  set.add(midi);
}

const EMPTY: ReadonlySet<number> = new Set();

/**
 * Derives the action steps (§6, §7) for the selected hands and passage.
 * Steps exist exactly at the ticks where an included hand presses or releases
 * a key, so a tick where only an excluded hand acts never becomes a step.
 */
export function deriveSteps(
  score: Pick<PreparedScore, 'presses' | 'measures' | 'endTick'>,
  hands: readonly Hand[],
  range: PassageRange | null,
): StepSequence {
  const included = HANDS.filter((h) => hands.includes(h));
  const resolved = resolveRange(score.measures, range);
  const span = rangeTicks(score.measures, range);
  const startTick = span.startTick;
  const endTick = range === null ? Math.max(span.endTick, score.endTick) : span.endTick;

  const presses = clipPresses(score.presses, included, startTick, endTick);

  const index = new Map<Hand, HandIndex>();
  for (const h of included) index.set(h, { starts: new Map(), ends: new Map(), carried: new Set() });
  const tickSet = new Set<number>();
  for (const p of presses) {
    const hi = index.get(p.hand);
    if (!hi) continue;
    addTo(hi.starts, p.startTick, p.midi);
    addTo(hi.ends, p.endTick, p.midi);
    if (p.carried) hi.carried.add(p.midi);
    tickSet.add(p.startTick);
    tickSet.add(p.endTick);
  }
  const ticks = [...tickSet].sort(ascending);

  const held = new Map<Hand, Set<number>>(included.map((h) => [h, new Set<number>()]));
  let occIndex = resolved.firstIndex;
  const steps: ActionStep[] = ticks.map((tick, i) => {
    const step: ActionStep = {
      index: i,
      tick,
      occ: 0,
      cells: {},
      attacks: {},
      releases: {},
      heldBefore: {},
      heldAfter: {},
      releaseOnly: true,
    };
    for (const h of included) {
      const hi = index.get(h)!;
      const before = held.get(h)!;
      const starts = hi.starts.get(tick) ?? EMPTY;
      const ends = hi.ends.get(tick) ?? EMPTY;
      // Carried presses always start at the passage start, the first tick.
      const carried = tick === startTick ? hi.carried : EMPTY;
      step.cells[h] = cellFor(before, starts, ends, carried);
      step.attacks[h] = [...starts].sort(ascending);
      step.releases[h] = [...ends].sort(ascending);
      step.heldBefore[h] = [...before].sort(ascending);
      const after = new Set([...before].filter((k) => !ends.has(k)));
      for (const k of starts) after.add(k);
      held.set(h, after);
      step.heldAfter[h] = [...after].sort(ascending);
      if (starts.size > 0) step.releaseOnly = false;
    }
    // Ticks are ascending, so the containing occurrence only moves forward.
    // The passage end lies past every earlier occurrence and lands on the last.
    if (occIndex >= 0) {
      while (occIndex < resolved.lastIndex) {
        const m = score.measures[occIndex];
        if (tick < m.startTick + m.durationTicks) break;
        occIndex++;
      }
      step.occ = score.measures[occIndex].occ;
    } else {
      step.occ = resolved.range.startOcc;
    }
    return step;
  });

  const usedKeysByHand: Partial<Record<Hand, number[]>> = {};
  for (const h of included) {
    usedKeysByHand[h] = [...new Set(presses.filter((p) => p.hand === h).map((p) => p.midi))].sort(ascending);
  }
  const usedKeys = [...new Set(presses.map((p) => p.midi))].sort(ascending);

  return {
    hands: included,
    range: resolved.range,
    startTick,
    endTick,
    steps,
    presses,
    usedKeys,
    usedKeysByHand,
  };
}
