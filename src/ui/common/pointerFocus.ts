import { useMemo, useRef } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

/*
 * Pointer use never leaves focus on a control.
 *
 * Chrome and Edge (the Web MIDI browsers) focus buttons, radios, checkboxes,
 * sliders and selects when they are clicked, without showing a focus ring.
 * The practice shortcuts (shortcuts.ts) then yield Space and the arrow keys to
 * that control, so after ordinary mouse use Space would re-click the button or
 * flip the switch, and an arrow would change the radio instead of stepping.
 * These helpers keep focus off a control after a pointer interaction.
 * Keyboard use is unchanged: a control reached with Tab keeps its focus, and
 * menus and dialogs opened from the keyboard still move and return focus.
 */

const FORM_FIELD = 'input, select, textarea';

/**
 * onMouseDown for buttons: the click does not move focus onto the button, and
 * leaves any form field, so Space and the arrows go back to play/pause and step.
 */
export function keepFocusOnMouse(e: ReactMouseEvent): void {
  e.preventDefault();
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(FORM_FIELD)) active.blur();
}

/**
 * True when a click came from the keyboard (Enter or Space) or assistive
 * technology rather than a pointer. Pointer clicks carry a click count.
 */
export function isKeyboardClick(e: { detail: number }): boolean {
  return e.detail === 0;
}

/**
 * onClick for a field's text label ("Speed", "From measure", ...). Chrome and
 * Edge focus the labelled slider or list when its label is clicked (without
 * opening the list), which would take Space and the arrows away from the
 * shortcuts. A pointer click on the label therefore does nothing; a click
 * from assistive technology keeps the usual label behaviour.
 */
export function keepFocusOffFromLabel(e: ReactMouseEvent): void {
  if (isKeyboardClick(e)) return;
  e.preventDefault();
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(FORM_FIELD)) active.blur();
}

/** The practice shortcut keys (shortcuts.ts): Space, ← → and Home. */
const SHORTCUT_KEYS: ReadonlySet<string> = new Set([' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'Home']);

/** Key presses a pointer-focused list let go of, so they work as practice shortcuts. */
const handedOver = new WeakSet<object>();

/**
 * True when a list that only had focus because it was clicked (and was then
 * closed without a new choice) let go of this key press: the press is a
 * practice shortcut although its target is the list.
 */
export function handedToShortcuts(e: object): boolean {
  return handedOver.has(e);
}

export interface PointerRelease {
  /**
   * Spread on the control (select) or on its label or wrapper (radio,
   * checkbox). A pointer press marks the next change as pointer-made; a key
   * press, or focus leaving the zone, clears the mark.
   *
   * A select clicked open and then closed without a new choice (Esc, a click
   * outside, or the item already chosen) fires no change and keeps focus. It
   * is still marked, so a practice shortcut key pressed next is handed back to
   * the page: the select lets go of focus and the key plays or steps. Any other
   * key (Tab, ↑/↓) is the user taking up the list with the keyboard, which
   * keeps it.
   */
  readonly zone: {
    onPointerDown: () => void;
    onMouseDown: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
    onBlur: (e: ReactFocusEvent<HTMLElement>) => void;
  };
  /**
   * Call from the control's onClick (radio, checkbox: a label click focuses
   * the input before its click event) or onChange (select). Drops focus from
   * the control when a pointer made the change.
   */
  release: (el: HTMLElement) => void;
}

/**
 * Radios, checkboxes and selects: blur after a pointer-made choice, keep focus
 * after keyboard use. Use one per select (a press on one list must not be
 * cleared by the other list losing focus).
 */
export function usePointerRelease(): PointerRelease {
  const pointer = useRef(false);
  return useMemo(() => {
    const mark = (): void => {
      pointer.current = true;
    };
    return {
      zone: {
        onPointerDown: mark,
        onMouseDown: mark,
        onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
          const marked = pointer.current;
          pointer.current = false;
          const el = e.target;
          if (
            marked &&
            el instanceof HTMLSelectElement &&
            document.activeElement === el &&
            SHORTCUT_KEYS.has(e.key) &&
            !e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey
          ) {
            el.blur();
            handedOver.add(e.nativeEvent);
          }
        },
        onBlur: (e: ReactFocusEvent<HTMLElement>) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node && e.currentTarget.contains(next))) pointer.current = false;
        },
      },
      release: (el: HTMLElement) => {
        if (!pointer.current) return;
        pointer.current = false;
        if (document.activeElement === el) el.blur();
      },
    };
  }, []);
}

/**
 * onPointerDown for sliders: once the pointer is released (anywhere, as a drag
 * may end outside the slider), focus leaves the slider. The arrow keys then
 * step again instead of nudging the value; a slider reached with Tab keeps
 * its arrow keys.
 */
export function releaseAfterDrag(e: { currentTarget: HTMLElement }): void {
  const el = e.currentTarget;
  const done = (): void => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    window.removeEventListener('mouseup', done, true);
    setTimeout(() => {
      if (document.activeElement === el) el.blur();
    }, 0);
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
  window.addEventListener('mouseup', done, true);
}
