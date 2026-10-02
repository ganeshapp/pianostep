import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { ActionStep, Hand, MeasureOccurrence, StepSequence } from '../../core/types';
import { isKeyboardClick, keepFocusOnMouse } from '../common/pointerFocus';
import { Cell } from './Cell';
import { HAND_NAME } from './labels';
import { HEAD_HEIGHT, measureStarts, ROW_HANDS, rowHeights, splitLabel, type MeasureStart } from './timelineLayout';
import {
  clampPan,
  columnsInView,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_OVERSCAN,
  DRAG_THRESHOLD_PX,
  MARKER_FRACTION,
  menuLeft,
  sameWindow,
  scrubberGeometry,
  snapPosition,
  stripOffset,
  viewAtScrubber,
  visibleRange,
  wheelPanPixels,
  type ColumnWindow,
} from './timelineWindow';
import './notation.css';

interface ColumnProps {
  index: number;
  step: ActionStep;
  /** Hands being practised; the other row stays in place, blank. */
  activeHands: readonly Hand[];
  heights: Record<Hand, number>;
  colWidth: number;
  past: boolean;
  current: boolean;
  /**
   * The column is inside the viewport. Measure labels in the overscan are
   * left out of the tab order: focusing one would bring it into view by
   * scrolling the viewport, away from the play marker.
   */
  onScreen: boolean;
  measure: MeasureStart | null;
  measureLabel: string | null;
  menuOpenForOcc: number | null;
  onSeek: (index: number) => void;
  onMeasure: (occ: number, trigger: HTMLButtonElement, byKeyboard: boolean) => void;
  /** The current column took keyboard focus: the view goes back to it. */
  onFocusCurrent: () => void;
}

const Column = memo(function Column({
  index,
  step,
  activeHands,
  heights,
  colWidth,
  past,
  current,
  onScreen,
  measure,
  measureLabel,
  menuOpenForOcc,
  onSeek,
  onMeasure,
  onFocusCurrent,
}: ColumnProps) {
  const label = measure && measureLabel !== null ? splitLabel(measureLabel) : null;
  return (
    <div
      className={`tl__col${past ? ' is-past' : ''}${current ? ' is-current' : ''}`}
      style={{ left: index * colWidth, width: colWidth }}
      data-step={index}
    >
      <div className="tl__head">
        {measure && label && (
          <button
            type="button"
            className="tl__measure"
            data-occ={measure.occ}
            tabIndex={onScreen ? 0 : -1}
            style={{ maxWidth: measure.span * colWidth - 6 }}
            title={`Measure ${measureLabel} — choose a passage`}
            aria-label={`Measure ${measureLabel}: passage options`}
            aria-haspopup="menu"
            aria-expanded={menuOpenForOcc === measure.occ}
            onMouseDown={keepFocusOnMouse}
            onClick={(e) => onMeasure(measure.occ, e.currentTarget, isKeyboardClick(e))}
          >
            <span>{label.main}</span>
            {label.pass && <span className="tl__measure-pass">{label.pass}</span>}
          </button>
        )}
      </div>
      {measure && <span className="tl__boundary" aria-hidden="true" />}
      <button
        type="button"
        className="tl__cells"
        tabIndex={current ? 0 : -1}
        aria-current={current ? 'step' : undefined}
        onMouseDown={keepFocusOnMouse}
        onClick={() => onSeek(index)}
        onFocus={current ? onFocusCurrent : undefined}
      >
        <span className="nt-sr-only">{`Step ${index + 1}. `}</span>
        {ROW_HANDS.map((hand) => {
          const active = activeHands.includes(hand);
          return (
            <span
              key={hand}
              className={`tl__row tl__row--${hand}${active ? '' : ' is-off'}`}
              style={{ height: heights[hand] }}
            >
              {active && <Cell hand={hand} cell={step.cells[hand]} />}
            </span>
          );
        })}
      </button>
      <span className="tl__gridline" aria-hidden="true" />
    </div>
  );
});

/** The mounted columns and, within them, the ones in the viewport. */
interface Windows {
  rendered: ColumnWindow;
  visible: ColumnWindow;
}

function windowsAt(position: number, width: number, colWidth: number, total: number): Windows {
  return {
    rendered: visibleRange(position, width, colWidth, MARKER_FRACTION, total, DEFAULT_OVERSCAN),
    visible: visibleRange(position, width, colWidth, MARKER_FRACTION, total, 0),
  };
}

/**
 * Keyboard focus to move once an update is committed: to the label of
 * measure occurrence `occ` when it is in view, else to the current column.
 */
interface FocusRequest {
  occ: number | null;
}

/** The focused column or measure label, read before an update is committed. */
interface FocusedControl {
  el: HTMLElement;
  occ: number | null;
}

function focusedIn(strip: HTMLElement | null): FocusedControl | null {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!strip || !(el instanceof HTMLElement) || !strip.contains(el)) return null;
  const occ = el.dataset.occ;
  return { el, occ: occ === undefined ? null : Number(occ) };
}

interface MenuState {
  occ: number;
  top: number;
  trigger: HTMLButtonElement;
  /** Opened with Enter/Space: focus starts on the first item and returns to the label on close. */
  byKeyboard: boolean;
}

/**
 * Pointer capture keeps a drag going when the pointer leaves the element.
 * It throws for a pointer that is no longer active; the drag then simply
 * works without it.
 */
function capturePointer(el: Element, id: number): void {
  try {
    el.setPointerCapture?.(id);
  } catch {
    // Not an active pointer (already lifted): nothing to capture.
  }
}

function releasePointer(el: Element, id: number): void {
  try {
    if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
  } catch {
    // Already released.
  }
}

/** A press on the notes that may turn into a drag (pan) once it moves far enough. */
interface DragState {
  id: number;
  x: number;
  /** Pan offset when the press began. */
  start: number;
  moved: boolean;
}

/** A press on the scrubber: the thumb (and the view) follow the pointer. */
interface ScrubDrag {
  id: number;
  x: number;
  start: number;
  /** Columns per px of the track. */
  scale: number;
}

export interface TimelineProps {
  sequence: StepSequence;
  /**
   * The rows are sized to fit this sequence's stacks as well: the passage
   * with both hands, so the rows keep their height whichever hand is
   * practised. Default: `sequence`.
   */
  layoutSequence?: Pick<StepSequence, 'steps'>;
  /** All measure occurrences of the piece (labels for the measure headers). */
  measures: readonly MeasureOccurrence[];
  /** The marker step from the session snapshot. */
  stepIndex: number;
  /** Fractional step position, read every animation frame. */
  getPosition: () => number;
  onSeek: (index: number) => void;
  onPassageStart: (occ: number) => void;
  onPassageEnd: (occ: number) => void;
  colWidth?: number;
  /** Shown instead of columns when the sequence has no steps. */
  emptyMessage?: string;
  /**
   * The notes can be looked through (panned) without moving the marker:
   * true while stopped, paused, finished or waiting in Follow me; false
   * during Listen / Steady playback, when the view follows the marker.
   */
  browsable?: boolean;
  /** A change brings the view back to the marker (Play, the step buttons, Home…). */
  recenterKey?: number;
}

/**
 * Two-row instruction timeline. A requestAnimationFrame loop moves the strip
 * with a transform; React only re-renders when the window of rendered columns
 * or the snapshot changes. While not playing, the notes can be panned (a
 * sideways wheel or trackpad swipe, Shift + wheel, a drag, or the scrubber
 * under them) without moving the marker.
 */
export function Timeline({
  sequence,
  layoutSequence,
  measures,
  stepIndex,
  getPosition,
  onSeek,
  onPassageStart,
  onPassageEnd,
  colWidth = DEFAULT_COLUMN_WIDTH,
  emptyMessage = 'Nothing to play here.',
  browsable = true,
  recenterKey = 0,
}: TimelineProps) {
  const { steps, hands: activeHands } = sequence;
  const total = steps.length;
  const heights = useMemo(() => {
    const own = rowHeights({ hands: ROW_HANDS, steps });
    if (!layoutSequence || layoutSequence.steps === steps) return own;
    const both = rowHeights({ hands: ROW_HANDS, steps: layoutSequence.steps });
    return { R: Math.max(own.R, both.R), L: Math.max(own.L, both.L) };
  }, [steps, layoutSequence]);
  const starts = useMemo(() => measureStarts(steps), [steps]);
  const bodyHeight = ROW_HANDS.reduce((sum, h) => sum + heights[h], 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);

  const [win, setWin] = useState<Windows>(() => windowsAt(stepIndex, 1200, colWidth, total));
  const winRef = useRef(win);
  const widthRef = useRef(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const focusRequest = useRef<FocusRequest | null>(null);

  /** Columns the view is moved away from the marker (0 = following it). */
  const panRef = useRef(0);
  const [panned, setPanned] = useState(false);
  /** The (snapped) marker position and the view position last drawn. */
  const positionRef = useRef(stepIndex);
  const viewRef = useRef(stepIndex);
  /** Draws the strip now (after a pan), without waiting for the next frame. */
  const renderRef = useRef<() => void>(() => undefined);
  const browsableRef = useRef(browsable);
  const totalRef = useRef(total);
  const dragRef = useRef<DragState | null>(null);
  const scrubDragRef = useRef<ScrubDrag | null>(null);
  /** The click that ends a drag must not also seek. */
  const swallowClick = useRef(false);

  const callbacks = useRef({ getPosition, onSeek, onPassageStart, onPassageEnd });
  useLayoutEffect(() => {
    callbacks.current = { getPosition, onSeek, onPassageStart, onPassageEnd };
    browsableRef.current = browsable;
    totalRef.current = total;
  });

  const menuState = useRef<MenuState | null>(null);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    const open = menuState.current;
    setMenu(null);
    if (!open || !restoreFocus) return;
    if (open.trigger.isConnected) open.trigger.focus({ preventScroll: true });
    else focusRequest.current = { occ: null };
  }, []);

  /**
   * Keeps the open menu under its measure label as the strip moves, and
   * inside the timeline. When the label scrolls out of view (or its column is
   * no longer rendered) the menu closes rather than being left behind.
   */
  const placeMenu = useCallback((): void => {
    const open = menuState.current;
    const el = menuRef.current;
    const root = rootRef.current;
    const viewport = viewportRef.current;
    if (!open || !el || !root || !viewport) return;
    const away = (): void => {
      // Keyboard focus in the menu goes to the current column, not the page body.
      if (open.byKeyboard && el.contains(document.activeElement)) focusRequest.current = { occ: null };
      closeMenu(false);
    };
    if (!open.trigger.isConnected) {
      away();
      return;
    }
    const r = open.trigger.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    if (view.width > 0 && (r.right <= view.left || r.left >= view.right)) {
      away();
      return;
    }
    const rootLeft = root.getBoundingClientRect().left;
    el.style.left = `${menuLeft(r.left - rootLeft, el.offsetWidth, root.clientWidth)}px`;
  }, [closeMenu]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const strip = stripRef.current;
    if (!viewport || !strip) {
      renderRef.current = () => undefined;
      return undefined;
    }
    const motion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let width = viewport.clientWidth;
    let lastPos = Number.NaN;
    let lastView = Number.NaN;
    let lastWidth = -1;
    let lastMarker = Number.NaN;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            width = viewport.clientWidth;
          })
        : null;
    observer?.observe(viewport);

    /** The scrubber's thumb (the columns in view) and its mark for the current step. */
    const drawScrubber = (view: number, pos: number): void => {
      const thumb = thumbRef.current;
      const now = nowRef.current;
      const scrub = scrubRef.current;
      if (!thumb || !now || !scrub) return;
      const g = scrubberGeometry(view, pos, width, colWidth, MARKER_FRACTION, total);
      thumb.style.left = `${g.start * 100}%`;
      thumb.style.width = `${g.size * 100}%`;
      now.style.left = `${g.now * 100}%`;
      const first = Math.min(total, Math.floor(g.start * total + 1e-6) + 1);
      const last = Math.max(first, Math.min(total, Math.round((g.start + g.size) * total)));
      const at = Math.min(total, Math.max(1, Math.round(view) + 1));
      scrub.setAttribute('aria-valuenow', String(at));
      scrub.setAttribute('aria-valuetext', `Showing steps ${first} to ${last} of ${total}`);
    };

    const render = (fromFrame: boolean): void => {
      if (!observer) width = viewport.clientWidth;
      widthRef.current = width;
      const pos = snapPosition(callbacks.current.getPosition(), motion?.matches ?? false);
      const pan = clampPan(pos, panRef.current, total);
      const view = pos + pan;
      positionRef.current = pos;
      viewRef.current = view;
      if (pos === lastPos && view === lastView && width === lastWidth) return;
      // The marker stays with the current step: panning moves it with the notes.
      const markerLeft = width * MARKER_FRACTION - colWidth / 2 - pan * colWidth;
      if (markerLeft !== lastMarker && markerRef.current) {
        markerRef.current.style.left = `${markerLeft}px`;
        lastMarker = markerLeft;
      }
      lastPos = pos;
      lastView = view;
      lastWidth = width;
      const next = windowsAt(view, width, colWidth, total);
      const now = winRef.current;
      if (!sameWindow(next.rendered, now.rendered) || !sameWindow(next.visible, now.visible)) {
        const covered = next.visible.start >= now.rendered.start && next.visible.end <= now.rendered.end;
        winRef.current = next;
        // A jump past the rendered columns (Home, Restart, a loop back to the
        // start) must mount the new columns before the strip moves there, or
        // the frame is painted with empty rows: a state update from
        // requestAnimationFrame is only committed in a later task. Small moves
        // stay within the overscan and update asynchronously.
        if (fromFrame && !covered) flushSync(() => setWin(next));
        else setWin(next);
      }
      strip.style.transform = `translate3d(${stripOffset(view, width, colWidth, MARKER_FRACTION)}px, 0, 0)`;
      drawScrubber(view, pos);
      placeMenu();
    };
    renderRef.current = () => render(false);

    let frame = 0;
    const loop = (): void => {
      render(true);
      frame = window.requestAnimationFrame(loop);
    };
    render(false);
    frame = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      renderRef.current = () => undefined;
    };
  }, [colWidth, total, placeMenu]);

  /** Moves the view to `offset` columns from the marker (clamped to the passage). */
  const panTo = useCallback((offset: number): void => {
    if (!browsableRef.current) return;
    const next = clampPan(positionRef.current, offset, totalRef.current);
    if (next === panRef.current) return;
    panRef.current = next;
    setPanned(next !== 0);
    renderRef.current();
  }, []);

  /** Back to following the marker. */
  const recenter = useCallback((): void => {
    if (panRef.current === 0) return;
    panRef.current = 0;
    setPanned(false);
    renderRef.current();
  }, []);

  // Any step change, a new sequence, playback starting, or a transport action
  // (recenterKey) brings the view back to the marker.
  useLayoutEffect(() => {
    recenter();
  }, [stepIndex, sequence, browsable, recenterKey, recenter]);

  // The viewport clips the strip (overflow: clip). Where clip is not supported
  // it is overflow: hidden, which the browser still scrolls to show a focused
  // control; the strip is positioned by transform only, so undo any scroll.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const unscroll = (): void => {
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
      if (viewport.scrollTop !== 0) viewport.scrollTop = 0;
    };
    viewport.addEventListener('scroll', unscroll);
    return () => viewport.removeEventListener('scroll', unscroll);
  }, []);

  // A sideways wheel or trackpad swipe (or Shift + wheel) over the notes pans
  // them. It is never left to the browser, which would scroll the page
  // sideways or go back in history; during playback it does nothing. An
  // upright wheel still scrolls the page. Not passive, to prevent the default.
  const hasSteps = total > 0;
  useEffect(() => {
    const targets = [rootRef.current, navRef.current].filter((el): el is HTMLDivElement => el !== null);
    const onWheel = (e: WheelEvent): void => {
      if (totalRef.current === 0) return;
      const px = wheelPanPixels(e, widthRef.current);
      if (px === null) return;
      e.preventDefault();
      if (browsableRef.current) panTo(panRef.current + px / colWidth);
    };
    for (const el of targets) el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      for (const el of targets) el.removeEventListener('wheel', onWheel);
    };
  }, [colWidth, panTo, hasSteps]);

  /* Dragging the notes. A press only becomes a drag once it has moved
     DRAG_THRESHOLD_PX, so a plain click still seeks or opens a measure menu. */
  const onViewportPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    swallowClick.current = false;
    if (!browsableRef.current || total === 0 || e.button !== 0 || !e.isPrimary) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, start: panRef.current, moved: false };
  };
  const onViewportPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      // The viewport keeps the pointer while the drag lasts, wherever it goes.
      capturePointer(e.currentTarget, e.pointerId);
      e.currentTarget.classList.add('is-dragging');
    }
    // Dragging the notes to the right looks back.
    panTo(d.start - dx / colWidth);
  };
  const endViewportDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    swallowClick.current = true;
    e.currentTarget.classList.remove('is-dragging');
    releasePointer(e.currentTarget, e.pointerId);
  };
  const onViewportClickCapture = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  /* The scrubber: the whole passage, with the columns in view as its thumb. */
  const onScrubPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!browsableRef.current || total === 0 || e.button !== 0) return;
    const track = e.currentTarget.getBoundingClientRect();
    if (!(track.width > 0)) return;
    const thumb = thumbRef.current?.getBoundingClientRect();
    const onThumb = thumb !== undefined && thumb.width > 0 && e.clientX >= thumb.left && e.clientX <= thumb.right;
    if (!onThumb) {
      const view = viewAtScrubber(
        (e.clientX - track.left) / track.width,
        widthRef.current,
        colWidth,
        MARKER_FRACTION,
        total,
      );
      panTo(view - positionRef.current);
    }
    scrubDragRef.current = { id: e.pointerId, x: e.clientX, start: panRef.current, scale: total / track.width };
    capturePointer(e.currentTarget, e.pointerId);
  };
  const onScrubPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = scrubDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    panTo(d.start + (e.clientX - d.x) * d.scale);
  };
  const endScrubDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = scrubDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    scrubDragRef.current = null;
    releasePointer(e.currentTarget, e.pointerId);
  };
  const onScrubKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!browsableRef.current || total === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const view = viewRef.current;
    const page = columnsInView(widthRef.current, colWidth);
    let target: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = Math.round(view) + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = Math.round(view) - 1;
        break;
      case 'PageDown':
        target = view + page;
        break;
      case 'PageUp':
        target = view - page;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = total - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    panTo(target - positionRef.current);
  };

  /** "Back to current step": from the keyboard, focus goes to the current column, not the page body. */
  const onBack = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    recenter();
    if (isKeyboardClick(e)) {
      stripRef.current?.querySelector<HTMLElement>('.tl__cells[tabindex="0"]')?.focus({ preventScroll: true });
    }
  };

  // Read before this update is committed (it may remove or reuse the element).
  const focusedBefore = focusedIn(stripRef.current);

  /**
   * Keeps keyboard focus in the timeline on the right control after every
   * update. Columns are reused by index and unmounted outside the rendered
   * window, so a focused column or label can disappear (focus would drop to
   * the page body) or come to show another step or measure.
   * - A focused column follows the current step (a roving tab stop).
   * - A focused label that now shows another measure, or was removed, moves
   *   to its own measure's label if that is in view, else to the current column.
   * - A request from the measure menu or its closing is carried out once the
   *   control is mounted.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const strip = stripRef.current;
    if (!root) return;
    const active = document.activeElement;
    const free = active === null || active === document.body;
    const lost =
      focusedBefore !== null &&
      (free ||
        (active === focusedBefore.el &&
          focusedBefore.occ !== null &&
          focusedBefore.el.dataset.occ !== String(focusedBefore.occ)));
    if (lost) {
      focusRequest.current ??= { occ: focusedBefore.occ };
    } else if (
      active instanceof HTMLElement &&
      active.classList.contains('tl__cells') &&
      strip?.contains(active) &&
      active.tabIndex !== 0
    ) {
      focusRequest.current = { occ: null };
    }
    const want = focusRequest.current;
    if (!want) return;
    if (!strip || (!free && !root.contains(active))) {
      // Nothing to focus (no steps), or the learner has moved on.
      focusRequest.current = null;
      return;
    }
    let target: HTMLElement | null = null;
    const label = want.occ === null ? null : strip.querySelector<HTMLElement>(`.tl__measure[data-occ="${want.occ}"]`);
    if (label) {
      // In view (without a layout, width 0, any mounted label counts).
      const col = Number(label.closest('.tl__col')?.getAttribute('data-step'));
      const width = widthRef.current;
      const view = visibleRange(stepIndex + panRef.current, width, colWidth, MARKER_FRACTION, total, 0);
      if (!(width > 0) || (col >= view.start && col < view.end)) target = label;
    }
    target ??= strip.querySelector<HTMLElement>('.tl__cells[tabindex="0"]');
    // The current column is not mounted yet: try again once the window has caught up.
    if (!target) return;
    focusRequest.current = null;
    if (target !== active) target.focus({ preventScroll: true });
  });

  const seek = useCallback(
    (index: number) => {
      callbacks.current.onSeek(index);
      recenter();
    },
    [recenter],
  );

  const openMenu = useCallback((occ: number, trigger: HTMLButtonElement, byKeyboard: boolean) => {
    const root = rootRef.current;
    if (!root) return;
    const r = trigger.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setMenu((prev) =>
      prev && prev.occ === occ ? null : { occ, top: r.bottom - rootRect.top + 4, trigger, byKeyboard },
    );
  }, []);

  // Measured after mount (the menu's width is only known then) and before paint.
  useLayoutEffect(() => {
    menuState.current = menu;
    if (menu) placeMenu();
  }, [menu, placeMenu]);

  useEffect(() => {
    if (!menu) return undefined;
    // From the keyboard, focus starts on the first item (menu pattern). After a
    // mouse click it goes to the menu itself, so the arrow keys and Esc still
    // work but Space never silently picks an item the user cannot see focused.
    if (menu.byKeyboard) {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    } else {
      menuRef.current?.focus({ preventScroll: true });
    }
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target && (menuRef.current?.contains(target) || menu.trigger.contains(target))) return;
      closeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu, closeMenu]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(menuState.current?.byKeyboard ?? false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = 0;
      if (e.key === 'ArrowDown') next = (at + 1) % items.length;
      else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
      else if (e.key === 'End') next = items.length - 1;
      items[next].focus();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    } else if ((e.key === ' ' || e.key === 'Spacebar') && e.target === menuRef.current) {
      // Focus is on the menu itself (opened with the mouse): Space picks
      // nothing and, like the other shortcuts, does nothing while the menu is
      // open, rather than scrolling the page away from it.
      e.preventDefault();
    }
  };

  /**
   * A passage chosen in the measure menu. After keyboard use, focus goes to
   * the chosen measure's label once the new passage is shown (columns are
   * reused by index, so the old label element may now show another measure).
   * After a mouse click focus stays free, so Space and the arrows remain shortcuts.
   */
  const choosePassage = (e: { detail: number }, occ: number, pick: (occ: number) => void): void => {
    pick(occ);
    if (isKeyboardClick(e)) focusRequest.current = { occ };
    closeMenu(false);
  };

  const columns = [];
  const { rendered, visible } = win;
  const end = Math.min(rendered.end, total);
  const column = (i: number) => {
    const measure = starts.get(i) ?? null;
    return (
      <Column
        key={i}
        index={i}
        step={steps[i]}
        activeHands={activeHands}
        heights={heights}
        colWidth={colWidth}
        past={i < stepIndex}
        current={i === stepIndex}
        onScreen={i >= visible.start && i < visible.end}
        measure={measure}
        measureLabel={measure ? (measures[measure.occ]?.label ?? String(measure.occ + 1)) : null}
        menuOpenForOcc={measure && menu?.occ === measure.occ ? menu.occ : null}
        onSeek={seek}
        onMeasure={openMenu}
        onFocusCurrent={recenter}
      />
    );
  };
  for (let i = Math.max(0, rendered.start); i < end; i += 1) columns.push(column(i));
  // The current column stays mounted while the notes are panned away from
  // it, so it remains the strip's tab stop and keeps keyboard focus.
  if (stepIndex >= 0 && stepIndex < total && (stepIndex < rendered.start || stepIndex >= end)) {
    columns.push(column(stepIndex));
  }

  const menuLabel = menu ? (measures[menu.occ]?.label ?? String(menu.occ + 1)) : '';
  const offHands = ROW_HANDS.filter((h) => !activeHands.includes(h));

  return (
    <div className="tl-box">
      <div
        ref={rootRef}
        className="tl"
        role="group"
        aria-label="Instructions"
        style={{ height: HEAD_HEIGHT + bodyHeight + 2 }}
      >
        <div className="tl__tabs" aria-hidden={total === 0 ? true : undefined}>
          <div className="tl__tabs-head" style={{ height: HEAD_HEIGHT }} />
          {ROW_HANDS.map((hand) => {
            const on = activeHands.includes(hand);
            const name = on ? HAND_NAME[hand] : `${HAND_NAME[hand]} (not practising)`;
            return (
              <div
                key={hand}
                className={`tl__tab tl__tab--${hand}${on ? '' : ' is-off'}`}
                style={{ height: heights[hand], boxSizing: 'border-box' }}
              >
                <span className="tl__tab-letter" role="img" aria-label={name} title={name}>
                  {hand}
                </span>
              </div>
            );
          })}
        </div>
        <div
          ref={viewportRef}
          className={`tl__viewport${browsable && total > 0 ? ' is-browsable' : ''}`}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={endViewportDrag}
          onPointerCancel={endViewportDrag}
          onClickCapture={onViewportClickCapture}
        >
          {total === 0 ? (
            <div className="tl__empty">{emptyMessage}</div>
          ) : (
            <>
              <div
                ref={markerRef}
                className="tl__marker"
                style={{ left: 1200 * MARKER_FRACTION - colWidth / 2, width: colWidth }}
                aria-hidden="true"
              />
              <div ref={stripRef} className="tl__strip" style={{ width: total * colWidth }}>
                {columns}
              </div>
              {offHands.map((hand) => (
                <div
                  key={hand}
                  className={`tl__off-hint tl__off-hint--${hand}`}
                  style={{ top: HEAD_HEIGHT + (hand === 'L' ? heights.R : 0), height: heights[hand] }}
                  aria-hidden="true"
                >
                  {hand === 'R' ? 'Right hand: not practising' : 'Left hand: not practising'}
                </div>
              ))}
            </>
          )}
        </div>
        {menu && (
          <div
            ref={menuRef}
            className="tl__menu"
            role="menu"
            aria-label={`Measure ${menuLabel}`}
            tabIndex={-1}
            style={{ top: menu.top }}
            onKeyDown={onMenuKey}
          >
            <div className="tl__menu-title" aria-hidden="true">
              Measure {menuLabel}
            </div>
            <button
              type="button"
              role="menuitem"
              className="tl__menu-item"
              onClick={(e) => choosePassage(e, menu.occ, callbacks.current.onPassageStart)}
            >
              Start passage here
            </button>
            <button
              type="button"
              role="menuitem"
              className="tl__menu-item"
              onClick={(e) => choosePassage(e, menu.occ, callbacks.current.onPassageEnd)}
            >
              End passage here
            </button>
          </div>
        )}
      </div>
      {/* Always there, so the card keeps its height when the chosen hand has
          nothing to play (an empty passage shows an empty, inert track). */}
      <div ref={navRef} className="tl-nav">
        {total === 0 ? (
          <div className="tl-scrub is-locked is-empty" aria-hidden="true" />
        ) : (
          <div
            ref={scrubRef}
            className={`tl-scrub${browsable ? '' : ' is-locked'}`}
            role="slider"
            tabIndex={browsable ? 0 : -1}
            aria-label="Look through the passage"
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-disabled={browsable ? undefined : true}
            title={browsable ? 'Drag to look through the passage' : undefined}
            onMouseDown={keepFocusOnMouse}
            onPointerDown={onScrubPointerDown}
            onPointerMove={onScrubPointerMove}
            onPointerUp={endScrubDrag}
            onPointerCancel={endScrubDrag}
            onKeyDown={onScrubKey}
          >
            <div ref={thumbRef} className="tl-scrub__thumb" />
            <div ref={nowRef} className="tl-scrub__now" />
          </div>
        )}
        {panned && total > 0 && (
          <button
            type="button"
            className="tl-nav__back"
            onMouseDown={keepFocusOnMouse}
            onClick={onBack}
          >
            Back to current step
          </button>
        )}
      </div>
    </div>
  );
}
