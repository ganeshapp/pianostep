import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keyboard focus on a control that becomes disabled is lost: the browser
 * moves it to the page body, and a keyboard user has to Tab back from the top
 * of the page. While `disabled` is true, focus that was on `ref` before the
 * update goes to `fallback()` instead (a neighbouring control that stays
 * usable). Pointer use is unaffected: buttons never take focus from a click.
 *
 * A key still held down from the disabled control (Enter repeats, e.g. Next
 * step held to the last step) does not go on to press the fallback; the next
 * fresh key press does.
 */
export function useFocusHandoff(
  ref: RefObject<HTMLElement | null>,
  disabled: boolean,
  fallback: () => HTMLElement | null | undefined,
): void {
  // Read before the update is committed: once disabled, some browsers have
  // already moved focus to the body by the time effects run.
  const el = ref.current;
  const hadFocus = el !== null && typeof document !== 'undefined' && document.activeElement === el;
  useLayoutEffect(() => {
    if (!disabled || !hadFocus) return;
    const active = document.activeElement;
    // Focus has gone somewhere else on purpose: leave it there.
    if (active !== ref.current && active !== null && active !== document.body) return;
    const target = fallback();
    if (!target) return;
    target.focus();
    if (document.activeElement !== target) return;
    const swallowRepeat = (e: KeyboardEvent): void => {
      if (e.repeat) e.preventDefault();
    };
    const done = (): void => {
      target.removeEventListener('keydown', swallowRepeat);
      target.removeEventListener('keyup', done);
      target.removeEventListener('blur', done);
    };
    target.addEventListener('keydown', swallowRepeat);
    target.addEventListener('keyup', done);
    target.addEventListener('blur', done);
  });
}
