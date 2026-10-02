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

/* ---------------------------------------------------------------------- */
/* Looking through the notes while not playing                             */
/* ---------------------------------------------------------------------- */

/**
 * A pointer has to move this far (px) before a press on the notes becomes a
 * drag that pans them; a shorter movement is still a click that seeks.
 */
export const DRAG_THRESHOLD_PX = 6;

/** Wheel "line" units in px (Firefox reports lines). */
const WHEEL_LINE_PX = 16;

/**
 * The pan offset (in columns, added to the marker position) clamped so the
 * view stays on the passage: at most the first column, or the last, sits
 * under the marker. No steps: no panning.
 */
export function clampPan(position: number, offset: number, total: number): number {
  const count = Math.max(0, Math.floor(total));
  if (count === 0 || !Number.isFinite(offset)) return 0;
  const pos = Number.isFinite(position) ? position : 0;
  const min = -pos;
  const max = count - 1 - pos;
  if (max < min) return 0;
  const clamped = Math.min(max, Math.max(min, offset));
  // Never -0 (from -position at step 0), so "not panned" is always plain 0.
  return clamped === 0 ? 0 : clamped;
}

/** The column under the marker's place in the viewport once the notes are panned. */
export function viewPosition(position: number, offset: number, total: number): number {
  const pos = Number.isFinite(position) ? position : 0;
  return pos + clampPan(pos, offset, total);
}

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (WheelEvent.deltaMode). */
  deltaMode: number;
  shiftKey: boolean;
}

/**
 * Horizontal movement of a wheel event in px, for panning the notes: a
 * trackpad's sideways swipe (deltaX), or Shift with a mouse wheel (deltaY
 * where the browser does not already turn it into deltaX). Null when the
 * movement is mostly vertical, which is left to scroll the page.
 */
export function wheelPanPixels(e: WheelLike, pageWidth: number): number | null {
  let dx = Number.isFinite(e.deltaX) ? e.deltaX : 0;
  let dy = Number.isFinite(e.deltaY) ? e.deltaY : 0;
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  if (dx === 0 || Math.abs(dx) < Math.abs(dy)) return null;
  const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? Math.max(1, pageWidth) : 1;
  return dx * unit;
}

/** The scrubber under the notes, as fractions (0–1) of its track. */
export interface ScrubberGeometry {
  /** Left edge of the thumb: the first visible column. */
  start: number;
  /** Width of the thumb: the share of the passage in view. */
  size: number;
  /** The current step (the marker), whether or not it is in view. */
  now: number;
}

/**
 * The visible window of columns for a view position, and the marker's step,
 * as parts of the whole passage.
 */
export function scrubberGeometry(
  view: number,
  position: number,
  viewportWidth: number,
  colWidth: number,
  markerFraction: number,
  total: number,
): ScrubberGeometry {
  const count = Math.max(0, Math.floor(total));
  if (count === 0 || !(colWidth > 0)) return { start: 0, size: 1, now: 0 };
  const width = Math.max(0, viewportWidth);
  const clamp = (x: number): number => Math.min(count, Math.max(0, Number.isFinite(x) ? x : 0));
  const left = -stripOffset(view, width, colWidth, markerFraction) / colWidth;
  const a = clamp(left);
  const b = clamp(left + width / colWidth);
  return { start: a / count, size: Math.max(0, b - a) / count, now: clamp(position + 0.5) / count };
}

/**
 * The view position whose visible window is centred on `fraction` of the
 * passage (a click on the scrubber's track). Not clamped: pass it through
 * clampPan.
 */
export function viewAtScrubber(
  fraction: number,
  viewportWidth: number,
  colWidth: number,
  markerFraction: number,
  total: number,
): number {
  const count = Math.max(0, Math.floor(total));
  if (count === 0 || !(colWidth > 0)) return 0;
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const width = Math.max(0, viewportWidth);
  // The window's left edge, in columns, is view + 0.5 - width * markerFraction / colWidth.
  return f * count - width / colWidth / 2 - 0.5 + (width * markerFraction) / colWidth;
}

/** Columns that fit in the viewport (at least one), for paging through the notes. */
export function columnsInView(viewportWidth: number, colWidth: number): number {
  if (!(colWidth > 0) || !(viewportWidth > 0)) return 1;
  return Math.max(1, Math.floor(viewportWidth / colWidth));
}
