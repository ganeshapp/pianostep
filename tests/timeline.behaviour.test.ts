/**
 * The real Timeline with requestAnimationFrame driven by hand and a stubbed
 * layout (jsdom has none): big jumps never paint empty rows, and the measure
 * menu stays inside the timeline and with its label.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { DEFAULT_SETTINGS, type StepSequence } from '../src/core/types';
import { PracticeSession } from '../src/engine/session';
import { Timeline } from '../src/ui/notation/Timeline';
import { DEFAULT_COLUMN_WIDTH, MARKER_FRACTION, menuLeft, stripOffset } from '../src/ui/notation/timelineWindow';
import { FakeMidi, FakeSampler } from './helpers/fakes';

const ACT = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

const FILE = 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl';
const prepared = prepareScore(
  loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', FILE))), FILE),
);

function wholePieceSequence(): StepSequence {
  const session = new PracticeSession(prepared, { ...DEFAULT_SETTINGS }, { sampler: new FakeSampler(), midi: new FakeMidi() });
  const sequence = session.getSnapshot().sequence;
  session.dispose();
  return sequence;
}

/* Layout model: a 1280px window with 28px page padding; the timeline's tabs are 48px wide. */
const COL = DEFAULT_COLUMN_WIDTH;
const ROOT_LEFT = 28;
const ROOT_WIDTH = 1224;
const VIEW_LEFT = ROOT_LEFT + 48;
const VIEW_WIDTH = ROOT_WIDTH - 48;
const MENU_WIDTH = 190;

function rect(left: number, width: number, top = 100, height = 30): DOMRect {
  return { left, width, right: left + width, top, height, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function stripX(el: Element): number {
  const strip = el.closest('.tl')?.querySelector<HTMLElement>('.tl__strip');
  return Number(strip?.style.transform.match(/translate3d\((-?[\d.]+)px/)?.[1] ?? 0);
}

const restore: (() => void)[] = [];
function stub<T extends object>(proto: T, key: string, descriptor: PropertyDescriptor): void {
  const before = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, ...descriptor });
  restore.push(() => {
    if (before) Object.defineProperty(proto, key, before);
    else delete (proto as Record<string, unknown>)[key];
  });
}

let frames: FrameRequestCallback[] = [];
function frame(): void {
  const due = frames;
  frames = [];
  for (const cb of due) cb(performance.now());
}

let container: HTMLDivElement;
let root: Root;
let position = 0;

beforeEach(() => {
  ACT.IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  stub(window, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    },
    writable: true,
  });
  stub(window, 'cancelAnimationFrame', { value: () => undefined, writable: true });
  stub(HTMLElement.prototype, 'clientWidth', {
    get(this: HTMLElement) {
      if (this.classList.contains('tl__viewport')) return VIEW_WIDTH;
      if (this.classList.contains('tl')) return ROOT_WIDTH;
      return 0;
    },
  });
  stub(HTMLElement.prototype, 'offsetWidth', {
    get(this: HTMLElement) {
      return this.classList.contains('tl__menu') ? MENU_WIDTH : 0;
    },
  });
  stub(Element.prototype, 'getBoundingClientRect', {
    value(this: Element) {
      if (this.classList.contains('tl')) return rect(ROOT_LEFT, ROOT_WIDTH, 100, 300);
      if (this.classList.contains('tl__viewport')) return rect(VIEW_LEFT, VIEW_WIDTH, 100, 300);
      if (this.classList.contains('tl__measure')) {
        const step = Number(this.closest('.tl__col')?.getAttribute('data-step'));
        return rect(VIEW_LEFT + stripX(this) + step * COL + 3, 30, 104, 22);
      }
      return rect(0, 0, 0, 0);
    },
    writable: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  ACT.IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.unmount());
  container.remove();
  while (restore.length) restore.pop()?.();
});

function renderTimeline(sequence: StepSequence, at: number): void {
  position = at;
  act(() =>
    root.render(
      createElement(Timeline, {
        sequence,
        measures: prepared.measures,
        stepIndex: at,
        getPosition: () => position,
        onSeek: () => undefined,
        onPassageStart: () => undefined,
        onPassageEnd: () => undefined,
      }),
    ),
  );
}

/** Columns that are on screen for the current strip offset, and how many of them are mounted. */
function onScreen(): { visible: number; mounted: number } {
  const strip = container.querySelector<HTMLElement>('.tl__strip');
  if (!strip) throw new Error('no strip');
  const tx = stripX(strip);
  const first = Math.max(0, Math.floor(-tx / COL));
  const last = Math.ceil((-tx + VIEW_WIDTH) / COL) - 1;
  const mounted = new Set([...container.querySelectorAll('.tl__col')].map((c) => Number(c.getAttribute('data-step'))));
  let visible = 0;
  let present = 0;
  for (let i = first; i <= last; i += 1) {
    visible += 1;
    if (mounted.has(i)) present += 1;
  }
  return { visible, mounted: present };
}

describe('Timeline jumps', () => {
  it('a jump far back (Home, restart, loop) has its columns mounted in the same frame as the strip moves', async () => {
    const sequence = wholePieceSequence();
    expect(sequence.steps.length).toBeGreaterThan(150);
    renderTimeline(sequence, 120);
    act(() => frame());
    expect(onScreen().mounted).toBe(onScreen().visible);

    ACT.IS_REACT_ACT_ENVIRONMENT = false;
    position = 0;
    frame();
    // What the browser paints after this frame: no microtask or task has run yet.
    const now = onScreen();
    expect(now.visible).toBeGreaterThan(5);
    expect(now.mounted).toBe(now.visible);
  });

  it('small moves still update the rendered window', () => {
    const sequence = wholePieceSequence();
    renderTimeline(sequence, 0);
    for (let p = 0; p <= 40; p += 1) {
      position = p;
      // act() commits the frame's re-render before the check (a few real
      // milliseconds of waiting are not always enough on a busy machine).
      act(() => frame());
      const now = onScreen();
      expect(now.mounted).toBe(now.visible);
    }
  });
});

describe('measure menu placement', () => {
  function measureButtons(): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>('.tl__measure')];
  }
  function menu(): HTMLElement | null {
    return container.querySelector<HTMLElement>('.tl__menu');
  }
  function left(el: HTMLElement): number {
    return Number.parseFloat(el.style.left);
  }

  it('is kept inside the timeline when its label is near the right edge', () => {
    renderTimeline(wholePieceSequence(), 0);
    // Scroll until a measure label sits in the last ~190px of the timeline.
    const nearRightEdge = (): HTMLButtonElement | undefined =>
      measureButtons().find((b) => {
        const r = b.getBoundingClientRect();
        return r.left - ROOT_LEFT > ROOT_WIDTH - MENU_WIDTH && r.right < VIEW_LEFT + VIEW_WIDTH;
      });
    let rightmost = nearRightEdge();
    for (let p = 1; !rightmost && p < 40; p += 1) {
      position = p;
      act(() => frame());
      rightmost = nearRightEdge();
    }
    if (!rightmost) throw new Error('no measure label near the right edge');
    act(() => rightmost.click());
    const m = menu();
    expect(m).not.toBeNull();
    if (!m) return;
    expect(left(m)).toBe(ROOT_WIDTH - MENU_WIDTH);
    expect(left(m) + MENU_WIDTH).toBeLessThanOrEqual(ROOT_WIDTH);
  });

  it('starts under its label, follows it while the strip moves, and closes once the label has scrolled away', async () => {
    renderTimeline(wholePieceSequence(), 0);
    const label = measureButtons().find((b) => {
      const x = b.getBoundingClientRect().left - ROOT_LEFT;
      return x > 300 && x < 600;
    });
    if (!label) throw new Error('no label in the middle');
    act(() => label.click());
    const m = menu();
    if (!m) throw new Error('menu did not open');
    const start = left(m);
    expect(start).toBeCloseTo(label.getBoundingClientRect().left - ROOT_LEFT, 5);

    position = 1;
    act(() => frame());
    expect(left(m)).toBeCloseTo(start - COL, 5);

    // Far enough that the label is left of the visible timeline.
    const step = Number(label.closest('.tl__col')?.getAttribute('data-step'));
    const offset = stripOffset(step + 12, VIEW_WIDTH, COL, MARKER_FRACTION);
    expect(VIEW_LEFT + offset + step * COL + 33).toBeLessThan(VIEW_LEFT);
    position = step + 12;
    act(() => frame());
    expect(menu()).toBeNull();
  });
});

describe('the viewport never scrolls away from the play marker', () => {
  /** Mounted columns that are (at least partly) inside the viewport for the current strip offset. */
  function inView(col: Element): boolean {
    const step = Number(col.getAttribute('data-step'));
    const left = VIEW_LEFT + stripX(col) + step * COL;
    return left < VIEW_LEFT + VIEW_WIDTH && left + COL > VIEW_LEFT;
  }

  it('leaves measure labels outside the viewport out of the tab order', () => {
    const sequence = wholePieceSequence();
    for (const at of [0, 100, 200]) {
      renderTimeline(sequence, at);
      const labels = [...container.querySelectorAll<HTMLButtonElement>('.tl__measure')];
      const outside = labels.filter((b) => !inView(b.closest('.tl__col') as Element));
      const inside = labels.filter((b) => inView(b.closest('.tl__col') as Element));
      // Measure labels are mounted beyond the right edge (the overscan) ...
      expect(outside.length).toBeGreaterThan(0);
      expect(inside.length).toBeGreaterThan(0);
      // ... but Tab never reaches them: focusing one would scroll the viewport.
      for (const b of outside) expect(b.tabIndex).toBe(-1);
      for (const b of inside) expect(b.tabIndex).toBe(0);
    }
  });

  it('keeps the labels\' tab order in step with the strip as it moves', () => {
    renderTimeline(wholePieceSequence(), 0);
    for (let p = 1; p <= 30; p += 1) {
      position = p;
      // act() commits the frame's re-render before the check: waiting a few
      // real milliseconds for React instead is not enough on a busy machine.
      act(() => frame());
      for (const b of container.querySelectorAll<HTMLButtonElement>('.tl__measure')) {
        expect(b.tabIndex).toBe(inView(b.closest('.tl__col') as Element) ? 0 : -1);
      }
    }
  });

  it('undoes any scroll of the viewport (a focused control brought into view)', () => {
    renderTimeline(wholePieceSequence(), 0);
    const viewport = container.querySelector<HTMLElement>('.tl__viewport');
    if (!viewport) throw new Error('no viewport');
    let scrollLeft = 0;
    Object.defineProperty(viewport, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
    });
    scrollLeft = 1400;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollLeft).toBe(0);
  });

  it('clips the strip instead of making the viewport a scroll container', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'notation', 'notation.css'), 'utf8');
    const rule = css.match(/\.tl__viewport\s*\{([^}]*)\}/)?.[1] ?? '';
    const overflow = [...rule.matchAll(/overflow\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
    // The last declaration wins where it is supported.
    expect(overflow.at(-1)).toBe('clip');
  });
});

describe('menuLeft', () => {
  it('keeps the menu inside its container and never past the left edge', () => {
    expect(menuLeft(100, 190, 1224)).toBe(100);
    expect(menuLeft(1172, 190, 1224)).toBe(1034);
    expect(menuLeft(-20, 190, 1224)).toBe(0);
    expect(menuLeft(50, 400, 300)).toBe(0);
    expect(menuLeft(80, 190, 0)).toBe(80);
  });
});
