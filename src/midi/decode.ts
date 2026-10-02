import type { MidiInputEvent } from '../core/types';

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const CC_SUSTAIN = 64;

/**
 * Decodes one complete MIDI message (Web MIDI never delivers running status).
 * Handles note-on, note-off and CC64 on all 16 channels; everything else
 * (clock, active sensing, other controllers, sysex) returns null.
 *
 * `channel` in the result is 1-16. A note-on with velocity 0 is, by the MIDI
 * spec, a note-off, and is returned as one.
 */
export function decodeMidiMessage(
  data: ArrayLike<number> | null | undefined,
  time: number,
): MidiInputEvent | null {
  if (!data || data.length < 3) return null;
  const status = data[0];
  const d1 = data[1];
  const d2 = data[2];
  if (status < 0x80 || status >= 0xf0) return null;
  if (d1 > 0x7f || d2 > 0x7f || d1 < 0 || d2 < 0) return null;

  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  if (kind === NOTE_ON) {
    if (d2 === 0) return { type: 'noteoff', midi: d1, channel, time };
    return { type: 'noteon', midi: d1, velocity: d2, channel, time };
  }
  if (kind === NOTE_OFF) return { type: 'noteoff', midi: d1, channel, time };
  if (kind === CONTROL_CHANGE && d1 === CC_SUSTAIN) {
    // Standard on/off reading of a continuous pedal: 64 and above is down.
    return { type: 'sustain', down: d2 >= 64, value: d2, channel, time };
  }
  return null;
}
