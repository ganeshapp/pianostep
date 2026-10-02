import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a slider must rest before its value is handed to the session. A
 * timing change re-anchors playback (held notes are cut and struck again), so
 * a drag must not do that on every input event.
 */
export const SLIDER_SETTLE_MS = 150;

export interface SettledSlider {
  /** The value to show: the learner's latest choice, else the committed one. */
  value: number;
  /** onChange: show the value at once, commit it once the slider rests. */
  change: (value: number) => void;
  /** Commit a pending value now (the pointer was let go, or focus left the slider). */
  settle: () => void;
  /** Commit this value now, dropping any pending one (a Reset button). */
  set: (value: number) => void;
}

/**
 * A slider whose value follows the learner's drag at once but reaches the
 * session only when the drag rests for SLIDER_SETTLE_MS, or ends (pointer up,
 * blur). Five quick input events make one commit. A pending value is still
 * committed if the slider goes away (the mode changed mid-drag).
 */
export function useSettledSlider(
  committed: number,
  commit: (value: number) => void,
  delayMs: number = SLIDER_SETTLE_MS,
): SettledSlider {
  const [draft, setDraft] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  const cancelTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const settle = useCallback((): void => {
    cancelTimer();
    const v = pending.current;
    pending.current = null;
    // The session is updated first, so no render shows the old value again.
    if (v !== null) commitRef.current(v);
    setDraft(null);
  }, []);

  const change = useCallback(
    (value: number): void => {
      pending.current = value;
      setDraft(value);
      cancelTimer();
      timer.current = setTimeout(settle, delayMs);
    },
    [settle, delayMs],
  );

  const set = useCallback((value: number): void => {
    cancelTimer();
    pending.current = null;
    commitRef.current(value);
    setDraft(null);
  }, []);

  useEffect(
    () => () => {
      cancelTimer();
      const v = pending.current;
      pending.current = null;
      if (v !== null) commitRef.current(v);
    },
    [],
  );

  return { value: draft ?? committed, change, settle, set };
}

/**
 * onPointerDown for a settled slider: when the pointer is let go (anywhere on
 * the page, since a drag may end off the slider), commit at once.
 */
export function settleOnPointerUp(slider: Pick<SettledSlider, 'settle'>): void {
  const done = (): void => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    window.removeEventListener('mouseup', done, true);
    slider.settle();
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
  window.addEventListener('mouseup', done, true);
}
