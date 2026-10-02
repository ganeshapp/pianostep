/**
 * Test doubles for the practice engine: a sampler with a controllable clock
 * that records every call and models voices like the real one, a MIDI
 * manager that can emit input and connection changes and records sends, and
 * a fake interval timer that drives both clocks together.
 */
import type { AudioState, VoiceOwner } from '../../src/audio/sampler';
import type { MidiState } from '../../src/midi/manager';
import type { MidiInputEvent } from '../../src/core/types';
import type { MidiLike, SamplerLike } from '../../src/engine/session';

/* ------------------------------------------------------------------------ */
/* Sampler                                                                   */
/* ------------------------------------------------------------------------ */

export type SamplerCall =
  | { kind: 'noteOn'; midi: number; velocity: number; when: number; now: number; owner: VoiceOwner }
  | { kind: 'noteOff'; midi: number; when: number; now: number; owner: VoiceOwner }
  | { kind: 'allNotesOff'; now: number }
  | { kind: 'click'; when: number; accent: boolean; now: number };

export interface FakeVoice {
  midi: number;
  /** The app's playback or the learner's monitored input; each only ends its own voices. */
  owner: VoiceOwner;
  start: number;
  /** Infinity while no release has been scheduled. */
  end: number;
  velocity: number;
}

/**
 * Voices follow the real sampler's rules: a note-off releases voices of
 * that key and owner that started strictly before it; a strike cuts an
 * earlier voice of the same key and owner; allNotesOff fades what sounds and
 * cancels what is scheduled, whoever started it.
 */
export class FakeSampler implements SamplerLike {
  state: AudioState = 'not-started';
  currentTime = 0;
  readonly calls: SamplerCall[] = [];
  readonly voices: FakeVoice[] = [];
  startCalls = 0;
  /** Make ensureStarted() reject, like a browser without Web Audio. */
  failStart = false;
  private readonly listeners = new Set<(s: AudioState) => void>();

  ensureStarted(): Promise<void> {
    this.startCalls++;
    if (this.failStart) {
      this.setState('error');
      return Promise.reject(new Error('Browser audio is not available'));
    }
    // Like the real sampler, a failed sample load is retried (and here succeeds).
    if (this.state === 'not-started' || this.state === 'error') this.setState('ready');
    return Promise.resolve();
  }

  onStateChange(fn: (s: AudioState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  setState(s: AudioState): void {
    if (s === this.state) return;
    this.state = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  noteOn(midi: number, velocity = 80, when?: number, owner: VoiceOwner = 'app'): void {
    const t = when ?? this.currentTime;
    this.calls.push({ kind: 'noteOn', midi, velocity, when: t, now: this.currentTime, owner });
    let nextStrike = Infinity;
    for (const v of this.voices) {
      if (v.midi !== midi || v.owner !== owner) continue;
      if (v.start > t) nextStrike = Math.min(nextStrike, v.start);
      else if (v.end > t) v.end = t;
    }
    this.voices.push({ midi, owner, start: t, end: nextStrike, velocity });
  }

  noteOff(midi: number, when?: number, owner: VoiceOwner = 'app'): void {
    const t = when ?? this.currentTime;
    this.calls.push({ kind: 'noteOff', midi, when: t, now: this.currentTime, owner });
    for (const v of this.voices) {
      if (v.midi === midi && v.owner === owner && v.start < t && v.end > t) v.end = t;
    }
  }

  allNotesOff(): void {
    const now = this.currentTime;
    this.calls.push({ kind: 'allNotesOff', now });
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.start > now) this.voices.splice(i, 1);
      else if (v.end > now) v.end = now;
    }
  }

  click(when: number, accent = false): void {
    this.calls.push({ kind: 'click', when, accent, now: this.currentTime });
  }

  /* Queries ----------------------------------------------------------- */

  noteOns(): Extract<SamplerCall, { kind: 'noteOn' }>[] {
    return this.calls.filter((c): c is Extract<SamplerCall, { kind: 'noteOn' }> => c.kind === 'noteOn');
  }

  noteOffs(): Extract<SamplerCall, { kind: 'noteOff' }>[] {
    return this.calls.filter((c): c is Extract<SamplerCall, { kind: 'noteOff' }> => c.kind === 'noteOff');
  }

  clicks(): Extract<SamplerCall, { kind: 'click' }>[] {
    return this.calls.filter((c): c is Extract<SamplerCall, { kind: 'click' }> => c.kind === 'click');
  }

  allNotesOffCount(): number {
    return this.calls.filter((c) => c.kind === 'allNotesOff').length;
  }

  /** Keys sounding at clock time t, ascending. */
  soundingAt(t: number): number[] {
    const keys = new Set<number>();
    for (const v of this.voices) if (v.start <= t && t < v.end) keys.add(v.midi);
    return [...keys].sort((a, b) => a - b);
  }

  /** Voices that will never be released. */
  stuck(): FakeVoice[] {
    return this.voices.filter((v) => v.end === Infinity);
  }

  /** Calls recorded since the given index. */
  since(index: number): SamplerCall[] {
    return this.calls.slice(index);
  }
}

/* ------------------------------------------------------------------------ */
/* MIDI                                                                      */
/* ------------------------------------------------------------------------ */

export type MidiSend =
  | { kind: 'on'; midi: number; velocity: number; atMs: number | undefined; nowMs: number }
  | { kind: 'off'; midi: number; atMs: number | undefined; nowMs: number }
  | { kind: 'allNotesOff'; nowMs: number };

export class FakeMidi implements MidiLike {
  state: MidiState = 'ready';
  selectedInputId: string | null = 'piano-1';
  selectedOutputId: string | null = null;
  inputConnected = true;
  inputName = 'Test Piano';
  readonly sends: MidiSend[] = [];
  readonly selectOutputCalls: (string | null)[] = [];
  private readonly eventListeners = new Set<(ev: MidiInputEvent) => void>();
  private readonly changeListeners = new Set<() => void>();
  private time = 0;

  constructor(private readonly now: () => number = () => 0) {}

  inputs(): { id: string; name: string; connected: boolean }[] {
    if (this.selectedInputId === null) return [];
    return [{ id: this.selectedInputId, name: this.inputName, connected: this.inputConnected }];
  }

  onEvent(fn: (ev: MidiInputEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => {
      this.changeListeners.delete(fn);
    };
  }

  get listenerCount(): number {
    return this.eventListeners.size + this.changeListeners.size;
  }

  selectOutput(id: string | null): void {
    this.selectOutputCalls.push(id);
    if (id === this.selectedOutputId) return;
    this.selectedOutputId = id;
    this.emitChange();
  }

  sendNoteOn(midi: number, velocity: number, atMs?: number): void {
    this.sends.push({ kind: 'on', midi, velocity, atMs, nowMs: this.now() });
  }

  sendNoteOff(midi: number, atMs?: number): void {
    this.sends.push({ kind: 'off', midi, atMs, nowMs: this.now() });
  }

  allNotesOff(): void {
    this.sends.push({ kind: 'allNotesOff', nowMs: this.now() });
  }

  /* Test controls ----------------------------------------------------- */

  emit(ev: MidiInputEvent): void {
    for (const fn of [...this.eventListeners]) fn(ev);
  }

  press(midi: number, velocity = 64, channel = 1): void {
    this.emit({ type: 'noteon', midi, velocity, channel, time: this.tickTime() });
  }

  release(midi: number, channel = 1): void {
    this.emit({ type: 'noteoff', midi, channel, time: this.tickTime() });
  }

  pedal(down: boolean): void {
    this.emit({ type: 'sustain', down, value: down ? 127 : 0, channel: 1, time: this.tickTime() });
  }

  disconnect(): void {
    this.inputConnected = false;
    this.emitChange();
  }

  reconnect(): void {
    this.inputConnected = true;
    this.emitChange();
  }

  emitChange(): void {
    for (const fn of [...this.changeListeners]) fn();
  }

  private tickTime(): number {
    this.time = Math.max(this.time + 1, this.now());
    return this.time;
  }
}

/* ------------------------------------------------------------------------ */
/* Timers                                                                    */
/* ------------------------------------------------------------------------ */

interface FakeInterval {
  fn: () => void;
  every: number;
  next: number;
}

/**
 * Integer-millisecond fake time. The sampler's audio clock runs in step with
 * it but from a different origin, so domain conversions are exercised.
 */
export class FakeClock {
  ms: number;
  private readonly originMs: number;
  private readonly intervals = new Map<number, FakeInterval>();
  private nextId = 1;
  created = 0;
  cleared = 0;

  constructor(
    private readonly sampler: FakeSampler | null = null,
    startMs = 10_000,
    private readonly audioOriginSec = 2,
  ) {
    this.ms = startMs;
    this.originMs = startMs;
    this.syncAudio();
  }

  readonly nowMs = (): number => this.ms;

  readonly setInterval = (fn: () => void, every: number): unknown => {
    const id = this.nextId++;
    this.created++;
    this.intervals.set(id, { fn, every, next: this.ms + every });
    return id;
  };

  readonly clearInterval = (handle: unknown): void => {
    if (typeof handle === 'number' && this.intervals.delete(handle)) this.cleared++;
  };

  get activeIntervals(): number {
    return this.intervals.size;
  }

  /** Audio-clock seconds for the current fake time. */
  get audioNow(): number {
    return this.audioOriginSec + (this.ms - this.originMs) / 1000;
  }

  /** Moves time forward by `ms`, firing intervals at their due times. */
  advance(ms: number): void {
    const target = this.ms + ms;
    for (;;) {
      let due: FakeInterval | null = null;
      for (const iv of this.intervals.values()) {
        if (iv.next <= target && (!due || iv.next < due.next)) due = iv;
      }
      if (!due) break;
      this.ms = Math.max(this.ms, due.next);
      this.syncAudio();
      due.next += due.every;
      due.fn();
    }
    this.ms = target;
    this.syncAudio();
  }

  /**
   * Moves time forward by `ms` without firing any timer, as when the main
   * thread is busy. Overdue timers then fire once, late, at the next advance.
   */
  stall(ms: number): void {
    this.ms += ms;
    for (const iv of this.intervals.values()) if (iv.next < this.ms) iv.next = this.ms;
    this.syncAudio();
  }

  /** Advances until fake time reaches `audioSec` on the audio clock. */
  advanceToAudio(audioSec: number): void {
    const ms = Math.round((audioSec - this.audioNow) * 1000);
    if (ms > 0) this.advance(ms);
  }

  private syncAudio(): void {
    if (this.sampler) this.sampler.currentTime = this.audioNow;
  }
}
