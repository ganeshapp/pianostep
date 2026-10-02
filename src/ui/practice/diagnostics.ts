import type { PreparedScore, ScoreWarning, WarningSeverity } from '../../core/types';

export const SEVERITY_ORDER: readonly WarningSeverity[] = ['error', 'review', 'info'];

export const SEVERITY_TITLE: Readonly<Record<WarningSeverity, string>> = {
  error: 'Problems',
  review: 'Worth checking',
  info: 'For your information',
};

export function groupWarnings(warnings: readonly ScoreWarning[]): [WarningSeverity, ScoreWarning[]][] {
  return SEVERITY_ORDER.map((sev): [WarningSeverity, ScoreWarning[]] => [
    sev,
    warnings.filter((w) => w.severity === sev),
  ]).filter(([, list]) => list.length > 0);
}

export function measureList(w: ScoreWarning): string | null {
  const measures = w.measures ?? [];
  if (measures.length === 0) return null;
  const more = w.measuresTruncated === true;
  const word = measures.length === 1 ? 'Measure' : 'Measures';
  return `${word} ${measures.join(', ')}${more ? ' and others' : ''}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type TempoFacts = Pick<PreparedScore, 'tempo'> & Partial<Pick<PreparedScore, 'warnings' | 'measures'>>;

/** The file marks a tempo, but only after the opening, which plays at the app's default (opening-tempo-defaulted). */
function openingDefaulted(prepared: TempoFacts): boolean {
  return !prepared.tempo.defaulted && (prepared.warnings ?? []).some((w) => w.code === 'opening-tempo-defaulted');
}

/** The written number of the measure that `tick` falls in, or null. */
function measureAtTick(measures: TempoFacts['measures'], tick: number): string | null {
  const m = (measures ?? []).find((o) => tick >= o.startTick && tick < o.startTick + Math.max(1, o.durationTicks));
  return m ? m.number : null;
}

function changesText(n: number, more: boolean): string {
  const word = more ? 'more ' : '';
  return n === 0 ? '' : n === 1 ? `, with 1 ${word}change` : `, with ${n} ${word}changes`;
}

/**
 * The Speed row: where the speed comes from. A file that marks its first
 * tempo only after the opening is told apart from one that marks it from the
 * start: its opening speed is the app's default, not the file's.
 */
export function tempoDescription(prepared: TempoFacts): string {
  const { points, defaulted } = prepared.tempo;
  const first = Math.round(points[0]?.qpm ?? 120);
  if (defaulted) {
    return `Not given in the file — the app plays it at ${first} quarter notes per minute.`;
  }
  if (openingDefaulted(prepared)) {
    const mark = points[1];
    const where = mark ? measureAtTick(prepared.measures, mark.tick) : null;
    const opening = `The opening has no tempo mark, so the app plays it at its default of ${first} quarter notes per minute`;
    if (!mark) return `${opening}.`;
    const from = where === null ? 'until the first marked tempo' : `until measure ${where}`;
    return (
      `${opening} ${from}. From there it follows the file: ` +
      `${Math.round(mark.qpm)} quarter notes per minute${changesText(points.length - 2, true)}.`
    );
  }
  return `From the file: starts at ${first} quarter notes per minute${changesText(points.length - 1, false)}.`;
}

/**
 * The Length row: the whole piece at its speed, which is the app's default
 * when the file gives none (or, for an unmarked opening, until its first mark).
 */
export function lengthDescription(prepared: TempoFacts, seconds: number): string {
  const speed = prepared.tempo.defaulted
    ? 'the app’s default speed'
    : openingDefaulted(prepared)
      ? 'the written speed (the unmarked opening at the app’s default)'
      : 'the written speed';
  return `About ${formatDuration(seconds)} at ${speed}`;
}
