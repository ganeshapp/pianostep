import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import type { MidiInputEvent } from '../src/core/types';
import type { MidiDeviceInfo, MidiState } from '../src/midi/manager';

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
  devices: MidiDeviceInfo[] = [];
  connectCalls = 0;
  private changes = new Set<() => void>();
  connect = async (): Promise<MidiState> => {
    this.connectCalls += 1;
    this.state = 'ready';
    if (this.devices.length === 1) {
      this.selectedInputId = this.devices[0].id;
      this.inputConnected = true;
    }
    this.emit();
    return this.state;
  };
  inputs = (): MidiDeviceInfo[] => this.devices;
  outputs = (): MidiDeviceInfo[] => [];
  selectInput = (id: string | null): void => {
    this.selectedInputId = id;
    this.inputConnected = this.devices.some((d) => d.id === id && d.connected);
    this.emit();
  };
  selectOutput = (id: string | null): void => {
    this.selectedOutputId = id;
  };
  onEvent = (_fn: (ev: MidiInputEvent) => void): (() => void) => () => undefined;
  onChange = (fn: () => void): (() => void) => {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  };
  sendNoteOn = (): void => undefined;
  sendNoteOff = (): void => undefined;
  allNotesOff = (): void => undefined;
  emit(): void {
    for (const fn of [...this.changes]) fn();
  }
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
  load: null as unknown as (id: string) => Promise<unknown>,
}));

vi.mock('../src/app/services', () => ({
  get midi() {
    return fakes.midi;
  },
  sampler: fakes.sampler,
}));

vi.mock('../src/catalog/loader', () => ({
  loadPiece: (id: string) => fakes.load(id),
  isAbortError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
}));

const { PracticePage } = await import('../src/ui/practice/PracticePage');
const { PracticeSession } = await import('../src/engine/session');

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

function radio(label: string): HTMLInputElement {
  const l = [...container.querySelectorAll('label')].find((el) => el.querySelector('span')?.textContent?.trim() === label);
  const input = l?.querySelector('input');
  if (!input) throw new Error(`no radio ${label}`);
  return input;
}

beforeEach(() => {
  localStorage.clear();
  fakes.midi = new FakeMidi();
  fakes.load = () =>
    Promise.resolve({
      id: 'minuet',
      kind: 'builtin',
      title: 'Minuet in G',
      arrangement: 'Original keyboard work',
      composer: 'Christian Petzold',
      prepared,
    });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PracticePage', () => {
  it('shows a loading state, then the piece with its timeline and keyboard', async () => {
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    expect(text()).toContain('Loading piece…');
    await flush();
    expect(container.querySelector('h1')?.textContent).toBe('Minuet in G');
    expect(text()).toContain('Plays the piece at its written rhythm.');
    expect(container.querySelectorAll('.tl__col').length).toBeGreaterThan(10);
    expect(container.querySelectorAll('.tl__col').length).toBeLessThan(prepared.measures.length * 8);
    expect(container.querySelector('[aria-label="Right hand"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Left hand"]')).not.toBeNull();
    expect(container.querySelector('.kb__svg')).not.toBeNull();
    expect(text()).toMatch(/Step 1 of \d+/);
  });

  it('shows a plain error with a way back when the piece cannot load', async () => {
    fakes.load = () => Promise.reject(new Error('The piece could not be downloaded.'));
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    expect(text()).toContain('The piece could not be downloaded.');
    const links = [...container.querySelectorAll('a[href="#/"]')].map((a) => a.textContent);
    expect(links).toContain('Back to library');
  });

  it('steps with the buttons and the arrow keys, and remembers settings and position', async () => {
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    act(() => button('Next step').click());
    expect(text()).toMatch(/Step 2 of/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(text()).toMatch(/Step 3 of/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    });
    expect(text()).toMatch(/Step 1 of/);
    act(() => button('Next step').click());
    act(() => radio('Right hand').click());
    // The left row stays, blank and marked as not practised.
    expect(container.querySelector('[aria-label="Left hand"]')).toBeNull();
    expect(container.querySelector('[aria-label="Left hand (not practising)"]')).not.toBeNull();

    act(() => root.unmount());
    const saved = JSON.parse(localStorage.getItem('pianosteps:v1:piece:minuet') ?? 'null');
    expect(saved.settings.hands).toBe('R');
    expect(typeof saved.stepTick).toBe('number');

    root = createRoot(container);
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    expect(radio('Right hand').checked).toBe(true);
    expect(text()).toMatch(/Step 2 of/);
  });

  it('disposes the session when the page goes away', async () => {
    const dispose = vi.spyOn(PracticeSession.prototype, 'dispose');
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    const before = dispose.mock.calls.length;
    act(() => root.unmount());
    expect(dispose.mock.calls.length).toBeGreaterThan(before);
    root = createRoot(container);
  });

  it('keeps Follow me disabled until a piano is connected, then offers it', async () => {
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    expect(radio('Follow me').disabled).toBe(true);
    expect(container.querySelector('label[title="Connect a digital piano by MIDI to use Follow me"]')).not.toBeNull();

    // No devices: a plain notice with a retry.
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    expect(fakes.midi.connectCalls).toBe(1);
    expect(text()).toContain('No piano found');
    expect(button('Try again')).toBeTruthy();

    fakes.midi.devices = [{ id: 'p1', name: 'Yamaha P-125', manufacturer: 'Yamaha', connected: true }];
    await act(async () => {
      button('Try again').click();
      await Promise.resolve();
    });
    act(() => fakes.midi.selectInput('p1'));
    await flush();
    expect(text()).toContain('Yamaha P-125');
    expect(radio('Follow me').disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('pianosteps:v1:global') ?? '{}').midiInputName).toBe('Yamaha P-125');
  });

  it('keeps a saved Follow me while no piano is connected, and brings it back once the piano connects', async () => {
    const KEY = 'pianosteps:v1:piece:minuet';
    localStorage.setItem(KEY, JSON.stringify({ settings: { mode: 'follow', hands: 'R' }, stepTick: null }));
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    // Follow me needs the piano, so the page opens in Listen for now...
    expect(radio('Listen').checked).toBe(true);
    expect(radio('Follow me').disabled).toBe(true);
    // ...but the saved choice is not overwritten by that fallback.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    let saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(saved.settings.mode).toBe('follow');
    expect(saved.settings.hands).toBe('R');

    fakes.midi.devices = [{ id: 'p1', name: 'Yamaha P-125', manufacturer: 'Yamaha', connected: true }];
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    await flush();
    expect(radio('Follow me').checked).toBe(true);
    act(() => root.unmount());
    saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(saved.settings.mode).toBe('follow');
    root = createRoot(container);
  });

  it('a saved Follow me gives way once the learner picks another mode before connecting', async () => {
    const KEY = 'pianosteps:v1:piece:minuet';
    localStorage.setItem(KEY, JSON.stringify({ settings: { mode: 'follow' }, stepTick: null }));
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    act(() => radio('Steady steps').click());
    fakes.midi.devices = [{ id: 'p1', name: 'Yamaha P-125', manufacturer: 'Yamaha', connected: true }];
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    await flush();
    expect(radio('Steady steps').checked).toBe(true);
    act(() => root.unmount());
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null').settings.mode).toBe('steady');
    root = createRoot(container);
  });

  it('opens help and the arrangement details as dialogs, and ignores shortcuts while they are open', async () => {
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    act(() => button('Help: how to read and practise').click());
    expect(text()).toContain('The five instructions');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(text()).toMatch(/Step 1 of/);
    act(() => button('Close').click());

    act(() => button('More').click());
    act(() => button('About this arrangement').click());
    expect(text()).toContain('What the app noticed');
    expect(text()).toContain(prepared.handMapping.description);
  });
});
