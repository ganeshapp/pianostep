import { midiToLabel } from '../../core/pitch';
import type { PracticeMode, PracticeSettings } from '../../core/types';
import type { SessionSnapshot } from '../../engine/session';
import { formatSpeed } from './settings';

export const FOLLOW_NEEDS_PIANO = 'Connect a digital piano by MIDI to use Follow me';

export const MODE_NOTES: Readonly<Record<PracticeMode, string>> = {
  listen: 'Plays the piece at its written rhythm.',
  steady: 'Movement practice: every step gets the same time — this is not the piece’s rhythm.',
  follow: 'Waits for the right keys on your piano. It checks notes, not timing or pedalling.',
};

function keyList(keys: readonly number[]): string {
  return keys.map(midiToLabel).join(' ');
}

/**
 * The timeline's empty state when the passage has nothing to play for the
 * chosen hands. With both hands there is no other hand to suggest.
 */
export function nothingToPlayText(settings: Pick<PracticeSettings, 'hands'>): string {
  if (settings.hands === 'both') return 'There is nothing to play in these measures (they are silent). Choose a different passage.';
  const who = settings.hands === 'R' ? 'the right hand' : 'the left hand';
  return `There is nothing for ${who} to play in these measures. Choose the other hand or a different passage.`;
}

export type StatusTone = 'normal' | 'wrong' | 'done' | 'info';

/** The changing part of the status line: Follow me feedback, count-in, finish and engine messages. */
export function statusMessage(
  s: Pick<
    SessionSnapshot,
    'status' | 'message' | 'wrong' | 'waitingFor' | 'countInRemaining' | 'settings' | 'audioState' | 'stepCount'
  >,
): { text: string; tone: StatusTone } | null {
  if (s.message) return { text: s.message, tone: 'info' };
  if (s.settings.mode === 'follow' && s.wrong.length > 0) {
    const them = s.wrong.length > 1 ? 'them' : 'it';
    return { text: `Not expected: ${keyList(s.wrong)} — release ${them} and try again`, tone: 'wrong' };
  }
  if (s.status === 'finished') return { text: 'Finished — passage complete', tone: 'done' };
  if (s.status === 'count-in' && s.countInRemaining !== null) {
    return { text: `Get ready… ${s.countInRemaining}`, tone: 'normal' };
  }
  if (s.status === 'waiting' && s.waitingFor.length > 0) {
    return { text: `Waiting for: ${keyList(s.waitingFor)}`, tone: 'normal' };
  }
  if (s.settings.mode === 'follow' && (s.status === 'stopped' || s.status === 'paused') && s.stepCount > 0) {
    return { text: 'Press Start, then play the keys shown in colour.', tone: 'info' };
  }
  if (s.settings.sound && s.settings.mode !== 'follow') {
    if (s.audioState === 'loading') return { text: 'Sound is loading…', tone: 'info' };
    if (s.audioState === 'error') {
      return { text: 'The piano sound could not load, so a simpler sound is used.', tone: 'info' };
    }
  }
  return null;
}

/**
 * Listen's speed, as read out by the slider. When the file gives no speed, 1×
 * is the app's own choice and is never called the written speed (brief §8).
 */
export function speedValueText(speed: number, defaultTempoQpm: number | null): string {
  const s = formatSpeed(speed);
  return defaultTempoQpm === null ? `${s} of the written speed` : `${s} of the app’s default speed (the file gives no speed)`;
}

/** Shown next to Listen's speed when the file gives no speed. */
export function defaultSpeedNote(qpm: number): string {
  return `No speed is written in this file, so 1× is the app’s default: ${Math.round(qpm)} quarter notes a minute.`;
}
