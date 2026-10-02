/**
 * Click-to-hear: a key on the on-screen keyboard sounds through the browser
 * sampler while it is held (at least AUDITION_MIN_SEC), as its own voice
 * owner. The keys are one Tab stop whose arrow keys move between them, and
 * the page's step shortcuts never fire from inside that group.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { labelToMidi } from '../src/core/pitch';
import { AUDITION_MIN_SEC, AUDITION_VELOCITY, KeyAudition } from '../src/ui/keyboard/audition';
import { Keyboard, type KeyboardProps } from '../src/ui/keyboard/Keyboard';
import { shortcutFor } from '../src/ui/practice/shortcuts';
import { FakeSampler } from './helpers/fakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function k(label: string): number {
  const m = labelToMidi(label);
  if (m === null) throw new Error(label);
  return m;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('KeyAudition', () => {
  it('starts browser sound inside the gesture, then sounds the key as its own voice', async () => {
    const sampler = new FakeSampler();
    sampler.currentTime = 5;
    const a = new KeyAudition(sampler);
    a.press(60);
    // ensureStarted() is called at once, within the click, before anything is awaited.
    expect(sampler.startCalls).toBe(1);
    await settle();
    expect(sampler.calls).toEqual([
      { kind: 'noteOn', midi: 60, velocity: AUDITION_VELOCITY, when: 5, now: 5, owner: 'audition' },
    ]);
    sampler.currentTime = 6;
    a.release(60);
    expect(sampler.calls.at(-1)).toEqual({ kind: 'noteOff', midi: 60, when: 6, now: 6, owner: 'audition' });
    expect(a.keysDown).toEqual([]);
  });

  it('a quick tap still sounds for the minimum time, even when let go before sound started', async () => {
    const sampler = new FakeSampler();
    sampler.currentTime = 2;
    const a = new KeyAudition(sampler);
    a.press(64);
    a.release(64);
    await settle();
    const off = sampler.calls.find((c) => c.kind === 'noteOff');
    expect(off).toMatchObject({ midi: 64, owner: 'audition' });
    expect(off && 'when' in off ? off.when : 0).toBeCloseTo(2 + AUDITION_MIN_SEC, 9);
  });

  it('a held key is not struck again (key repeat), and nothing sounds when browser sound cannot start', async () => {
    const sampler = new FakeSampler();
    const a = new KeyAudition(sampler);
    a.press(60);
    a.press(60);
    await settle();
    expect(sampler.calls.filter((c) => c.kind === 'noteOn')).toHaveLength(1);
    a.releaseAll();
    expect(a.keysDown).toEqual([]);

    const silent = new FakeSampler();
    silent.failStart = true;
    const b = new KeyAudition(silent);
    b.press(62);
    await settle();
    expect(silent.calls).toEqual([]);
    expect(b.keysDown).toEqual([]);
  });

  it('a playback strike or release of the same key never cuts it (separate owners)', async () => {
    const sampler = new FakeSampler();
    const a = new KeyAudition(sampler);
    a.press(60);
    await settle();
    sampler.noteOn(60, 80, 0.1, 'app');
    sampler.noteOff(60, 0.2, 'app');
    const mine = sampler.voices.find((v) => v.owner === 'audition');
    expect(mine?.end).toBe(Infinity);
  });
});

describe('Keyboard keys you can click to hear', () => {
  let container: HTMLDivElement;
  let root: Root;
  let calls: string[];

  const audition = {
    press: (midi: number) => calls.push(`press ${midi}`),
    release: (midi: number) => calls.push(`release ${midi}`),
  };

  const base: KeyboardProps = {
    frameKeys: [k('C3'), k('G4')],
    labelKeys: [k('C3'), k('E4')],
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
    audition,
  };

  beforeEach(() => {
    calls = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(patch: Partial<KeyboardProps> = {}): void {
    act(() => root.render(createElement(Keyboard, { ...base, ...patch })));
  }

  function key(label: string): SVGGElement {
    const g = container.querySelector<SVGGElement>(`.kb-key[data-midi="${k(label)}"]`);
    if (!g) throw new Error(`${label} not drawn`);
    return g;
  }

  function pointer(type: string, target: Element, init: PointerEventInit = {}): void {
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));
    });
  }

  function keydown(target: Element, key: string, repeat = false): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(ev);
    });
    return ev;
  }

  it('plays a key while the mouse holds it, and lets go on release or when the pointer leaves it', () => {
    render();
    pointer('pointerdown', key('E4'));
    expect(calls).toEqual([`press ${k('E4')}`]);
    pointer('pointerup', key('E4'));
    expect(calls).toEqual([`press ${k('E4')}`, `release ${k('E4')}`]);

    calls = [];
    pointer('pointerdown', key('C4'));
    // Moving within the key (onto its label) keeps it sounding...
    pointer('pointerout', key('C4'), { relatedTarget: key('C4').querySelector('text') ?? key('C4') });
    expect(calls).toEqual([`press ${k('C4')}`]);
    // ...moving off it lets go.
    pointer('pointerout', key('C4'), { relatedTarget: key('D4') });
    expect(calls).toEqual([`press ${k('C4')}`, `release ${k('C4')}`]);
  });

  it('a mouse press does not focus the key, so Space and the arrows stay play/pause and step', () => {
    render();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 });
    act(() => {
      key('E4').dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
  });

  it('is one Tab stop (middle C), and the arrow keys move between the keys', () => {
    render();
    const svg = container.querySelector('svg.kb__svg');
    expect(svg?.getAttribute('role')).toBe('toolbar');
    const stops = [...container.querySelectorAll('.kb-key[tabindex="0"]')];
    expect(stops).toEqual([key('C4')]);
    expect(key('C4').getAttribute('role')).toBe('button');
    expect(key('C#4').getAttribute('aria-label')).toBe('C sharp 4');

    act(() => key('C4').focus());
    expect(keydown(key('C4'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(key('C#4'));
    expect(key('C#4').getAttribute('tabindex')).toBe('0');
    expect(key('C4').getAttribute('tabindex')).toBe('-1');
    keydown(key('C#4'), 'Home');
    expect(document.activeElement?.getAttribute('data-midi')).toBe(container.querySelector('.kb-key')?.getAttribute('data-midi'));
  });

  it('Enter or Space plays the focused key until it is let go; a held key does not repeat', () => {
    render();
    act(() => key('C4').focus());
    keydown(key('C4'), 'Enter');
    keydown(key('C4'), 'Enter', true);
    act(() => {
      key('C4').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual([`press ${k('C4')}`, `release ${k('C4')}`]);
    expect(keydown(key('C4'), ' ').defaultPrevented).toBe(true);
    expect(calls.at(-1)).toBe(`press ${k('C4')}`);
  });

  it('the page shortcuts (Space, ←/→, Home) do not fire while focus is on a key', () => {
    render();
    act(() => key('C4').focus());
    for (const name of [' ', 'ArrowLeft', 'ArrowRight', 'Home']) {
      expect(shortcutFor({ key: name, altKey: false, ctrlKey: false, metaKey: false, target: key('C4') }, document)).toBeNull();
    }
  });

  it('without click-to-hear the keyboard stays a picture with no tab stops', () => {
    render({ audition: undefined });
    expect(container.querySelector('svg.kb__svg')?.getAttribute('role')).toBe('img');
    expect(container.querySelector('.kb-key[tabindex]')).toBeNull();
    pointer('pointerdown', key('E4'));
    expect(calls).toEqual([]);
  });
});
