import { describe, expect, it } from 'vitest';
import type { HandCell } from '../src/core/types';
import { measureStarts, rowHeights, splitLabel } from '../src/ui/notation/timelineLayout';
import {
  sameWindow,
  snapPosition,
  stripOffset,
  visibleRange,
} from '../src/ui/notation/timelineWindow';

const COL = 72;
const MARK = 0.28;

describe('stripOffset', () => {
  it('centres the current column under the marker', () => {
    // Marker at 280px; column 0 centre at 36px -> shift right by 244px.
    expect(stripOffset(0, 1000, COL, MARK)).toBe(244);
    // Column 10 centre at 756px.
    expect(stripOffset(10, 1000, COL, MARK)).toBe(280 - 756);
  });

  it('moves smoothly between columns for fractional positions', () => {
    const a = stripOffset(3, 1000, COL, MARK);
    const b = stripOffset(4, 1000, COL, MARK);
    expect(stripOffset(3.5, 1000, COL, MARK)).toBeCloseTo((a + b) / 2, 9);
  });

  it('treats a non-finite position as the start', () => {
    expect(stripOffset(Number.NaN, 1000, COL, MARK)).toBe(stripOffset(0, 1000, COL, MARK));
  });
});

describe('visibleRange', () => {
  it('covers the visible columns plus the overscan on each side', () => {
    // At position 0 the strip shows strip x [-244, 756): columns 0..10.
    expect(visibleRange(0, 1000, COL, MARK, 500, 20)).toEqual({ start: 0, end: 31 });
    expect(visibleRange(0, 1000, COL, MARK, 500, 0)).toEqual({ start: 0, end: 11 });
  });

  it('includes partially visible columns at both edges', () => {
    // Position 100: strip x from 100.5*72-280 = 6956 to 7956 -> columns 96..110.
    expect(visibleRange(100, 1000, COL, MARK, 500, 0)).toEqual({ start: 96, end: 111 });
    expect(visibleRange(100, 1000, COL, MARK, 500, 20)).toEqual({ start: 76, end: 131 });
  });

  it('clamps to the sequence bounds', () => {
    expect(visibleRange(498, 1000, COL, MARK, 500, 20)).toEqual({ start: 474, end: 500 });
    expect(visibleRange(2, 1000, COL, MARK, 5, 20)).toEqual({ start: 0, end: 5 });
  });

  it('is empty for an empty sequence or a degenerate column width', () => {
    expect(visibleRange(0, 1000, COL, MARK, 0, 20)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 1000, 0, MARK, 50, 20)).toEqual({ start: 0, end: 0 });
  });

  it('only changes at whole-column boundaries while scrolling', () => {
    const windows = new Set<string>();
    let changes = 0;
    let prev = visibleRange(10, 1000, COL, MARK, 500, 20);
    for (let p = 10; p <= 20; p += 0.05) {
      const w = visibleRange(p, 1000, COL, MARK, 500, 20);
      if (!sameWindow(w, prev)) changes += 1;
      windows.add(`${w.start}-${w.end}`);
      prev = w;
    }
    // Ten columns of travel move each edge at most once per column.
    expect(changes).toBeLessThanOrEqual(20);
    expect(windows.size).toBeLessThanOrEqual(21);
  });

  it('always contains the current column', () => {
    for (const vw of [320, 800, 1280, 2560]) {
      for (let p = 0; p < 300; p += 7.3) {
        const w = visibleRange(p, vw, COL, MARK, 300, 0);
        expect(w.start).toBeLessThanOrEqual(Math.floor(p));
        expect(w.end).toBeGreaterThan(Math.floor(p));
      }
    }
  });

  it('keeps the window small for very long sequences', () => {
    const w = visibleRange(5000, 1280, COL, MARK, 20000, 20);
    expect(w.end - w.start).toBeLessThanOrEqual(Math.ceil(1280 / COL) + 1 + 40);
  });
});

describe('snapPosition', () => {
  it('passes fractional positions through normally', () => {
    expect(snapPosition(3.6, false)).toBe(3.6);
  });

  it('snaps to whole steps under reduced motion', () => {
    expect(snapPosition(3.6, true)).toBe(3);
    expect(snapPosition(4, true)).toBe(4);
    expect(snapPosition(3.9999999, true)).toBe(4);
    expect(snapPosition(Number.NaN, true)).toBe(0);
  });
});

describe('timeline layout', () => {
  const cell = (n: number): HandCell =>
    n === 0
      ? { kind: 'hold', tokens: [] }
      : { kind: 'replace', tokens: Array.from({ length: n }, (_, i) => ({ midi: 60 + i, label: `K${i}`, action: 'press' as const })) };
  const step = (occ: number, r: number, l: number) => ({ occ, cells: { R: cell(r), L: cell(l) } });

  it('sizes each row for the tallest stack of its own hand in the sequence', () => {
    const h = rowHeights({ hands: ['R', 'L'], steps: [step(0, 1, 3), step(0, 2, 0), step(1, 1, 4)] });
    expect(h.L).toBeGreaterThan(h.R);
    const one = rowHeights({ hands: ['R', 'L'], steps: [step(0, 1, 1)] });
    const two = rowHeights({ hands: ['R', 'L'], steps: [step(0, 2, 1)] });
    expect(two.R).toBeGreaterThan(one.R);
    // A single token (or a rest/hold) still gets a comfortable row.
    expect(one.R).toBeGreaterThanOrEqual(48);
    // Rows grow linearly so stacks never overlap.
    const four = rowHeights({ hands: ['R'], steps: [step(0, 4, 0)] });
    const eight = rowHeights({ hands: ['R'], steps: [step(0, 8, 0)] });
    expect(eight.R - four.R).toBe((four.R - two.R) * 2);
  });

  it('labels the first column of every measure occurrence with how many columns it spans', () => {
    const starts = measureStarts([{ occ: 0 }, { occ: 0 }, { occ: 1 }, { occ: 3 }, { occ: 3 }, { occ: 3 }]);
    expect([...starts.entries()]).toEqual([
      [0, { occ: 0, span: 2 }],
      [2, { occ: 1, span: 1 }],
      [3, { occ: 3, span: 3 }],
    ]);
    expect(measureStarts([]).size).toBe(0);
  });

  it('splits a repeat label into the number and the pass', () => {
    expect(splitLabel('12 (2nd time)')).toEqual({ main: '12', pass: '2nd time' });
    expect(splitLabel('7')).toEqual({ main: '7', pass: null });
  });
});
