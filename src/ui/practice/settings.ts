import { DEFAULT_SETTINGS } from '../../core/types';
import type { ActionStep, PassageRange, PracticeMode, PracticeSettings } from '../../core/types';

export const SPEED_SLIDER = { min: 0.25, max: 2, step: 0.05 } as const;
export const STEP_SECONDS_SLIDER = { min: 0.3, max: 4, step: 0.1 } as const;

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** A stored passage that no longer fits this piece (or covers all of it) becomes "whole piece". */
export function validRange(range: PassageRange | null | undefined, occurrenceCount: number): PassageRange | null {
  if (!range || occurrenceCount <= 0) return null;
  const { startOcc, endOcc } = range;
  if (!Number.isInteger(startOcc) || !Number.isInteger(endOcc)) return null;
  if (startOcc < 0 || endOcc >= occurrenceCount || startOcc > endOcc) return null;
  if (startOcc === 0 && endOcc === occurrenceCount - 1) return null;
  return { startOcc, endOcc };
}

/**
 * Settings to start a session with. Follow me needs a connected piano, so a
 * saved Follow me falls back to Listen until the piano is connected again.
 */
export function restoreSettings(
  saved: Partial<PracticeSettings> | null | undefined,
  occurrenceCount: number,
  canFollow: boolean,
): PracticeSettings {
  const s: PracticeSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  const modes: PracticeMode[] = ['listen', 'steady', 'follow'];
  let mode: PracticeMode = modes.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode;
  if (mode === 'follow' && !canFollow) mode = 'listen';
  return {
    ...s,
    mode,
    hands: s.hands === 'R' || s.hands === 'L' ? s.hands : 'both',
    speed: clampNumber(s.speed, SPEED_SLIDER.min, SPEED_SLIDER.max, DEFAULT_SETTINGS.speed),
    stepSeconds: clampNumber(
      s.stepSeconds,
      STEP_SECONDS_SLIDER.min,
      STEP_SECONDS_SLIDER.max,
      DEFAULT_SETTINGS.stepSeconds,
    ),
    range: validRange(s.range, occurrenceCount),
  };
}

/** "From measure" changed: the end moves along if it would come before the start. */
export function passageStartingAt(
  range: PassageRange | null,
  occ: number,
  occurrenceCount: number,
): PassageRange | null {
  const last = occurrenceCount - 1;
  const end = range ? range.endOcc : last;
  return validRange({ startOcc: occ, endOcc: Math.max(occ, end) }, occurrenceCount);
}

/** "To measure" changed: the start moves along if it would come after the end. */
export function passageEndingAt(
  range: PassageRange | null,
  occ: number,
  occurrenceCount: number,
): PassageRange | null {
  const start = range ? range.startOcc : 0;
  return validRange({ startOcc: Math.min(occ, start), endOcc: occ }, occurrenceCount);
}

/** The first step at or after a saved tick, so a reopened piece resumes where it was left. */
export function stepIndexForTick(steps: readonly Pick<ActionStep, 'tick'>[], tick: number | null): number {
  if (tick === null || steps.length === 0) return 0;
  const i = steps.findIndex((s) => s.tick >= tick);
  return i < 0 ? steps.length - 1 : i;
}

export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

export function formatStepSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}
