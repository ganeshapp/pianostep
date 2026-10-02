import type { Hand, KeyPress, MeasureOccurrence, PerformanceNote, ScoreWarning } from '../types';
import { WarningBag } from './performance';

export interface KeyPressesResult {
  presses: KeyPress[];
  warnings: ScoreWarning[];
}

const HAND_ORDER: Record<Hand, number> = { R: 0, L: 1 };

/** Display measure number of the occurrence containing `tick` (occurrences sorted by startTick). */
function measureAt(occurrences: readonly MeasureOccurrence[], tick: number): string | null {
  let lo = 0;
  let hi = occurrences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (occurrences[mid].startTick <= tick) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? occurrences[found].number : null;
}

/**
 * Reconciles performance notes into physical key-down intervals per hand and
 * key. `occurrences` is optional and only used to name measures in warnings.
 */
export function buildKeyPresses(
  notes: readonly PerformanceNote[],
  occurrences: readonly MeasureOccurrence[] = [],
): KeyPressesResult {
  const bag = new WarningBag();
  const where = (tick: number): string[] => {
    const m = measureAt(occurrences, tick);
    return m === null ? [] : [m];
  };

  const groups = new Map<string, PerformanceNote[]>();
  for (const n of notes) {
    if (n.endTick <= n.startTick) {
      bag.add('zero-length-note', 'info', 'Some notes have no length and are left out.', where(n.startTick));
      continue;
    }
    const key = `${n.hand}:${n.midi}`;
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }

  const presses: KeyPress[] = [];
  const overlaps: number[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.startTick - b.startTick);
    let previous: KeyPress | null = null;
    let k = 0;
    while (k < group.length) {
      const start = group[k].startTick;
      const unison: PerformanceNote[] = [];
      while (k < group.length && group[k].startTick === start) unison.push(group[k++]);

      // Notes struck together on one key are one physical press held to the longest end.
      let end = Math.max(...unison.map((n) => n.endTick));
      if (previous && previous.endTick > start) {
        // The key is still down from another voice: strike it again at the new
        // attack and keep it down until both notes are over, so no attack is
        // lost and nothing is released early.
        end = Math.max(end, previous.endTick);
        previous.endTick = start;
        overlaps.push(start);
      }
      const velocities = unison.flatMap((n) => (n.velocity === undefined ? [] : [n.velocity]));
      const press: KeyPress = {
        id: `${unison[0].hand}:${unison[0].midi}:${start}`,
        hand: unison[0].hand,
        midi: unison[0].midi,
        startTick: start,
        endTick: end,
        noteIds: unison.map((n) => n.id),
      };
      if (velocities.length) press.velocity = Math.max(...velocities);
      presses.push(press);
      previous = press;
    }
  }

  // Reported in playing order, so the measure list reads front to back.
  for (const tick of overlaps.sort((a, b) => a - b)) {
    bag.add(
      'voice-overlap-same-key',
      'info',
      'Two voices in one hand use the same key at the same time; the key is struck again at the second note and held until both notes end.',
      where(tick),
    );
  }

  const kept = presses.filter((p) => p.endTick > p.startTick);
  kept.sort((a, b) => a.startTick - b.startTick || HAND_ORDER[a.hand] - HAND_ORDER[b.hand] || a.midi - b.midi);
  return { presses: kept, warnings: bag.list() };
}
