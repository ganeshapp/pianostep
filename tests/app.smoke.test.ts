/**
 * Whole-app smoke test: <App/> rendered with react-dom/client in jsdom, the way
 * src/main.tsx mounts it (StrictMode included). IndexedDB (idb-keyval) is an
 * in-memory map, and the audio/MIDI singletons are fakes unless a test asks
 * for the real ones. Built-in scores are "downloaded" from public/ through a
 * stubbed fetch, so the real loader, parser and preparer run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { parseMusicXml } from '../src/core/musicxml/parse';
import type { CatalogEntry, MidiInputEvent } from '../src/core/types';
import type { MidiDeviceInfo, MidiState } from '../src/midi/manager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------------ */
/* Mocks                                                                     */
/* ------------------------------------------------------------------------ */

class FakeMidi {
  state: MidiState = 'idle';
  errorMessage: string | null = null;
  selectedInputId: string | null = null;
  selectedOutputId: string | null = null;
  inputConnected = false;
  private changes = new Set<() => void>();
  connect = async (): Promise<MidiState> => {
    this.state = 'ready';
    this.emit();
    return this.state;
  };
  inputs = (): MidiDeviceInfo[] => [];
  outputs = (): MidiDeviceInfo[] => [];
  selectInput = (id: string | null): void => {
    this.selectedInputId = id;
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
  private emit(): void {
    for (const fn of [...this.changes]) fn();
  }
}

const fakes = vi.hoisted(() => ({
  db: new Map<unknown, unknown>(),
  /** When set, PracticePage gets this instead of the real loadPiece. */
  load: null as null | ((id: string, signal?: AbortSignal) => Promise<unknown>),
  realServices: false,
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

vi.mock('idb-keyval', () => ({
  createStore: () => 'imports-store',
  get: async (key: unknown) => fakes.db.get(key),
  getMany: async (keys: unknown[]) => keys.map((k) => fakes.db.get(k)),
  keys: async () => [...fakes.db.keys()],
  setMany: async (entries: [unknown, unknown][]) => {
    for (const [k, v] of entries) fakes.db.set(k, v);
  },
  delMany: async (keys: unknown[]) => {
    for (const k of keys) fakes.db.delete(k);
  },
  clear: async () => fakes.db.clear(),
}));

vi.mock('../src/app/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/app/services')>();
  return {
    get sampler() {
      return fakes.realServices ? actual.sampler : fakes.sampler;
    },
    get midi() {
      return fakes.realServices ? actual.midi : fakes.midi;
    },
  };
});

vi.mock('../src/catalog/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/catalog/loader')>();
  return {
    ...actual,
    loadPiece: (id: string, signal?: AbortSignal) => (fakes.load ? fakes.load(id, signal) : actual.loadPiece(id, signal)),
  };
});

const { App } = await import('../src/App');
const { getCatalog } = await import('../src/catalog/loader');
const { filterCatalog } = await import('../src/ui/library/filter');
const { PracticeSession } = await import('../src/engine/session');

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

let container: HTMLDivElement;
let root: Root;

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/**
 * Waits (in act) until the predicate holds. It gives up only after 20 s, so a
 * busy machine (loading and parsing a piece can then take seconds) never
 * fails it; the happy path returns as soon as the predicate holds.
 */
async function until(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  if (predicate()) return;
  throw new Error(`Timed out waiting for ${what}. Page text: ${text().slice(0, 400)}`);
}

function text(): string {
  return container.textContent ?? '';
}

function renderApp(hash: string): void {
  window.history.replaceState(null, '', `/${hash}`);
  act(() => root.render(createElement(StrictMode, null, createElement(App))));
}

async function go(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((r) => setTimeout(r, 0));
  });
}

function builtinCards(): HTMLLIElement[] {
  const section = container.querySelector('section[aria-labelledby="builtin-heading"]');
  return [...(section?.querySelectorAll<HTMLLIElement>('li.card') ?? [])];
}

function button(label: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}"`);
  return b;
}

function columnTokens(index: number, hand: 'R' | 'L'): string[] {
  const col = container.querySelector(`.tl__col[data-step="${index}"]`);
  const row = col?.querySelector(`.tl__row--${hand}`);
  return [...(row?.querySelectorAll('[role="img"]') ?? [])].map((el) => el.getAttribute('aria-label') ?? '');
}

/** React 19 tracks input values itself; set through the native setter so onChange fires. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** fetch stand-in serving the files in public/, like the static host does. */
const fetchFromPublic = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost/');
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  try {
    return new Response(new Uint8Array(readFileSync(join(ROOT, 'public', path))), { status: 200 });
  } catch {
    return new Response('not found', { status: 404 });
  }
});

/** A tiny prepared score: the §6 worked example (C4 held under a moving E4 → G4 → F4 line). */
function mockedPiece(id: string) {
  const xml = readFileSync(join(ROOT, 'tests', 'fixtures', 'f04-moving-line.musicxml'), 'utf8');
  return {
    id,
    kind: 'builtin' as const,
    title: 'Moving line',
    arrangement: 'Test arrangement',
    composer: 'Nobody',
    prepared: prepareScore(parseMusicXml(xml)),
  };
}

const catalog: CatalogEntry[] = getCatalog();
const ODE = 'ode-to-joy-easy-variation';

beforeEach(() => {
  localStorage.clear();
  fakes.db.clear();
  fakes.load = null;
  fakes.realServices = false;
  fakes.midi = new FakeMidi();
  fetchFromPublic.mockClear();
  vi.stubGlobal('fetch', fetchFromPublic);
  // jsdom has no layout, so scrolling is a no-op here.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

/* ------------------------------------------------------------------------ */
/* Tests                                                                     */
/* ------------------------------------------------------------------------ */

describe('App: library', () => {
  it('lists every catalog entry as a card that links to its piece', async () => {
    renderApp('#/');
    await flush();
    expect(container.querySelector('h1')?.textContent).toBe('Piano Steps');
    expect(text()).toContain('Follow key names instead of sheet music');
    expect(button('Import MusicXML…')).toBeTruthy();

    const cards = builtinCards();
    expect(catalog.length).toBeGreaterThan(50);
    expect(cards).toHaveLength(catalog.length);
    const links = new Map(
      cards.map((c) => {
        const a = c.querySelector<HTMLAnchorElement>('a.card-link');
        return [a?.getAttribute('href'), a?.textContent];
      }),
    );
    for (const entry of catalog) expect(links.get(`#/piece/${entry.id}`)).toBe(entry.title);

    expect(container.querySelector('#builtin-heading')?.textContent).toContain(`${catalog.length} pieces`);
    // No imports yet, so that section is absent.
    expect(container.querySelector('#imports-heading')).toBeNull();
    expect(text()).toContain('Imported pieces and your settings are stored only in this browser.');
    expect(document.title).toBe('Piano Steps');
  });

  it('filters by search text and by difficulty chip', async () => {
    renderApp('#/');
    await flush();

    const beginner = button(`Beginner, ${filterCatalog(catalog, '', 'All', true).counts.Beginner} pieces`);
    act(() => beginner.click());
    expect(beginner.getAttribute('aria-pressed')).toBe('true');
    const expected = filterCatalog(catalog, '', 'Beginner', true).entries.map((e) => e.title);
    expect(builtinCards().map((c) => c.querySelector('.card-title')?.textContent)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);

    act(() => button(`All, ${catalog.length} pieces`).click());
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search box');
    act(() => typeInto(search, 'ode to JOY'));
    expect(builtinCards().map((c) => c.querySelector('.card-title')?.textContent)).toContain('Ode to Joy');
    expect(builtinCards().length).toBeLessThan(catalog.length);

    act(() => typeInto(search, 'zzzz no such piece'));
    expect(builtinCards()).toHaveLength(0);
    expect(text()).toContain('No pieces match.');

    // The library remembers its filters between visits, so put them back.
    act(() => button('Clear search and filters').click());
    expect(builtinCards()).toHaveLength(catalog.length);
  });

  it('rewrites unknown routes to the library', async () => {
    renderApp('#/no/such/page');
    await flush();
    expect(window.location.hash).toBe('#/');
    expect(builtinCards()).toHaveLength(catalog.length);
  });
});

describe('App: practice page', () => {
  it('renders the practice page skeleton and timeline tokens for a mocked prepared score', async () => {
    const loads: string[] = [];
    fakes.load = (id) => {
      loads.push(id);
      return Promise.resolve(mockedPiece(id));
    };
    renderApp('#/');
    await flush();
    await go(`#/piece/${ODE}`);
    await until('the practice page', () => container.querySelector('.tl__col') !== null);

    expect(loads).toContain(ODE);
    expect(container.querySelector('h1')?.textContent).toBe('Moving line');
    expect(container.querySelector('a.ps-back')?.getAttribute('href')).toBe('#/');
    expect(container.querySelector('[role="region"][aria-label="Practice controls"]')).not.toBeNull();
    for (const label of ['Restart', 'Previous step', 'Play', 'Next step', 'Stop', 'Connect piano', 'More']) {
      expect(button(label)).toBeTruthy();
    }
    expect(text()).toContain('Plays the piece at its written rhythm.');
    expect(text()).toContain('A measure is a numbered section of the piece.');
    expect(container.querySelector('.kb__svg')).not.toBeNull();
    expect(text()).toContain('Middle C');
    expect(text()).toMatch(/Step 1 of 5/);

    // R row above L row, each with its tab.
    const tabs = [...container.querySelectorAll('.tl__tab-letter')].map((el) => el.getAttribute('aria-label'));
    expect(tabs).toEqual(['Right hand', 'Left hand']);

    // The worked example from the brief, column by column.
    expect(columnTokens(0, 'R')).toEqual(['Right hand: press C4']);
    expect(columnTokens(1, 'R')).toEqual(['Right hand: add E4, keep other keys held']);
    expect(columnTokens(2, 'R')).toEqual(['Right hand: add G4, keep other keys held', 'Right hand: release E4 only']);
    expect(columnTokens(3, 'R')).toEqual(['Right hand: release G4 only', 'Right hand: add F4, keep other keys held']);
    expect(columnTokens(4, 'R')).toEqual(['Right hand: release all keys']);
    expect(columnTokens(0, 'L')).toEqual(['Left hand: no change']);

    const add = container.querySelector('.tl__col[data-step="1"] .nt-token--add');
    expect(add?.querySelector('.nt-token__mark--dot')).not.toBeNull();
    const release = container.querySelector('.tl__col[data-step="2"] .nt-token--release');
    expect(release?.querySelector('.nt-token__mark--ring')).not.toBeNull();

    // Stepping moves the marker and the keyboard follows the expected keys.
    act(() => button('Next step').click());
    expect(text()).toMatch(/Step 2 of 5/);
    expect(container.querySelector('.tl__col[data-step="1"] .tl__cells')?.getAttribute('aria-current')).toBe('step');
  });

  it('loads a built-in piece from its file under the site path, then returns to the library', async () => {
    const dispose = vi.spyOn(PracticeSession.prototype, 'dispose');
    renderApp(`#/piece/${ODE}`);
    await until('the piece to load', () => container.querySelector('.tl__col') !== null);

    const urls = fetchFromPublic.mock.calls.map(([input]) => String(input));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/scores\/Ode_to_Joy_Easy_variation\.mxl$/);

    expect(container.querySelector('h1')?.textContent).toBe('Ode to Joy');
    expect(text()).toContain('Easy arrangement by Torby Brand');
    expect(text()).toContain('Beginner');
    expect(text()).toContain('per score');
    expect(document.title).toBe('Ode to Joy · Piano Steps');

    // Opening bars (checked against the file): B4 over a G3-B3-D4 chord.
    expect(columnTokens(0, 'R')).toEqual(['Right hand: press B4']);
    expect(columnTokens(0, 'L')).toEqual(['Left hand: press D4', 'Left hand: press B3', 'Left hand: press G3']);
    expect(container.querySelectorAll('.nt-token').length).toBeGreaterThan(10);

    // Only the right hand: the L row disappears.
    const right = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Right hand');
    act(() => right?.querySelector('input')?.click());
    expect([...container.querySelectorAll('.tl__tab-letter')].map((el) => el.getAttribute('aria-label'))).toEqual([
      'Right hand',
    ]);

    const before = dispose.mock.calls.length;
    await go('#/');
    await flush();
    expect(dispose.mock.calls.length).toBeGreaterThan(before);
    expect(builtinCards()).toHaveLength(catalog.length);
    expect(document.title).toBe('Piano Steps');
    // The piece is remembered for next time.
    expect(container.querySelector('a.continue-link')?.textContent).toBe('Continue: Ode to Joy');
    expect(JSON.parse(localStorage.getItem('pianosteps:v1:piece:' + ODE) ?? 'null')?.settings?.hands).toBe('R');
  });

  it('shows a plain message with a way back for an unknown piece', async () => {
    renderApp('#/piece/not-a-real-piece');
    await until('the error message', () => text().includes('Back to library'));
    expect(text()).toContain('This piece could not be opened');
    expect(text()).toContain('This piece is not in the library.');
    expect(fetchFromPublic).not.toHaveBeenCalled();
    expect(container.querySelector('a.btn[href="#/"]')?.textContent).toBe('Back to library');
  });

  it('keeps working with the real audio and MIDI services in a browser without Web Audio or Web MIDI', async () => {
    fakes.realServices = true;
    fakes.load = (id) => Promise.resolve(mockedPiece(id));
    renderApp(`#/piece/${ODE}`);
    await until('the practice page', () => container.querySelector('.tl__col') !== null);

    const follow = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Follow me');
    expect(follow?.querySelector('input')?.disabled).toBe(true);
    expect(follow?.getAttribute('title')).toBe('Connect a digital piano by MIDI to use Follow me');

    await act(async () => {
      button('Connect piano').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    await until('the unsupported notice', () => text().includes("This browser can't connect to a MIDI piano."));

    // Play still runs (silently) and can be paused again.
    await act(async () => {
      button('Play').click();
      await new Promise((r) => setTimeout(r, 50));
    });
    await until('playback to start', () => container.querySelector('button[aria-label="Pause"]') !== null);
    expect(text()).toContain('Browser sound could not start, so playback is silent.');
    act(() => button('Pause').click());
    expect(container.querySelector('button[aria-label="Play"]')).not.toBeNull();
  });
});
