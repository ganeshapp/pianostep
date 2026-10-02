import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react';
import { keepFocusOnMouse } from './pointerFocus';

export interface PopoverProps {
  /** Accessible name of the trigger button (e.g. "About this difficulty rating"). */
  label: string;
  /** Visible trigger content; defaults to the label. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Accessible name of the panel; defaults to the label. */
  panelLabel?: string;
  /** Preferred horizontal alignment; flips automatically if it would overflow the window. */
  align?: 'start' | 'end';
  children: ReactNode;
}

const EDGE = 8;

/**
 * A disclosure button with a small floating panel. Non-modal: the panel sits
 * right after the trigger in tab order, so links inside it are reachable.
 * Esc or a click outside closes it; Esc returns focus to the trigger.
 */
export function Popover({ label, trigger, triggerClassName = 'icon-btn', panelLabel, align = 'start', children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'start' | 'end'>(align);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Measured once per opening (flipping only once avoids oscillating when neither side fits).
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (align === 'start' && rect.right > window.innerWidth - EDGE) setSide('end');
    else if (align === 'end' && rect.left < EDGE) setSide('start');
    else setSide(align);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!anchorRef.current || !(e.target instanceof Node) || anchorRef.current.contains(e.target)) return;
      setOpen(false);
      // A click that only dismisses the popover must not also follow a link
      // underneath it (e.g. open the piece whose card was clicked).
      const swallowLinkClick = (ev: MouseEvent) => {
        if (ev.target instanceof Element && ev.target.closest('a[href]')) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      };
      document.addEventListener('click', swallowLinkClick, true);
      document.addEventListener(
        'pointerup',
        () => setTimeout(() => document.removeEventListener('click', swallowLinkClick, true), 0),
        { once: true, capture: true },
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't let Esc also close a surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      const focusWasInside = anchorRef.current?.contains(document.activeElement) ?? false;
      if (focusWasInside) buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const onBlur = (e: ReactFocusEvent<HTMLSpanElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && anchorRef.current && !anchorRef.current.contains(next)) setOpen(false);
  };

  return (
    <span ref={anchorRef} className="popover-anchor" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={trigger === undefined ? undefined : label}
        // A mouse click leaves focus where it was (on the practice page a focused
        // trigger would take Space from play/pause and reopen the panel).
        onMouseDown={keepFocusOnMouse}
        onClick={() => {
          setSide(align);
          setOpen((v) => !v);
        }}
      >
        {trigger ?? label}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={panelLabel ?? label}
          className={`popover${side === 'end' ? ' popover-end' : ''}`}
        >
          {children}
        </div>
      )}
    </span>
  );
}
