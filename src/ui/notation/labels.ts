import type { CellKind, Hand, NoteToken, TokenAction } from '../../core/types';

export const HAND_NAME: Readonly<Record<Hand, string>> = { R: 'Right hand', L: 'Left hand' };

/**
 * Notation colours. Purple and green belong to the hands and are never used
 * here; red and blue mean add and release only.
 */
export const TOKEN_COLOUR: Readonly<Record<TokenAction, string>> = {
  press: 'var(--fg, #22201c)',
  add: 'var(--add, #c81e1e)',
  release: 'var(--release, #1d4ed8)',
};

/** The colour-independent mark drawn directly beneath a token's label. */
export type TokenMark = 'dot' | 'ring' | null;

export function tokenMark(action: TokenAction): TokenMark {
  if (action === 'add') return 'dot';
  if (action === 'release') return 'ring';
  return null;
}

export const CARRIED_TITLE = 'Already held when this passage starts';

export const HOLD_GLYPH = '—';
export const REST_GLYPH = '·';

/** "C#4" reads as "C sharp 4" to a screen reader; "C4" stays as it is. */
export function spokenKey(label: string): string {
  return label.replace('#', ' sharp ');
}

export function tokenAriaLabel(hand: Hand, token: NoteToken): string {
  const key = spokenKey(token.label);
  let action: string;
  switch (token.action) {
    case 'press':
      action = `press ${key}`;
      break;
    case 'add':
      action = token.repress
        ? `press ${key} again, keep other keys held`
        : `add ${key}, keep other keys held`;
      break;
    case 'release':
      action = `release ${key} only`;
      break;
  }
  const carried = token.carried ? ` (${CARRIED_TITLE.toLowerCase()})` : '';
  return `${HAND_NAME[hand]}: ${action}${carried}`;
}

export function cellAriaLabel(hand: Hand, kind: Extract<CellKind, 'hold' | 'rest'>): string {
  return kind === 'hold' ? `${HAND_NAME[hand]}: no change` : `${HAND_NAME[hand]}: release all keys`;
}
