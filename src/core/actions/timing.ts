import type { StepSequence, TempoMap } from '../types';
import { tickToSeconds } from '../model/tempo';

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

/**
 * Listen: when each step is reached, in seconds from the passage start.
 * Real tempo-map time, so long holds keep their length even though they add
 * no columns; `speed` 2 halves every gap, 0.5 doubles it.
 */
export function listenStepTimes(
  seq: Pick<StepSequence, 'steps' | 'startTick'>,
  tempo: TempoMap,
  speed: number,
): number[] {
  requirePositive('speed', speed);
  const origin = tickToSeconds(tempo, seq.startTick);
  return seq.steps.map((s) => (tickToSeconds(tempo, s.tick) - origin) / speed);
}

/** Steady steps: every step gets the same practice interval, regardless of rhythm. */
export function steadyStepTimes(seq: Pick<StepSequence, 'steps'>, stepSeconds: number): number[] {
  requirePositive('stepSeconds', stepSeconds);
  return seq.steps.map((_, i) => i * stepSeconds);
}

/**
 * Listen: length of the whole passage. It runs to the passage end tick, not
 * the last step, so a trailing rest still takes its time before a loop restarts.
 */
export function passageDurationListen(
  seq: Pick<StepSequence, 'startTick' | 'endTick'>,
  tempo: TempoMap,
  speed: number,
): number {
  requirePositive('speed', speed);
  return (tickToSeconds(tempo, seq.endTick) - tickToSeconds(tempo, seq.startTick)) / speed;
}

/** Steady steps: one interval per step, including the final one after the last step. */
export function passageDurationSteady(seq: Pick<StepSequence, 'steps'>, stepSeconds: number): number {
  requirePositive('stepSeconds', stepSeconds);
  return seq.steps.length * stepSeconds;
}
