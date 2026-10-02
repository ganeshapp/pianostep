import { describe, expect, it } from 'vitest';
import { isBlackKey, labelToMidi, midiToLabel, PIANO_MAX, PIANO_MIN } from '../src/core/pitch';
import { describeHighlights, keyHighlights } from '../src/ui/keyboard/highlight';
import {
  BLACK_WIDTH_RATIO,
  computeKeyboardRange,
  keyLayout,
  whiteKeyCount,
  type KeyboardLayout,
} from '../src/ui/keyboard/layout';

function k(label: string): number {
  const m = labelToMidi(label);
  if (m === null) throw new Error(`bad label ${label}`);
  return m;
}

function labels(r: { low: number; high: number }): [string, string] {
  return [midiToLabel(r.low), midiToLabel(r.high)];
}

function rect(layout: KeyboardLayout, label: string) {
  const r = layout.byMidi.get(k(label));
  if (!r) throw new Error(`${label} not in layout`);
  return r;
}

describe('computeKeyboardRange', () => {
  it('adds two white keys of context each side and keeps at least two octaves', () => {
    // C3..G5 is already wider than two octaves: D3..A5 context -> A2..B5.
    const r = computeKeyboardRange([k('C3'), k('E4'), k('G5')]);
    expect(labels(r)).toEqual(['A2', 'B5']);
    expect(r.hasOutOfRange).toBe(false);
  });

  it('widens a small passage to two octaves, roughly centred', () => {
    const r = computeKeyboardRange([k('C4'), k('E4'), k('G4')]);
    expect(r.high - r.low).toBeGreaterThanOrEqual(24);
    expect(r.high - r.low).toBeLessThanOrEqual(26);
    expect(r.low).toBeLessThan(k('C4'));
    expect(r.high).toBeGreaterThan(k('G4'));
    // Context is spread over both sides.
    expect(k('C4') - r.low).toBeGreaterThan(6);
    expect(r.high - k('G4')).toBeGreaterThan(6);
  });

  it('always puts white keys at both edges, even when black keys are the extremes', () => {
    const cases: number[][] = [
      [k('C#4')],
      [k('F#3'), k('A#5')],
      [k('D#2'), k('G#2')],
      [k('A#0')],
      [k('C#1'), k('A#7')],
      [],
    ];
    for (const used of cases) {
      const r = computeKeyboardRange(used);
      expect(isBlackKey(r.low), `low for ${used.map(midiToLabel)}`).toBe(false);
      expect(isBlackKey(r.high), `high for ${used.map(midiToLabel)}`).toBe(false);
      for (const u of used) {
        expect(u).toBeGreaterThanOrEqual(r.low);
        expect(u).toBeLessThanOrEqual(r.high);
      }
    }
  });

  it('snaps a black-key extreme to its white neighbour before adding context', () => {
    // F#3 -> F3, then two white keys lower: D3. A#5 -> B5, then two higher: D6.
    const r = computeKeyboardRange([k('F#3'), k('A#5')]);
    expect(labels(r)).toEqual(['D3', 'D6']);
  });

  it('clamps to A0–C8 and widens the other side when one edge is reached', () => {
    const lowEnd = computeKeyboardRange([k('A0'), k('C1')]);
    expect(lowEnd.low).toBe(PIANO_MIN);
    expect(lowEnd.high - lowEnd.low).toBeGreaterThanOrEqual(24);

    const highEnd = computeKeyboardRange([k('A7'), k('C8')]);
    expect(highEnd.high).toBe(PIANO_MAX);
    expect(highEnd.high - highEnd.low).toBeGreaterThanOrEqual(24);

    const all = computeKeyboardRange([k('B0'), k('B7')]);
    expect(labels(all)).toEqual(['A0', 'C8']);
  });

  it('reports keys beyond the piano instead of clamping them', () => {
    const r = computeKeyboardRange([k('G#0'), k('C4'), k('D8'), k('D8')]);
    expect(r.hasOutOfRange).toBe(true);
    expect(r.outOfRange.map(midiToLabel)).toEqual(['G#0', 'D8']);
    expect(r.low).toBeGreaterThanOrEqual(PIANO_MIN);
    expect(r.high).toBeLessThanOrEqual(PIANO_MAX);
    expect(r.low).toBeLessThan(k('C4'));
  });

  it('shows two octaves around middle C when nothing is used', () => {
    expect(labels(computeKeyboardRange([]))).toEqual(['C3', 'C5']);
  });

  it('includes carried keys simply because they are in usedKeys', () => {
    const withCarried = computeKeyboardRange([k('C2'), k('E4'), k('G4')]);
    expect(withCarried.low).toBeLessThan(k('C2'));
  });

  it('respects custom context and minimum span', () => {
    const r = computeKeyboardRange([k('C4'), k('C5')], { contextWhiteKeys: 0, minSemitones: 0 });
    expect(labels(r)).toEqual(['C4', 'C5']);
  });
});

describe('keyLayout', () => {
  const full = keyLayout({ low: PIANO_MIN, high: PIANO_MAX }, 52 * 20);

  it('has 52 equal white keys and 36 black keys on a full piano', () => {
    expect(full.whites).toHaveLength(52);
    expect(full.blacks).toHaveLength(36);
    expect(full.whiteWidth).toBe(20);
    for (const [i, w] of full.whites.entries()) {
      expect(w.x).toBeCloseTo(i * 20, 9);
      expect(w.width).toBe(20);
    }
    expect(full.width).toBe(1040);
  });

  it('places C4 after A0, B0 and three full octaves of white keys', () => {
    // A0, B0, then C1..B3 (21 white keys) precede C4.
    expect(rect(full, 'C4').x).toBe(23 * 20);
    expect(full.whites[23].midi).toBe(60);
  });

  it('puts each black key between its white neighbours at the standard offsets', () => {
    const W = full.whiteWidth;
    const centre = (label: string) => {
      const r = rect(full, label);
      return r.x + r.width / 2;
    };
    // Boundaries are the left edges of the white key above.
    expect(centre('C#4')).toBeCloseTo(rect(full, 'D4').x - 0.1 * W, 9);
    expect(centre('D#4')).toBeCloseTo(rect(full, 'E4').x + 0.1 * W, 9);
    expect(centre('F#4')).toBeCloseTo(rect(full, 'G4').x - W / 7, 9);
    expect(centre('G#4')).toBeCloseTo(rect(full, 'A4').x, 9);
    expect(centre('A#4')).toBeCloseTo(rect(full, 'B4').x + W / 7, 9);

    for (const label of ['C#4', 'D#4', 'F#4', 'G#4', 'A#4']) {
      const b = rect(full, label);
      const below = rect(full, midiToLabel(k(label) - 1));
      const above = rect(full, midiToLabel(k(label) + 1));
      expect(b.black).toBe(true);
      expect(b.width).toBeCloseTo(W * BLACK_WIDTH_RATIO, 9);
      expect(b.height).toBeLessThan(below.height);
      // Overlaps both neighbours and stays inside their combined span.
      expect(b.x).toBeGreaterThan(below.x);
      expect(b.x).toBeLessThan(above.x);
      expect(b.x + b.width).toBeGreaterThan(above.x);
      expect(b.x + b.width).toBeLessThan(above.x + above.width);
    }
  });

  it('keeps the C#/D# and F#/G#/A# groups symmetric within each octave', () => {
    const W = full.whiteWidth;
    const c = rect(full, 'C4').x;
    const f = rect(full, 'F4').x;
    const mid = (label: string) => rect(full, label).x + rect(full, label).width / 2 - c;
    // C–E spans 3 white keys: C# and D# mirror around its centre (1.5 W).
    expect(mid('C#4') + mid('D#4')).toBeCloseTo(3 * W, 9);
    // F–B spans 4 white keys: F# and A# mirror around G# at 2 W from F.
    const fm = (label: string) => rect(full, label).x + rect(full, label).width / 2 - f;
    expect(fm('G#4')).toBeCloseTo(2 * W, 9);
    expect(fm('F#4') + fm('A#4')).toBeCloseTo(4 * W, 9);
  });

  it('lays out a fitted range from edge to edge with white edges and the right heights', () => {
    const range = computeKeyboardRange([k('E3'), k('C#5')]);
    const layout = keyLayout(range, 900, { whiteHeight: 200 });
    const count = whiteKeyCount(range.low, range.high);
    expect(layout.whites).toHaveLength(count);
    expect(layout.whites[0].midi).toBe(range.low);
    expect(layout.whites[count - 1].midi).toBe(range.high);
    expect(layout.whites[0].x).toBe(0);
    expect(layout.width).toBeCloseTo(900, 9);
    expect(layout.whiteHeight).toBe(200);
    expect(layout.blackHeight).toBeCloseTo(124, 9);
    for (const b of layout.blacks) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x + b.width).toBeLessThan(900);
    }
    // Every key of the range is drawn exactly once.
    expect(layout.byMidi.size).toBe(range.high - range.low + 1);
  });
});

describe('keyHighlights', () => {
  it('marks struck keys strong and held keys soft, per hand', () => {
    const h = keyHighlights({ R: [k('C4'), k('E4')], L: [k('C3')] }, { R: [k('E4')], L: [] });
    expect(h.get(k('E4'))).toEqual({ R: 'strong', L: null });
    expect(h.get(k('C4'))).toEqual({ R: 'soft', L: null });
    expect(h.get(k('C3'))).toEqual({ R: null, L: 'soft' });
    expect(h.has(k('D4'))).toBe(false);
  });

  it('keeps both hands on a key held by both, so it can be split', () => {
    const h = keyHighlights({ R: [k('C4')], L: [k('C4')] }, { R: [], L: [k('C4')] });
    expect(h.get(k('C4'))).toEqual({ R: 'soft', L: 'strong' });
  });

  it('describes the expected keys in words', () => {
    const h = keyHighlights({ R: [k('E4'), k('C4')], L: [k('C3')] }, { R: [k('E4')], L: [] });
    expect(describeHighlights(h, midiToLabel)).toBe('Right hand: C4, E4 (press now). Left hand: C3');
    expect(describeHighlights(new Map(), midiToLabel)).toBe('No keys held');
  });
});
