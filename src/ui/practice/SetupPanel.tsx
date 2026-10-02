import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { keepFocusOnMouse } from '../common/pointerFocus';

export interface SetupPanelProps {
  /** The settings are shown; otherwise only the one-line summary is. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** One line describing the settings, shown while they are folded away. */
  summary: string;
  children: ReactNode;
}

/**
 * The practice settings, which fold into one summary line ("Listen · Both
 * hands · 1× · Measures 1–78 · Repeat off") so the notes, transport and
 * keyboard have the screen while practising. "Adjust settings" opens them
 * again at any time.
 *
 * Keyboard focus inside the settings when they fold away (Space pressed on a
 * focused slider starts playback, which folds them) goes to the toggle, never
 * to the page body.
 */
export function SetupPanel({ expanded, onExpandedChange, summary, children }: SetupPanelProps) {
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Read before the update is committed: once hidden, browsers drop the focus.
  const panel = panelRef.current;
  const hadFocus = panel !== null && typeof document !== 'undefined' && panel.contains(document.activeElement);
  useLayoutEffect(() => {
    if (expanded || !hadFocus) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !panelRef.current?.contains(active)) return;
    toggleRef.current?.focus({ preventScroll: true });
  });

  return (
    <section className={`ps-setup${expanded ? ' is-open' : ' is-folded'}`} aria-label="Practice settings">
      <div className="ps-setup__bar">
        {expanded ? (
          <h2 className="ps-setup__title">Practice settings</h2>
        ) : (
          <p className="ps-setup__summary" title={summary}>
            {summary}
          </p>
        )}
        <button
          ref={toggleRef}
          type="button"
          className="ps-btn ps-btn--small ps-setup__toggle"
          aria-expanded={expanded}
          aria-controls={`${id}-panel`}
          onMouseDown={keepFocusOnMouse}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? 'Hide settings' : 'Adjust settings'}
        </button>
      </div>
      <div id={`${id}-panel`} ref={panelRef} className="ps-setup__panel" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
