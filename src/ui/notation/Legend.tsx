import { HOLD_GLYPH, REST_GLYPH, TOKEN_COLOUR } from './labels';
import './notation.css';

/**
 * The five instructions in one compact line, drawn with the timeline's own
 * colours and marks: "Dark: replace · Red ●: add / press again ·
 * Blue ○: release · —: no change · ·: rest". Red is both a key added to
 * those held and a held key struck again. Always shown above the notes, so
 * the meaning is never more than a glance away.
 */
export function NotationLegend() {
  return (
    <p className="nt-legend">
      <span className="nt-legend__item">
        <span className="nt-legend__sample" style={{ color: TOKEN_COLOUR.press }}>
          Dark
        </span>
        : replace
      </span>
      <Sep />
      <span className="nt-legend__item">
        <span className="nt-legend__sample" style={{ color: TOKEN_COLOUR.add }}>
          Red
          <span className="nt-legend__mark nt-token__mark nt-token__mark--dot" aria-hidden="true" />
          <span className="nt-sr-only"> with a dot</span>
        </span>
        : add / press again
      </span>
      <Sep />
      <span className="nt-legend__item">
        <span className="nt-legend__sample" style={{ color: TOKEN_COLOUR.release }}>
          Blue
          <span className="nt-legend__mark nt-token__mark nt-token__mark--ring" aria-hidden="true" />
          <span className="nt-sr-only"> with a ring</span>
        </span>
        : release
      </span>
      <Sep />
      <span className="nt-legend__item">
        <span className="nt-legend__glyph nt-legend__glyph--hold" aria-hidden="true">
          {HOLD_GLYPH}
        </span>
        <span className="nt-sr-only">Dash</span>: no change
      </span>
      <Sep />
      <span className="nt-legend__item">
        <span className="nt-legend__glyph nt-legend__glyph--rest" aria-hidden="true">
          {REST_GLYPH}
        </span>
        <span className="nt-sr-only">Big dot</span>: rest
      </span>
    </p>
  );
}

function Sep() {
  return (
    <span className="nt-legend__sep" aria-hidden="true">
      ·
    </span>
  );
}
