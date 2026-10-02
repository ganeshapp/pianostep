import type { VoiceOwner } from '../../audio/sampler';

/** What a key click needs from the browser sampler (`services.sampler`). */
export interface AuditionSampler {
  readonly currentTime: number;
  ensureStarted(): Promise<void>;
  noteOn(midi: number, velocity?: number, when?: number, owner?: VoiceOwner): void;
  noteOff(midi: number, when?: number, owner?: VoiceOwner): void;
}

/** A clicked key sounds at least this long, so a quick tap is still heard. */
export const AUDITION_MIN_SEC = 0.25;
export const AUDITION_VELOCITY = 80;
const OWNER: VoiceOwner = 'audition';

interface Held {
  /** Audio time the note started; null until browser sound has started. */
  startedAt: number | null;
  released: boolean;
}

/**
 * "Click a key to hear it": a key on the on-screen keyboard sounds through
 * the browser sampler while it is held down (at least AUDITION_MIN_SEC).
 *
 * It is the learner's explicit request, so it sounds whether or not Sound is
 * on. It goes straight to the sampler, as its own voice owner: it is never
 * MIDI input, never reaches Follow me, the step position or the MIDI output,
 * and a strike or release by playback never cuts it (nor it playback).
 */
export class KeyAudition {
  private readonly sampler: AuditionSampler;
  private readonly held = new Map<number, Held>();

  constructor(sampler: AuditionSampler) {
    this.sampler = sampler;
  }

  /**
   * Call from the gesture itself (pointerdown, keydown): browsers only let
   * sound start inside a user gesture, and ensureStarted() is called before
   * anything is awaited. A key already sounding is not struck again (key
   * repeat, a second pointer).
   */
  press(midi: number): void {
    const before = this.held.get(midi);
    if (before && !before.released) return;
    // A tap let go before sound had started is replaced by this press.
    const entry: Held = { startedAt: null, released: false };
    this.held.set(midi, entry);
    let started: Promise<void>;
    try {
      started = this.sampler.ensureStarted();
    } catch (e) {
      started = Promise.reject(e);
    }
    started.then(
      () => {
        if (this.held.get(midi) !== entry) return;
        const t = this.sampler.currentTime;
        this.sampler.noteOn(midi, AUDITION_VELOCITY, t, OWNER);
        entry.startedAt = t;
        if (entry.released) this.finish(midi, entry);
      },
      () => {
        // No browser sound: nothing to hear, nothing to release.
        if (this.held.get(midi) === entry) this.held.delete(midi);
      },
    );
  }

  /** The key was let go (pointer up or leave, key up, blur). */
  release(midi: number): void {
    const entry = this.held.get(midi);
    if (!entry || entry.released) return;
    entry.released = true;
    if (entry.startedAt !== null) this.finish(midi, entry);
  }

  /** Lets go of every clicked key (the keyboard goes away). */
  releaseAll(): void {
    for (const midi of [...this.held.keys()]) this.release(midi);
  }

  /** Keys currently held down by the learner on screen (for tests and diagnostics). */
  get keysDown(): number[] {
    return [...this.held.entries()].filter(([, h]) => !h.released).map(([k]) => k);
  }

  private finish(midi: number, entry: Held): void {
    this.held.delete(midi);
    const start = entry.startedAt ?? this.sampler.currentTime;
    this.sampler.noteOff(midi, Math.max(this.sampler.currentTime, start + AUDITION_MIN_SEC), OWNER);
  }
}
