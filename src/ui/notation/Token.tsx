import type { Hand, NoteToken } from '../../core/types';
import { CARRIED_TITLE, TOKEN_COLOUR, tokenAriaLabel, tokenMark } from './labels';
import './notation.css';

export interface TokenProps {
  hand: Hand;
  token: NoteToken;
}

/** One key instruction: the key address, coloured by action, with its mark beneath. */
export function Token({ hand, token }: TokenProps) {
  const mark = tokenMark(token.action);
  const className = [
    'nt-token',
    `nt-token--${token.action}`,
    token.repress ? 'nt-token--repress' : '',
    token.carried ? 'nt-token--carried' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={className}
      role="img"
      aria-label={tokenAriaLabel(hand, token)}
      title={token.carried ? CARRIED_TITLE : undefined}
      style={{ color: TOKEN_COLOUR[token.action] }}
    >
      <span className="nt-token__label" aria-hidden="true">
        {token.label}
      </span>
      <span
        className={mark ? `nt-token__mark nt-token__mark--${mark}` : 'nt-token__mark'}
        aria-hidden="true"
      />
    </span>
  );
}
