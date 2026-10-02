/**
 * The warm "practice studio" look: the palette's contrast (WCAG AA), the brand
 * ink staying clear of the notation, hand and warning colours, system fonts
 * only, and the logo (component and favicon drawing the same mark).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOGO_BLACK_KEYS,
  LOGO_INK,
  LOGO_PAPER,
  LOGO_TILE_RADIUS,
  LOGO_WHITE_KEYS,
  LogoMark,
  Wordmark,
} from '../src/ui/common/Logo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(__dirname, '..');
const theme = readFileSync(join(ROOT, 'src', 'ui', 'theme.css'), 'utf8');

/** A `--name: #rrggbb;` custom property from theme.css. */
function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(theme);
  if (!m) throw new Error(`${name} is not a #rrggbb value in theme.css`);
  return m[1].toLowerCase();
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `color-mix(in srgb, top p, base)`, as the timeline uses for its marker band. */
const mix = (base: string, top: string, p: number): string =>
  '#' +
  rgb(base)
    .map((v, i) => Math.round(v * (1 - p) + rgb(top)[i] * p))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
/** Spread of the channels, 0 (grey) to 1: how colourful a colour is, whatever its lightness. */
const chroma = (hex: string): number => {
  const c = rgb(hex);
  return (Math.max(...c) - Math.min(...c)) / 255;
};

describe('Palette contrast (WCAG AA)', () => {
  const surfaces = ['--page', '--bg', '--surface', '--surface-2'];

  it('body, muted and subtle text read at 4.5:1 on every surface', () => {
    for (const text of ['--fg', '--muted', '--subtle']) {
      for (const surface of surfaces) {
        expect(contrast(token(text), token(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the red and blue note colours read at 4.5:1 on the notes, also under the play marker', () => {
    const marker = mix(token('--bg'), token('--fg'), 0.06);
    for (const note of ['--add', '--release', '--fg']) {
      for (const surface of [token('--bg'), token('--surface'), marker]) {
        expect(contrast(token(note), surface), `${note} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('white R and L tab letters read on the hand colours', () => {
    expect(contrast('#ffffff', token('--rh'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', token('--lh'))).toBeGreaterThanOrEqual(4.5);
  });

  it('primary buttons, "needs review" chips and the keyboard caption read at 4.5:1', () => {
    expect(contrast(token('--on-ink'), token('--ink'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--on-ink'), token('--ink-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--review-fg'), token('--review-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--unusable-fg'), token('--unusable-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--badge-fg'), token('--badge-bg'))).toBeGreaterThanOrEqual(4.5);
    for (const body of ['--kb-body', '--kb-body-deep']) {
      expect(contrast(token('--kb-caption'), token(body)), `caption on ${body}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text fields and focus rings stand out at 3:1 (non-text contrast)', () => {
    for (const surface of ['--page', '--bg', '--surface']) {
      expect(contrast(token('--border-input'), token(surface)), `field border on ${surface}`).toBeGreaterThanOrEqual(3);
      expect(contrast(token('--focus-ring'), token(surface)), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(token('--focus-ring'), token('--key-white'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('--focus-ring-on-dark'), token('--key-black'))).toBeGreaterThanOrEqual(3);
    // The ring's inner halo separates it from the ink of primary buttons.
    expect(contrast(token('--focus-ring-inner'), token('--ink'))).toBeGreaterThanOrEqual(3);
  });

  it('the scrubber under the notes is easy to find: its track and thumb stand out at 3:1', () => {
    const notation = readFileSync(join(ROOT, 'src', 'ui', 'notation', 'notation.css'), 'utf8');
    const rule = (selector: string): string => {
      const at = notation.indexOf(`${selector} {`);
      if (at < 0) throw new Error(`no ${selector} rule`);
      return notation.slice(at, notation.indexOf('}', at));
    };
    /** The `color-mix(in srgb, var(--fg…) N%, transparent)` share of ink, as a fraction. */
    const inkShare = (selector: string): number => {
      const m = /color-mix\(in srgb, var\(--fg[^)]*\) (\d+)%, transparent\)/.exec(rule(selector));
      if (!m) throw new Error(`${selector} is not a share of --fg`);
      return Number(m[1]) / 100;
    };
    const track = token('--surface-2');
    // The track's outline, against the paper notes card it sits on.
    const outline = /inset 0 0 0 1px var\((--[\w-]+)/.exec(rule('.tl-scrub'))?.[1];
    expect(outline).toBeDefined();
    expect(contrast(token(outline ?? ''), token('--bg')), 'track outline on the card').toBeGreaterThanOrEqual(3);
    // The thumb (the part in view), at rest and on hover, against the track.
    const thumb = mix(track, token('--fg'), inkShare('.tl-scrub__thumb'));
    const hover = mix(track, token('--fg'), inkShare('.tl-scrub:not(.is-locked):hover .tl-scrub__thumb'));
    expect(contrast(thumb, track), 'thumb on the track').toBeGreaterThanOrEqual(3);
    expect(contrast(hover, track), 'thumb on hover').toBeGreaterThan(contrast(thumb, track));
    // The current-step mark still shows over the thumb.
    expect(contrast(token('--fg'), thumb), 'now mark on the thumb').toBeGreaterThanOrEqual(3);
  });
});

describe('Brand colours', () => {
  it('keeps the notation, hand and warning colours unchanged', () => {
    expect(token('--add')).toBe('#c81e1e');
    expect(token('--release')).toBe('#1d4ed8');
    expect(token('--rh')).toBe('#7c3aed');
    expect(token('--lh')).toBe('#15803d');
    expect(token('--wrong')).toBe('#b45309');
  });

  it('uses a near-neutral ink and cream, never a red, blue, purple, green or amber', () => {
    // The semantic colours are all far from grey...
    for (const semantic of ['--add', '--release', '--rh', '--lh', '--wrong']) expect(chroma(token(semantic))).toBeGreaterThan(0.4);
    // ...and the brand, surfaces and borders are all close to it.
    const neutrals = ['--ink', '--ink-hover', '--on-ink', '--page', '--bg', '--surface', '--surface-2', '--border', '--border-strong'];
    for (const name of [...neutrals, '--kb-body', '--kb-body-deep', '--kb-felt']) {
      expect(chroma(token(name)), name).toBeLessThan(0.15);
    }
    expect(chroma(LOGO_INK)).toBeLessThan(0.05);
    expect(chroma(LOGO_PAPER)).toBeLessThan(0.05);
    expect(LOGO_INK).toBe(token('--ink'));
  });
});

describe('Fonts', () => {
  const cssFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? cssFiles(join(dir, d.name)) : d.name.endsWith('.css') ? [join(dir, d.name)] : [],
    );

  it('headings use a system book serif and body text a system sans', () => {
    const stack = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(theme)?.[1] ?? '';
    expect(stack('--font-display')).toMatch(/^'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif$/);
    expect(stack('--font-sans')).toMatch(/^system-ui,.*sans-serif$/);
    expect(stack('--font-mono')).toMatch(/^ui-monospace,.*monospace$/);
  });

  it('downloads no fonts or styles from anywhere', () => {
    const files = cssFiles(join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      expect(css, file).not.toMatch(/@font-face|@import|url\(\s*['"]?(https?:)?\/\//i);
    }
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link[^>]+rel=["']?(stylesheet|preconnect|preload)/i);
  });
});

describe('Logo', () => {
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

  it('draws four white keys climbing like steps, with a black key between each pair', () => {
    expect(LOGO_WHITE_KEYS).toHaveLength(4);
    expect(LOGO_BLACK_KEYS).toHaveLength(3);
    const start = (d: string): [number, number] => {
      const m = /^M([\d.]+) ([\d.]+)/.exec(d);
      if (!m) throw new Error(d);
      return [Number(m[1]), Number(m[2])];
    };
    const whites = LOGO_WHITE_KEYS.map(start);
    for (let i = 1; i < whites.length; i++) {
      expect(whites[i][0]).toBeGreaterThan(whites[i - 1][0]); // left to right
      expect(whites[i][1]).toBeLessThan(whites[i - 1][1]); // each one a step higher
    }
    // Each black key straddles the gap between its two white keys, at the lower key's back edge.
    LOGO_BLACK_KEYS.map(start).forEach(([x, y], i) => {
      expect(x).toBeLessThan(whites[i][0] + 5.2);
      expect(x + 3.6).toBeGreaterThan(whites[i + 1][0]);
      expect(y).toBe(whites[i][1]);
    });
    // Everything stays inside the 32×32 tile with a margin.
    for (const [x, y] of [...whites, ...LOGO_BLACK_KEYS.map(start)]) {
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
    }
  });

  it('renders as a decorative SVG at the requested size', () => {
    act(() => root.render(createElement(LogoMark, { size: 40, className: 'x' })));
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('width')).toBe('40');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(svg?.classList.contains('logo-mark')).toBe(true);
    expect(svg?.classList.contains('x')).toBe(true);
    expect(svg?.querySelector('title')).toBeNull();
    expect(svg?.textContent).toBe('');
    const fills = [...(svg?.querySelectorAll('rect, path') ?? [])].map((e) => e.getAttribute('fill'));
    expect(fills).toEqual([LOGO_INK, LOGO_PAPER, LOGO_INK]);
  });

  it('pairs with the wordmark, which reads as plain "Piano Steps"', () => {
    act(() => root.render(createElement(Wordmark)));
    const mark = container.querySelector('.wordmark');
    expect(mark?.textContent).toBe('Piano Steps');
    expect(mark?.querySelector('.wordmark__piano')?.textContent).toBe('Piano');
    expect(mark?.querySelector('.wordmark__steps')?.textContent).toBe('Steps');
  });

  it('is also the favicon: index.html inlines the same mark as an SVG data URI', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const href = /<link[^>]*rel="icon"[^>]*href="data:image\/svg\+xml,([^"]+)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    const svg = decodeURIComponent(href ?? '');
    expect(svg).toContain(`viewBox='0 0 32 32'`);
    expect(svg).toContain(`<rect width='32' height='32' rx='${LOGO_TILE_RADIUS}' fill='${LOGO_INK}'/>`);
    expect(svg).toContain(`<path fill='${LOGO_PAPER}' d='${LOGO_WHITE_KEYS.join('')}'/>`);
    expect(svg).toContain(`<path fill='${LOGO_INK}' d='${LOGO_BLACK_KEYS.join('')}'/>`);
  });
});
