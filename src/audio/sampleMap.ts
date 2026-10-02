import { PIANO_MAX, PIANO_MIN, octaveOf, pitchClass } from '../core/pitch';

/**
 * The bundled Salamander Grand Piano set has one recording (velocity layer 8)
 * every third semitone, A0 (21) through C8 (108): A, C, D#, F# in each octave.
 * Every key on the piano is therefore at most one semitone from a recording.
 */
const SAMPLE_STEP = 3;

export const SAMPLE_MIDIS: readonly number[] = Array.from(
  { length: (PIANO_MAX - PIANO_MIN) / SAMPLE_STEP + 1 },
  (_, i) => PIANO_MIN + SAMPLE_STEP * i,
);

const FILE_STEM: Readonly<Record<number, string>> = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };

export interface SampleChoice {
  /** MIDI number of the recorded note that will be pitch-shifted. */
  sampleMidi: number;
  /** File name inside public/audio/piano/, e.g. "Ds4v8.mp3". */
  file: string;
  /** Semitones from the recording to the requested note (negative = lower). */
  shift: number;
  /** AudioBufferSourceNode.playbackRate that produces the requested pitch. */
  playbackRate: number;
}

/** File name of a recorded note, e.g. 63 -> "Ds4v8.mp3". Throws for notes that have no recording. */
export function sampleFileName(sampleMidi: number): string {
  const stem = FILE_STEM[pitchClass(sampleMidi)];
  if (stem === undefined || !SAMPLE_MIDIS.includes(sampleMidi)) {
    throw new RangeError(`No piano sample is recorded for MIDI ${sampleMidi}`);
  }
  return `${stem}${octaveOf(sampleMidi)}v8.mp3`;
}

/**
 * Nearest recording. Notes beyond the keyboard use the end recordings (A0 or C8),
 * so they still sound, just with a larger pitch shift.
 */
export function nearestSampleMidi(midi: number): number {
  const clamped = Math.min(PIANO_MAX, Math.max(PIANO_MIN, midi));
  return PIANO_MIN + SAMPLE_STEP * Math.round((clamped - PIANO_MIN) / SAMPLE_STEP);
}

/** Which recording to play for `midi`, and at what rate (2^(shift/12), equal temperament). */
export function sampleForMidi(midi: number): SampleChoice {
  const sampleMidi = nearestSampleMidi(midi);
  const shift = midi - sampleMidi;
  return { sampleMidi, file: sampleFileName(sampleMidi), shift, playbackRate: 2 ** (shift / 12) };
}
