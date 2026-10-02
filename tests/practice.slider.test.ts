/**
 * The Speed and Seconds-per-step sliders: a timing change re-anchors playback
 * (held notes are cut and struck again), so a drag must reach the session
 * once it rests or ends, not on every input event. The slider itself follows
 * the drag at once.
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type MeasureOccurrence, type PracticeSettings } from '../src/core/types';
import { ControlsBar, type SessionControls } from '../src/ui/practice/ControlsBar';
import type { MidiConnection } from '../src/ui/practice/midiConnection';
import { SLIDER_SETTLE_MS } from '../src/ui/practice/settledSlider';
import { nothingToPlayText } from '../src/ui/practice/text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEASURES: MeasureOccurrence[] = [0, 1, 2].map((occ) => ({
  occ,
  measureIndex: occ,
  number: String(occ + 1),
  pass: 1,
  startTick: occ * 4,
  durationTicks: 4,
  label: String(occ + 1),
}));

const MIDI: MidiConnection = {
  phase: 'idle',
  inputs: [],
  outputs: [],
  selectedInputId: null,
  selectedOutputId: null,
  notice: null,
  connect: () => undefined,
  selectInput: () => undefined,
  dismissNotice: () => undefined,
  focusFrom: null,
  keepFocusFrom: () => undefined,
  focusSettled: () => undefined,
};

let container: HTMLDivElement;
let root: Root;
/** Every settings patch the controls sent, in order. */
let patches: Partial<PracticeSettings>[];

/** The controls over a session stand-in that applies each patch, as PracticeSession does. */
function Harness({ initial }: { initial: PracticeSettings }) {
  const [settings, setSettings] = useState(initial);
  const session: SessionControls = {
    updateSettings: (patch) => {
      patches.push(patch);
      setSettings((s) => ({ ...s, ...patch }));
    },
    togglePlay: () => undefined,
    restart: () => undefined,
    next: () => undefined,
    prev: () => undefined,
    stop: () => undefined,
  };
  return createElement(ControlsBar, {
    session,
    settings,
    status: 'playing',
    stepIndex: 0,
    stepCount: 10,
    canFollow: false,
    measures: MEASURES,
    midi: MIDI,
    onOutputChange: () => undefined,
    onOpenAbout: () => undefined,
  });
}

function render(settings: Partial<PracticeSettings> = {}): void {
  act(() => root.render(createElement(Harness, { initial: { ...DEFAULT_SETTINGS, mode: 'listen', ...settings } })));
}

function slider(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('.ps-slider input[type="range"]');
  if (!el) throw new Error('no slider');
  return el;
}

function shown(): string {
  return container.querySelector('.ps-slider__value')?.textContent ?? '';
}

/** React tracks input values itself; set through the native setter so onChange fires. */
function drag(to: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(slider(), String(to));
    slider().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  patches = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('dragging the Speed slider', () => {
  it('five quick input events make one speed change, with the last value, once the slider rests', () => {
    render();
    for (const v of [0.95, 0.9, 0.85, 0.8, 0.75]) {
      drag(v);
      wait(30);
    }
    // The slider and its readout follow the drag at once.
    expect(slider().value).toBe('0.75');
    expect(shown()).toBe('0.75×');
    expect(patches).toEqual([]);

    wait(SLIDER_SETTLE_MS);
    expect(patches).toEqual([{ speed: 0.75 }]);
    expect(slider().value).toBe('0.75');
    expect(shown()).toBe('0.75×');
  });

  it('letting go of the pointer commits at once', () => {
    render();
    act(() => {
      slider().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    drag(0.6);
    drag(0.5);
    act(() => {
      window.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(patches).toEqual([{ speed: 0.5 }]);
    wait(SLIDER_SETTLE_MS * 2);
    expect(patches).toEqual([{ speed: 0.5 }]);
  });

  it('focus leaving the slider commits at once', () => {
    render();
    act(() => slider().focus());
    drag(1.5);
    act(() => slider().blur());
    expect(patches).toEqual([{ speed: 1.5 }]);
  });

  it('Reset right after a drag gives 1×, not the dragged value', () => {
    render({ speed: 0.5 });
    drag(0.7);
    const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset');
    if (!reset) throw new Error('no Reset button');
    act(() => reset.click());
    wait(SLIDER_SETTLE_MS * 2);
    expect(patches).toEqual([{ speed: 1 }]);
    expect(slider().value).toBe('1');
  });

  it('a change still pending when the controls go away is not lost', () => {
    const sent: Partial<PracticeSettings>[] = [];
    patches = sent;
    render();
    drag(0.8);
    act(() => root.unmount());
    root = createRoot(container);
    expect(sent).toEqual([{ speed: 0.8 }]);
  });
});

describe('dragging the Seconds per step slider', () => {
  it('five quick input events make one change', () => {
    render({ mode: 'steady', stepSeconds: 1 });
    for (const v of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      drag(v);
      wait(20);
    }
    expect(patches).toEqual([]);
    wait(SLIDER_SETTLE_MS);
    expect(patches).toEqual([{ stepSeconds: 1.5 }]);
  });
});

describe('an empty passage', () => {
  it('with both hands, does not suggest choosing the other hand', () => {
    const text = nothingToPlayText({ hands: 'both' });
    expect(text).not.toMatch(/other hand|either hand/i);
    expect(text).toContain('different passage');
  });

  it('with one hand, names that hand and suggests the other one', () => {
    expect(nothingToPlayText({ hands: 'R' })).toContain('the right hand');
    expect(nothingToPlayText({ hands: 'L' })).toContain('the left hand');
    expect(nothingToPlayText({ hands: 'L' })).toContain('the other hand');
  });
});
