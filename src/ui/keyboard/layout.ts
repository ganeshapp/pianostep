import { isBlackKey, pitchClass, PIANO_MAX, PIANO_MIN } from '../../core/pitch';

/** The keys a keyboard view shows. Both edges are always white keys. */
export interface KeyboardRange {
  low: number;
  high: number;
  /** Used keys beyond A0–C8, which no piano has and the view cannot draw. Ascending. */
  outOfRange: number[];
  hasOutOfRange: boolean;
}

export interface KeyboardRangeOptions {
  /** White keys of context beyond the lowest and highest used key (default 2). */
  contextWhiteKeys?: number;
  /** Smallest span shown, in semitones (default 24: two octaves). */
  minSemitones?: number;
}

/** Shown when nothing is used: two octaves centred on middle C (C3–C5). */
const EMPTY_LOW = 48;
const EMPTY_HIGH = 72;

function whiteBelow(midi: number): number {
  let k = midi - 1;
  while (isBlackKey(k)) k -= 1;
  return k;
}

function whiteAbove(midi: number): number {
  let k = midi + 1;
  while (isBlackKey(k)) k += 1;
  return k;
}

/**
 * Fits the keyboard to the keys a passage uses: their min/max plus a little
 * context, with white keys at both edges, at least two octaves wide, and never
 * beyond the 88 keys (A0–C8). Keys outside the piano are reported, not clamped.
 */
export function computeKeyboardRange(
  usedKeys: readonly number[],
  opts: KeyboardRangeOptions = {},
): KeyboardRange {
  const context = Math.max(0, Math.floor(opts.contextWhiteKeys ?? 2));
  const minSpan = Math.min(PIANO_MAX - PIANO_MIN, Math.max(0, opts.minSemitones ?? 24));

  const onPiano: number[] = [];
  const outside = new Set<number>();
  for (const k of usedKeys) {
    if (!Number.isFinite(k)) continue;
    if (k >= PIANO_MIN && k <= PIANO_MAX) onPiano.push(k);
    else outside.add(k);
  }

  let low: number;
  let high: number;
  if (onPiano.length === 0) {
    low = EMPTY_LOW;
    high = EMPTY_HIGH;
  } else {
    const min = Math.min(...onPiano);
    const max = Math.max(...onPiano);
    // A black key's white neighbours are always one semitone away, and A0/C8
    // are white, so snapping never leaves the piano.
    low = isBlackKey(min) ? min - 1 : min;
    high = isBlackKey(max) ? max + 1 : max;
    for (let i = 0; i < context; i += 1) {
      if (low > PIANO_MIN) low = whiteBelow(low);
      if (high < PIANO_MAX) high = whiteAbove(high);
    }
  }

  let growLow = true;
  while (high - low < minSpan && (low > PIANO_MIN || high < PIANO_MAX)) {
    if ((growLow && low > PIANO_MIN) || high >= PIANO_MAX) low = whiteBelow(low);
    else high = whiteAbove(high);
    growLow = !growLow;
  }

  const outOfRange = [...outside].sort((a, b) => a - b);
  return { low, high, outOfRange, hasOutOfRange: outOfRange.length > 0 };
}

export interface KeyRect {
  midi: number;
  black: boolean;
  x: number;
  width: number;
  height: number;
}

export interface KeyboardLayout {
  low: number;
  high: number;
  width: number;
  whiteWidth: number;
  blackWidth: number;
  whiteHeight: number;
  blackHeight: number;
  whites: KeyRect[];
  blacks: KeyRect[];
  byMidi: ReadonlyMap<number, KeyRect>;
}

export interface KeyLayoutOptions {
  /** Height of a white key in px (default 196). */
  whiteHeight?: number;
  /** Black key height as a fraction of the white key height (default 0.62). */
  blackHeightRatio?: number;
}

/** A black key is a little narrower than 0.6 of a white key on a real piano. */
export const BLACK_WIDTH_RATIO = 0.58;

/**
 * Centre of each black key relative to the boundary between its two white
 * neighbours, in white-key widths. On a real keyboard the C–E group splits its
 * three white keys into five equal top slots and the F–B group splits four
 * white keys into seven, so C#/D# lean outwards by 1/10 and F#/A# by 1/7,
 * while G# sits exactly on the G/A boundary.
 */
export const BLACK_KEY_OFFSETS: Readonly<Record<number, number>> = {
  1: -0.1,
  3: 0.1,
  6: -1 / 7,
  8: 0,
  10: 1 / 7,
};

export function whiteKeyCount(low: number, high: number): number {
  let n = 0;
  for (let k = low; k <= high; k += 1) if (!isBlackKey(k)) n += 1;
  return n;
}

/** Pixel rectangles for every key in [low, high] spread across `width`. */
export function keyLayout(
  range: Pick<KeyboardRange, 'low' | 'high'>,
  width: number,
  opts: KeyLayoutOptions = {},
): KeyboardLayout {
  const { low, high } = range;
  const whiteHeight = opts.whiteHeight ?? 196;
  const blackHeight = whiteHeight * (opts.blackHeightRatio ?? 0.62);
  const count = Math.max(1, whiteKeyCount(low, high));
  const whiteWidth = Math.max(0, width) / count;
  const blackWidth = whiteWidth * BLACK_WIDTH_RATIO;

  const whites: KeyRect[] = [];
  const whiteX = new Map<number, number>();
  for (let k = low; k <= high; k += 1) {
    if (isBlackKey(k)) continue;
    const x = whites.length * whiteWidth;
    whiteX.set(k, x);
    whites.push({ midi: k, black: false, x, width: whiteWidth, height: whiteHeight });
  }

  const blacks: KeyRect[] = [];
  for (let k = low + 1; k < high; k += 1) {
    if (!isBlackKey(k)) continue;
    const boundary = whiteX.get(k + 1);
    if (boundary === undefined) continue;
    const centre = boundary + (BLACK_KEY_OFFSETS[pitchClass(k)] ?? 0) * whiteWidth;
    blacks.push({ midi: k, black: true, x: centre - blackWidth / 2, width: blackWidth, height: blackHeight });
  }

  const byMidi = new Map<number, KeyRect>();
  for (const r of whites) byMidi.set(r.midi, r);
  for (const r of blacks) byMidi.set(r.midi, r);

  return {
    low,
    high,
    width: whites.length * whiteWidth,
    whiteWidth,
    blackWidth,
    whiteHeight,
    blackHeight,
    whites,
    blacks,
    byMidi,
  };
}

/** Framing input that only changes when its contents change, so playback never re-frames. */
export function framingKey(keys: readonly number[]): string {
  return keys.join(',');
}
