import { useEffect, useId, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { isKeyboardClick, keepFocusOnMouse, usePointerRelease } from '../common/pointerFocus';
import { IconPiano } from './Icons';
import type { MidiConnection } from './midiConnection';

/**
 * Keyboard use of Connect piano, Try again or Dismiss can remove the control
 * that had focus (the button becomes the piano chip or list, the notice goes
 * away). Focus then moves to the piano control: the list when the learner has
 * to choose, else the Connect piano button or the chip. Pointer use never
 * moves focus (pointerFocus.ts).
 */
function useFocusRecovery(
  conn: MidiConnection,
  target: () => HTMLElement | null,
): void {
  const { focusFrom, focusSettled, phase } = conn;

  // The learner moved on (Tab, a click): nothing to restore.
  useEffect(() => {
    if (!focusFrom) return undefined;
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target !== focusFrom) focusSettled();
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', focusSettled);
    document.addEventListener('mousedown', focusSettled);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', focusSettled);
      document.removeEventListener('mousedown', focusSettled);
    };
  }, [focusFrom, focusSettled]);

  // After every update: once connecting has finished, focus that was lost goes
  // back to the activated control if it is still there, else to the piano control.
  useEffect(() => {
    if (!focusFrom || phase === 'requesting') return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const usable =
      focusFrom.isConnected && !(focusFrom instanceof HTMLButtonElement && focusFrom.disabled) ? focusFrom : null;
    (usable ?? target())?.focus();
    focusSettled();
  });
}

/** The Connect piano control in the controls bar. */
export function ConnectPiano({ conn }: { conn: MidiConnection }) {
  const id = useId();
  const pointer = usePointerRelease();
  const selectRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const { phase, inputs, selectedInputId } = conn;

  useFocusRecovery(conn, () => selectRef.current ?? buttonRef.current ?? chipRef.current);

  if (phase === 'connected' || phase === 'choose' || phase === 'disconnected') {
    const live = inputs.filter((i) => i.connected);
    const selected = inputs.find((i) => i.id === selectedInputId) ?? null;
    const dotClass =
      phase === 'connected' ? 'ps-dot ps-dot--on' : phase === 'choose' ? 'ps-dot ps-dot--wait' : 'ps-dot ps-dot--off';
    const dotLabel =
      phase === 'connected' ? 'Connected' : phase === 'choose' ? 'Choose a piano' : 'Disconnected';

    // Several inputs, or the chosen piano is gone while another device is
    // connected (it may be the same piano back under a new name): offer the list.
    if (live.length > 1 || phase === 'choose' || (phase === 'disconnected' && live.length > 0)) {
      return (
        <div className="ps-midi">
          <span className={dotClass} role="img" aria-label={dotLabel} />
          <label className="visually-hidden" htmlFor={`${id}-input`}>
            Your piano
          </label>
          <select
            ref={selectRef}
            id={`${id}-input`}
            className="ps-select ps-midi__select"
            value={selected?.id ?? ''}
            {...pointer.zone}
            onChange={(e) => {
              if (e.target.value) conn.selectInput(e.target.value);
              pointer.release(e.currentTarget);
            }}
          >
            {selected === null && (
              <option value="" disabled>
                Choose your piano…
              </option>
            )}
            {inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.connected ? i.name : `${i.name} (disconnected)`}
              </option>
            ))}
          </select>
        </div>
      );
    }

    const name = selected?.name ?? 'Piano';
    return (
      <div className="ps-midi">
        {/* Focusable only from code, so keyboard focus has somewhere to land when Connect piano goes away. */}
        <span
          ref={chipRef}
          className="ps-midi__chip"
          role="group"
          tabIndex={-1}
          aria-label={`Your piano: ${name}, ${dotLabel.toLowerCase()}`}
          title={phase === 'connected' ? 'Your piano is connected' : 'Your piano is disconnected'}
        >
          <span className={dotClass} role="img" aria-label={dotLabel} />
          <span className="ps-midi__name">{name}</span>
          {phase === 'disconnected' && (
            <span className="ps-midi__state" aria-hidden="true">
              disconnected
            </span>
          )}
        </span>
      </div>
    );
  }

  const busy = phase === 'requesting';
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ps-btn ps-btn--connect"
        onMouseDown={keepFocusOnMouse}
        onClick={(e) => {
          if (isKeyboardClick(e)) conn.keepFocusFrom(e.currentTarget);
          conn.connect();
        }}
        disabled={busy}
        aria-describedby={`${id}-hint`}
      >
        <IconPiano />
        <span>{busy ? 'Connecting…' : 'Connect piano'}</span>
      </button>
      <span id={`${id}-hint`} className="visually-hidden">
        Connect a digital piano by MIDI to use Follow me and see the keys you press.
      </span>
    </>
  );
}

/** One-line explanation under the controls when connecting needs attention. */
export function MidiNotice({ conn }: { conn: MidiConnection }) {
  const notice = conn.notice;
  if (!notice) return null;
  const fromKeyboard = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    if (isKeyboardClick(e)) conn.keepFocusFrom(e.currentTarget);
  };
  return (
    <div className="ps-notice" role="status">
      <span className="ps-notice__text">{notice.text}</span>
      <span className="ps-notice__actions">
        {notice.canRetry && (
          <button
            type="button"
            className="ps-btn ps-btn--small"
            onMouseDown={keepFocusOnMouse}
            onClick={(e) => {
              fromKeyboard(e);
              conn.connect();
            }}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          className="ps-btn ps-btn--small ps-btn--quiet"
          onMouseDown={keepFocusOnMouse}
          onClick={(e) => {
            fromKeyboard(e);
            conn.dismissNotice();
          }}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
