import type { PracticeMode } from '../../core/types';
import type { SessionSnapshot } from '../../engine/session';
import { MODE_NOTES, statusMessage } from './text';

export function ModeNote({ mode }: { mode: PracticeMode }) {
  return <p className="ps-mode-note">{MODE_NOTES[mode]}</p>;
}

export function StatusLine({ snapshot }: { snapshot: SessionSnapshot }) {
  const { stepIndex, stepCount, measureLabel, midiInputConnected, midiInputName, midiInputNotFound, midiState } =
    snapshot;
  const parts: string[] = [];
  parts.push(stepCount > 0 ? `Step ${stepIndex + 1} of ${stepCount}` : 'No steps to play');
  if (stepCount > 0 && measureLabel) parts.push(`Measure ${measureLabel}`);
  if (midiInputConnected) parts.push(`MIDI: ${midiInputName ?? 'piano'} connected`);
  // A piano remembered from an earlier visit that is still off was not found,
  // as the notice under the controls says; it was never disconnected.
  else if (midiState === 'ready' && midiInputNotFound) parts.push('MIDI: no piano found');
  else if (midiState === 'ready' && midiInputName) parts.push(`MIDI: ${midiInputName} disconnected`);

  const msg = statusMessage(snapshot);
  return (
    <div className="ps-status">
      <p className="ps-status__facts">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && (
              <span className="ps-status__sep" aria-hidden="true">
                ·
              </span>
            )}
            {p}
          </span>
        ))}
      </p>
      <p className={`ps-status__msg ps-status__msg--${msg?.tone ?? 'normal'}`} aria-live="polite">
        {msg?.text ?? ''}
      </p>
    </div>
  );
}
