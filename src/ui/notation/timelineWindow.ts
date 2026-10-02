/** Half-open range of column indexes [start, end). */
export interface ColumnWindow {
  start: number;
  end: number;
}

export const DEFAULT_COLUMN_WIDTH = 72;
/** The play marker sits a little left of centre so upcoming steps stay in view. */
export const MARKER_FRACTION = 0.28;
export const DEFAULT_OVERSCAN = 20;

/**
 * Horizontal offset of the strip so that the centre of column `position`
 * (fractional while playback moves between steps) sits under the marker.
 */
export function stripOffset(
  position: number,
  viewportWidth: number,
  colWidth: number,
  markerFraction: number,
): number {
  const pos = Number.isFinite(position) ? position : 0;
  return viewportWidth * markerFraction - (pos + 0.5) * colWidth;
}

/**
 * Columns that intersect the viewport for a given scroll position, widened by
 * `overscan` columns on each side and clamped to [0, total].
 */
export function visibleRange(
  position: number,
  viewportWidth: number,
  colWidth: number,
  markerFraction: number,
  total: number,
  overscan: number,
): ColumnWindow {
  const count = Math.max(0, Math.floor(total));
  if (count === 0 || !(colWidth > 0)) return { start: 0, end: 0 };
  const extra = Math.max(0, Math.floor(overscan));
  const width = Math.max(0, viewportWidth);

  const left = -stripOffset(position, width, colWidth, markerFraction);
  const first = Math.floor(left / colWidth);
  const last = Math.ceil((left + width) / colWidth) - 1;

  const start = Math.min(count, Math.max(0, first - extra));
  const end = Math.min(count, Math.max(start, last + 1 + extra));
  return { start, end };
}

/** Reduced motion: jump from step to step instead of gliding between them. */
export function snapPosition(position: number, reducedMotion: boolean): number {
  if (!Number.isFinite(position)) return 0;
  return reducedMotion ? Math.floor(position + 1e-6) : position;
}

export function sameWindow(a: ColumnWindow, b: ColumnWindow): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * Left edge of a popup menu that should start under its trigger but stay
 * inside its container: shifted left when it would overflow on the right,
 * never past the left edge. A container not laid out yet (width 0) only
 * clamps the left edge.
 */
export function menuLeft(desired: number, menuWidth: number, containerWidth: number): number {
  const want = Number.isFinite(desired) ? desired : 0;
  if (!(containerWidth > 0)) return Math.max(0, want);
  return Math.max(0, Math.min(want, containerWidth - Math.max(0, menuWidth)));
}
