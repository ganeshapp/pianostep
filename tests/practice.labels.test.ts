/**
 * Labels and names on the practice page and library cards: a default tempo is
 * never called the written speed, the passage lists have names, the help's
 * inline token sits in the text, and the keyboard has no hover tooltip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import type { CatalogEntry, PreparedScore } from '../src/core/types';
import type { MidiDeviceInfo, MidiState } from '../src/midi/manager';
import { buildImportMeta } from '../src/storage/imports';
import { lengthDescription } from '../src/ui/practice/diagnostics';
import { defaultSpeedNote, speedValueText } from '../src/ui/practice/text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function load(file: string) {
  const source = loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', file))), file);
  return { source, prepared: prepareScore(source) };
}

const withTempo = load('Bach_Minuet_in_G_Major_BWV_Anh._114.mxl');
const noTempo = load('Happy_Birthday_To_You_C_Major.mxl');

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
  onEvent = (): (() => void) => () => undefined;
  onChange = (): (() => void) => () => undefined;
  sendNoteOn = (): void => undefined;
  sendNoteOff = (): void => undefined;
  allNotesOff = (): void => undefined;
}

const fakes = vi.hoisted(() => ({
  prepared: null as unknown,
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

vi.mock('../src/app/services', () => ({ midi: new FakeMidi(), sampler: fakes.sampler }));
vi.mock('../src/catalog/loader', () => ({
  loadPiece: () =>
    Promise.resolve({ id: 'piece', kind: 'builtin', title: 'A piece', arrangement: 'x', composer: 'y', prepared: fakes.prepared }),
  isAbortError: () => false,
}));

const { PracticePage } = await import('../src/ui/practice/PracticePage');
const { DiagnosticsDialog } = await import('../src/ui/practice/DiagnosticsDialog');
const { HelpDialog } = await import('../src/ui/help/HelpDialog');
const { Keyboard } = await import('../src/ui/keyboard/Keyboard');
const { BuiltinCard, ImportCard } = await import('../src/ui/library/LibraryCard');

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPractice(prepared: PreparedScore): Promise<void> {
  fakes.prepared = prepared;
  act(() => root.render(createElement(PracticePage, { pieceId: 'piece' })));
  await flush();
}

function speedSlider(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('.ps-slider input[type="range"]');
  if (!el) throw new Error('no speed slider');
  return el;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a tempo chosen by the app is labelled as such', () => {
  it('the fixtures: one file with a tempo, one without', () => {
    expect(withTempo.prepared.tempo.defaulted).toBe(false);
    expect(noTempo.prepared.tempo.defaulted).toBe(true);
  });

  it('Listen speed: "of the written speed" only when the file gives one', async () => {
    await openPractice(withTempo.prepared);
    expect(speedSlider().getAttribute('aria-valuetext')).toBe('1× of the written speed');
    expect(container.querySelector('.ps-slider__note')).toBeNull();
    act(() => root.unmount());

    root = createRoot(container);
    await openPractice(noTempo.prepared);
    const slider = speedSlider();
    expect(slider.getAttribute('aria-valuetext')).not.toContain('written');
    expect(slider.getAttribute('aria-valuetext')).toContain('default');
    const note = container.querySelector('.ps-slider__note');
    expect(note?.textContent).toBe(defaultSpeedNote(noTempo.prepared.tempo.points[0].qpm));
    expect(note?.textContent).toContain('120');
    expect(slider.getAttribute('aria-describedby')).toBe(note?.id);
  });

  it('speed and length texts', () => {
    expect(speedValueText(0.5, null)).toBe('0.5× of the written speed');
    expect(speedValueText(0.5, 120)).toBe('0.5× of the app’s default speed (the file gives no speed)');
    expect(lengthDescription(withTempo.prepared, 96)).toBe('About 1:36 at the written speed');
    expect(lengthDescription(noTempo.prepared, 12)).toBe('About 0:12 at the app’s default speed');
  });

  it('About this arrangement gives the length at the app’s default speed', () => {
    const piece = { id: 'hb', kind: 'import' as const, title: 'Happy Birthday', arrangement: null, composer: null, prepared: noTempo.prepared };
    act(() => root.render(createElement(DiagnosticsDialog, { open: true, onClose: () => undefined, piece })));
    expect(document.body.textContent).toContain('at the app’s default speed');
    expect(document.body.textContent).not.toContain('at the written speed');
  });

  it('imported pieces remember that the tempo was defaulted, and the card says so', () => {
    const meta = buildImportMeta('local-1', 'hb.mxl', 100, noTempo.source, noTempo.prepared);
    expect(meta.tempoDefaulted).toBe(true);
    expect(buildImportMeta('local-2', 'm.mxl', 100, withTempo.source, withTempo.prepared).tempoDefaulted).toBe(false);

    act(() =>
      root.render(createElement('ul', null, createElement(ImportCard, { meta, onDelete: () => undefined }))),
    );
    const stats = container.querySelector('.card-stats');
    expect(stats?.textContent).toContain('at default speed');
    expect(stats?.textContent).toContain('at the app’s default speed');
  });

  it('library cards qualify the length when the catalog marks the tempo as defaulted', () => {
    const entry = (tempoDefaulted?: boolean): CatalogEntry =>
      ({
        id: 'hb',
        title: 'Happy Birthday',
        composer: null,
        arrangement: 'Easy',
        file: 'scores/x.mxl',
        upstreamUrl: '',
        rightsInFile: null,
        attribution: '',
        difficulty: { level: 'Unrated', basis: 'none' },
        readiness: 'ready',
        readinessReasons: [],
        stats: { measures: 8, performanceMeasures: 8, notes: 30, durationSec: 12, lowest: 'C3', highest: 'C5', tempoDefaulted },
        notes: [],
      }) as CatalogEntry;
    act(() => root.render(createElement('ul', null, createElement(BuiltinCard, { entry: entry(true) }))));
    expect(container.querySelector('.card-stats')?.textContent).toContain('at default speed');
    act(() => root.render(createElement('ul', null, createElement(BuiltinCard, { entry: entry(undefined) }))));
    expect(container.querySelector('.card-stats')?.textContent).not.toContain('default speed');
  });
});

describe('accessible names and presentation', () => {
  it('the passage lists are named "From measure" and "To measure"', async () => {
    await openPractice(withTempo.prepared);
    const selects = [...container.querySelectorAll<HTMLSelectElement>('.ps-passage select')];
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['From measure', 'To measure']);
  });

  it('the help’s inline carried-note example is an inline token, not a boxed cell example', () => {
    act(() => root.render(createElement(HelpDialog, { open: true, onClose: () => undefined })));
    const notes = [...document.querySelectorAll('.help-note')];
    const carried = notes.find((n) => n.textContent?.includes('dotted underline'));
    expect(carried?.querySelector('.help-inline-token .nt-token--carried')).not.toBeNull();
    expect(carried?.querySelector('.help-example')).toBeNull();
  });

  it('the help explains when shortcuts do not apply, as they really behave', () => {
    act(() => root.render(createElement(HelpDialog, { open: true, onClose: () => undefined })));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('while you are typing or choosing from a list');
    expect(text).toContain('Tab key');
    expect(text).toContain('mouse');
  });

  it('the keyboard is named with aria-label, not an SVG <title> that would show as a hover tooltip', () => {
    act(() =>
      root.render(
        createElement(Keyboard, {
          frameKeys: [48, 60, 72],
          labelKeys: [60, 64],
          expected: { R: [60, 64], L: [] },
          struck: { R: [60], L: [] },
          physicalDown: [],
          wrong: [],
          pedalDown: false,
          hands: ['R', 'L'],
          showPhysical: false,
          showWrong: false,
          fitWholePiece: false,
          onFitChange: () => undefined,
        }),
      ),
    );
    const svg = container.querySelector('svg.kb__svg');
    expect(svg?.querySelector('title')).toBeNull();
    expect(svg?.getAttribute('aria-labelledby')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toMatch(/^Keyboard from \w+\d to \w+\d\. Right hand: C4.*\.$/);
  });

  it('the connected-piano dot is not green (green means the left hand)', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'practice', 'practice.css'), 'utf8');
    const rule = css.match(/\.ps-dot--on\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/#16a34a|22,\s*163,\s*74|--lh/i);
  });
});

describe('About this arrangement: the catalog notes and the checked hand setting', () => {
  const catalog = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'catalog', 'catalog.json'), 'utf8')) as CatalogEntry[];

  function openAbout(id: string): { entry: CatalogEntry; prepared: PreparedScore; text: string } {
    const entry = catalog.find((e) => e.id === id);
    if (!entry) throw new Error(`no catalog entry ${id}`);
    const file = entry.file.slice('scores/'.length);
    const source = loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', entry.file))), file);
    const prepared = prepareScore(source, entry.overrides);
    const piece = { id, kind: 'builtin' as const, title: entry.title, arrangement: entry.arrangement, composer: entry.composer, entry, prepared };
    act(() => root.render(createElement(DiagnosticsDialog, { open: true, onClose: () => undefined, piece })));
    return { entry, prepared, text: document.body.textContent ?? '' };
  }

  it('lists the catalog notes, so the "Repeat 8va" instruction the app does not apply is explained', () => {
    const { entry, text } = openAbout('the-entertainer-scott-joplin');
    expect(entry.notes.some((n) => n.includes('8va'))).toBe(true);
    const items = [...document.querySelectorAll('.ps-diag__notes li')].map((li) => li.textContent);
    expect(items).toEqual(entry.notes);
    expect(text).toContain('About this version');
  });

  it('states a checked hand setting once, in the Hands section', () => {
    const { prepared, text } = openAbout('schubert-serenade-standchen-by-lizst');
    expect(prepared.handMapping.source).toBe('override');
    const reason = prepared.handMapping.description;
    expect(prepared.warnings.some((w) => w.message === reason)).toBe(true);
    expect(text.split(reason).length - 1).toBe(1);
  });
});
