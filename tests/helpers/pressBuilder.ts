/**
 * Compact builders for action-step tests: key presses, simple measure
 * occurrences, tempo maps, and expected notation cells.
 *
 * Default grid: 4/4 with ticksPerQuarter = 4, so one measure = 16 ticks.
 */
import type {
  Hand,
  HandCell,
  KeyPress,
  MeasureOccurrence,
  NoteToken,
  PreparedScore,
  TempoMap,
} from '../../src/core/types';
import { labelToMidi, midiToLabel } from '../../src/core/pitch';

export const TPQ = 4;
export const MEASURE_TICKS = 4 * TPQ;

export type Key = string | number;

export interface PressSpec {
  hand: Hand;
  /** "C#4" style label or a midi number. */
  key: Key;
  start: number;
  end: number;
}

export function midiOf(key: Key): number {
  if (typeof key === 'number') return key;
  const midi = labelToMidi(key);
  if (midi === null) throw new Error(`bad key label ${key}`);
  return midi;
}

const HAND_ORDER: Record<Hand, number> = { R: 0, L: 1 };

/** KeyPress[] sorted like PreparedScore.presses (start, R before L, midi). */
export function buildPresses(specs: readonly PressSpec[]): KeyPress[] {
  return specs
    .map((s, i): KeyPress => {
      const id = `${s.hand}${i}`;
      return { id, hand: s.hand, midi: midiOf(s.key), startTick: s.start, endTick: s.end, noteIds: [`n${i}`] };
    })
    .sort((a, b) => a.startTick - b.startTick || HAND_ORDER[a.hand] - HAND_ORDER[b.hand] || a.midi - b.midi);
}

/** Shorthands for one hand. */
export const R = (key: Key, start: number, end: number): PressSpec => ({ hand: 'R', key, start, end });
export const L = (key: Key, start: number, end: number): PressSpec => ({ hand: 'L', key, start, end });

/** Consecutive occurrences with the given lengths (pass 1, numbered from 1). */
export function measuresFromLengths(lengths: readonly number[]): MeasureOccurrence[] {
  let tick = 0;
  return lengths.map((durationTicks, occ) => {
    const m: MeasureOccurrence = {
      occ,
      measureIndex: occ,
      number: String(occ + 1),
      pass: 1,
      startTick: tick,
      durationTicks,
      label: String(occ + 1),
    };
    tick += durationTicks;
    return m;
  });
}

export function buildMeasures(count: number, ticksPerMeasure = MEASURE_TICKS): MeasureOccurrence[] {
  return measuresFromLengths(Array.from({ length: count }, () => ticksPerMeasure));
}

export type ScoreInput = Pick<PreparedScore, 'presses' | 'measures' | 'endTick'>;

/**
 * A minimal score for deriveSteps. Without explicit measures, enough
 * default-length measures are generated to cover every press (at least one).
 */
export function buildScore(specs: readonly PressSpec[], measures?: readonly MeasureOccurrence[]): ScoreInput {
  const presses = buildPresses(specs);
  const lastEnd = presses.reduce((m, p) => Math.max(m, p.endTick), 0);
  const occs = measures ? [...measures] : buildMeasures(Math.max(1, Math.ceil(lastEnd / MEASURE_TICKS)));
  const last = occs[occs.length - 1];
  return { presses, measures: occs, endTick: last ? last.startTick + last.durationTicks : 0 };
}

/** Tempo map from [tick, qpm] pairs. */
export function tempoMap(points: ReadonlyArray<readonly [number, number]>, ticksPerQuarter = TPQ): TempoMap {
  return { ticksPerQuarter, points: points.map(([tick, qpm]) => ({ tick, qpm })), defaulted: false };
}

/* Expected notation ------------------------------------------------------- */

interface Flags {
  repress?: boolean;
  carried?: boolean;
}

function tok(key: Key, action: NoteToken['action'], flags: Flags = {}): NoteToken {
  const midi = midiOf(key);
  const t: NoteToken = { midi, label: midiToLabel(midi), action };
  if (flags.repress) t.repress = true;
  if (flags.carried) t.carried = true;
  return t;
}

/** Normal (foreground) stack token. */
export const press = (key: Key, flags?: Flags): NoteToken => tok(key, 'press', flags);
/** Red token. */
export const add = (key: Key, flags?: Flags): NoteToken => tok(key, 'add', flags);
/** Red re-press token. */
export const repress = (key: Key): NoteToken => tok(key, 'add', { repress: true });
/** Blue token. */
export const rel = (key: Key): NoteToken => tok(key, 'release');

export const replace = (...tokens: NoteToken[]): HandCell => ({ kind: 'replace', tokens });
export const change = (...tokens: NoteToken[]): HandCell => ({ kind: 'change', tokens });
export const HOLD: HandCell = { kind: 'hold', tokens: [] };
export const REST: HandCell = { kind: 'rest', tokens: [] };

/** Midi numbers for a list of labels, ascending (as held/attack sets are stored). */
export function keys(...labels: Key[]): number[] {
  return labels.map(midiOf).sort((a, b) => a - b);
}
