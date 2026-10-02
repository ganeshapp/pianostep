/** Seconds -> "m:ss" (or "h:mm:ss" from an hour up). */
export function formatDuration(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** Spoken form for screen readers: "1 minute 32 seconds". */
export function spokenDuration(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

export function measuresText(count: number): string {
  return `${count} ${count === 1 ? 'measure' : 'measures'}`;
}

/** "C3–G5", or null when the range is unknown. */
export function keyRangeText(lowest: string | null | undefined, highest: string | null | undefined): string | null {
  if (!lowest || !highest) return null;
  return lowest === highest ? lowest : `${lowest}–${highest}`;
}

/** Plural-aware count: (1, 'piece') -> "1 piece". */
export function countText(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatAddedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
