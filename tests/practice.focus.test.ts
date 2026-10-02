/**
 * Pointer use must never leave focus on a practice control (where Space and
 * the arrows would then belong to it), while keyboard use keeps the usual
 * focus movement. jsdom does not move focus on mousedown, so `pointerClick`
 * plays Chrome's part: a mousedown that is not prevented focuses the
 * clicked control, and clicks carry a click count (detail 1). A plain
 * `.click()` has detail 0, like Enter/Space or assistive technology.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import type { MidiInputEvent } from '../src/core/types';
import type { MidiDeviceInfo, MidiState } from '../src/midi/manager';
import { shortcutFor } from '../src/ui/practice/shortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl';
const prepared = prepareScore(
  loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', FILE))), FILE),
);

class FakeMidi {
  state: MidiState = 'idle';
  errorMessage: string | null = null;
  selectedInputId: string | null = null;
  selectedOutputId: string | null = null;
  inputConnected = false;
  connect = async (): Promise<MidiState> => this.state;
  inputs = (): MidiDeviceInfo[] => [];
  outputs = (): MidiDeviceInfo[] => [];
  selectInput = (): void => undefined;
  selectOutput = (): void => undefined;
  onEvent = (_fn: (ev: MidiInputEvent) => void): (() => void) => () => undefined;
  onChange = (): (() => void) => () => undefined;
  sendNoteOn = (): void => undefined;
  sendNoteOff = (): void => undefined;
  allNotesOff = (): void => undefined;
}

const fakes = vi.hoisted(() => ({
  midi: null as unknown as FakeMidi,
  sampler: {
    state: 'not-started' as const,
    currentTime: 0,
    ensureStarted: () => Promise.resolve(),
    onStateChange: () => () => undefined,
    noteOn: () => undefined,
    noteOff: () => undefined,
    allNotesOff: () => undefined,
    click: () => undefined,
  },
}));

vi.mock('../src/app/services', () => ({
  get midi() {
    return fakes.midi;
  },
  sampler: fakes.sampler,
}));

vi.mock('../src/catalog/loader', () => ({
  loadPiece: () =>
    Promise.resolve({ id: 'minuet', kind: 'builtin', title: 'Minuet in G', arrangement: 'Original', composer: 'Petzold', prepared }),
  isAbortError: () => false,
}));

const { PracticePage } = await import('../src/ui/practice/PracticePage');

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function open(): Promise<void> {
  act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
  await flush();
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

/** The radio or switch input whose label reads `label`. */
function control(label: string): HTMLInputElement {
  const l = [...container.querySelectorAll('label')].find((el) => el.textContent?.trim() === label);
  const input = l?.querySelector('input');
  if (!input) throw new Error(`no control ${label}`);
  return input;
}

function pointer(type: string, el: Element): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse' }));
}

/** A mouse click as Chrome does it: mousedown focuses the control unless prevented. */
function pointerClick(el: HTMLElement): void {
  act(() => {
    pointer('pointerdown', el);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
    el.dispatchEvent(down);
    if (!down.defaultPrevented) el.closest<HTMLElement>('button, input, select, [tabindex]')?.focus();
    pointer('pointerup', el);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** A key pressed wherever focus is; returns true when the page handled it as a shortcut. */
function press(key: string): boolean {
  const target = document.activeElement ?? document.body;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

function shortcut(key: string) {
  return shortcutFor({ key, altKey: false, ctrlKey: false, metaKey: false, target: document.activeElement }, document);
}

function stepText(): string {
  return container.textContent?.match(/Step \d+ of \d+/)?.[0] ?? '';
}

function playLabel(): string | null {
  return container.querySelector('.ps-transport__btn--primary')?.getAttribute('aria-label') ?? null;
}

function focusIsFree(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body;
}

function measureSelect(label: 'From measure' | 'To measure'): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!el) throw new Error(`no ${label} select`);
  return el;
}

/**
 * A mouse click on a field's text label as Chrome does it: the click focuses
 * the labelled control unless the click is cancelled.
 */
function labelClick(text: string): void {
  const l = [...container.querySelectorAll('label')].find((el) => el.textContent?.trim() === text);
  if (!l) throw new Error(`no label ${text}`);
  act(() => {
    pointer('pointerdown', l);
    l.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }));
    pointer('pointerup', l);
    l.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1 }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    // jsdom does not focus a list or slider from its label; Chrome does.
    const control = (l as HTMLLabelElement).control as HTMLElement | null;
    l.dispatchEvent(click);
    if (!click.defaultPrevented && control && !(control instanceof HTMLInputElement && control.type === 'checkbox')) {
      control.focus();
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  fakes.midi = new FakeMidi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('shortcuts keep working after mouse use of the practice controls', () => {
  it('Space plays after Help was opened and closed with the mouse (it does not reopen Help)', async () => {
    await open();
    pointerClick(button('Help: how to read and practise'));
    expect(container.textContent).toContain('The five instructions');
    pointerClick(button('Close'));
    expect(container.textContent).not.toContain('The five instructions');
    expect(focusIsFree()).toBe(true);
    expect(shortcut(' ')).toBe('toggle');
    expect(press(' ')).toBe(true);
    await flush();
    expect(playLabel()).toBe('Pause');
  });

  it('opening More with the mouse leaves focus alone, so Space plays instead of turning on monitoring', async () => {
    await open();
    pointerClick(button('More'));
    const monitor = control('Hear my playing through the browser');
    expect(document.activeElement).not.toBe(monitor);
    expect(focusIsFree()).toBe(true);
    expect(press(' ')).toBe(true);
    expect(monitor.checked).toBe(false);
    await flush();
    expect(playLabel()).toBe('Pause');
  });

  it('a mouse click on the "Hear my playing" switch does not keep focus on it', async () => {
    await open();
    pointerClick(button('More'));
    const monitor = control('Hear my playing through the browser');
    pointerClick(monitor);
    expect(monitor.checked).toBe(true);
    expect(focusIsFree()).toBe(true);
    expect(container.querySelector('.ps-more__panel')).not.toBeNull();
  });

  it('after clicking "Right hand", → steps instead of switching to the left hand', async () => {
    await open();
    pointerClick(control('Right hand'));
    expect(control('Right hand').checked).toBe(true);
    expect(focusIsFree()).toBe(true);
    expect(shortcut('ArrowRight')).toBe('next');
    expect(press('ArrowRight')).toBe(true);
    expect(stepText()).toMatch(/^Step 2 of/);
    expect(control('Right hand').checked).toBe(true);
  });

  it('after clicking a Mode option, Space and the arrows are shortcuts again', async () => {
    await open();
    pointerClick(control('Steady steps'));
    expect(control('Steady steps').checked).toBe(true);
    expect(focusIsFree()).toBe(true);
    expect(shortcut(' ')).toBe('toggle');
    expect(shortcut('ArrowLeft')).toBe('prev');
    expect(shortcut('Home')).toBe('restart');
  });

  it('after switching Repeat on with the mouse, Space plays and Repeat stays on', async () => {
    await open();
    const repeat = control('Repeat');
    pointerClick(repeat);
    expect(repeat.checked).toBe(true);
    expect(focusIsFree()).toBe(true);
    expect(press(' ')).toBe(true);
    expect(repeat.checked).toBe(true);
    await flush();
    expect(playLabel()).toBe('Pause');
  });

  it('the Sound and Count-in switches release focus after a mouse click too', async () => {
    await open();
    for (const label of ['Sound', 'Count-in']) {
      const sw = control(label);
      const before = sw.checked;
      pointerClick(sw);
      expect(sw.checked).toBe(!before);
      expect(focusIsFree()).toBe(true);
    }
  });

  it('after clicking Fit "Whole piece", ← steps instead of flipping the fit back', async () => {
    await open();
    act(() => button('Next step').click());
    const whole = control('Whole piece');
    pointerClick(whole);
    expect(whole.checked).toBe(true);
    expect(focusIsFree()).toBe(true);
    expect(press('ArrowLeft')).toBe(true);
    expect(stepText()).toMatch(/^Step 1 of/);
    expect(whole.checked).toBe(true);
  });

  it('after "End passage here" is chosen with the mouse, Space plays (focus is not sent to the measure label)', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[2];
    pointerClick(label);
    const menu = container.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    // Focus sits on the menu itself, not on an item that Space would silently pick.
    expect(document.activeElement).toBe(menu);
    pointerClick(button('End passage here'));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(label);
    expect(focusIsFree()).toBe(true);
    expect(press(' ')).toBe(true);
    await flush();
    expect(playLabel()).toBe('Pause');
  });

  it('dragging a speed slider releases focus once the pointer is let go', async () => {
    await open();
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('no slider');
    act(() => {
      pointer('pointerdown', slider);
      slider.focus();
    });
    expect(document.activeElement).toBe(slider);
    act(() => pointer('pointerup', document.body));
    await flush();
    expect(focusIsFree()).toBe(true);
    expect(shortcut('ArrowRight')).toBe('next');
  });

  it('choosing a passage measure from the list with the mouse releases the list', async () => {
    await open();
    const from = container.querySelector<HTMLSelectElement>('select[aria-label="From measure"]');
    if (!from) throw new Error('no From select');
    act(() => {
      pointer('pointerdown', from);
      from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }));
      from.focus();
    });
    act(() => {
      from.value = '2';
      from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(from.value).toBe('2');
    expect(focusIsFree()).toBe(true);
    expect(shortcut(' ')).toBe('toggle');
  });
});

describe('a list opened with the mouse and closed without a new choice', () => {
  it('lets Space play and → step, without changing the passage', async () => {
    await open();
    const from = measureSelect('From measure');
    pointerClick(from); // the native list opens and is closed again (Esc, a click outside, the same item)
    expect(document.activeElement).toBe(from);
    expect(press('ArrowRight')).toBe(true);
    expect(stepText()).toMatch(/^Step 2 of/);
    expect(from.value).toBe('0');
    expect(focusIsFree()).toBe(true);

    pointerClick(measureSelect('To measure'));
    expect(press(' ')).toBe(true);
    await flush();
    expect(playLabel()).toBe('Pause');
    expect(focusIsFree()).toBe(true);
  });

  it('Home restarts after a look at the list', async () => {
    await open();
    act(() => button('Next step').click());
    pointerClick(measureSelect('From measure'));
    expect(press('Home')).toBe(true);
    expect(stepText()).toMatch(/^Step 1 of/);
  });

  it('↑/↓ after a mouse look take the list up with the keyboard, which then keeps its keys', async () => {
    await open();
    const from = measureSelect('From measure');
    pointerClick(from);
    expect(press('ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(from);
    expect(press('ArrowRight')).toBe(false);
    expect(document.activeElement).toBe(from);
  });

  it('a list reached later with the keyboard keeps its keys, even after an earlier mouse look', async () => {
    await open();
    const from = measureSelect('From measure');
    pointerClick(from);
    act(() => from.blur()); // focus left it (a click elsewhere)
    act(() => from.focus()); // reached again with Tab
    expect(press('ArrowRight')).toBe(false);
    expect(document.activeElement).toBe(from);
    expect(stepText()).toMatch(/^Step 1 of/);
  });
});

describe('clicking a field\'s text label does not hand it the shortcut keys', () => {
  it('"From measure" and "to"', async () => {
    await open();
    for (const text of ['From measure', 'to']) {
      labelClick(text);
      expect(focusIsFree()).toBe(true);
      expect(shortcut('ArrowRight')).toBe('next');
    }
    expect(press('ArrowRight')).toBe(true);
    expect(stepText()).toMatch(/^Step 2 of/);
  });

  it('"Speed" and "Seconds per step"', async () => {
    await open();
    labelClick('Speed');
    expect(focusIsFree()).toBe(true);
    expect(shortcut(' ')).toBe('toggle');
    pointerClick(control('Steady steps'));
    labelClick('Seconds per step');
    expect(focusIsFree()).toBe(true);
    expect(shortcut('ArrowLeft')).toBe('prev');
  });
});

describe('an open measure menu', () => {
  it('opened with the mouse, Space neither plays nor picks an item', async () => {
    await open();
    pointerClick(container.querySelectorAll<HTMLButtonElement>('.tl__measure')[0]);
    const menu = container.querySelector<HTMLElement>('[role="menu"]');
    expect(document.activeElement).toBe(menu);
    expect(shortcut(' ')).toBeNull();
    // Handled by the menu (so the page does not scroll away), not by the shortcuts.
    expect(press(' ')).toBe(true);
    await flush();
    expect(playLabel()).toBe('Play');
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(shortcut('ArrowRight')).toBeNull();
  });
});

describe('keyboard use keeps its focus behaviour', () => {
  it('a radio reached with the keyboard keeps the arrow keys', async () => {
    await open();
    const right = control('Right hand');
    act(() => right.focus());
    expect(shortcut('ArrowRight')).toBeNull();
    // A keyboard-made choice (keydown, then the browser's click) keeps focus.
    act(() => {
      right.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      right.click();
    });
    expect(right.checked).toBe(true);
    expect(document.activeElement).toBe(right);
  });

  it('a switch toggled with Space keeps focus, even after an earlier mouse press elsewhere on it', async () => {
    await open();
    const repeat = control('Repeat');
    act(() => pointer('pointerdown', repeat)); // pressed, then dragged away: no click
    act(() => {
      repeat.focus();
      repeat.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      repeat.click();
    });
    expect(repeat.checked).toBe(true);
    expect(document.activeElement).toBe(repeat);
  });

  it('a list changed with the keyboard keeps focus', async () => {
    await open();
    const to = container.querySelector<HTMLSelectElement>('select[aria-label="To measure"]');
    if (!to) throw new Error('no To select');
    act(() => {
      to.focus();
      to.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      to.value = '3';
      to.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.activeElement).toBe(to);
  });

  it('More opened from the keyboard moves focus into the panel, and Esc returns it to More', async () => {
    await open();
    const more = button('More');
    act(() => more.focus());
    act(() => more.click());
    await flush();
    expect(document.activeElement).toBe(control('Hear my playing through the browser'));
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('.ps-more__panel')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('Esc after opening More with the mouse closes it without moving focus onto More', async () => {
    await open();
    pointerClick(button('More'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('.ps-more__panel')).toBeNull();
    expect(focusIsFree()).toBe(true);
  });

  it('the measure menu opened from the keyboard focuses its first item and returns focus to the label', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[2];
    const name = label.getAttribute('aria-label');
    act(() => label.focus());
    act(() => label.click());
    await flush();
    expect(document.activeElement?.textContent).toBe('Start passage here');
    act(() => button('Start passage here').click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    // The label of the same measure, wherever the new passage shows it.
    expect(document.activeElement?.classList.contains('tl__measure')).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(name);
  });

  it('Esc in a measure menu opened from the keyboard returns focus to its label', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[1];
    act(() => label.focus());
    act(() => label.click());
    await flush();
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(label);
  });

  it('closing "About this arrangement" opened from More returns focus to More', async () => {
    await open();
    const more = button('More');
    act(() => more.focus());
    act(() => more.click());
    await flush();
    const about = button('About this arrangement');
    act(() => about.focus());
    act(() => about.click());
    await flush();
    expect(container.textContent).toContain('What the app noticed');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    act(() => button('Close').click());
    await flush();
    expect(container.textContent).not.toContain('What the app noticed');
    expect(document.activeElement).toBe(more);
  });

  it('Help opened from the keyboard returns focus to its button', async () => {
    await open();
    const help = button('Help: how to read and practise');
    act(() => help.focus());
    act(() => help.click());
    await flush();
    act(() => button('Close').click());
    await flush();
    expect(document.activeElement).toBe(help);
  });
});

/** Focus that lands on the page body sends a keyboard user back to the top of the page. */
describe('keyboard focus is not lost or moved to the wrong control', () => {
  function active(): HTMLElement {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) throw new Error('focus is on the page body');
    return el;
  }

  function currentColumn(): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>('.tl__cells[aria-current="step"]');
    if (!el) throw new Error('no current column');
    return el;
  }

  /** Frames of the timeline's animation loop. */
  async function frames(): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  it('Reset of the speed from the keyboard moves focus to the Speed slider', async () => {
    await open();
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('no slider');
    act(() => slider.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '0.5');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const reset = button('Reset');
    act(() => reset.focus());
    act(() => reset.click());
    await flush();
    expect(container.textContent).not.toContain('Reset');
    expect(slider.value).toBe('1');
    expect(active()).toBe(slider);
  });

  it('Reset of the speed with the mouse still leaves focus free', async () => {
    await open();
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error('no slider');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '0.5');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    pointerClick(button('Reset'));
    await flush();
    expect(slider.value).toBe('1');
    expect(focusIsFree()).toBe(true);
  });

  it('"Start passage here" from the keyboard focuses the chosen measure, not the label now in its old place', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[3];
    expect(label.getAttribute('aria-label')).toBe('Measure 4: passage options');
    act(() => label.focus());
    act(() => label.click());
    await flush();
    act(() => button('Start passage here').click());
    await flush();
    expect(measureSelect('From measure').selectedOptions[0]?.textContent).toBe('4');
    expect(active().getAttribute('aria-label')).toBe('Measure 4: passage options');
    expect(active().classList.contains('tl__measure')).toBe(true);
  });

  it('"End passage here" from the keyboard focuses the chosen measure', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[0];
    act(() => label.focus());
    act(() => label.click());
    await flush();
    act(() => button('End passage here').click());
    await flush();
    expect(measureSelect('To measure').selectedOptions[0]?.textContent).toBe('1');
    expect(active().getAttribute('aria-label')).toBe('Measure 1: passage options');
  });

  it('a focused instruction column keeps focus while → steps far past the rendered columns', async () => {
    await open();
    act(() => currentColumn().focus());
    for (let i = 0; i < 40; i += 1) {
      expect(press('ArrowRight')).toBe(true);
      await frames();
    }
    expect(stepText()).toMatch(/^Step 41 of/);
    // Focus follows the current step (roving tab stop), so it is never left on a column that goes away.
    expect(active()).toBe(currentColumn());
    expect(active().isConnected).toBe(true);
  });

  it('a focused instruction column follows a jump back to the start (Home)', async () => {
    await open();
    for (let i = 0; i < 60; i += 1) act(() => button('Next step').click());
    await frames();
    act(() => currentColumn().focus());
    expect(press('Home')).toBe(true);
    await frames();
    expect(stepText()).toMatch(/^Step 1 of/);
    expect(active()).toBe(currentColumn());
  });

  it('a focused measure label that leaves the rendered columns hands focus to the current column', async () => {
    await open();
    const label = container.querySelectorAll<HTMLButtonElement>('.tl__measure')[0];
    act(() => label.focus());
    for (let i = 0; i < 40; i += 1) {
      press('ArrowRight');
      await frames();
    }
    expect(label.isConnected && document.activeElement === label ? 'label kept' : 'moved').toBe('moved');
    expect(active()).toBe(currentColumn());
  });

  it('a transport button that becomes disabled under keyboard focus hands focus to Play', async () => {
    await open();
    const prev = button('Previous step');
    act(() => button('Next step').click());
    act(() => prev.focus());
    act(() => prev.click());
    expect(stepText()).toMatch(/^Step 1 of/);
    expect(prev.disabled).toBe(true);
    expect(active()).toBe(button('Play'));
  });

  it('a key held down on Next step up to the last step does not go on to press Play', async () => {
    await open();
    // A passage of the last measure only, so a few clicks reach its last step
    // (clicking through the whole piece takes too long on a busy machine).
    const from = measureSelect('From measure');
    act(() => {
      from.value = from.options[from.options.length - 1].value;
      from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const next = button('Next step');
    const count = Number(stepText().match(/of (\d+)/)?.[1]);
    expect(count).toBeGreaterThan(2);
    expect(count).toBeLessThan(30);
    for (let i = 0; i < count - 2; i += 1) act(() => next.click());
    act(() => next.focus());
    act(() => next.click());
    expect(next.disabled).toBe(true);
    const play = button('Play');
    expect(active()).toBe(play);
    const key = (type: string, repeat: boolean): KeyboardEvent => {
      const ev = new KeyboardEvent(type, { key: 'Enter', repeat, bubbles: true, cancelable: true });
      act(() => {
        play.dispatchEvent(ev);
      });
      return ev;
    };
    // The held Enter keeps repeating: those presses are not passed on to Play.
    expect(key('keydown', true).defaultPrevented).toBe(true);
    key('keyup', false);
    // A fresh press after letting go is Play's own.
    expect(key('keydown', false).defaultPrevented).toBe(false);
    expect(key('keydown', true).defaultPrevented).toBe(false);
  });

  it('"Whole piece" chosen from the keyboard hands focus to the From measure list', async () => {
    await open();
    const from = measureSelect('From measure');
    act(() => {
      from.value = '2';
      from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const whole = button('Whole piece');
    expect(whole.disabled).toBe(false);
    act(() => whole.focus());
    act(() => whole.click());
    expect(whole.disabled).toBe(true);
    expect(active()).toBe(from);
  });
});
