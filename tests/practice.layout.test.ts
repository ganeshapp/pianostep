/**
 * The practice page's focus layout: the settings fold into one line while
 * practising (only when Play really starts) and the practice area is brought
 * into view; the notes card has a legend and the starting setup; the
 * transport bar sits under the notes with the passage time and step count;
 * switching hands never moves the rows, the starting setup line, the
 * scrubber or the keyboard; and the on-screen keys can be
 * clicked to hear them without touching practice.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import type { MidiInputEvent, PreparedScore } from '../src/core/types';
import type { MidiDeviceInfo, MidiState } from '../src/midi/manager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = 'Bach_Minuet_in_G_Major_BWV_Anh._114.mxl';
const minuet = prepareScore(
  loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', FILE))), FILE),
);
/** A LH C2 tied from measure 1 into measures 2 and 3. */
const heldInto = prepareScore(
  parseMusicXml(readFileSync(join(__dirname, 'fixtures', 'f10-held-into-passage.musicxml'), 'utf8')),
);

/** The left hand rests in measure 1, then both hands play in measure 2. */
const silentLeftHand = prepareScore(
  parseMusicXml(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><rest/><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`),
);

class FakeMidi {
  state: MidiState = 'idle';
  errorMessage: string | null = null;
  selectedInputId: string | null = null;
  selectedOutputId: string | null = null;
  inputConnected = false;
  devices: MidiDeviceInfo[] = [];
  sent: number[] = [];
  private changes = new Set<() => void>();
  connect = async (): Promise<MidiState> => {
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
  sendNoteOn = (midi: number): void => {
    this.sent.push(midi);
  };
  sendNoteOff = (): void => undefined;
  allNotesOff = (): void => undefined;
  emit(): void {
    for (const fn of [...this.changes]) fn();
  }
}

const fakes = vi.hoisted(() => ({
  midi: null as unknown as FakeMidi,
  notes: [] as { midi: number; owner: string | undefined }[],
  startCalls: 0,
  sampler: {
    state: 'not-started' as const,
    currentTime: 0,
    ensureStarted: () => Promise.resolve(),
    onStateChange: () => () => undefined,
    noteOn: (_midi: number, _v?: number, _w?: number, _o?: string) => undefined,
    noteOff: () => undefined,
    allNotesOff: () => undefined,
    click: () => undefined,
  },
  prepared: null as unknown as PreparedScore,
}));

vi.mock('../src/app/services', () => ({
  get midi() {
    return fakes.midi;
  },
  sampler: fakes.sampler,
}));

vi.mock('../src/catalog/loader', () => ({
  loadPiece: (id: string) =>
    Promise.resolve({ id, kind: 'builtin', title: 'Test piece', arrangement: 'Original', composer: 'Someone', prepared: fakes.prepared }),
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

async function open(prepared: PreparedScore = minuet): Promise<void> {
  fakes.prepared = prepared;
  act(() => root.render(createElement(PracticePage, { pieceId: 'piece' })));
  await flush();
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button ${label}`);
  return b;
}

function radio(label: string): HTMLInputElement {
  const l = [...container.querySelectorAll('label')].find((el) => el.textContent?.trim() === label);
  const input = l?.querySelector('input');
  if (!input) throw new Error(`no radio ${label}`);
  return input;
}

function setup(): HTMLElement {
  const el = container.querySelector<HTMLElement>('section[aria-label="Practice settings"]');
  if (!el) throw new Error('no settings area');
  return el;
}

function folded(): boolean {
  const panel = setup().querySelector<HTMLElement>('.ps-setup__panel');
  return panel?.hasAttribute('hidden') ?? false;
}

function savedGlobal(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('pianosteps:v1:global') ?? '{}') as Record<string, unknown>;
}

function setSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  fakes.midi = new FakeMidi();
  fakes.notes = [];
  fakes.startCalls = 0;
  fakes.sampler.noteOn = (midi: number, _v?: number, _w?: number, owner?: string) => {
    fakes.notes.push({ midi, owner });
  };
  fakes.sampler.ensureStarted = () => {
    fakes.startCalls += 1;
    return Promise.resolve();
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('the settings fold away while practising', () => {
  it('are open on a first visit, fold into a summary line when Play starts, and open again with "Adjust settings"', async () => {
    await open();
    expect(folded()).toBe(false);
    expect(button('Hide settings').getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(folded()).toBe(true);
    const last = minuet.measures.at(-1)?.label;
    expect(setup().querySelector('.ps-setup__summary')?.textContent).toBe(
      `Listen · Both hands · 1× · Measures 1–${last} · Repeat off`,
    );
    expect(savedGlobal().setupCollapsed).toBe(true);
    // The transport stays at hand, under the notes.
    expect(button('Pause')).toBeTruthy();

    act(() => button('Adjust settings').click());
    expect(folded()).toBe(false);
    expect(savedGlobal().setupCollapsed).toBe(false);
    // Opening them while playing does not stop anything.
    expect(button('Pause')).toBeTruthy();
  });

  it('remember being folded on the next visit', async () => {
    await open();
    act(() => button('Hide settings').click());
    expect(folded()).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    await open();
    expect(folded()).toBe(true);
    expect(button('Adjust settings').getAttribute('aria-expanded')).toBe('false');
  });

  it('stay open when Play has nothing to play, so the hand and passage controls the message points to are still there', async () => {
    await open(silentLeftHand);
    const to = container.querySelector<HTMLSelectElement>('select[aria-label="To measure"]');
    if (!to) throw new Error('no To list');
    setSelect(to, '0');
    act(() => radio('Left hand').click());
    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(container.querySelector('.ps-transport-bar')?.textContent).toContain('There is nothing to play in these measures.');
    expect(folded()).toBe(false);
    expect(savedGlobal().setupCollapsed).not.toBe(true);
    expect(radio('Both hands')).toBeTruthy();
    // With something to play, Play folds them as usual.
    act(() => radio('Both hands').click());
    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(folded()).toBe(true);
  });

  it('bring the notes, transport and keyboard into view when practice starts, without scrolling past the notes', async () => {
    await open();
    const area = container.querySelector<HTMLElement>('.ps-practice');
    if (!area) throw new Error('no practice area');
    // The keyboard ends 200px below the window; the notes start 300px down.
    const rect = { top: 300, bottom: window.innerHeight + 200 };
    area.getBoundingClientRect = () => ({ ...rect, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => rect }) as DOMRect;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: 208, behavior: 'smooth' });
    // Pausing does not scroll.
    await act(async () => {
      button('Pause').click();
      await Promise.resolve();
    });
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Already in view: nothing to do.
    rect.bottom = window.innerHeight - 50;
    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('keyboard focus inside the settings when they fold goes to "Adjust settings", not the page body', async () => {
    await open();
    const from = container.querySelector<HTMLSelectElement>('select[aria-label="From measure"]');
    if (!from) throw new Error('no From list');
    act(() => from.focus());
    await act(async () => {
      button('Play').click();
      await Promise.resolve();
    });
    expect(folded()).toBe(true);
    expect(document.activeElement).toBe(button('Adjust settings'));
  });

  it('the summary names the mode, hands, speed or step length, passage and repeat', async () => {
    await open();
    act(() => radio('Steady steps').click());
    act(() => radio('Left hand').click());
    act(() => {
      const repeat = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Repeat');
      repeat?.querySelector('input')?.click();
    });
    const from = container.querySelector<HTMLSelectElement>('select[aria-label="From measure"]');
    const to = container.querySelector<HTMLSelectElement>('select[aria-label="To measure"]');
    if (!from || !to) throw new Error('no passage lists');
    setSelect(from, '2');
    setSelect(to, '5');
    act(() => button('Hide settings').click());
    expect(setup().querySelector('.ps-setup__summary')?.textContent).toBe(
      `Steady steps · Left hand · 1.0 s per step · Measures ${minuet.measures[2].label}–${minuet.measures[5].label} · Repeat on`,
    );
  });
});

describe('the practice area: notes, transport, keyboard', () => {
  it('shows notes (with the legend), then the transport bar, then the keyboard', async () => {
    await open();
    const notes = container.querySelector('section[aria-label="Notes"]');
    const transport = container.querySelector('.ps-transport-bar');
    const keyboard = container.querySelector('section[aria-label="Piano keyboard"]');
    if (!notes || !transport || !keyboard) throw new Error('practice area incomplete');
    expect(notes.compareDocumentPosition(transport) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(transport.compareDocumentPosition(keyboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes.querySelector('.nt-legend')?.textContent).toContain('replace');
    // Red means a key added or a held key pressed again; the legend says both.
    expect(notes.querySelector('.nt-legend')?.textContent).toContain('Red with a dot: add / press again');
    for (const label of ['Restart', 'Previous step', 'Play', 'Next step', 'Stop']) {
      expect(transport.contains(button(label))).toBe(true);
    }
    // The old sticky status line is gone; its facts are in the transport bar.
    expect(container.querySelector('.ps-status')).toBeNull();
    expect(transport.textContent).toContain('Plays the piece at its written rhythm.');
  });

  it('reads out the passage time and the step in Listen and Steady steps, and only the step in Follow me', async () => {
    await open();
    const facts = (): string => container.querySelector('.ps-transport-bar .ps-status__facts')?.textContent ?? '';
    expect(facts()).toMatch(/^Time: 0:00 \/ \d+:\d\d·Step 1 of \d+/);
    act(() => radio('Steady steps').click());
    act(() => button('Next step').click());
    const steps = Number(facts().match(/of (\d+)/)?.[1]);
    const total = `${Math.floor(steps / 60)}:${String(steps % 60).padStart(2, '0')}`;
    expect(facts()).toContain(`0:01 / ${total}`);
    expect(facts()).toContain('Step 2 of');

    fakes.midi.devices = [{ id: 'p1', name: 'Yamaha P-125', manufacturer: 'Yamaha', connected: true }];
    await act(async () => {
      button('Connect piano').click();
      await Promise.resolve();
    });
    await flush();
    act(() => radio('Follow me').click());
    expect(container.querySelector('.ps-transport__time')).toBeNull();
    expect(facts()).toMatch(/^Step 2 of \d+/);
    expect(facts()).toContain('MIDI: Yamaha P-125 connected');
  });

  it('shows the starting setup above the notes when the passage begins with keys already held', async () => {
    await open(heldInto);
    expect(container.querySelector('.ps-start-setup')).toBeNull();
    const from = container.querySelector<HTMLSelectElement>('select[aria-label="From measure"]');
    if (!from) throw new Error('no From list');
    setSelect(from, '1');
    expect(container.querySelector('.ps-start-setup')?.textContent).toBe(
      'Starting setup — left hand: C2. These keys are already held when this passage begins; press them first.',
    );
    // The carried token keeps its dotted underline.
    expect(container.querySelector('.tl__col[data-step="0"] .tl__row--L .nt-token--carried')).not.toBeNull();
  });
});

describe('switching hands never moves anything', () => {
  it('keeps both rows, their heights, the keyboard range, its key sizes and its labels', async () => {
    await open();
    const snapshot = () => ({
      tabs: [...container.querySelectorAll<HTMLElement>('.tl__tab')].map((t) => t.style.height),
      keys: [...container.querySelectorAll('.kb-key')].map((g) => g.getAttribute('data-midi')),
      widths: [...container.querySelectorAll('.kb-key .kb-shape')].map((p) => p.getAttribute('d')),
      labels: [...container.querySelectorAll('.kb-key text')].map((t) => t.textContent),
    });
    const both = snapshot();
    expect(both.tabs).toHaveLength(2);
    for (const hands of ['Right hand', 'Left hand', 'Both hands']) {
      act(() => radio(hands).click());
      expect(snapshot()).toEqual(both);
    }
    act(() => radio('Left hand').click());
    expect(container.querySelector('.tl__tab--R.is-off')).not.toBeNull();
    // Highlights still come only from the hand being practised.
    act(() => button('Next step').click());
    expect(container.querySelector('.kb-key.is-lit')).not.toBeNull();
    const lit = [...container.querySelectorAll<SVGPathElement>('.kb-key.is-lit .kb-shape')].map((p) => p.style.fill);
    for (const f of lit) expect(f).not.toContain('--rh');
  });

  it('keeps the starting setup line, with the same words, whichever hand is practised; a hand not practised is only muted', async () => {
    await open(heldInto);
    const from = container.querySelector<HTMLSelectElement>('select[aria-label="From measure"]');
    if (!from) throw new Error('no From list');
    setSelect(from, '1');
    const banner = (): HTMLElement | null => container.querySelector<HTMLElement>('.ps-start-setup');
    /** The words on screen (screen-reader-only text left out): they decide the line's size. */
    const onScreen = (): string | null => {
      const el = banner();
      if (!el) return null;
      const copy = el.cloneNode(true) as HTMLElement;
      for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove();
      return copy.textContent;
    };
    const both = onScreen();
    expect(both).toBe('Starting setup — left hand: C2. These keys are already held when this passage begins; press them first.');
    for (const hands of ['Right hand', 'Left hand', 'Both hands', 'Right hand']) {
      act(() => radio(hands).click());
      expect(onScreen(), hands).toBe(both);
      expect(banner()?.className, hands).toBe(
        hands === 'Right hand' ? 'ps-start-setup is-off' : 'ps-start-setup',
      );
    }
    // Practising the right hand only: the left hand's keys are muted, and read out as not practised.
    const left = banner()?.querySelector<HTMLElement>('.ps-start-setup__hand[data-hand="L"]');
    expect(left?.classList.contains('is-off')).toBe(true);
    expect(left?.textContent).toBe('left hand (not practising): C2');
    act(() => radio('Left hand').click());
    expect(banner()?.querySelector('.ps-start-setup__hand[data-hand="L"]')?.classList.contains('is-off')).toBe(false);
  });

  it('keeps the scrubber row when the hand being practised has nothing to play', async () => {
    await open(silentLeftHand);
    const to = container.querySelector<HTMLSelectElement>('select[aria-label="To measure"]');
    if (!to) throw new Error('no To list');
    setSelect(to, '0');
    const frame = () => ({
      nav: container.querySelectorAll('.tl-box > .tl-nav').length,
      track: container.querySelectorAll('.tl-nav .tl-scrub').length,
      height: container.querySelector<HTMLElement>('.tl')?.style.height,
    });
    const both = frame();
    expect(both).toEqual({ nav: 1, track: 1, height: both.height });
    expect(container.querySelector('.tl-scrub[role="slider"]')).not.toBeNull();
    act(() => radio('Left hand').click());
    expect(container.querySelector('.tl__empty')?.textContent).toMatch(/^There is nothing for the left hand to play/);
    expect(frame()).toEqual(both);
    // An empty, inert track: nothing to look through, nothing to tab to.
    expect(container.querySelector('.tl-scrub[role="slider"]')).toBeNull();
    const empty = container.querySelector<HTMLElement>('.tl-scrub.is-empty');
    expect(empty?.getAttribute('aria-hidden')).toBe('true');
    expect(empty?.hasAttribute('tabindex')).toBe(false);
    act(() => radio('Both hands').click());
    expect(frame()).toEqual(both);
    expect(container.querySelector('.tl-scrub[role="slider"]')).not.toBeNull();
  });

  it('the R / L letters are not drawn on the keys', async () => {
    await open();
    act(() => button('Next step').click());
    expect(container.querySelector('.kb-hand-letter')).toBeNull();
    for (const g of container.querySelectorAll('.kb-key.is-lit')) {
      expect([...g.querySelectorAll('text')].map((t) => t.textContent)).not.toContain('R');
      expect([...g.querySelectorAll('text')].map((t) => t.textContent)).not.toContain('L');
    }
  });
});

describe('click a key to hear it', () => {
  it('sounds through the browser even with Sound off, and never moves the step, reaches Follow me or the MIDI output', async () => {
    await open();
    const sound = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Sound');
    act(() => sound?.querySelector('input')?.click());
    act(() => button('Next step').click());
    const before = container.querySelector('.ps-transport__step')?.textContent;
    const key = container.querySelector('.kb-key[data-midi="60"]');
    if (!key) throw new Error('no middle C');
    const startsBefore = fakes.startCalls;
    await act(async () => {
      key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0 }));
      await Promise.resolve();
    });
    // Browser sound was started within the click itself.
    expect(fakes.startCalls).toBe(startsBefore + 1);
    await flush();
    act(() => {
      key.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0 }));
    });
    expect(fakes.notes).toContainEqual({ midi: 60, owner: 'audition' });
    expect(container.querySelector('.ps-transport__step')?.textContent).toBe(before);
    expect(fakes.midi.sent).toEqual([]);
  });

  it('←/→ inside the keyboard move between keys instead of stepping', async () => {
    await open();
    const middle = container.querySelector<SVGGElement>('.kb-key[tabindex="0"]');
    if (!middle) throw new Error('no keyboard tab stop');
    act(() => middle.focus());
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    act(() => {
      middle.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(container.querySelector('.ps-transport__step')?.textContent).toMatch(/^Step 1 of/);
    expect(document.activeElement?.getAttribute('data-midi')).toBe(String(Number(middle.getAttribute('data-midi')) + 1));
  });
});
