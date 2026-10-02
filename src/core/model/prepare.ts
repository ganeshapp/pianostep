import type { KeyPress, MeasureOccurrence, PreparedScore, Readiness, ScoreOverrides, ScoreWarning, SourceScore } from '../types';
import { isOnPiano } from '../pitch';
import { detectHandMapping } from './hands';
import { buildPerformanceNotes, buildTempoMap, mergeWarnings, noTempoWarning, unrollMeasures, WarningBag } from './performance';
import { buildKeyPresses } from './physical';

export const NO_PRESSES_REASON = 'There are no notes to play for either hand.';

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
}

/** source.title → first credit line → "Untitled". */
export function chooseTitle(source: SourceScore): string {
  const title = source.title?.trim();
  if (title) return title;
  for (const credit of source.credits) {
    const line = firstLine(credit);
    if (line) return line;
  }
  return 'Untitled';
}

function pressRange(presses: readonly KeyPress[]): { min: number; max: number } | null {
  if (presses.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of presses) {
    if (p.midi < min) min = p.midi;
    if (p.midi > max) max = p.midi;
  }
  return { min, max };
}

/**
 * Widest stretch, in semitones, one hand is expected to strike at once: a
 * major tenth (C3 to E4). Wider chords are not playable by one hand, so the
 * hand assignment there needs checking (a staff is not an infallible hand
 * label, §10).
 */
export const MAX_HAND_SPAN = 16;

/** The occurrence whose span contains `tick` (binary search over performance order). */
function occurrenceAt(occurrences: readonly MeasureOccurrence[], tick: number): MeasureOccurrence | undefined {
  let lo = 0;
  let hi = occurrences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const o = occurrences[mid];
    if (tick < o.startTick) hi = mid - 1;
    else if (tick >= o.startTick + o.durationTicks) lo = mid + 1;
    else return o;
  }
  return undefined;
}

/**
 * Review warning for moments where one hand strikes keys more than
 * MAX_HAND_SPAN semitones apart at the same instant. Keys still held from
 * earlier are not counted, only keys struck together.
 */
export function handSpanWarnings(presses: readonly KeyPress[], occurrences: readonly MeasureOccurrence[]): ScoreWarning[] {
  const span = new Map<string, { hand: KeyPress['hand']; tick: number; min: number; max: number }>();
  for (const p of presses) {
    const key = `${p.hand}@${p.startTick}`;
    const s = span.get(key);
    if (!s) span.set(key, { hand: p.hand, tick: p.startTick, min: p.midi, max: p.midi });
    else {
      if (p.midi < s.min) s.min = p.midi;
      if (p.midi > s.max) s.max = p.midi;
    }
  }
  const bag = new WarningBag();
  const wide = [...span.values()].filter((s) => s.max - s.min > MAX_HAND_SPAN).sort((a, b) => a.tick - b.tick);
  for (const s of wide) {
    const occ = occurrenceAt(occurrences, s.tick);
    bag.add(
      'hand-span-too-wide',
      'review',
      'In some places one hand is asked to strike keys too far apart to reach at once (wider than a tenth). Some of those notes may belong to the other hand, or the chord may be meant to be rolled.',
      occ ? [occ.number] : [],
    );
  }
  return bag.list();
}

export function assessReadiness(
  presses: readonly KeyPress[],
  warnings: readonly ScoreWarning[],
): { readiness: Readiness; readinessReasons: string[] } {
  const errors = warnings.filter((w) => w.severity === 'error').map((w) => w.message);
  const reviews = warnings.filter((w) => w.severity === 'review').map((w) => w.message);
  if (presses.length === 0 || errors.length) {
    const reasons = presses.length === 0 ? [NO_PRESSES_REASON, ...errors] : errors;
    return { readiness: 'unsupported', readinessReasons: [...reasons, ...reviews] };
  }
  if (reviews.length) return { readiness: 'review', readinessReasons: reviews };
  return { readiness: 'ready', readinessReasons: [] };
}

export function prepareScore(source: SourceScore, overrides?: ScoreOverrides): PreparedScore {
  const hands = detectHandMapping(source, overrides);
  const unrolled = unrollMeasures(source);
  const occurrences = unrolled.occurrences;
  const tempo = buildTempoMap(source, occurrences);
  const performance = buildPerformanceNotes(source, occurrences, hands.mapping);
  const physical = buildKeyPresses(performance.notes, occurrences);

  const rangeBag = new WarningBag();
  if (!source.warnings.some((w) => w.code === 'out-of-piano-range')) {
    for (const p of physical.presses) {
      if (isOnPiano(p.midi)) continue;
      const occ = occurrences.find((o) => p.startTick >= o.startTick && p.startTick < o.startTick + o.durationTicks);
      rangeBag.add(
        'out-of-piano-range',
        'review',
        'Some notes are outside the 88 keys of a piano. They are kept as written, but the keyboard cannot show them.',
        occ ? [occ.number] : [],
      );
    }
  }

  const warnings = mergeWarnings(
    source.warnings,
    hands.warnings,
    unrolled.warnings,
    tempo.defaulted ? [noTempoWarning()] : [],
    performance.warnings,
    physical.warnings,
    rangeBag.list(),
    handSpanWarnings(physical.presses, occurrences),
  );
  const last = occurrences[occurrences.length - 1];
  const { readiness, readinessReasons } = assessReadiness(physical.presses, warnings);

  return {
    meta: { title: chooseTitle(source), composer: source.composer, arranger: source.arranger },
    source,
    handMapping: hands.mapping,
    measures: occurrences,
    tempo,
    notes: performance.notes,
    presses: physical.presses,
    endTick: last ? last.startTick + last.durationTicks : 0,
    range: pressRange(physical.presses),
    warnings,
    readiness,
    readinessReasons,
  };
}
