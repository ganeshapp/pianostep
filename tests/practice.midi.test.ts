/**
 * Connect piano with the real MidiManager and a fake Web MIDI access: a
 * disconnected piano must never leave the page stuck. Another connected
 * device can be chosen, and "Try again" re-picks instead of doing nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { MidiManager } from '../src/midi/manager';
import { savePieceState } from '../src/storage/prefs';
import { fallbackInput, MIDI_TEXT, midiPhase } from '../src/ui/practice/midiConnection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl';
const prepared = prepareScore(
  loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', FILE))), FILE),
);

class FakePort {
  state: 'connected' | 'disconnected' = 'connected';
  connection = 'closed';
  version = '1.0';
  manufacturer = 'Test';
  onmidimessage: unknown = null;
  onstatechange: unknown = null;
  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: 'input' | 'output' = 'input',
  ) {}
  send(): void {}
}

class FakeAccess {
  readonly inputs = new Map<string, FakePort>();
  readonly outputs = new Map<string, FakePort>();
  readonly sysexEnabled = false;
  onstatechange: ((ev: { port: FakePort }) => void) | null = null;
  plug(p: FakePort): void {
    p.state = 'connected';
    this.inputs.set(p.id, p);
    this.onstatechange?.({ port: p });
  }
  unplug(p: FakePort): void {
    p.state = 'disconnected';
    this.inputs.delete(p.id);
    this.onstatechange?.({ port: p });
  }
  /** Chrome keeps an unplugged port in the map, marked disconnected. */
  unplugKeep(p: FakePort): void {
    p.state = 'disconnected';
    this.onstatechange?.({ port: p });
  }
}

const fakes = vi.hoisted(() => ({
  midi: null as unknown,
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
let access: FakeAccess;
let mgr: MidiManager;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

function followDisabled(): boolean {
  const input = container.querySelector<HTMLInputElement>('input[type="radio"][value="follow"]');
  if (!input) throw new Error('no Follow me option');
  return input.disabled;
}

function pianoSelect(): HTMLSelectElement | null {
  return container.querySelector<HTMLSelectElement>('.ps-midi__select');
}

function notice(): string | null {
  return container.querySelector('.ps-notice')?.textContent ?? null;
}

/** The facts line in the transport bar under the notes ("0:00 / 1:31 · Step 1 of 275 · Measure 1 · MIDI: …"). */
function statusFacts(): string {
  return container.querySelector('.ps-status__facts')?.textContent ?? '';
}

function hasButton(label: string): boolean {
  return [...container.querySelectorAll('button')].some((el) => el.textContent?.trim() === label);
}

function focusIsFree(): boolean {
  const el = document.activeElement;
  return el === null || el === document.body;
}

async function openPage(): Promise<void> {
  act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
  await flush();
}

/** Enter or Space on a focused button: a click with no click count. */
async function keyboardActivate(label: string): Promise<void> {
  const b = button(label);
  act(() => b.focus());
  expect(document.activeElement).toBe(b);
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await flush();
}

/** A mouse click as Chrome does it: the button's onMouseDown keeps focus off it. */
async function mouseActivate(label: string): Promise<void> {
  const b = button(label);
  await act(async () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
    b.dispatchEvent(down);
    if (!down.defaultPrevented) b.focus();
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    await Promise.resolve();
  });
  await flush();
}

function chooseInput(id: string): void {
  const select = pianoSelect();
  if (!select) throw new Error('no piano list');
  act(() => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Connected to "Yamaha P-125", then it is unplugged and "Digital Piano" (new id and name) appears. */
async function connectThenSwapDevice(): Promise<{ b: FakePort }> {
  const a = new FakePort('in-a', 'Yamaha P-125');
  access.inputs.set(a.id, a);
  act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
  await flush();
  await act(async () => {
    button('Connect piano').click();
    await Promise.resolve();
  });
  await flush();
  expect(mgr.inputConnected).toBe(true);
  expect(followDisabled()).toBe(false);

  act(() => access.unplug(a));
  const b = new FakePort('in-b', 'Digital Piano');
  act(() => access.plug(b));
  await flush();
  expect(mgr.inputConnected).toBe(false);
  expect(mgr.selectedInputId).toBe('in-a');
  return { b };
}

beforeEach(() => {
  localStorage.clear();
  access = new FakeAccess();
  mgr = new MidiManager({
    requestMIDIAccess: (async () => access) as unknown as (opts?: MIDIOptions) => Promise<MIDIAccess>,
    now: () => 1000,
  });
  fakes.midi = mgr;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a disconnected piano with another device connected', () => {
  it('offers the connected device in the piano list, and choosing it reconnects', async () => {
    await connectThenSwapDevice();
    const select = pianoSelect();
    expect(select).not.toBeNull();
    const options = [...(select?.options ?? [])].map((o) => o.textContent);
    expect(options).toEqual(['Digital Piano', 'Yamaha P-125 (disconnected)']);
    expect(select?.value).toBe('in-a');
    expect(container.textContent).toContain(MIDI_TEXT.disconnectedOthers);
    expect(followDisabled()).toBe(true);

    act(() => {
      if (!select) return;
      select.value = 'in-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(mgr.selectedInputId).toBe('in-b');
    expect(mgr.inputConnected).toBe(true);
    expect(followDisabled()).toBe(false);
    expect(container.querySelector('.ps-notice')).toBeNull();
  });

  it('"Try again" switches to the only connected device instead of doing nothing', async () => {
    await connectThenSwapDevice();
    await act(async () => {
      button('Try again').click();
      await Promise.resolve();
    });
    await flush();
    expect(mgr.selectedInputId).toBe('in-b');
    expect(mgr.inputConnected).toBe(true);
    expect(followDisabled()).toBe(false);
    expect(container.querySelector('.ps-midi')?.textContent).toContain('Digital Piano');
  });

  it('with no other device, the chip stays and says it is disconnected; the piano is re-attached when it returns', async () => {
    const a = new FakePort('in-a', 'Yamaha P-125');
    access.inputs.set(a.id, a);
    act(() => root.render(createElement(PracticePage, { pieceId: 'minuet' })));
    await flush();
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    await flush();
    act(() => access.unplug(a));
    await flush();
    expect(pianoSelect()).toBeNull();
    expect(container.querySelector('.ps-midi')?.textContent).toContain('disconnected');
    expect(container.textContent).toContain(MIDI_TEXT.disconnected);

    // Same piano back under a new id: picked up again by name.
    act(() => access.plug(new FakePort('in-a2', 'Yamaha P-125')));
    await flush();
    expect(mgr.inputConnected).toBe(true);
    expect(followDisabled()).toBe(false);
  });
});

describe('fallbackInput', () => {
  const dev = (id: string, name: string, connected = true) => ({ id, name, connected });

  it('prefers a connected input with the remembered name', () => {
    expect(fallbackInput([dev('a', 'P-125', false), dev('b', 'Other'), dev('c', 'P-125')], 'a', 'P-125')).toBe('c');
  });

  it('takes the only other connected input, and leaves a choice of several to the user', () => {
    expect(fallbackInput([dev('a', 'P-125', false), dev('b', 'Digital Piano')], 'a', 'P-125')).toBe('b');
    expect(fallbackInput([dev('a', 'P-125', false), dev('b', 'X'), dev('c', 'Y')], 'a', 'P-125')).toBeNull();
    expect(fallbackInput([dev('a', 'P-125', false)], 'a', 'P-125')).toBeNull();
  });

  it('never takes a device that was connected beside the piano', () => {
    const through = dev('t', 'Midi Through Port-0');
    expect(fallbackInput([dev('a', 'P-125', false), through], 'a', 'P-125', new Set(['t']))).toBeNull();
    // A device that appeared later may be the piano under a new name.
    expect(fallbackInput([dev('a', 'P-125', false), through, dev('b', 'Digital Piano')], 'a', null, new Set(['t']))).toBe('b');
    // The remembered name still wins.
    expect(fallbackInput([dev('a', 'P-125', false), dev('c', 'P-125')], 'a', 'P-125', new Set(['c']))).toBe('c');
  });

  it('never takes a loopback port as "the only other input"', () => {
    const through = dev('t', 'Midi Through Port-0');
    expect(fallbackInput([dev('a', 'P-125', false), through], 'a', 'P-125')).toBeNull();
    expect(fallbackInput([through], null, null)).toBeNull();
    expect(fallbackInput([dev('a', 'P-125', false), through, dev('b', 'Digital Piano')], 'a', null)).toBe('b');
  });
});

describe('"Try again" never switches to a device that was already there beside the piano', () => {
  for (const variant of ['removed from the list', 'kept in the list as disconnected'] as const) {
    it(`keeps waiting for the piano (port ${variant}), saves nothing about the other port, and re-attaches the piano`, async () => {
      const piano = new FakePort('in-a', 'Yamaha P-125');
      const through = new FakePort('in-t', 'Midi Through Port-0');
      access.inputs.set(piano.id, piano);
      access.inputs.set(through.id, through);
      await openPage();
      await mouseActivate('Connect piano');
      expect(container.textContent).toContain(MIDI_TEXT.choose);
      chooseInput('in-a');
      await flush();
      expect(mgr.inputConnected).toBe(true);

      act(() => (variant === 'removed from the list' ? access.unplug(piano) : access.unplugKeep(piano)));
      await flush();
      expect(notice()).toContain(MIDI_TEXT.disconnectedOthers);

      await mouseActivate('Try again');
      expect(mgr.selectedInputId).toBe('in-a');
      expect(mgr.inputConnected).toBe(false);
      expect(followDisabled()).toBe(true);
      expect(container.textContent).not.toContain('Midi Through Port-0 connected');
      // The list is still there to choose from.
      expect(pianoSelect()?.value).toBe('in-a');

      act(() => root.unmount());
      const global = JSON.parse(localStorage.getItem('pianosteps:v1:global') ?? '{}');
      const piece = JSON.parse(localStorage.getItem('pianosteps:v1:piece:minuet') ?? '{}');
      expect(global.midiInputName).toBe('Yamaha P-125');
      expect(piece.settings.midiInputId).toBe('in-a');
      root = createRoot(container);
      await openPage();

      act(() => access.plug(piano));
      await flush();
      expect(mgr.selectedInputId).toBe('in-a');
      expect(mgr.inputConnected).toBe(true);
    });
  }
});

describe('a saved "Play through connected piano" device the browser now lists under a new id', () => {
  it('is found by the name remembered with the preferences, and the piece then saves the new id', async () => {
    savePieceState('minuet', { settings: { ...DEFAULT_SETTINGS, midiOutputId: 'out-1' }, stepTick: null });
    localStorage.setItem('pianosteps:v1:global', JSON.stringify({ midiOutputName: 'Digital Piano' }));
    const sent: number[][] = [];
    const out = new (class extends FakePort {
      override send(data?: number[]): void {
        if (data) sent.push(data);
      }
    })('out-2', 'Digital Piano', 'output');
    access.outputs.set(out.id, out);
    access.inputs.set('in-2', new FakePort('in-2', 'Digital Piano'));
    await openPage();
    await mouseActivate('Connect piano');
    expect(mgr.selectedOutputId).toBe('out-2');
    // Playback reaches it: a run hands its first strike to the output as it starts.
    await mouseActivate('Play');
    expect(sent.some((data) => data[0] === 0x90)).toBe(true);
    await mouseActivate('Pause');
    act(() => root.unmount());
    expect(JSON.parse(localStorage.getItem('pianosteps:v1:piece:minuet') ?? '{}').settings.midiOutputId).toBe('out-2');
    root = createRoot(container);
  });
});

describe('a dismissed MIDI notice only hides that problem', () => {
  it('after dismissing "No piano found", a later disconnect still explains itself and offers Try again', async () => {
    await openPage();
    await mouseActivate('Connect piano');
    expect(notice()).toContain('No piano found');
    await mouseActivate('Dismiss');
    expect(notice()).toBeNull();

    const piano = new FakePort('in-a', 'Yamaha P-125');
    act(() => access.plug(piano));
    await flush();
    expect(mgr.inputConnected).toBe(true);
    expect(notice()).toBeNull();

    act(() => access.unplug(piano));
    await flush();
    expect(notice()).toContain(MIDI_TEXT.disconnected);
    expect(hasButton('Try again')).toBe(true);
  });

  it('a dismissed disconnect notice comes back for the next disconnect', async () => {
    const piano = new FakePort('in-a', 'Yamaha P-125');
    access.inputs.set(piano.id, piano);
    await openPage();
    await mouseActivate('Connect piano');
    act(() => access.unplug(piano));
    await flush();
    await mouseActivate('Dismiss');
    expect(notice()).toBeNull();
    act(() => access.plug(piano));
    await flush();
    act(() => access.unplug(piano));
    await flush();
    expect(notice()).toContain(MIDI_TEXT.disconnected);
  });
});

describe('keyboard focus after Connect piano, Try again and Dismiss', () => {
  it('with two inputs, focus moves to the "Your piano" list the learner now has to use', async () => {
    access.inputs.set('in-a', new FakePort('in-a', 'Yamaha P-125'));
    access.inputs.set('in-t', new FakePort('in-t', 'Midi Through Port-0'));
    await openPage();
    await keyboardActivate('Connect piano');
    const select = pianoSelect();
    expect(select).not.toBeNull();
    expect(document.activeElement).toBe(select);
  });

  it('with one input, focus moves to the connected piano chip, which names the piano', async () => {
    access.inputs.set('in-a', new FakePort('in-a', 'Yamaha P-125'));
    await openPage();
    await keyboardActivate('Connect piano');
    expect(mgr.inputConnected).toBe(true);
    const chip = container.querySelector<HTMLElement>('.ps-midi__chip');
    expect(document.activeElement).toBe(chip);
    expect(chip?.getAttribute('aria-label')).toBe('Your piano: Yamaha P-125, connected');
  });

  it('with no piano, focus stays on Connect piano', async () => {
    await openPage();
    await keyboardActivate('Connect piano');
    expect(notice()).toContain('No piano found');
    expect(document.activeElement).toBe(button('Connect piano'));
  });

  it('Try again that reconnects (piano back under a new id and name) keeps focus off the page body', async () => {
    await connectThenSwapDevice();
    await keyboardActivate('Try again');
    expect(mgr.inputConnected).toBe(true);
    expect(focusIsFree()).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('.ps-midi__chip'));
  });

  it('Dismiss from the keyboard moves focus to the piano control', async () => {
    await openPage();
    await keyboardActivate('Connect piano');
    await keyboardActivate('Dismiss');
    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(button('Connect piano'));
  });

  it('a mouse click on Connect piano leaves focus where it was', async () => {
    access.inputs.set('in-a', new FakePort('in-a', 'Yamaha P-125'));
    access.inputs.set('in-t', new FakePort('in-t', 'Midi Through Port-0'));
    await openPage();
    await mouseActivate('Connect piano');
    expect(pianoSelect()).not.toBeNull();
    expect(focusIsFree()).toBe(true);
  });
});

describe('a piece whose saved piano is switched off', () => {
  /** The piece was practised with "Yamaha P-125" (id in-a) on an earlier visit. */
  function rememberPiano(): void {
    savePieceState('minuet', { settings: { ...DEFAULT_SETTINGS, midiInputId: 'in-a' }, stepTick: null });
  }

  async function connect(): Promise<void> {
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    await flush();
  }

  it('Connect piano says no piano was found, not that it was disconnected', async () => {
    rememberPiano();
    await openPage();
    await connect();
    expect(mgr.selectedInputId).toBe('in-a');
    expect(mgr.inputConnected).toBe(false);
    expect(notice()).toContain(MIDI_TEXT.noDevices);
    expect(container.textContent).not.toContain(MIDI_TEXT.disconnected);
    expect(container.querySelector('.ps-midi__chip')).toBeNull();

    // Try again with the piano still off: the "still no piano" help.
    await connect();
    expect(notice()).toContain(MIDI_TEXT.stillNoDevices);
  });

  it('the piano switched on later under the same id is attached', async () => {
    rememberPiano();
    await openPage();
    await connect();
    act(() => access.plug(new FakePort('in-a', 'Yamaha P-125')));
    await flush();
    expect(mgr.inputConnected).toBe(true);
    expect(followDisabled()).toBe(false);
    expect(notice()).toBeNull();
  });

  it('with two other devices and the saved piano off, the list asks for a choice and shows no device as chosen', async () => {
    rememberPiano();
    access.inputs.set('in-x', new FakePort('in-x', 'Midi Through Port-0'));
    access.inputs.set('in-y', new FakePort('in-y', 'USB Keyboard'));
    await openPage();
    await connect();
    expect(mgr.inputConnected).toBe(false);
    expect(notice()).toContain(MIDI_TEXT.chooseSavedMissing);
    expect(container.textContent).not.toContain('was disconnected');
    const select = pianoSelect();
    expect(select).not.toBeNull();
    expect(select?.value).toBe('');
    expect(select?.selectedOptions[0]?.textContent).toBe('Choose your piano…');
  });

  it('with one other device on and the saved piano off, that device is not attached in its place', async () => {
    rememberPiano();
    localStorage.setItem('pianosteps:v1:global', JSON.stringify({ midiInputName: 'Yamaha P-125' }));
    access.inputs.set('in-y', new FakePort('in-y', 'USB Keyboard'));
    await openPage();
    await connect();
    expect(mgr.selectedInputId).toBe('in-a');
    expect(mgr.inputConnected).toBe(false);
    expect(notice()).toContain(MIDI_TEXT.chooseSavedMissing);
    expect(notice()).not.toContain('More than one');
    expect(pianoSelect()?.value).toBe('');
    // Nothing about the other device was saved.
    act(() => root.unmount());
    expect(JSON.parse(localStorage.getItem('pianosteps:v1:global') ?? '{}').midiInputName).toBe('Yamaha P-125');
    expect(JSON.parse(localStorage.getItem('pianosteps:v1:piece:minuet') ?? '{}').settings.midiInputId).toBe('in-a');
    root = createRoot(container);
  });

  for (const variant of ['the same id', 'a new id and the same name', 'a new id and a new name'] as const) {
    it(`with only "Midi Through" on, nothing is attached; the piano switched on under ${variant} is`, async () => {
      rememberPiano();
      localStorage.setItem('pianosteps:v1:global', JSON.stringify({ midiInputName: 'Yamaha P-125' }));
      access.inputs.set('in-x', new FakePort('in-x', 'Midi Through Port-0'));
      await openPage();
      await connect();
      expect(mgr.inputConnected).toBe(false);
      expect(notice()).toContain(MIDI_TEXT.noDevices);
      expect(container.textContent).not.toContain('Midi Through Port-0 connected');

      const piano =
        variant === 'the same id'
          ? new FakePort('in-a', 'Yamaha P-125')
          : variant === 'a new id and the same name'
            ? new FakePort('in-a2', 'Yamaha P-125')
            : new FakePort('in-b', 'Digital Piano');
      act(() => access.plug(piano));
      await flush();
      expect(mgr.selectedInputId).toBe(piano.id);
      expect(mgr.inputConnected).toBe(true);
      expect(followDisabled()).toBe(false);
    });
  }

  it('a new piece with only "Midi Through" on finds no piano, and attaches the piano when it is switched on', async () => {
    access.inputs.set('in-x', new FakePort('in-x', 'Midi Through Port-0'));
    await openPage();
    await connect();
    expect(mgr.selectedInputId).toBeNull();
    expect(notice()).toContain(MIDI_TEXT.noDevices);
    act(() => access.plug(new FakePort('in-a', 'Yamaha P-125')));
    await flush();
    expect(mgr.selectedInputId).toBe('in-a');
    expect(mgr.inputConnected).toBe(true);
  });

  it('the piano switched on under a new id is found by its remembered name, even when another device turns up with it', async () => {
    rememberPiano();
    localStorage.setItem('pianosteps:v1:global', JSON.stringify({ midiInputName: 'Yamaha P-125' }));
    await openPage();
    await connect();
    expect(notice()).toContain(MIDI_TEXT.noDevices);
    // Two newcomers at once: only the remembered name can tell which is the piano.
    access.inputs.set('in-pad', new FakePort('in-pad', 'Pad Controller'));
    act(() => access.plug(new FakePort('in-a2', 'Yamaha P-125')));
    await flush();
    expect(mgr.selectedInputId).toBe('in-a2');
    expect(mgr.inputConnected).toBe(true);
    expect(statusFacts()).toContain('MIDI: Yamaha P-125 connected');
  });

  it('the status line agrees with the notice: no piano found, never an unnamed device disconnected', async () => {
    rememberPiano();
    await openPage();
    await connect();
    expect(notice()).toContain(MIDI_TEXT.noDevices);
    expect(statusFacts()).toContain('MIDI: no piano found');
    expect(statusFacts()).not.toContain('disconnected');
    expect(statusFacts()).not.toContain('Unnamed MIDI device');

    const piano = new FakePort('in-a', 'Yamaha P-125');
    act(() => access.plug(piano));
    await flush();
    expect(statusFacts()).toContain('MIDI: Yamaha P-125 connected');
    expect(statusFacts()).not.toContain('no piano found');

    // Seen this session, then unplugged: now it really was disconnected.
    act(() => access.unplug(piano));
    await flush();
    expect(notice()).toContain(MIDI_TEXT.disconnected);
    expect(statusFacts()).toContain('MIDI: Yamaha P-125 disconnected');
  });

  it('with other devices on and the saved piano off, the status line says no piano was found', async () => {
    rememberPiano();
    access.inputs.set('in-x', new FakePort('in-x', 'Midi Through Port-0'));
    access.inputs.set('in-y', new FakePort('in-y', 'USB Keyboard'));
    await openPage();
    await connect();
    expect(notice()).toContain(MIDI_TEXT.chooseSavedMissing);
    expect(statusFacts()).toContain('MIDI: no piano found');
    expect(statusFacts()).not.toContain('Unnamed MIDI device');
    expect(statusFacts()).not.toContain('disconnected');
  });

  it('a piano that was connected and then unplugged is still reported as disconnected', () => {
    const base = { state: 'ready' as const, selectedInputId: 'in-a', inputConnected: false, inputs: () => [] };
    expect(midiPhase({ ...base, inputSeen: true })).toBe('disconnected');
    expect(midiPhase({ ...base, inputSeen: false })).toBe('no-devices');
    expect(midiPhase({ ...base, inputSeen: false, inputs: () => [{ connected: true }] })).toBe('choose');
    // A MIDI control that does not report it keeps the old behaviour.
    expect(midiPhase(base)).toBe('disconnected');
    // Only a loopback port beside the missing piano: no piano was found.
    const through = { connected: true, name: 'Midi Through Port-0' };
    expect(midiPhase({ ...base, inputSeen: false, inputs: () => [through] })).toBe('no-devices');
    expect(midiPhase({ ...base, selectedInputId: null, inputs: () => [through] })).toBe('no-devices');
  });
});
