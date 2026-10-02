import type { Hand } from '../../core/types';

/** strong = struck at this step ("press now"); soft = still held from before. */
export type HandHighlight = 'strong' | 'soft' | null;

export interface KeyHighlight {
  R: HandHighlight;
  L: HandHighlight;
}

export type HandKeys = Readonly<Partial<Record<Hand, readonly number[]>>>;

/**
 * Expected state of every highlighted key. A key held by both hands keeps
 * both entries so the keyboard can split it instead of hiding one hand.
 */
export function keyHighlights(expected: HandKeys, struck: HandKeys): Map<number, KeyHighlight> {
  const result = new Map<number, KeyHighlight>();
  for (const hand of ['R', 'L'] as const) {
    const held = expected[hand] ?? [];
    const hit = new Set(struck[hand] ?? []);
    for (const key of held) {
      const entry = result.get(key) ?? { R: null, L: null };
      entry[hand] = hit.has(key) ? 'strong' : 'soft';
      result.set(key, entry);
    }
  }
  return result;
}

/** Spoken summary of the expected keys, e.g. "Right hand: C4 (press now), E4". */
export function describeHighlights(
  highlights: ReadonlyMap<number, KeyHighlight>,
  labelOf: (midi: number) => string,
): string {
  const parts: string[] = [];
  for (const [hand, name] of [
    ['R', 'Right hand'],
    ['L', 'Left hand'],
  ] as const) {
    const keys = [...highlights.entries()]
      .filter(([, h]) => h[hand] !== null)
      .sort(([a], [b]) => a - b)
      .map(([midi, h]) => `${labelOf(midi)}${h[hand] === 'strong' ? ' (press now)' : ''}`);
    if (keys.length > 0) parts.push(`${name}: ${keys.join(', ')}`);
  }
  return parts.length > 0 ? parts.join('. ') : 'No keys held';
}
