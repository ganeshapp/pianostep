import type { CellKind, Hand, HandCell } from '../../core/types';
import { cellAriaLabel, HOLD_GLYPH, REST_GLYPH } from './labels';
import { Token } from './Token';
import './notation.css';

export interface CellProps {
  hand: Hand;
  /** A missing cell means this hand does nothing at this step. */
  cell: HandCell | undefined;
}

/** One hand's instruction for one step: a token stack, "—" or a rest dot. */
export function Cell({ hand, cell }: CellProps) {
  const kind: CellKind = cell?.kind ?? 'hold';
  if (kind === 'hold' || kind === 'rest' || !cell || cell.tokens.length === 0) {
    const glyphKind = kind === 'rest' ? 'rest' : 'hold';
    return (
      <span className={`nt-cell nt-cell--${glyphKind}`} data-hand={hand}>
        <span className={`nt-glyph nt-glyph--${glyphKind}`} role="img" aria-label={cellAriaLabel(hand, glyphKind)}>
          {glyphKind === 'rest' ? REST_GLYPH : HOLD_GLYPH}
        </span>
      </span>
    );
  }
  return (
    <span className={`nt-cell nt-cell--${kind}`} data-hand={hand}>
      {cell.tokens.map((t) => (
        <Token key={`${t.action}-${t.midi}`} hand={hand} token={t} />
      ))}
    </span>
  );
}
