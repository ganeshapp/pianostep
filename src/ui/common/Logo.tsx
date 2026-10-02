/**
 * The Piano Steps mark and wordmark.
 *
 * The mark is four white keys climbing like steps, with a black key between
 * each pair, on a rounded ink tile. It is drawn on a 32×32 grid so it stays
 * legible as a 16px favicon (index.html carries the same shapes as an inline
 * SVG data URI) and as a ~40px header mark.
 *
 * Its colours are the brand ink and paper only: never a hand, notation or
 * warning colour.
 */

/** Brand ink (the tile and the black keys) and paper (the white keys). */
export const LOGO_INK = '#22201c';
export const LOGO_PAPER = '#fbf8f2';

/** White keys, lowest step first: 5.2 wide, 14 long, each one 3 higher than the last, front corners rounded. */
export const LOGO_WHITE_KEYS = [
  'M4 13.5h5.2v12.8a1.2 1.2 0 0 1-1.2 1.2h-2.8a1.2 1.2 0 0 1-1.2-1.2z',
  'M10.25 10.5h5.2v12.8a1.2 1.2 0 0 1-1.2 1.2h-2.8a1.2 1.2 0 0 1-1.2-1.2z',
  'M16.5 7.5h5.2v12.8a1.2 1.2 0 0 1-1.2 1.2h-2.8a1.2 1.2 0 0 1-1.2-1.2z',
  'M22.75 4.5h5.2v12.8a1.2 1.2 0 0 1-1.2 1.2h-2.8a1.2 1.2 0 0 1-1.2-1.2z',
] as const;

/** Black keys, centred on each gap and flush with the back of the lower key. */
export const LOGO_BLACK_KEYS = [
  'M7.925 13.5h3.6v7.2a0.8 0.8 0 0 1-0.8 0.8h-2a0.8 0.8 0 0 1-0.8-0.8z',
  'M14.175 10.5h3.6v7.2a0.8 0.8 0 0 1-0.8 0.8h-2a0.8 0.8 0 0 1-0.8-0.8z',
  'M20.425 7.5h3.6v7.2a0.8 0.8 0 0 1-0.8 0.8h-2a0.8 0.8 0 0 1-0.8-0.8z',
] as const;

/** The tile's corner radius on the 32×32 grid. */
export const LOGO_TILE_RADIUS = 7.5;

/** The mark alone. Decorative: whatever it sits in (a heading, a link) carries the name. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className ? `logo-mark ${className}` : 'logo-mark'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx={LOGO_TILE_RADIUS} fill={LOGO_INK} />
      <path fill={LOGO_PAPER} d={LOGO_WHITE_KEYS.join('')} />
      <path fill={LOGO_INK} d={LOGO_BLACK_KEYS.join('')} />
    </svg>
  );
}

/** "Piano Steps": "Piano" in the serif display face, "Steps" lighter. Reads as the plain text "Piano Steps". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      <span className="wordmark__piano">Piano</span> <span className="wordmark__steps">Steps</span>
    </span>
  );
}
