import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { ActionStep, Hand, MeasureOccurrence, StepSequence } from '../../core/types';
import { isKeyboardClick, keepFocusOnMouse } from '../common/pointerFocus';
import { Cell } from './Cell';
import { HAND_NAME } from './labels';
import { HEAD_HEIGHT, measureStarts, rowHeights, splitLabel, type MeasureStart } from './timelineLayout';
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_OVERSCAN,
  MARKER_FRACTION,
  menuLeft,
  sameWindow,
  snapPosition,
  stripOffset,
  visibleRange,
  type ColumnWindow,
} from './timelineWindow';
import './notation.css';

interface ColumnProps {
  index: number;
  step: ActionStep;
  hands: readonly Hand[];
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
}

const Column = memo(function Column({
  index,
  step,
  hands,
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
      >
        <span className="nt-sr-only">{`Step ${index + 1}. `}</span>
        {hands.map((hand) => (
          <span key={hand} className={`tl__row tl__row--${hand}`} style={{ height: heights[hand] }}>
            <Cell hand={hand} cell={step.cells[hand]} />
          </span>
        ))}
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

export interface TimelineProps {
  sequence: StepSequence;
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
}

/**
 * Two-row instruction timeline. A requestAnimationFrame loop moves the strip
 * with a transform; React only re-renders when the window of rendered columns
 * or the snapshot changes.
 */
export function Timeline({
  sequence,
  measures,
  stepIndex,
  getPosition,
  onSeek,
  onPassageStart,
  onPassageEnd,
  colWidth = DEFAULT_COLUMN_WIDTH,
  emptyMessage = 'Nothing to play here.',
}: TimelineProps) {
  const { steps, hands } = sequence;
  const total = steps.length;
  const heights = useMemo(() => rowHeights(sequence), [sequence]);
  const starts = useMemo(() => measureStarts(steps), [steps]);
  const bodyHeight = hands.reduce((sum, h) => sum + heights[h], 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [win, setWin] = useState<Windows>(() => windowsAt(stepIndex, 1200, colWidth, total));
  const winRef = useRef(win);
  const widthRef = useRef(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const focusRequest = useRef<FocusRequest | null>(null);

  const callbacks = useRef({ getPosition, onSeek, onPassageStart, onPassageEnd });
  useLayoutEffect(() => {
    callbacks.current = { getPosition, onSeek, onPassageStart, onPassageEnd };
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
    if (!viewport || !strip) return undefined;
    const motion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let width = viewport.clientWidth;
    let lastPos = Number.NaN;
    let lastWidth = -1;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            width = viewport.clientWidth;
          })
        : null;
    observer?.observe(viewport);

    const render = (fromFrame: boolean): void => {
      if (!observer) width = viewport.clientWidth;
      widthRef.current = width;
      const pos = snapPosition(callbacks.current.getPosition(), motion?.matches ?? false);
      if (pos === lastPos && width === lastWidth) return;
      if (width !== lastWidth && markerRef.current) {
        markerRef.current.style.left = `${width * MARKER_FRACTION - colWidth / 2}px`;
      }
      lastPos = pos;
      lastWidth = width;
      const next = windowsAt(pos, width, colWidth, total);
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
      strip.style.transform = `translate3d(${stripOffset(pos, width, colWidth, MARKER_FRACTION)}px, 0, 0)`;
      placeMenu();
    };

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
    };
  }, [colWidth, total, placeMenu]);

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
      // In view at the current step (without a layout, width 0, any mounted label counts).
      const col = Number(label.closest('.tl__col')?.getAttribute('data-step'));
      const width = widthRef.current;
      const view = visibleRange(stepIndex, width, colWidth, MARKER_FRACTION, total, 0);
      if (!(width > 0) || (col >= view.start && col < view.end)) target = label;
    }
    target ??= strip.querySelector<HTMLElement>('.tl__cells[tabindex="0"]');
    // The current column is not mounted yet: try again once the window has caught up.
    if (!target) return;
    focusRequest.current = null;
    if (target !== active) target.focus({ preventScroll: true });
  });

  const seek = useCallback((index: number) => callbacks.current.onSeek(index), []);

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
  for (let i = Math.max(0, rendered.start); i < end; i += 1) {
    const measure = starts.get(i) ?? null;
    columns.push(
      <Column
        key={i}
        index={i}
        step={steps[i]}
        hands={hands}
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
      />,
    );
  }

  const menuLabel = menu ? (measures[menu.occ]?.label ?? String(menu.occ + 1)) : '';

  return (
    <div
      ref={rootRef}
      className="tl"
      role="group"
      aria-label="Instructions"
      style={{ height: HEAD_HEIGHT + bodyHeight + 2 }}
    >
      <div className="tl__tabs" aria-hidden={total === 0 ? true : undefined}>
        <div className="tl__tabs-head" style={{ height: HEAD_HEIGHT }} />
        {hands.map((hand) => (
          <div
            key={hand}
            className={`tl__tab tl__tab--${hand}`}
            style={{ height: heights[hand], boxSizing: 'border-box' }}
          >
            <span className="tl__tab-letter" role="img" aria-label={HAND_NAME[hand]} title={HAND_NAME[hand]}>
              {hand}
            </span>
          </div>
        ))}
      </div>
      <div ref={viewportRef} className="tl__viewport">
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
  );
}
