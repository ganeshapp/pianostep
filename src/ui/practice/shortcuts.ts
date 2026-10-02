import { useEffect, useRef } from 'react';
import { handedToShortcuts } from '../common/pointerFocus';

export type ShortcutAction = 'toggle' | 'prev' | 'next' | 'restart';

export interface ShortcutKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
  defaultPrevented?: boolean;
}

const KEYS: Readonly<Record<string, ShortcutAction>> = {
  ' ': 'toggle',
  Spacebar: 'toggle',
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Home: 'restart',
};

/**
 * Space already activates these, so it must not also play/pause. A measure
 * menu opened with the mouse has focus on the menu itself, and no shortcut
 * applies while it is open (its arrows are owned below). The More panel is a
 * disclosure, not a menu, so the shortcuts keep working while it is open.
 */
const SPACE_ACTIVATES =
  'button, a[href], summary, [role="button"], [role="menu"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"]';

/** Arrow keys and Home already mean something inside these widgets. */
const ARROWS_OWNED = '[role="radiogroup"], [role="menu"], [role="listbox"], [role="slider"], [role="tablist"], [role="grid"]';

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function isTextEntry(el: Element): boolean {
  if (el.closest('input, select, textarea')) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function dialogOpen(doc: Document): boolean {
  return doc.querySelector('dialog[open], [aria-modal="true"]') !== null;
}

/**
 * The practice shortcut for a key press, or null when the key belongs to
 * whatever has focus (a form field, a dialog, a menu, a focused button).
 */
export function shortcutFor(e: ShortcutKeyEvent, doc: Document): ShortcutAction | null {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return null;
  const action = KEYS[e.key];
  if (!action) return null;
  if (dialogOpen(doc)) return null;
  // A list that only had focus from a mouse click let go of this key (pointerFocus.ts).
  if (handedToShortcuts(e)) return action;
  const el = asElement(e.target);
  if (el) {
    if (isTextEntry(el)) return null;
    if (el.closest('dialog, [role="dialog"], [role="alertdialog"]')) return null;
    if (action === 'toggle' && el.closest(SPACE_ACTIVATES)) return null;
    if (action !== 'toggle' && el.closest(ARROWS_OWNED)) return null;
  }
  return action;
}

export type ShortcutHandlers = Record<ShortcutAction, () => void>;

/** Space, ←/→ and Home for the practice page. */
export function usePracticeShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat && e.key === ' ') return;
      const action = shortcutFor(e, document);
      if (!action) return;
      e.preventDefault();
      ref.current[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
