import { childElements, nameOf, normalizeSpace, textOf, toNumber } from './dom';

/**
 * Small pure readers for MusicXML notation details (endings, jump words,
 * metronome marks, dynamics, time signatures).
 */

const MAX_ENDING_NUMBER = 100;

/**
 * Pass numbers of a volta bracket: "1" -> [1], "1, 2" -> [1, 2], "1." -> [1],
 * "1-3" -> [1, 2, 3], "1 2" -> [1, 2]. Unparseable text gives [].
 */
export function parseEndingNumbers(text: string | null): number[] {
  if (!text) return [];
  const cleaned = text.replace(/\s*[-–—]\s*/g, '-');
  const out = new Set<number>();
  for (const raw of cleaned.split(/[,;+&\s]+/)) {
    const token = raw.replace(/\.+$/, '');
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a >= 1 && b >= a && b <= MAX_ENDING_NUMBER) for (let n = a; n <= b; n++) out.add(n);
    } else if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 1 && n <= MAX_ENDING_NUMBER) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Jump instructions written as text, used when no matching <sound> attribute exists. */
export interface JumpWords {
  daCapo: boolean;
  dalSegno: boolean;
  fine: boolean;
  toCoda: boolean;
}

export function readJumpWords(text: string): JumpWords {
  const t = normalizeSpace(text);
  return {
    daCapo: /(^|[^a-z])d\.\s?c\.|\bda\s+capo\b|^dc\b/i.test(t),
    dalSegno: /(^|[^a-z])d\.\s?s\.|\bdal\s+segno\b|^ds\b/i.test(t),
    // Only a standalone "Fine" marks the end; "D.C. al Fine" is the jump, not the stop.
    fine: /^fine\.?$/i.test(t),
    toCoda: /\bto\s+coda\b/i.test(t),
  };
}

const NOTE_TYPE_QUARTERS: Record<string, number> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
};

/** Quarter notes in a note value with dots: dotted quarter -> 1.5. */
export function noteTypeQuarters(type: string, dots: number): number | null {
  const base = NOTE_TYPE_QUARTERS[type.trim()];
  if (base === undefined) return null;
  return base * (2 - 1 / 2 ** dots);
}

/**
 * Quarter notes per minute from a <metronome> mark such as dotted-quarter = 60
 * (-> 90). Returns null for metric modulations or marks without a number.
 */
export function metronomeQpm(metronome: Element): number | null {
  let unit: string | null = null;
  let dots = 0;
  let perMinute: number | null = null;
  for (const c of childElements(metronome)) {
    const name = nameOf(c);
    if (name === 'beat-unit') {
      if (unit !== null) return null;
      unit = textOf(c);
    } else if (name === 'beat-unit-dot') {
      dots++;
    } else if (name === 'per-minute') {
      const m = /\d+(?:\.\d+)?/.exec(textOf(c));
      perMinute = m ? Number(m[0]) : null;
    }
  }
  if (unit === null || perMinute === null) return null;
  const quarters = noteTypeQuarters(unit, dots);
  return quarters === null ? null : perMinute * quarters;
}

export function isUsableTempo(qpm: number | null): qpm is number {
  return qpm !== null && Number.isFinite(qpm) && qpm > 0 && qpm <= 1000;
}

/** MusicXML dynamics are a percentage of forte (velocity 90); clamp to MIDI 1–127. */
export function dynamicsToVelocity(percent: string | null): number | undefined {
  const p = toNumber(percent);
  if (p === null || p < 0) return undefined;
  return Math.min(127, Math.max(1, Math.round((p * 90) / 100)));
}

/** First beats/beat-type pair of a <time>; "3+2" beats are summed. */
export function readTimeSignature(time: Element): { beats: number; beatType: number } | null {
  let beats: number | null = null;
  let beatType: number | null = null;
  for (const c of childElements(time)) {
    const name = nameOf(c);
    if (name === 'beats' && beats === null) {
      const parts = textOf(c).split('+').map((s) => Number(s.trim()));
      if (parts.every((n) => Number.isFinite(n) && n > 0)) beats = parts.reduce((a, b) => a + b, 0);
    } else if (name === 'beat-type' && beatType === null) {
      const n = Number(textOf(c).trim());
      if (Number.isFinite(n) && n > 0) beatType = n;
    }
  }
  return beats !== null && beatType !== null ? { beats, beatType } : null;
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}
