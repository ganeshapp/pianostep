import { isOnPiano } from '../pitch';
import type { ActionStep, FollowStatus, MidiInputEvent, StepSequence } from '../types';

export interface FollowResult {
  /** True when this event completed the current step (the step index moved). */
  advanced: boolean;
  status: FollowStatus;
}

const ascending = (a: number, b: number): number => a - b;

/**
 * Follow-me state machine (ARCHITECTURE.md §4). Pure: no timers, no I/O.
 * Feed it only real MIDI input from the player, never app playback.
 *
 * Channels are merged: a key is identified by its MIDI number alone, so a
 * note-off on any channel releases a key pressed on any channel.
 */
export class FollowMatcher {
  private seq: StepSequence;
  private index = 0;
  /** Keys physically down right now (independent of the sustain pedal). */
  private readonly down = new Set<number>();
  /** Keys struck (note-on) since the current step began. */
  private readonly fresh = new Set<number>();
  private sustain = false;
  /**
   * True while the current step was entered by start() (the passage start, a
   * seek or a loop restart) rather than by completing the step before it.
   * Only then may the learner put down the keys the score already holds.
   */
  private entry = true;

  constructor(seq: StepSequence) {
    this.seq = seq;
    this.start(0);
  }

  /** Replaces the sequence and restarts at step 0. Physical keys and pedal are kept. */
  setSequence(seq: StepSequence): void {
    this.seq = seq;
    this.start(0);
  }

  /**
   * Makes `stepIndex` current (clamped to 0..steps.length), forgets fresh
   * presses and skips forward over release-only steps. Keys already down stay
   * down but do not count as new presses for the step.
   */
  start(stepIndex: number): void {
    const n = this.seq.steps.length;
    const i = Number.isFinite(stepIndex) ? Math.trunc(stepIndex) : 0;
    this.index = Math.min(Math.max(i, 0), n);
    this.fresh.clear();
    this.entry = true;
    this.skipReleaseOnly();
  }

  /**
   * Forgets every physically-down key and the pedal. Use when the input
   * device disconnects or changes, because its note-offs will never arrive.
   */
  resetPhysical(): void {
    this.down.clear();
    this.sustain = false;
  }

  handle(ev: MidiInputEvent): FollowResult {
    const before = this.index;
    if (ev.type === 'sustain') {
      this.sustain = ev.down;
    } else if (ev.type === 'noteon' && ev.velocity > 0) {
      this.press(ev.midi);
      this.tryComplete();
    } else {
      this.down.delete(ev.midi);
      this.tryComplete();
    }
    return { advanced: this.index !== before, status: this.status() };
  }

  status(): FollowStatus {
    const n = this.seq.steps.length;
    if (this.index >= n) {
      return { stepIndex: n, expected: [], satisfied: [], wrong: [], finished: true };
    }
    const expected = this.expectedKeys();
    const status: FollowStatus = {
      stepIndex: this.index,
      expected,
      satisfied: expected.filter((k) => this.fresh.has(k) && this.down.has(k)),
      wrong: this.wrongKeys(expected),
      finished: false,
    };
    const beyond = this.unionOver(this.seq.steps[this.index].attacks).filter((k) => !isOnPiano(k));
    if (beyond.length > 0) status.beyondPiano = beyond;
    return status;
  }

  /** Index of the step waiting for input; equals `steps.length` once finished. */
  get currentStep(): number {
    return this.index;
  }

  get finished(): boolean {
    return this.index >= this.seq.steps.length;
  }

  get pedal(): boolean {
    return this.sustain;
  }

  /** Keys physically down, ascending. The sustain pedal never adds keys here. */
  get physicalDown(): number[] {
    return [...this.down].sort(ascending);
  }

  private press(midi: number): void {
    // A second note-on without a note-off is not a new physical strike
    // (duplicate message, or the same key arriving on another channel).
    if (this.down.has(midi)) return;
    this.down.add(midi);
    this.fresh.add(midi);
  }

  private tryComplete(): void {
    if (this.finished) return;
    const expected = this.expectedKeys();
    const allStruck = expected.every((k) => this.fresh.has(k) && this.down.has(k));
    if (!allStruck || this.wrongKeys(expected).length > 0) return;
    // The presses that completed this step are spent: a key still held now
    // must be struck again to satisfy a later repeated attack.
    this.fresh.clear();
    this.entry = false;
    this.index += 1;
    this.skipReleaseOnly();
  }

  /**
   * The forgiving mode does not check releases, so a step with nothing to
   * strike would otherwise wait forever. Skip it (and any that follow). A
   * step whose only notes lie beyond the 88 keys (A0-C8) has nothing that can
   * be struck either.
   */
  private skipReleaseOnly(): void {
    const steps = this.seq.steps;
    while (this.index < steps.length && this.isReleaseOnly(steps[this.index])) {
      this.index += 1;
    }
  }

  private isReleaseOnly(step: ActionStep): boolean {
    return step.releaseOnly || !this.unionOver(step.attacks).some(isOnPiano);
  }

  /** The step's attacks that a piano has keys for; notes beyond A0-C8 cannot be asked for. */
  private expectedKeys(): number[] {
    return this.unionOver(this.seq.steps[this.index].attacks).filter(isOnPiano);
  }

  /**
   * Down, struck since the step began, not expected and not part of the
   * score's held state. Keys held over from earlier steps are never wrong
   * (late holds are forgiven). Re-pressing a key the score keeps holding
   * through this step is fine, but re-striking a key this step lets go of
   * (the previous note or chord) is a mistake. Only on a step entered by
   * start() may every key the score already holds be put down, so the
   * learner can set up a passage that begins mid-hold.
   */
  private wrongKeys(expected: number[]): number[] {
    const step = this.seq.steps[this.index];
    const ok = new Set<number>(expected);
    for (const k of this.unionOver(this.entry ? step.heldBefore : step.heldAfter)) ok.add(k);
    // A key beyond the piano's range that a device can still send is not penalised.
    for (const k of this.unionOver(step.attacks)) ok.add(k);
    const wrong: number[] = [];
    for (const k of this.down) {
      if (this.fresh.has(k) && !ok.has(k)) wrong.push(k);
    }
    return wrong.sort(ascending);
  }

  private unionOver(perHand: ActionStep['attacks']): number[] {
    const keys = new Set<number>();
    for (const h of this.seq.hands) {
      for (const k of perHand[h] ?? []) keys.add(k);
    }
    return [...keys].sort(ascending);
  }
}
