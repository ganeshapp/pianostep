import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Buttons shown at the bottom (e.g. Cancel / Confirm). */
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large';
  /** Element to focus when the dialog opens; defaults to the close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 'alertdialog' for confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** Clicking outside the dialog closes it (default true). */
  closeOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function supportsModal(): boolean {
  return typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

/**
 * Modal dialog on the native <dialog> element: showModal() makes the rest of
 * the page inert and Esc closes it. Where showModal() is missing, the same
 * behaviour (focus trap, Esc, backdrop) is provided by hand.
 * Rendered only while open; focus returns to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'medium',
  initialFocusRef,
  role = 'dialog',
  closeOnBackdrop = true,
  className,
}: DialogProps) {
  if (!open) return null;
  return (
    <DialogOpen
      onClose={onClose}
      title={title}
      footer={footer}
      size={size}
      initialFocusRef={initialFocusRef}
      role={role}
      closeOnBackdrop={closeOnBackdrop}
      className={className}
    >
      {children}
    </DialogOpen>
  );
}

type OpenProps = Omit<DialogProps, 'open'> & Required<Pick<DialogProps, 'size' | 'role' | 'closeOnBackdrop'>>;

function DialogOpen({ onClose, title, children, footer, size, initialFocusRef, role, closeOnBackdrop, className }: OpenProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pressedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  const [fallback] = useState(() => !supportsModal());
  const titleId = useId();
  const bodyId = useId();

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!fallback) {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    const target = initialFocusRef?.current ?? closeRef.current;
    target?.focus();

    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
    // Runs once per opening; initialFocusRef is read at open time only.
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Esc on a native modal fires `cancel`; keep React in charge of closing.
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (!fallback) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = focusableIn(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // The dialog element itself only receives pointer events on its ::backdrop
  // (its content is wrapped in .dialog-frame), so press-and-release on it means "outside".
  const onMouseDown = (e: ReactMouseEvent<HTMLDialogElement>) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  };
  const onClick = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (closeOnBackdrop && pressedOnBackdrop.current && e.target === e.currentTarget) onCloseRef.current();
    pressedOnBackdrop.current = false;
  };

  const classes = ['dialog', size !== 'medium' ? `dialog-${size}` : '', fallback ? 'dialog-fallback' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {fallback && (
        <div
          className="dialog-backdrop-fallback"
          aria-hidden="true"
          onClick={() => {
            if (closeOnBackdrop) onCloseRef.current();
          }}
        />
      )}
      <dialog
        ref={ref}
        className={classes}
        role={role === 'alertdialog' ? 'alertdialog' : undefined}
        aria-modal={fallback ? true : undefined}
        aria-labelledby={titleId}
        aria-describedby={role === 'alertdialog' ? bodyId : undefined}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <div className="dialog-frame">
          <div className="dialog-header">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            <button ref={closeRef} type="button" className="icon-btn" onClick={() => onCloseRef.current()} aria-label="Close">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div id={bodyId} className="dialog-body">
            {children}
          </div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      </dialog>
    </>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Disables the buttons while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small "are you sure?" dialog. Focus starts on Cancel so Enter never confirms by accident. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      size="small"
      role="alertdialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
