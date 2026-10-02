import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { labelToMidi } from '../src/core/pitch';
import { Keyboard, type KeyboardProps } from '../src/ui/keyboard/Keyboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function k(label: string): number {
  const m = labelToMidi(label);
  if (m === null) throw new Error(label);
  return m;
}
const ks = (labels: string): number[] => labels.split(' ').map(k);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base: KeyboardProps = {
  frameKeys: ks('C3 G3 C4 E4 G4'),
  labelKeys: ks('C3 G3 C4 E4 F#4 G4'),
  expected: { R: [], L: [] },
  struck: { R: [], L: [] },
  physicalDown: [],
  wrong: [],
  pedalDown: false,
  hands: ['R', 'L'],
  showPhysical: false,
  showWrong: false,
  fitWholePiece: false,
  onFitChange: () => undefined,
};

function render(patch: Partial<KeyboardProps> = {}): HTMLElement {
  act(() => root.render(createElement(Keyboard, { ...base, ...patch })));
  return container;
}

function key(label: string): SVGGElement {
  const g = container.querySelector<SVGGElement>(`.kb-key[data-midi="${k(label)}"]`);
  if (!g) throw new Error(`${label} not drawn`);
  return g;
}

function shownRange(): [number, number] {
  const midis = [...container.querySelectorAll('.kb-key')].map((g) => Number(g.getAttribute('data-midi')));
  return [Math.min(...midis), Math.max(...midis)];
}

function fill(label: string): string {
  return key(label).querySelector<SVGPathElement>('.kb-shape')?.style.fill ?? '';
}

describe('Keyboard', () => {
  it('labels only the keys the passage uses and marks middle C', () => {
    render();
    expect(key('C4').textContent).toContain('C4');
    expect(key('F#4').textContent).toContain('F#');
    expect(key('D4').querySelector('text')).toBeNull();
    expect(key('A3').querySelector('text')).toBeNull();
    expect(container.querySelector('.kb-middle-c')?.textContent).toBe('Middle C');
  });

  it('fills right-hand keys purple and left-hand keys green, strong when struck and light when held', () => {
    render({ expected: { R: ks('C4 E4'), L: ks('C3') }, struck: { R: ks('E4'), L: [] } });
    expect(fill('E4')).toContain('--rh,');
    expect(fill('C4')).toContain('--rh-soft');
    expect(fill('C3')).toContain('--lh-soft');
    expect(fill('D4')).toBe('');
    expect(key('E4').querySelector('.kb-hand-letter')?.textContent).toBe('R');
    expect(key('C3').querySelector('.kb-hand-letter')?.textContent).toBe('L');
    // Notation colours never appear on the keyboard.
    expect(container.innerHTML).not.toMatch(/--(add|release)\b/);
  });

  it('splits a key held by both hands instead of hiding one of them', () => {
    render({ expected: { R: ks('C4'), L: ks('C4') }, struck: { R: [], L: ks('C4') } });
    const f = fill('C4');
    expect(f).toMatch(/^url\(#/);
    const id = /url\("?#([^")]+)"?\)/.exec(f)?.[1];
    const gradient = id ? container.querySelector(`[id="${id}"]`) : null;
    const stops = [...(gradient?.querySelectorAll('stop') ?? [])].map((s) => (s as SVGStopElement).style.stopColor);
    expect(stops[0]).toContain('--rh-soft');
    expect(stops[1]).toContain('--lh,');
    expect(key('C4').querySelector('.kb-hand-letter')?.textContent).toBe('R L');
  });

  it('outlines "keep holding" keys in the full hand colour, so long holds stay visible', () => {
    render({ expected: { R: ks('C4 E4 F#4'), L: ks('C3') }, struck: { R: ks('E4'), L: [] } });
    const outline = (label: string) => key(label).querySelector<SVGPathElement>('.kb-hold-outline');
    expect(outline('C4')?.style.stroke).toContain('--rh,');
    expect(outline('C3')?.style.stroke).toContain('--lh,');
    // Black keys too.
    expect(outline('F#4')?.style.stroke).toContain('--rh,');
    // "Press now" keys and unused keys have no outline.
    expect(outline('E4')).toBeNull();
    expect(outline('D4')).toBeNull();
  });

  it('outlines a key both hands hold in both full colours, one per half', () => {
    render({ expected: { R: ks('C4'), L: ks('C4') }, struck: { R: [], L: [] } });
    const stroke = key('C4').querySelector<SVGPathElement>('.kb-hold-outline')?.style.stroke ?? '';
    const id = /url\("?#([^")]+)"?\)/.exec(stroke)?.[1];
    const gradient = id ? container.querySelector(`[id="${id}"]`) : null;
    const stops = [...(gradient?.querySelectorAll('stop') ?? [])].map((s) => (s as SVGStopElement).style.stopColor);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toContain('--rh,');
    expect(stops[1]).toContain('--lh,');
  });

  it('uses "keep holding" fills that stand out from a white key', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'theme.css'), 'utf8');
    const value = (name: string): string => {
      const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      if (!m) throw new Error(`${name} not set`);
      return m[1];
    };
    const lin = (c: number): number => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const onWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05);
    for (const soft of ['--rh-soft', '--lh-soft']) expect(onWhite(value(soft))).toBeGreaterThanOrEqual(1.6);
    // Still clearly lighter than "press now".
    expect(luminance(value('--rh-soft'))).toBeGreaterThan(luminance(value('--rh')) * 2.5);
    expect(luminance(value('--lh-soft'))).toBeGreaterThan(luminance(value('--lh')) * 2.5);
  });

  it('shows physical keys as dots only when a piano is connected', () => {
    render({ physicalDown: ks('C4 D4') });
    expect(container.querySelectorAll('.kb-physical')).toHaveLength(0);
    render({ physicalDown: ks('C4 D4'), showPhysical: true });
    expect(key('C4').querySelector('.kb-physical')).not.toBeNull();
    expect(key('D4').querySelector('.kb-physical')).not.toBeNull();
    expect(key('E4').querySelector('.kb-physical')).toBeNull();
    expect(container.querySelector('.kb-legend')?.textContent).toContain('= your key');
  });

  it('marks wrong keys with an amber dashed outline and a cross in Follow me only', () => {
    render({ physicalDown: ks('D4'), wrong: ks('D4'), showPhysical: true });
    expect(container.querySelector('.kb-wrong-outline')).toBeNull();
    render({ physicalDown: ks('D4'), wrong: ks('D4'), showPhysical: true, showWrong: true });
    expect(key('D4').querySelector('.kb-wrong-outline')).not.toBeNull();
    expect(key('D4').querySelector('.kb-wrong-badge')).not.toBeNull();
    expect(fill('D4')).toBe('');
    expect(container.querySelector('.kb-legend')?.textContent).toContain('= not expected');
  });

  it('shows the pedal separately and never as a held key', () => {
    render({ pedalDown: true });
    const chip = container.querySelector('.kb-pedal');
    expect(chip?.classList.contains('is-up')).toBe(false);
    expect(chip?.textContent).toContain('Pedal');
    expect(container.querySelectorAll('.kb-physical')).toHaveLength(0);
    render({ pedalDown: false });
    expect(container.querySelector('.kb-pedal')?.classList.contains('is-up')).toBe(true);
  });

  it('keeps its framing while the highlighted keys change', () => {
    render();
    const before = shownRange();
    render({ expected: { R: ks('B5'), L: ks('C2') }, struck: { R: ks('B5'), L: ks('C2') } });
    expect(shownRange()).toEqual(before);
    // Same keys in a new array: still the same framing.
    render({ frameKeys: [...base.frameKeys] });
    expect(shownRange()).toEqual(before);
    render({ frameKeys: ks('C2 C6') });
    expect(shownRange()).not.toEqual(before);
  });

  it('only lists the hands in use in the legend', () => {
    render({ hands: ['L'] });
    const legend = container.querySelector('.kb-legend')?.textContent ?? '';
    expect(legend).toContain('Green = left hand');
    expect(legend).not.toContain('Purple');
    expect(legend).not.toContain('your key');
    expect(legend).not.toContain('not expected');
  });

  it('explains notes beyond the 88 keys above the keyboard', () => {
    render({ frameKeys: [...base.frameKeys, k('D8')] });
    expect(container.querySelector('.kb-notice')?.textContent).toContain('D8');
    render();
    expect(container.querySelector('.kb-notice')).toBeNull();
  });

  it('offers the passage / whole piece fit as a radio group', () => {
    let chosen: boolean | null = null;
    render({ onFitChange: (whole) => (chosen = whole) });
    const radios = container.querySelectorAll<HTMLInputElement>('.kb-fit input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    act(() => radios[1].click());
    expect(chosen).toBe(true);
  });
});
