/**
 * What happens to the page when practice starts: the settings fold away and
 * the practice area (notes, transport, keyboard) is brought into view.
 */
import type { SessionSnapshot, SessionStatus } from '../../engine/session';

/** Playing, counting in, or Follow me waiting for keys. */
export function isRunning(status: SessionStatus): boolean {
  return status === 'playing' || status === 'count-in' || status === 'waiting';
}

/**
 * Whether Play would start playback or Follow me now. Not when the passage
 * has nothing for the chosen hands, or when Follow me has no piano: then the
 * session only explains why, and the settings that fix it stay in view.
 */
export function playWillStart(s: Pick<SessionSnapshot, 'status' | 'stepCount' | 'settings' | 'midiInputConnected'>): boolean {
  if (isRunning(s.status) || s.stepCount === 0) return false;
  return s.settings.mode !== 'follow' || s.midiInputConnected;
}

/**
 * How far to scroll the page down when practice starts, so that the whole
 * practice area (notes, transport, keyboard) is in view: just enough to show
 * its bottom, never past its top (the notes stay whole), and never up. Zero
 * when it already fits or the learner has scrolled past its top.
 */
export function revealScroll(area: { top: number; bottom: number }, viewportHeight: number, margin = 8): number {
  if (!(viewportHeight > 0)) return 0;
  const below = area.bottom + margin - viewportHeight;
  if (!(below > 0)) return 0;
  return Math.max(0, Math.min(below, area.top - margin));
}

