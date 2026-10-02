/**
 * Looking through the notes while not playing: the real Timeline, with
 * requestAnimationFrame driven by hand and a stubbed layout (jsdom has none).
 * A sideways wheel, Shift + wheel, a drag or the scrubber pan the notes
 * without moving the marker step; "Back to current step", a step change or
 * a transport action bring the view back. During playback nothing pans.
 * Both rows always show, sized for both hands.
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
import { Timeline, type TimelineProps } from '../src/ui/notation/Timeline';
import { DEFAULT_COLUMN_WIDTH, MARKER_FRACTION, stripOffset } from '../src/ui/notation/timelineWindow';
import { shortcutFor } from '../src/ui/practice/shortcuts';
import { FakeMidi, FakeSampler } from './helpers/fakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl';
const prepared = prepareScore(
  loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', FILE))), FILE),
);

function sequenceFor(hands: 'both' | 'R' | 'L'): StepSequence {
  const session = new PracticeSession(prepared, { ...DEFAULT_SETTINGS, hands }, { sampler: new FakeSampler(), midi: new FakeMidi() });
  const sequence = session.getSnapshot().sequence;
  session.dispose();
  return sequence;
}
const BOTH = sequenceFor('both');
const RIGHT = sequenceFor('R');

/* Layout model: a 1280px window with 28px page padding; the timeline's tabs are 48px wide. */
const COL = DEFAULT_COLUMN_WIDTH;
const ROOT_LEFT = 28;
const ROOT_WIDTH = 1224;
const VIEW_LEFT = ROOT_LEFT + 48;
const VIEW_WIDTH = ROOT_WIDTH - 48;

function rect(left: number, width: number, top = 100, height = 30): DOMRect {
  return { left, width, right: left + width, top, height, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
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
let seeks: number[] = [];

beforeEach(() => {
  frames = [];
  seeks = [];
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
  stub(Element.prototype, 'getBoundingClientRect', {
    value(this: Element) {
      if (this.classList.contains('tl')) return rect(ROOT_LEFT, ROOT_WIDTH, 100, 300);
      if (this.classList.contains('tl__viewport')) return rect(VIEW_LEFT, VIEW_WIDTH, 100, 300);
      if (this.classList.contains('tl-scrub')) return rect(VIEW_LEFT, VIEW_WIDTH, 410, 10);
      if (this.classList.contains('tl-scrub__thumb')) {
        const el = this as HTMLElement;
        const l = Number.parseFloat(el.style.left) / 100;
        const w = Number.parseFloat(el.style.width) / 100;
        return rect(VIEW_LEFT + l * VIEW_WIDTH, w * VIEW_WIDTH, 410, 10);
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
  act(() => root.unmount());
  container.remove();
  while (restore.length) restore.pop()?.();
});

function render(at: number, patch: Partial<TimelineProps> = {}): void {
  position = at;
  act(() =>
    root.render(
      createElement(Timeline, {
        sequence: BOTH,
        measures: prepared.measures,
        stepIndex: at,
        getPosition: () => position,
        onSeek: (i) => seeks.push(i),
        onPassageStart: () => undefined,
        onPassageEnd: () => undefined,
        ...patch,
      }),
    ),
  );
}

function q<T extends Element>(sel: string): T {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
}

function stripX(): number {
  return Number(q<HTMLElement>('.tl__strip').style.transform.match(/translate3d\((-?[\d.]+)px/)?.[1] ?? Number.NaN);
}

function markerLeft(): number {
  return Number.parseFloat(q<HTMLElement>('.tl__marker').style.left);
}

function backButton(): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === 'Back to current step') ?? null;
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function pointer(type: string, target: Element, clientX: number, extra: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX, pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse', ...extra }),
    );
  });
}

function click(target: Element, clientX: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, detail: 1 }));
  });
}

/** The strip's offset when column `view` sits under the marker's place. */
const offsetFor = (view: number): number => stripOffset(view, VIEW_WIDTH, COL, MARKER_FRACTION);

describe('looking ahead and back while not playing', () => {
  it('a sideways swipe pans the notes without moving the marker step, and "Back to current step" returns', () => {
    render(10);
    expect(stripX()).toBeCloseTo(offsetFor(10), 6);
    const marker = markerLeft();
    const ev = wheel(q('.tl__viewport'), { deltaX: COL * 5 });
    expect(ev.defaultPrevented).toBe(true);
    expect(stripX()).toBeCloseTo(offsetFor(15), 6);
    // The marker stays with the current step, moving with the notes.
    expect(markerLeft()).toBeCloseTo(marker - COL * 5, 6);
    expect(seeks).toEqual([]);
    // The marker step itself is unchanged.
    expect(q('.tl__cells[aria-current="step"]').closest('.tl__col')?.getAttribute('data-step')).toBe('10');

    const back = backButton();
    expect(back).not.toBeNull();
    act(() => back?.click());
    expect(stripX()).toBeCloseTo(offsetFor(10), 6);
    expect(markerLeft()).toBeCloseTo(marker, 6);
    expect(backButton()).toBeNull();
  });

  it('Shift + wheel pans too; an upright wheel is left to scroll the page', () => {
    render(10);
    wheel(q('.tl__viewport'), { deltaY: COL * 3, shiftKey: true });
    expect(stripX()).toBeCloseTo(offsetFor(13), 6);
    const upright = wheel(q('.tl__viewport'), { deltaY: 120 });
    expect(upright.defaultPrevented).toBe(false);
    expect(stripX()).toBeCloseTo(offsetFor(13), 6);
  });

  it('never pans past the first or the last step', () => {
    render(3);
    wheel(q('.tl__viewport'), { deltaX: -COL * 50 });
    expect(stripX()).toBeCloseTo(offsetFor(0), 6);
    wheel(q('.tl__viewport'), { deltaX: COL * 100_000 });
    expect(stripX()).toBeCloseTo(offsetFor(BOTH.steps.length - 1), 6);
  });

  it('a drag pans and does not seek; a press that barely moves is still a click that seeks', () => {
    render(10);
    const viewport = q('.tl__viewport');
    const cell = q('.tl__col[data-step="12"] .tl__cells');
    pointer('pointerdown', cell, 500);
    for (let x = 500; x >= 500 - COL * 4; x -= 24) pointer('pointermove', viewport, x);
    pointer('pointerup', viewport, 500 - COL * 4);
    click(cell, 500 - COL * 4);
    expect(stripX()).toBeCloseTo(offsetFor(14), 6);
    expect(seeks).toEqual([]);

    // A wobble under the threshold, then a click: it seeks, and the view goes back to the marker.
    const other = q('.tl__col[data-step="16"] .tl__cells');
    pointer('pointerdown', other, 300);
    pointer('pointermove', viewport, 303);
    pointer('pointerup', viewport, 303);
    click(other, 303);
    expect(seeks).toEqual([16]);
    expect(backButton()).toBeNull();
  });

  it('the scrubber shows the passage; a click on its track jumps there and its arrow keys pan', () => {
    render(0);
    const scrub = q<HTMLElement>('.tl-scrub');
    expect(scrub.getAttribute('role')).toBe('slider');
    expect(scrub.getAttribute('aria-valuetext')).toMatch(/^Showing steps 1 to \d+ of \d+$/);
    const total = BOTH.steps.length;
    pointer('pointerdown', scrub, VIEW_LEFT + VIEW_WIDTH * 0.5);
    pointer('pointerup', scrub, VIEW_LEFT + VIEW_WIDTH * 0.5);
    const thumb = q<HTMLElement>('.tl-scrub__thumb');
    const middle = (Number.parseFloat(thumb.style.left) + Number.parseFloat(thumb.style.width) / 2) / 100;
    expect(middle).toBeCloseTo(0.5, 2);
    expect(seeks).toEqual([]);
    // The current step's mark stays at the start.
    expect(Number.parseFloat(q<HTMLElement>('.tl-scrub__now').style.left)).toBeCloseTo((0.5 / total) * 100, 6);

    const before = stripX();
    act(() => {
      scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(stripX()).toBeLessThan(before);
    act(() => {
      scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    });
    expect(stripX()).toBeCloseTo(offsetFor(0), 6);
  });

  it('a step change, a new sequence or a transport action brings the view back to the marker', () => {
    render(10);
    wheel(q('.tl__viewport'), { deltaX: COL * 8 });
    expect(backButton()).not.toBeNull();
    render(11);
    act(() => frame());
    expect(stripX()).toBeCloseTo(offsetFor(11), 6);
    expect(backButton()).toBeNull();

    wheel(q('.tl__viewport'), { deltaX: COL * 8 });
    render(11, { recenterKey: 1 });
    expect(stripX()).toBeCloseTo(offsetFor(11), 6);
    expect(backButton()).toBeNull();
  });

  it('keeps the current column mounted (the strip\'s tab stop) when panned far away, and focusing it returns there', () => {
    render(5);
    wheel(q('.tl__viewport'), { deltaX: COL * 120 });
    act(() => frame());
    const current = q<HTMLButtonElement>('.tl__cells[aria-current="step"]');
    expect(current.tabIndex).toBe(0);
    // The overscan does not reach back to step 5.
    expect(container.querySelector('.tl__col[data-step="20"]')).toBeNull();
    // Measure labels now in view are tab stops; the current column is the only column stop.
    expect([...container.querySelectorAll('.tl__cells[tabindex="0"]')]).toEqual([current]);
    act(() => current.focus());
    expect(stripX()).toBeCloseTo(offsetFor(5), 6);
    expect(document.activeElement).toBe(current);
  });

  it('"Back to current step" from the keyboard puts focus on the current column', () => {
    render(5);
    wheel(q('.tl__viewport'), { deltaX: COL * 30 });
    const back = backButton();
    if (!back) throw new Error('no back button');
    act(() => back.focus());
    act(() => back.click()); // detail 0: Enter / Space
    expect(document.activeElement).toBe(q('.tl__cells[aria-current="step"]'));
  });
});

describe('during Listen / Steady playback', () => {
  it('ignores panning (the view follows the marker), but still keeps a sideways swipe from the browser', () => {
    render(10, { browsable: false });
    const ev = wheel(q('.tl__viewport'), { deltaX: COL * 5 });
    expect(ev.defaultPrevented).toBe(true);
    expect(stripX()).toBeCloseTo(offsetFor(10), 6);
    const viewport = q('.tl__viewport');
    pointer('pointerdown', q('.tl__col[data-step="11"] .tl__cells'), 500);
    pointer('pointermove', viewport, 300);
    pointer('pointerup', viewport, 300);
    expect(stripX()).toBeCloseTo(offsetFor(10), 6);
    expect(backButton()).toBeNull();
  });

  it('the scrubber is disabled, so the arrow keys on it are play-page shortcuts again', () => {
    render(10, { browsable: false });
    const scrub = q<HTMLElement>('.tl-scrub');
    expect(scrub.getAttribute('aria-disabled')).toBe('true');
    expect(scrub.tabIndex).toBe(-1);
    const ev = { key: 'ArrowRight', altKey: false, ctrlKey: false, metaKey: false, target: scrub };
    expect(shortcutFor(ev, document)).toBe('next');
    render(10, { browsable: true });
    expect(shortcutFor({ ...ev, target: q('.tl-scrub') }, document)).toBeNull();
  });

  it('a pan in progress is dropped when playback starts', () => {
    render(10);
    wheel(q('.tl__viewport'), { deltaX: COL * 5 });
    render(10, { browsable: false });
    expect(stripX()).toBeCloseTo(offsetFor(10), 6);
    expect(backButton()).toBeNull();
  });
});

describe('both rows, whichever hands are practised', () => {
  it('keeps the left row in place, blank, when only the right hand is practised, at the both-hands height', () => {
    render(0);
    const heights = [...container.querySelectorAll<HTMLElement>('.tl__tab')].map((t) => t.style.height);
    render(0, { sequence: RIGHT, layoutSequence: BOTH });
    expect([...container.querySelectorAll<HTMLElement>('.tl__tab')].map((t) => t.style.height)).toEqual(heights);
    expect([...container.querySelectorAll('.tl__tab-letter')].map((t) => t.getAttribute('aria-label'))).toEqual([
      'Right hand',
      'Left hand (not practising)',
    ]);
    const leftRows = [...container.querySelectorAll('.tl__row--L')];
    expect(leftRows.length).toBeGreaterThan(5);
    for (const row of leftRows) {
      expect(row.classList.contains('is-off')).toBe(true);
      expect(row.textContent).toBe('');
    }
    expect(q('.tl__off-hint--L').textContent).toBe('Left hand: not practising');
    expect(container.querySelector('.tl__row--R .nt-token')).not.toBeNull();
  });
});
