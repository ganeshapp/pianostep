import { midiToLabel } from '../../core/pitch';
import type {
  Hand,
  HandSelection,
  MeasureOccurrence,
  PracticeMode,
  PracticeSettings,
  StepSequence,
} from '../../core/types';
import type { PassageTime, SessionSnapshot } from '../../engine/session';
import { formatSpeed, formatStepSeconds } from './settings';

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

/** The transport bar's message line: Follow me feedback, count-in, finish and engine messages. */
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

export const MODE_NAMES: Readonly<Record<PracticeMode, string>> = {
  listen: 'Listen',
  steady: 'Steady steps',
  follow: 'Follow me',
};

export const HAND_SELECTION_NAMES: Readonly<Record<HandSelection, string>> = {
  both: 'Both hands',
  R: 'Right hand',
  L: 'Left hand',
};

/** "Measures 1–78", "Measure 12 (2nd time)": the passage, by its occurrence labels. */
export function passageText(
  range: PracticeSettings['range'],
  measures: readonly Pick<MeasureOccurrence, 'label'>[],
): string {
  const count = measures.length;
  if (count === 0) return 'Whole piece';
  const from = range ? range.startOcc : 0;
  const to = range ? range.endOcc : count - 1;
  const label = (occ: number): string => measures[occ]?.label ?? String(occ + 1);
  return from === to ? `Measure ${label(from)}` : `Measures ${label(from)}–${label(to)}`;
}

/**
 * The folded practice settings in one line, e.g. "Listen · Both hands · 1× ·
 * Measures 1–78 · Repeat off". Sound and Count-in are only mentioned when
 * they differ from the usual (sound on, no count-in), and not in Follow me,
 * where neither applies.
 */
export function setupSummary(
  settings: PracticeSettings,
  measures: readonly Pick<MeasureOccurrence, 'label'>[],
): string {
  const parts: string[] = [MODE_NAMES[settings.mode], HAND_SELECTION_NAMES[settings.hands]];
  if (settings.mode === 'listen') parts.push(formatSpeed(settings.speed));
  else if (settings.mode === 'steady') parts.push(`${formatStepSeconds(settings.stepSeconds)} per step`);
  parts.push(passageText(settings.range, measures));
  parts.push(settings.loop ? 'Repeat on' : 'Repeat off');
  if (settings.mode !== 'follow') {
    if (!settings.sound) parts.push('Sound off');
    if (settings.countIn) parts.push('Count-in on');
  }
  return parts.join(' · ');
}

/** Keys one hand already holds when the passage starts (ascending). */
export interface StartingKeys {
  hand: Hand;
  keys: number[];
}

/**
 * The starting setup: keys each hand of `sequence` is already holding when
 * the passage begins (notes struck before its first measure and still
 * sounding), read from the carried tokens of the first step. Empty when there
 * are none. The page reads it from the passage with both hands, so the line
 * stays (and keeps its words) whichever hand is practised; a hand not being
 * practised is only shown muted.
 */
export function startingSetup(sequence: Pick<StepSequence, 'hands' | 'steps'>): StartingKeys[] {
  const first = sequence.steps[0];
  if (!first) return [];
  const result: StartingKeys[] = [];
  for (const hand of ['R', 'L'] as const) {
    if (!sequence.hands.includes(hand)) continue;
    const keys = (first.cells[hand]?.tokens ?? [])
      .filter((t) => t.carried && t.action !== 'release')
      .map((t) => t.midi)
      .sort((a, b) => a - b);
    if (keys.length > 0) result.push({ hand, keys });
  }
  return result;
}

/** "right hand: F#4", as shown in the starting setup line. */
export function startingSetupHandText(entry: StartingKeys): string {
  return `${entry.hand === 'R' ? 'right hand' : 'left hand'}: ${keyList(entry.keys)}`;
}

export const STARTING_SETUP_NOTE = 'These keys are already held when this passage begins; press them first.';

/** Read out (not shown) after a hand that is not being practised. */
export const NOT_PRACTISING = ' (not practising)';

/**
 * The whole line as one sentence, or null when nothing is carried in. With
 * `practising`, a hand left out of it is marked "(not practising)", as a
 * screen reader hears it; on screen that hand is muted instead, so the line
 * keeps its words and its size.
 */
export function startingSetupText(setup: readonly StartingKeys[], practising?: readonly Hand[]): string | null {
  if (setup.length === 0) return null;
  const keys = setup
    .map((s) => {
      const text = startingSetupHandText(s);
      if (!practising || practising.includes(s.hand)) return text;
      const at = text.indexOf(':');
      return `${text.slice(0, at)}${NOT_PRACTISING}${text.slice(at)}`;
    })
    .join(' · ');
  return `Starting setup — ${keys}. ${STARTING_SETUP_NOTE}`;
}

/** Seconds as "m:ss" (whole seconds, rounded down). */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds + 1e-6)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "0:07 / 4:22", or null in Follow me (no clock). */
export function passageTimeText(time: PassageTime | null): string | null {
  if (!time) return null;
  return `${formatClock(time.elapsed)} / ${formatClock(time.total)}`;
}
