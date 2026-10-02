import { useEffect, useId, useRef, useState } from 'react';
import type { MidiDeviceInfo } from '../../midi/manager';
import { isKeyboardClick, keepFocusOffFromLabel, keepFocusOnMouse, usePointerRelease } from '../common/pointerFocus';
import { IconMore } from './Icons';

export interface MoreMenuProps {
  monitorInput: boolean;
  onMonitorChange: (on: boolean) => void;
  /** MIDI is connected, so outputs can be listed. */
  midiReady: boolean;
  outputs: readonly MidiDeviceInfo[];
  outputId: string | null;
  onOutputChange: (id: string | null) => void;
  onOpenAbout: () => void;
}

/** The ⋯ More panel: input monitoring, MIDI output and the arrangement details. */
export function MoreMenu({
  monitorInput,
  onMonitorChange,
  midiReady,
  outputs,
  outputId,
  onOutputChange,
  onOpenAbout,
}: MoreMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Opened from the keyboard, so focus moves into the panel. A mouse click leaves focus alone. */
  const focusOnOpen = useRef(false);
  const monitorPointer = usePointerRelease();
  const outputPointer = usePointerRelease();

  useEffect(() => {
    if (!open) return undefined;
    if (focusOnOpen.current) panelRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Focus goes back to More only if it was in the panel; after opening
        // with the mouse it was never moved, so it stays where it was.
        const focusWasInside = panelRef.current?.contains(document.activeElement) ?? false;
        setOpen(false);
        if (focusWasInside) buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const outputKnown = outputId === null || outputs.some((o) => o.id === outputId);

  return (
    <div ref={rootRef} className="ps-more">
      <button
        ref={buttonRef}
        type="button"
        className="ps-btn ps-btn--icon-text"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onMouseDown={keepFocusOnMouse}
        onClick={(e) => {
          focusOnOpen.current = isKeyboardClick(e);
          setOpen((o) => !o);
        }}
      >
        <IconMore />
        <span>More</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          className="ps-more__panel"
          role="group"
          aria-label="More options"
          onBlur={(e) => {
            if (e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
          }}
        >
          <div className="ps-more__section">
            <label className="ps-switch" {...monitorPointer.zone}>
              <input
                type="checkbox"
                role="switch"
                checked={monitorInput}
                onChange={(e) => onMonitorChange(e.target.checked)}
                onClick={(e) => monitorPointer.release(e.currentTarget)}
                aria-describedby={`${id}-monitor-hint`}
              />
              <span className="ps-switch__track" aria-hidden="true" />
              <span>Hear my playing through the browser</span>
            </label>
            <p id={`${id}-monitor-hint`} className="ps-more__hint">
              Plays the keys you press on your piano through this computer. Leave it off if your piano makes its own
              sound.
            </p>
          </div>

          <div className="ps-more__section">
            <label className="ps-more__field" htmlFor={`${id}-output`} onClick={keepFocusOffFromLabel}>
              Play through connected piano
            </label>
            <select
              id={`${id}-output`}
              className="ps-select"
              value={outputKnown ? (outputId ?? '') : ''}
              disabled={!midiReady}
              aria-describedby={`${id}-output-hint`}
              {...outputPointer.zone}
              onChange={(e) => {
                onOutputChange(e.target.value === '' ? null : e.target.value);
                outputPointer.release(e.currentTarget);
              }}
            >
              <option value="">Off</option>
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <p id={`${id}-output-hint`} className="ps-more__hint">
              {midiReady
                ? 'Sends Listen and Steady steps playback to the piano you choose, so it plays the notes itself.'
                : 'Connect your piano first to choose where playback goes.'}
            </p>
          </div>

          <div className="ps-more__section ps-more__section--last">
            <button
              type="button"
              className="ps-more__item"
              onMouseDown={keepFocusOnMouse}
              onClick={(e) => {
                // From the keyboard, focus moves to More first: the panel (and
                // this button) closes in the same update that opens the dialog,
                // and the dialog returns focus to whatever had it when it opened.
                if (isKeyboardClick(e)) buttonRef.current?.focus();
                setOpen(false);
                onOpenAbout();
              }}
            >
              About this arrangement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
