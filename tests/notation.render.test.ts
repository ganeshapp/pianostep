import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hand, HandCell, NoteToken } from '../src/core/types';
import { Cell } from '../src/ui/notation/Cell';
import { CARRIED_TITLE, HOLD_GLYPH, REST_GLYPH, tokenAriaLabel } from '../src/ui/notation/labels';
import { Token } from '../src/ui/notation/Token';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function render(el: ReturnType<typeof createElement>): HTMLDivElement {
  act(() => root.render(el));
  return container;
}

function renderToken(hand: Hand, token: NoteToken): HTMLElement {
  render(createElement(Token, { hand, token }));
  const el = container.querySelector<HTMLElement>('.nt-token');
  if (!el) throw new Error('token not rendered');
  return el;
}

function renderCell(hand: Hand, cell: HandCell | undefined): HTMLElement {
  render(createElement(Cell, { hand, cell }));
  const el = container.querySelector<HTMLElement>('.nt-cell');
  if (!el) throw new Error('cell not rendered');
  return el;
}

const tok = (midi: number, label: string, action: NoteToken['action'], extra: Partial<NoteToken> = {}): NoteToken => ({
  midi,
  label,
  action,
  ...extra,
});

function mark(el: Element): Element {
  const m = el.querySelector('.nt-token__mark');
  if (!m) throw new Error('mark missing');
  return m;
}

describe('Token', () => {
  it('renders a press token in the foreground colour with no mark', () => {
    const el = renderToken('R', tok(60, 'C4', 'press'));
    expect(el.classList.contains('nt-token--press')).toBe(true);
    expect(el.style.color).toContain('--fg');
    expect(el.textContent).toBe('C4');
    expect(mark(el).classList.contains('nt-token__mark--dot')).toBe(false);
    expect(mark(el).classList.contains('nt-token__mark--ring')).toBe(false);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Right hand: press C4');
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('renders an add token in red with a filled dot beneath', () => {
    const el = renderToken('R', tok(64, 'E4', 'add'));
    expect(el.classList.contains('nt-token--add')).toBe(true);
    expect(el.style.color).toContain('--add');
    expect(el.style.color).not.toContain('--release');
    // The dot is the element directly after the label, inside the token.
    const label = el.querySelector('.nt-token__label');
    expect(label?.nextElementSibling).toBe(mark(el));
    expect(mark(el).classList.contains('nt-token__mark--dot')).toBe(true);
    expect(mark(el).classList.contains('nt-token__mark--ring')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Right hand: add E4, keep other keys held');
  });

  it('describes a re-press as pressing the key again', () => {
    const el = renderToken('L', tok(64, 'E4', 'add', { repress: true }));
    expect(el.classList.contains('nt-token--repress')).toBe(true);
    expect(mark(el).classList.contains('nt-token__mark--dot')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Left hand: press E4 again, keep other keys held');
  });

  it('renders a release token in blue with a hollow circle beneath', () => {
    const el = renderToken('R', tok(64, 'E4', 'release'));
    expect(el.classList.contains('nt-token--release')).toBe(true);
    expect(el.style.color).toContain('--release');
    expect(mark(el).classList.contains('nt-token__mark--ring')).toBe(true);
    expect(mark(el).classList.contains('nt-token__mark--dot')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Right hand: release E4 only');
  });

  it('never uses the hand colours for notation', () => {
    for (const action of ['press', 'add', 'release'] as const) {
      for (const hand of ['R', 'L'] as const) {
        const el = renderToken(hand, tok(61, 'C#4', action));
        expect(el.style.color).not.toMatch(/--(rh|lh)/);
      }
    }
  });

  it('spells sharps out for screen readers but shows the key address', () => {
    const el = renderToken('L', tok(61, 'C#4', 'press'));
    expect(el.textContent).toBe('C#4');
    expect(el.getAttribute('aria-label')).toBe('Left hand: press C sharp 4');
  });

  it('marks a carried token with a dotted underline class and a title', () => {
    const el = renderToken('R', tok(55, 'G3', 'press', { carried: true }));
    expect(el.classList.contains('nt-token--carried')).toBe(true);
    expect(el.getAttribute('title')).toBe(CARRIED_TITLE);
    expect(el.getAttribute('aria-label')).toBe(
      'Right hand: press G3 (already held when this passage starts)',
    );
  });

  it('labels every action plainly', () => {
    expect(tokenAriaLabel('R', tok(60, 'C4', 'press'))).toBe('Right hand: press C4');
    expect(tokenAriaLabel('L', tok(64, 'E4', 'add'))).toBe('Left hand: add E4, keep other keys held');
    expect(tokenAriaLabel('L', tok(64, 'E4', 'add', { repress: true }))).toBe(
      'Left hand: press E4 again, keep other keys held',
    );
    expect(tokenAriaLabel('R', tok(64, 'E4', 'release'))).toBe('Right hand: release E4 only');
  });
});

describe('Cell', () => {
  it('stacks replace tokens highest first, in the order given', () => {
    const cell: HandCell = {
      kind: 'replace',
      tokens: [tok(67, 'G4', 'press'), tok(64, 'E4', 'press'), tok(60, 'C4', 'press')],
    };
    const el = renderCell('L', cell);
    expect(el.classList.contains('nt-cell--replace')).toBe(true);
    const tokens = [...el.querySelectorAll('.nt-token')];
    expect(tokens.map((t) => t.textContent)).toEqual(['G4', 'E4', 'C4']);
    expect(tokens.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Left hand: press G4',
      'Left hand: press E4',
      'Left hand: press C4',
    ]);
    expect(el.querySelector('.nt-glyph')).toBeNull();
  });

  it('shows a change cell with red adds and blue releases, each with its own mark', () => {
    const cell: HandCell = {
      kind: 'change',
      tokens: [tok(67, 'G4', 'add'), tok(64, 'E4', 'release')],
    };
    const el = renderCell('R', cell);
    expect(el.classList.contains('nt-cell--change')).toBe(true);
    const [g, e] = [...el.querySelectorAll<HTMLElement>('.nt-token')];
    expect(g.classList.contains('nt-token--add')).toBe(true);
    expect(g.querySelector('.nt-token__mark--dot')).not.toBeNull();
    expect(e.classList.contains('nt-token--release')).toBe(true);
    expect(e.querySelector('.nt-token__mark--ring')).not.toBeNull();
    // Marks belong to tokens; there is no standalone rest dot in a change cell.
    expect(el.querySelector('.nt-glyph--rest')).toBeNull();
  });

  it('shows a hold as a muted dash with a plain label', () => {
    const el = renderCell('L', { kind: 'hold', tokens: [] });
    expect(el.classList.contains('nt-cell--hold')).toBe(true);
    const glyph = el.querySelector('.nt-glyph');
    expect(glyph?.classList.contains('nt-glyph--hold')).toBe(true);
    expect(glyph?.textContent).toBe(HOLD_GLYPH);
    expect(HOLD_GLYPH).toBe('—');
    expect(glyph?.getAttribute('role')).toBe('img');
    expect(glyph?.getAttribute('aria-label')).toBe('Left hand: no change');
    expect(el.querySelector('.nt-token')).toBeNull();
  });

  it('shows a rest as a large dot in the cell itself, not under a note', () => {
    const el = renderCell('L', { kind: 'rest', tokens: [] });
    expect(el.classList.contains('nt-cell--rest')).toBe(true);
    const glyph = el.querySelector('.nt-glyph');
    expect(glyph?.classList.contains('nt-glyph--rest')).toBe(true);
    expect(glyph?.textContent).toBe(REST_GLYPH);
    expect(glyph?.parentElement).toBe(el);
    expect(glyph?.getAttribute('aria-label')).toBe('Left hand: release all keys');
    expect(el.querySelector('.nt-token')).toBeNull();
    expect(el.querySelector('.nt-token__mark')).toBeNull();
  });

  it('treats a missing cell as no change', () => {
    const el = renderCell('R', undefined);
    expect(el.querySelector('.nt-glyph')?.getAttribute('aria-label')).toBe('Right hand: no change');
  });
});
