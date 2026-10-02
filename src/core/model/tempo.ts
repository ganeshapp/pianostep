import type { TempoMap } from '../types';

/**
 * Piecewise-constant tempo: between two tempo points the quarter-note rate is
 * constant, so tick -> seconds is piecewise linear and exact at every point.
 */

function secondsPerTick(map: TempoMap, qpm: number): number {
  return 60 / (qpm * map.ticksPerQuarter);
}

/** Seconds (at 1x speed) from tick 0 to `tick`. */
export function tickToSeconds(map: TempoMap, tick: number): number {
  const pts = map.points;
  let seconds = 0;
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].tick;
    const end = i + 1 < pts.length ? pts[i + 1].tick : Infinity;
    if (tick <= start) break;
    const span = Math.min(tick, end) - start;
    seconds += span * secondsPerTick(map, pts[i].qpm);
    if (tick <= end) break;
  }
  return seconds;
}

/** Inverse of tickToSeconds (returns a possibly fractional tick). */
export function secondsToTick(map: TempoMap, seconds: number): number {
  const pts = map.points;
  let elapsed = 0;
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].tick;
    const end = i + 1 < pts.length ? pts[i + 1].tick : Infinity;
    const spt = secondsPerTick(map, pts[i].qpm);
    const segSeconds = (end - start) * spt;
    if (seconds <= elapsed + segSeconds) {
      return start + (seconds - elapsed) / spt;
    }
    elapsed += segSeconds;
  }
  return pts.length ? pts[pts.length - 1].tick : 0;
}

/** Tempo (qpm) in effect at `tick`. */
export function tempoAt(map: TempoMap, tick: number): number {
  let qpm = map.points[0]?.qpm ?? 120;
  for (const p of map.points) {
    if (p.tick <= tick) qpm = p.qpm;
    else break;
  }
  return qpm;
}

export const DEFAULT_QPM = 120;
