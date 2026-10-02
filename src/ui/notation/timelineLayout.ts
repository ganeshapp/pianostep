import type { ActionStep, Hand } from '../../core/types';

export const HEAD_HEIGHT = 26;
const TOKEN_HEIGHT = 28;
const ROW_PADDING = 12;
const MIN_ROW_HEIGHT = 50;

/** Each row is tall enough for the biggest stack that hand ever shows in this sequence. */
export function rowHeights(sequence: {
  hands: readonly Hand[];
  steps: readonly Pick<ActionStep, 'cells'>[];
}): Record<Hand, number> {
  const result: Record<Hand, number> = { R: MIN_ROW_HEIGHT, L: MIN_ROW_HEIGHT };
  for (const hand of sequence.hands) {
    let most = 1;
    for (const step of sequence.steps) {
      const n = step.cells[hand]?.tokens.length ?? 0;
      if (n > most) most = n;
    }
    result[hand] = Math.max(MIN_ROW_HEIGHT, most * TOKEN_HEIGHT + ROW_PADDING);
  }
  return result;
}

export interface MeasureStart {
  occ: number;
  /** Columns this occurrence covers, used to keep its label from spilling into the next. */
  span: number;
}

/** The first column of each measure occurrence that has any steps. */
export function measureStarts(steps: readonly Pick<ActionStep, 'occ'>[]): Map<number, MeasureStart> {
  const starts = new Map<number, MeasureStart>();
  let current: MeasureStart | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    if (i === 0 || steps[i].occ !== steps[i - 1].occ) {
      current = { occ: steps[i].occ, span: 0 };
      starts.set(i, current);
    }
    if (current) current.span += 1;
  }
  return starts;
}

/** "12 (2nd time)" -> number "12" plus a smaller "2nd time". */
export function splitLabel(label: string): { main: string; pass: string | null } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(label);
  return m ? { main: m[1], pass: m[2] } : { main: label, pass: null };
}
