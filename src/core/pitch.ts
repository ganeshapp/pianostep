import type { PitchStep, SpelledPitch } from './types';

/** Lowest (A0) and highest (C8) keys of a standard 88-key piano. */
export const PIANO_MIN = 21;
export const PIANO_MAX = 108;
export const MIDDLE_C = 60;

const STEP_SEMITONES: Record<PitchStep, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const SPOKEN_NAMES = [
  'C', 'C sharp', 'D', 'D sharp', 'E', 'F', 'F sharp', 'G', 'G sharp', 'A', 'A sharp', 'B',
] as const;
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export function isPitchStep(s: string): s is PitchStep {
  return s in STEP_SEMITONES;
}

/**
 * Sounding MIDI number from a spelled pitch. Resolves by pitch arithmetic,
 * never by string substitution: B#3 -> 60 (C4), Cb4 -> 59 (B3).
 * Fractional (microtonal) alterations are rounded to the nearest semitone.
 */
export function midiFromSpelled(p: SpelledPitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + Math.round(p.alter);
}

/** Pitch class 0..11 (C = 0), safe for negative numbers. */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** Scientific octave number; changes at C (B3 -> C4). MIDI 60 is C4. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** Beginner key address, sharps only: 61 -> "C#4", 60 -> "C4", 21 -> "A0". */
export function midiToLabel(midi: number): string {
  return `${SHARP_NAMES[pitchClass(midi)]}${octaveOf(midi)}`;
}

/** Screen-reader friendly name: 61 -> "C sharp 4". */
export function midiToSpoken(midi: number): string {
  return `${SPOKEN_NAMES[pitchClass(midi)]} ${octaveOf(midi)}`;
}

/** Parses "C#4", "Db4", "B#3", "Cb4", "A0", "C-1". Returns null if invalid. */
export function labelToMidi(label: string): number | null {
  const m = /^([A-Ga-g])([#b]*)(-?\d+)$/.exec(label.trim());
  if (!m) return null;
  const step = m[1].toUpperCase() as PitchStep;
  let alter = 0;
  for (const ch of m[2]) alter += ch === '#' ? 1 : -1;
  return midiFromSpelled({ step, alter, octave: Number(m[3]) });
}

export function isBlackKey(midi: number): boolean {
  return BLACK[pitchClass(midi)];
}

export function isOnPiano(midi: number): boolean {
  return midi >= PIANO_MIN && midi <= PIANO_MAX;
}

/** Spelling as written, for provenance displays: {D,-1,4} -> "D♭4". */
export function spelledToText(p: SpelledPitch): string {
  const a = Math.round(p.alter);
  const acc = a > 0 ? '♯'.repeat(a) : a < 0 ? '♭'.repeat(-a) : '';
  return `${p.step}${acc}${p.octave}`;
}
