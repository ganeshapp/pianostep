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

export function tempoDescription(prepared: Pick<PreparedScore, 'tempo'>): string {
  const { points, defaulted } = prepared.tempo;
  const first = Math.round(points[0]?.qpm ?? 120);
  if (defaulted) {
    return `Not given in the file — the app plays it at ${first} quarter notes per minute.`;
  }
  const changes = points.length - 1;
  const extra = changes === 0 ? '' : changes === 1 ? ', with 1 change' : `, with ${changes} changes`;
  return `From the file: starts at ${first} quarter notes per minute${extra}.`;
}

/** The Length row: the whole piece at its speed, which is the app's default when the file gives none. */
export function lengthDescription(prepared: Pick<PreparedScore, 'tempo'>, seconds: number): string {
  const speed = prepared.tempo.defaulted ? 'the app’s default speed' : 'the written speed';
  return `About ${formatDuration(seconds)} at ${speed}`;
}
