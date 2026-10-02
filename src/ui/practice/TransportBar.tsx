import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { PassageTime, SessionSnapshot } from '../../engine/session';
import { useFocusHandoff } from '../common/focusHandoff';
import { keepFocusOnMouse } from '../common/pointerFocus';
import { IconNext, IconPause, IconPlay, IconPrev, IconRestart, IconStop } from './Icons';
import { MODE_NOTES, passageTimeText, statusMessage } from './text';

/** What the transport buttons do (the practice page adds its own steps around the session's). */
export interface TransportActions {
  togglePlay(): void;
  restart(): void;
  prev(): void;
  next(): void;
  stop(): void;
}

export interface TransportBarProps {
  snapshot: SessionSnapshot;
  actions: TransportActions;
  /** Listen / Steady: elapsed and total passage time; null in Follow me. Read every frame while playing. */
  getPassageTime: () => PassageTime | null;
}

function TransportButton({
  label,
  onClick,
  disabled = false,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Next at the last step, Previous at the first, Stop once stopped: keyboard
  // focus goes to Play (never disabled) instead of the page body.
  useFocusHandoff(ref, disabled, () =>
    ref.current?.closest('.ps-transport')?.querySelector<HTMLButtonElement>('.ps-transport__btn--primary'),
  );
  return (
    <button
      ref={ref}
      type="button"
      className={`ps-transport__btn${primary ? ' ps-transport__btn--primary' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={keepFocusOnMouse}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * "0:07 / 4:22". While playing it is redrawn every animation frame straight
 * into the DOM (like the timeline's strip), so React does not re-render the
 * page for the clock.
 */
function PassageClock({ read, running }: { read: () => PassageTime | null; running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = passageTimeText(read()) ?? '';
  });
  useEffect(() => {
    if (!running) return undefined;
    let frame = 0;
    const tick = (): void => {
      const el = ref.current;
      const text = passageTimeText(read()) ?? '';
      if (el && el.textContent !== text) el.textContent = text;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [read, running]);
  return (
    <span className="ps-transport__time">
      <span className="visually-hidden">Time: </span>
      <span ref={ref} className="ps-transport__clock" />
    </span>
  );
}

/** The MIDI part of the facts line; it agrees with the notice under the settings. */
function midiFact(s: SessionSnapshot): string | null {
  if (s.midiInputConnected) return `MIDI: ${s.midiInputName ?? 'piano'} connected`;
  // A piano remembered from an earlier visit that is still off was not found;
  // it was never disconnected.
  if (s.midiState === 'ready' && s.midiInputNotFound) return 'MIDI: no piano found';
  if (s.midiState === 'ready' && s.midiInputName) return `MIDI: ${s.midiInputName} disconnected`;
  return null;
}

/**
 * Directly under the notes: Restart, Previous, a large Play/Pause, Next and
 * Stop; the passage time (Listen, Steady steps) and the step count; and one
 * line that is either the current message (Follow me's "Waiting for…",
 * "Not expected…", count-in, finish, sound) or the mode's short note.
 */
export function TransportBar({ snapshot, actions, getPassageTime }: TransportBarProps) {
  const { status, stepIndex, stepCount, measureLabel, settings } = snapshot;
  const running = status === 'playing' || status === 'count-in' || status === 'waiting';
  const follow = settings.mode === 'follow';
  const playLabel = running ? 'Pause' : follow ? 'Start Follow me' : 'Play';

  const facts: ReactNode[] = [];
  if (!follow) facts.push(<PassageClock key="time" read={getPassageTime} running={status === 'playing' || status === 'count-in'} />);
  facts.push(
    <span key="step" className="ps-transport__step">
      {stepCount > 0 ? `Step ${stepIndex + 1} of ${stepCount}` : 'No steps to play'}
    </span>,
  );
  if (stepCount > 0 && measureLabel) facts.push(<span key="measure">{`Measure ${measureLabel}`}</span>);
  const midi = midiFact(snapshot);
  if (midi) facts.push(<span key="midi" className="ps-transport__midi">{midi}</span>);

  const msg = statusMessage(snapshot);
  return (
    <div className="ps-transport-bar">
      <div className="ps-transport" role="group" aria-label="Playback">
        <TransportButton label="Restart" onClick={actions.restart} disabled={stepCount === 0}>
          <IconRestart />
        </TransportButton>
        <TransportButton label="Previous step" onClick={actions.prev} disabled={stepCount === 0 || stepIndex <= 0}>
          <IconPrev />
        </TransportButton>
        <TransportButton label={playLabel} onClick={actions.togglePlay} primary>
          {running ? <IconPause /> : <IconPlay />}
        </TransportButton>
        <TransportButton label="Next step" onClick={actions.next} disabled={stepCount === 0 || stepIndex >= stepCount - 1}>
          <IconNext />
        </TransportButton>
        <TransportButton label="Stop" onClick={actions.stop} disabled={status === 'stopped' && stepIndex === 0}>
          <IconStop />
        </TransportButton>
      </div>

      <div className="ps-transport__info">
        <p className="ps-status__facts">
          {facts.map((f, i) => (
            <span key={i} className="ps-status__fact">
              {i > 0 && (
                <span className="ps-status__sep" aria-hidden="true">
                  ·
                </span>
              )}
              {f}
            </span>
          ))}
        </p>
        <div className="ps-transport__line">
          <p className={`ps-status__msg ps-status__msg--${msg?.tone ?? 'normal'}`} aria-live="polite">
            {msg?.text ?? ''}
          </p>
          {!msg && <p className="ps-mode-note">{MODE_NOTES[settings.mode]}</p>}
        </div>
      </div>
    </div>
  );
}
