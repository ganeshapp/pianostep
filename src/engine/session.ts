import { handsOf } from '../core/types';
import type {
  ActionStep,
  Hand,
  MidiInputEvent,
  PassageRange,
  PracticeSettings,
  PreparedScore,
  StepSequence,
} from '../core/types';
import type { AudioState, VoiceOwner } from '../audio/sampler';
import type { MidiState } from '../midi/manager';
import { deriveSteps } from '../core/actions/derive';
import {
  listenStepTimes,
  passageDurationListen,
  passageDurationSteady,
  steadyStepTimes,
} from '../core/actions/timing';
import { tempoAt } from '../core/model/tempo';
import { isOnPiano } from '../core/pitch';
import { FollowMatcher } from '../core/practice/follow';

export type SessionStatus = 'stopped' | 'count-in' | 'playing' | 'paused' | 'waiting' | 'finished';

export interface SessionSnapshot {
  status: SessionStatus;
  settings: PracticeSettings;
  sequence: StepSequence;
  /** Marker step (0..stepCount-1); 0 when stepCount === 0. */
  stepIndex: number;
  stepCount: number;
  /** Label of the marker step's measure occurrence, e.g. "12 (2nd time)". */
  measureLabel: string;
  /** heldAfter of the marker step for included hands ([] for excluded hands). */
  expected: Record<Hand, number[]>;
  /** attacks of the marker step ("press now"). */
  struck: Record<Hand, number[]>;
  /** Physical MIDI input state — never includes app playback. */
  physicalDown: number[];
  pedalDown: boolean;
  /** Follow me only. */
  wrong: number[];
  waitingFor: number[];
  countInRemaining: number | null;
  audioState: AudioState;
  midiState: MidiState;
  midiInputName: string | null;
  midiInputConnected: boolean;
  /**
   * MIDI is ready and the selected input is a piano remembered from an earlier
   * visit that has not turned up in this session (`MidiLike.inputSeen` is
   * false): it was not found, rather than disconnected. `midiInputName` is
   * then null.
   */
  midiInputNotFound: boolean;
  /** Plain-language transient message (e.g. "Piano disconnected — playback paused"). */
  message: string | null;
}

/** Listen / Steady: the marker's place in the passage and the passage length, in seconds. */
export interface PassageTime {
  elapsed: number;
  total: number;
}

export interface SamplerLike {
  readonly state: AudioState;
  readonly currentTime: number;
  ensureStarted(): Promise<void>;
  onStateChange(fn: (s: AudioState) => void): () => void;
  /**
   * `owner` (default 'app') keeps the learner's monitored notes ('input') and
   * the app's playback apart: a strike or release by one never ends the
   * other's voice on the same key.
   */
  noteOn(midi: number, velocity?: number, when?: number, owner?: VoiceOwner): void;
  noteOff(midi: number, when?: number, owner?: VoiceOwner): void;
  allNotesOff(fadeSec?: number): void;
  click(when: number, accent?: boolean): void;
}

export interface MidiLike {
  readonly state: MidiState;
  readonly selectedInputId: string | null;
  readonly selectedOutputId: string | null;
  readonly inputConnected: boolean;
  /**
   * False while the selected input has not been connected at all this
   * session (a piano remembered from an earlier visit that is still off): it
   * was not found rather than disconnected. Absent means unknown (seen).
   */
  readonly inputSeen?: boolean;
  inputs(): { id: string; name: string; connected: boolean }[];
  onEvent(fn: (ev: MidiInputEvent) => void): () => void;
  onChange(fn: () => void): () => void;
  /**
   * `rememberedName` is the saved output device's name, so the device is
   * found again if the browser lists it under another id.
   */
  selectOutput(id: string | null, rememberedName?: string | null): void;
  sendNoteOn(midi: number, velocity: number, atMs?: number): void;
  sendNoteOff(midi: number, atMs?: number): void;
  allNotesOff(): void;
}

/** Where the session listens for 'pagehide' (the window in the browser). */
export interface PageEventsLike {
  addEventListener(type: 'pagehide', fn: () => void): void;
  removeEventListener(type: 'pagehide', fn: () => void): void;
}

export interface SessionDeps {
  sampler: SamplerLike;
  midi: MidiLike;
  /** Injected for tests; default performance.now(). */
  nowMs?: () => number;
  /** Injected for tests; default window.setInterval / clearInterval. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /**
   * On 'pagehide' (reload, tab close, leaving the site) the session pauses and
   * releases every app-sent note, because Web MIDI sends no note-offs when the
   * page goes away. Default: `window` when present; null disables it.
   */
  pageEvents?: PageEventsLike | null;
  /**
   * Name of the output device saved with the learner's preferences, passed
   * on with the piece's saved output id so a device the browser now lists
   * under another id is still found (the id setting then follows it).
   */
  midiOutputName?: string | null;
}

/* ------------------------------------------------------------------------ */
/* Tunables                                                                  */
/* ------------------------------------------------------------------------ */

export const SCHEDULER_INTERVAL_MS = 25;
export const LOOKAHEAD_SEC = 0.15;
/**
 * MIDI output is handed over a much shorter time ahead than the browser
 * sampler. A message given to Web MIDI with a future timestamp can only be
 * withdrawn with MIDIOutput.clear(), which Chrome and Edge lack, so a long
 * lookahead would let stale notes sound after a pause or cut a restarted run.
 * One scheduler period plus slack for a late timer; below START_LEAD_SEC, so
 * anything still queued lands before a restarted run's first strike. That
 * first strike (with any re-struck held keys) is handed over at once, when the
 * run starts, so a busy main thread right after Play or a seek cannot delay
 * it; later messages tolerate a timer that is up to about 15-40 ms late.
 */
export const MIDI_LOOKAHEAD_SEC = 0.04;
/** Playback (and the first count-in click) starts this far after "now", so the first chord is never late. */
export const START_LEAD_SEC = 0.05;
export const PREVIEW_SEC = 0.5;
export const FOLLOW_LOOP_DELAY_MS = 1000;
export const COUNT_IN_BEATS = 4;
export const DEFAULT_PLAY_VELOCITY = 80;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2;
export const STEP_SECONDS_MIN = 0.3;
export const STEP_SECONDS_MAX = 4;

export const SESSION_MESSAGES = {
  disconnected: 'Piano disconnected — reconnect it to continue.',
  needPiano: 'Connect a digital piano by MIDI to use Follow me.',
  nothingToPlay: 'There is nothing to play in these measures.',
  noSound: 'Browser sound could not start, so playback is silent.',
  monitorNoSound: 'Browser sound could not start, so your playing is not heard. Click Play or a step button to try again.',
} as const;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

type ClockKind = 'audio' | 'wall';
type TimedMode = 'listen' | 'steady';

interface PlayEvent {
  /** Seconds from the passage start in the run's time base. */
  t: number;
  on: boolean;
  midi: number;
  velocity: number;
}

/** One continuous stretch of Listen / Steady playback mapped onto a clock. */
interface Run {
  clock: ClockKind;
  mode: TimedMode;
  speed: number;
  stepSeconds: number;
  times: readonly number[];
  duration: number;
  /** Clock time of passage time 0: an event at relative time t sounds at anchor + t. */
  anchor: number;
  startRel: number;
  startStep: number;
  /** Clock time when the music (re)starts, after the lead and any count-in. */
  startAt: number;
  events: PlayEvent[];
  /** Next event for the browser sampler (LOOKAHEAD_SEC ahead). */
  nextEvent: number;
  /** Next event for the MIDI output (MIDI_LOOKAHEAD_SEC ahead). */
  nextMidiEvent: number;
  clicks: number[];
  nextClick: number;
  /**
   * The following loop pass, scheduled ahead inside the lookahead so a loop
   * without count-in repeats with no gap. It takes over at its anchor.
   */
  next: Run | null;
}

interface Timeline {
  seq: StepSequence;
  mode: TimedMode;
  speed: number;
  stepSeconds: number;
  times: number[];
  duration: number;
}

const HAND_KEYS: readonly Hand[] = ['R', 'L'];
const EMPTY: number[] = [];
/** Tolerance for re-anchoring at a computed (not step-exact) position. */
const EPS = 1e-6;
/** Shortest monitored note, so a release never lands in the same instant as its strike. */
const MONITOR_MIN_SEC = 0.01;
/** A restarted run's first MIDI message comes at least this long after anything still queued. */
const MIDI_QUEUE_MARGIN_SEC = 0.005;
/** Loop passes shorter than this are not chained ahead (bounds the passes per lookahead). */
const MIN_CHAIN_SEC = SCHEDULER_INTERVAL_MS / 1000;
/**
 * When playback carries on from the current position rather than from a step
 * (re-anchoring after a speed, step-length, sound, output or input change, or
 * browser audio joining in), a held key is struck again only if it stays down
 * at least this long; otherwise it would be a click-short attack that is not
 * in the score. Starting or seeking at a step re-sounds every held key.
 */
const RESTRIKE_MIN_SEC = 0.03;

const ascending = (a: number, b: number): number => a - b;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(s: PracticeSettings): PracticeSettings {
  return {
    ...s,
    speed: clampNumber(s.speed, SPEED_MIN, SPEED_MAX, 1),
    stepSeconds: clampNumber(s.stepSeconds, STEP_SECONDS_MIN, STEP_SECONDS_MAX, 1),
  };
}

function sameRange(a: PassageRange | null, b: PassageRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startOcc === b.startOcc && a.endOcc === b.endOcc;
}

function sameSettings(a: PracticeSettings, b: PracticeSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof PracticeSettings)[]);
  for (const k of keys) {
    if (k === 'range') {
      if (!sameRange(a.range, b.range)) return false;
    } else if (!Object.is(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Largest i with times[i] <= rel; 0 when rel is before the first step (or there are none). */
function stepAt(times: readonly number[], rel: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= rel) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Fractional step position for smooth scrolling. Between two steps it moves
 * in proportion to elapsed time, so a long hold makes the marker dwell; after
 * the last step it stays there through any trailing rest. Before step 0 (a
 * passage that opens with a rest) it waits on column 0, as during a count-in:
 * that is the marker step the snapshot reports, so the marker never sits
 * over an empty column left of the first action.
 */
function positionAt(times: readonly number[], rel: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (rel < times[0]) return 0;
  const i = stepAt(times, rel);
  if (i >= n - 1) return n - 1;
  const span = times[i + 1] - times[i];
  return span > 0 ? i + Math.min(1, (rel - times[i]) / span) : i;
}

function unionOver(step: ActionStep, hands: readonly Hand[], field: 'attacks' | 'heldAfter'): number[] {
  const keys = new Set<number>();
  for (const h of hands) for (const k of step[field][h] ?? EMPTY) keys.add(k);
  return [...keys].sort(ascending);
}

const defaultNowMs = (): number => performance.now();
const defaultSetInterval = (fn: () => void, ms: number): unknown => globalThis.setInterval(fn, ms);
const defaultClearInterval = (handle: unknown): void =>
  globalThis.clearInterval(handle as Parameters<typeof globalThis.clearInterval>[0]);
const defaultPageEvents = (): PageEventsLike | null =>
  typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;

/* ------------------------------------------------------------------------ */
/* PracticeSession                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Owns the shared playback clock, scheduling and mode logic for one piece.
 * React reads it with subscribe/getSnapshot and polls getVisualPosition()
 * every animation frame; nothing here depends on rendering.
 */
export class PracticeSession {
  private readonly score: PreparedScore;
  private readonly sampler: SamplerLike;
  private readonly midi: MidiLike;
  private readonly nowMs: () => number;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;

  private settings: PracticeSettings;
  private seq: StepSequence;
  private stepOfTick = new Map<number, number>();
  private readonly occLabels = new Map<number, string>();
  private timelineCache: Timeline | null = null;
  private readonly matcher: FollowMatcher;

  private status: SessionStatus = 'stopped';
  private stepIndex = 0;
  private run: Run | null = null;
  private countInRemaining: number | null = null;
  /**
   * Paused (or the page hidden) during a count-in, before the music began:
   * the next play() counts in again, as from stopped.
   */
  private countInInterrupted = false;
  private waitingFor: number[] = EMPTY;
  private wrong: number[] = EMPTY;
  private message: string | null = null;
  private followRestartAt: number | null = null;

  private readonly physical = new Set<number>();
  private pedal = false;
  /** Monitored keys released while the pedal is down; they sound until the pedal lifts. */
  private readonly sustained = new Set<number>();
  /** Audio time each monitored key was struck. */
  private readonly monitorOnAt = new Map<number, number>();
  private previewKeys: number[] = EMPTY;
  /**
   * When the MIDI-output preview is released (nowMs domain). Its note-off is
   * sent when due rather than queued ahead, so it can never cut later playback.
   */
  private previewOffAtMs: number | null = null;
  /** Latest timestamp (nowMs domain) handed to the MIDI output; such messages cannot be withdrawn. */
  private midiQueuedUntilMs = -Infinity;

  private audioStarted = false;
  /** This session asked browser audio to start (startAudioQuietly) and it has not answered yet. */
  private audioPending = false;
  private lastInputConnected: boolean;
  private lastInputId: string | null;
  private midiInputName: string | null = null;

  private intervalHandle: unknown = null;
  private intervalActive = false;
  private playToken = 0;
  private depth = 0;
  private disposed = false;
  private unsubscribers: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: SessionSnapshot;

  constructor(score: PreparedScore, settings: PracticeSettings, deps: SessionDeps) {
    this.score = score;
    this.sampler = deps.sampler;
    this.midi = deps.midi;
    this.nowMs = deps.nowMs ?? defaultNowMs;
    this.setIntervalFn = deps.setInterval ?? defaultSetInterval;
    this.clearIntervalFn = deps.clearInterval ?? defaultClearInterval;

    for (const m of score.measures) this.occLabels.set(m.occ, m.label);
    this.settings = normalizeSettings(settings);
    this.seq = this.deriveSequence();
    this.matcher = new FollowMatcher(this.seq);

    if (this.midi.selectedOutputId !== this.settings.midiOutputId) {
      this.midi.selectOutput(this.settings.midiOutputId, deps.midiOutputName ?? null);
    }
    this.followOutputId();
    this.lastInputConnected = this.midi.inputConnected;
    this.lastInputId = this.midi.selectedInputId;
    this.midiInputName = this.readInputName();

    // Bound so they can be handed straight to useSyncExternalStore, requestAnimationFrame and click handlers.
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getVisualPosition = this.getVisualPosition.bind(this);
    this.getPassageTime = this.getPassageTime.bind(this);
    this.play = this.play.bind(this);
    this.pause = this.pause.bind(this);
    this.stop = this.stop.bind(this);
    this.togglePlay = this.togglePlay.bind(this);
    this.restart = this.restart.bind(this);
    this.next = this.next.bind(this);
    this.prev = this.prev.bind(this);

    this.unsubscribers.push(
      this.midi.onEvent((ev) => this.onMidiEvent(ev)),
      this.midi.onChange(() => this.onMidiChange()),
      this.sampler.onStateChange(() => this.mutate(() => undefined)),
    );
    const page = deps.pageEvents === undefined ? defaultPageEvents() : deps.pageEvents;
    if (page) {
      const onPageHide = (): void => this.onPageHide();
      page.addEventListener('pagehide', onPageHide);
      this.unsubscribers.push(() => page.removeEventListener('pagehide', onPageHide));
    }
    this.snapshot = this.buildSnapshot();
  }

  /* -------------------------------------------------------------------- */
  /* Public API                                                            */
  /* -------------------------------------------------------------------- */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  getVisualPosition(): number {
    if (!this.run || (this.status !== 'playing' && this.status !== 'count-in')) return this.displayIndex();
    const run = this.livePass(this.run);
    const rel = this.clockNow(run.clock) - run.anchor;
    return positionAt(run.times, Math.min(run.duration, Math.max(run.startRel, rel)));
  }

  /**
   * Listen / Steady: how far into the passage the marker is, and how long the
   * passage lasts, in seconds at the current speed or step length (the times
   * playback itself uses). While playing it moves with the clock, so it is
   * read every animation frame like getVisualPosition(); during a count-in
   * it stays at the starting point. Follow me has no clock: null.
   */
  getPassageTime(): PassageTime | null {
    if (this.disposed || this.inFollow()) return null;
    if (this.run && (this.status === 'playing' || this.status === 'count-in')) {
      const run = this.livePass(this.run);
      const rel = this.clockNow(run.clock) - run.anchor;
      return { elapsed: Math.min(run.duration, Math.max(run.startRel, rel)), total: run.duration };
    }
    const tl = this.timeline();
    const at = this.status === 'finished' ? tl.duration : this.startRelFor(this.displayIndex());
    return { elapsed: Math.min(tl.duration, Math.max(0, at)), total: tl.duration };
  }

  updateSettings(patch: Partial<PracticeSettings>): void {
    if (this.disposed) return;
    this.mutate(() => {
      const prev = this.settings;
      const next = normalizeSettings({ ...prev, ...patch });
      if (sameSettings(prev, next)) return;

      const seqChanged = prev.hands !== next.hands || !sameRange(prev.range, next.range);
      const modeChanged = prev.mode !== next.mode;
      const timingChanged = prev.speed !== next.speed || prev.stepSeconds !== next.stepSeconds;
      const soundChanged = prev.sound !== next.sound;
      const outputChanged = prev.midiOutputId !== next.midiOutputId;

      this.message = null;
      // Released while the old output is still the selected one. Follow me
      // plays no app sound, so there only the learner's own monitored notes
      // would be cut; they keep sounding until the learner lets go.
      if (seqChanged || modeChanged || timingChanged || soundChanged || outputChanged) {
        this.releaseAll(!modeChanged && prev.mode === 'follow');
      }
      if (prev.monitorInput && !next.monitorInput) this.releaseMonitored();
      this.settings = next;
      if (outputChanged) this.midi.selectOutput(next.midiOutputId);
      if (next.monitorInput && !prev.monitorInput) this.startAudioQuietly();
      if (next.sound && !prev.sound && this.run) this.startAudioQuietly();
      // Count-in clicks need browser audio; the next tick moves a silent run onto the audio clock.
      if (next.countIn && !prev.countIn && this.run) this.startAudioQuietly();
      if (!next.loop && this.followRestartAt !== null) this.followRestartAt = null;

      if (seqChanged) {
        const oldTick = this.seq.steps[this.stepIndex]?.tick ?? this.seq.startTick;
        this.haltPlayback();
        this.seq = this.deriveSequence();
        this.matcher.setSequence(this.seq);
        const at = this.seq.steps.findIndex((s) => s.tick >= oldTick);
        this.stepIndex = at < 0 ? 0 : at;
      } else if (modeChanged) {
        this.haltPlayback();
      } else if (this.run && (timingChanged || soundChanged || outputChanged)) {
        this.reanchor(false);
      }
      this.syncInterval();
    });
  }

  async play(): Promise<void> {
    if (this.disposed) return;
    if (this.inFollow() && this.status === 'finished' && this.followRestartAt !== null) {
      // Start pressed during the Follow me loop gap: go again from step 0 now.
      this.playToken++;
      this.mutate(() => this.beginFollow());
      return;
    }
    if (this.isRunning()) return;
    const token = ++this.playToken;
    if (this.inFollow()) {
      this.mutate(() => this.beginFollow());
      return;
    }
    if (this.seq.steps.length === 0) {
      this.mutate(() => {
        this.message = SESSION_MESSAGES.nothingToPlay;
      });
      return;
    }
    let audioFailed = false;
    if (this.settings.sound || this.settings.countIn) {
      try {
        // Called before any await so the browser counts it as part of the gesture.
        await this.sampler.ensureStarted();
        this.audioStarted = true;
      } catch {
        audioFailed = true;
      }
    }
    if (this.disposed || token !== this.playToken || this.isRunning() || this.inFollow()) return;
    this.mutate(() => {
      this.message = audioFailed && this.settings.sound ? SESSION_MESSAGES.noSound : null;
      // From the marker, unless the passage is finished or nothing is left to
      // sound from there: the marker on the closing release (restored from a
      // saved position, or left there when the mode, hands or passage changed
      // after the end) or paused in the trailing rest. Then from step 0, like
      // Follow me's beginFollow.
      const restart = this.status === 'finished' || !this.soundsFrom(this.stepIndex);
      const fromStart = restart || this.status === 'stopped' || this.countInInterrupted;
      if (restart) this.stepIndex = 0;
      this.startRun(this.startRelFor(this.stepIndex), fromStart && this.settings.countIn);
    });
  }

  pause(): void {
    if (this.disposed) return;
    this.playToken++;
    this.mutate(() => {
      this.message = null;
      this.pauseInternal();
    });
  }

  stop(): void {
    if (this.disposed) return;
    this.playToken++;
    this.mutate(() => {
      this.message = null;
      this.releaseAll();
      this.run = null;
      this.followRestartAt = null;
      this.status = 'stopped';
      this.stepIndex = 0;
      this.countInRemaining = null;
      this.countInInterrupted = false;
      this.waitingFor = EMPTY;
      this.wrong = EMPTY;
      this.syncInterval();
    });
  }

  /** Matches the transport button: it offers Start (not Pause) while the status is 'finished'. */
  togglePlay(): void {
    if (this.status !== 'finished' && this.isRunning()) this.pause();
    else void this.play();
  }

  restart(): void {
    if (this.disposed) return;
    this.mutate(() => {
      this.message = null;
      if (this.status === 'finished' && this.followRestartAt === null) {
        this.stepIndex = 0;
        this.status = 'stopped';
      } else {
        this.jumpTo(0);
      }
    });
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  seek(stepIndex: number): void {
    if (this.disposed) return;
    this.mutate(() => {
      this.message = null;
      this.jumpTo(stepIndex);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.playToken++;
    this.releaseAll();
    this.run = null;
    this.followRestartAt = null;
    this.syncInterval();
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.listeners.clear();
    this.disposed = true;
  }

  /* -------------------------------------------------------------------- */
  /* Transport internals                                                   */
  /* -------------------------------------------------------------------- */

  private inFollow(): boolean {
    return this.settings.mode === 'follow';
  }

  private isRunning(): boolean {
    const s = this.status;
    return s === 'playing' || s === 'count-in' || s === 'waiting' || this.followRestartAt !== null;
  }

  private step(delta: number): void {
    if (this.disposed) return;
    this.mutate(() => {
      this.message = null;
      const n = this.seq.steps.length;
      if (n === 0) return;
      let target = Math.min(n - 1, Math.max(0, this.stepIndex + delta));
      if (this.inFollow()) {
        // Follow me never waits on a step with nothing to strike (the matcher
        // skips it forwards), so step over those in the direction of travel;
        // otherwise Previous would land back on the current step.
        while (delta < 0 && target > 0 && !this.hasAttacks(target)) target--;
        while (delta > 0 && target < n - 1 && !this.hasAttacks(target)) target++;
      }
      if (target === this.stepIndex) return;
      const wasRunning = this.isRunning();
      this.jumpTo(target);
      if (!wasRunning) this.preview(target);
    });
  }

  /** Moves the marker; while playing, playback continues from the new step. */
  private jumpTo(index: number): void {
    const n = this.seq.steps.length;
    const k = n === 0 ? 0 : Math.min(n - 1, Math.max(0, Math.trunc(Number.isFinite(index) ? index : 0)));
    const s = this.status;
    if ((s === 'playing' || s === 'count-in') && this.run) {
      this.releaseAll();
      this.startRun(this.startRelFor(k), s === 'count-in' && this.settings.countIn);
    } else if (s === 'waiting') {
      this.matcher.start(k);
      this.applyFollowStatus();
    } else if (s === 'finished' && this.followRestartAt !== null) {
      this.startFollow(k);
    } else {
      this.stepIndex = k;
      if (s === 'finished') this.status = 'paused';
    }
    this.syncInterval();
  }

  /**
   * @param keepMonitor In Follow me, leave the learner's monitored notes
   *   sounding (they end with the learner's own note-offs). False when the
   *   input's note-offs can no longer arrive, or the page is going away.
   */
  private pauseInternal(keepMonitor = true): void {
    const s = this.status;
    if ((s === 'playing' || s === 'count-in') && this.run) {
      const run = this.livePass(this.run);
      if (s === 'playing') {
        const rel = this.clockNow(run.clock) - run.anchor;
        this.stepIndex = Math.max(run.startStep, stepAt(run.times, rel));
      } else {
        // The music has not begun: Play counts in again from the same step.
        this.countInInterrupted = true;
      }
      this.releaseAll();
      this.run = null;
      this.status = 'paused';
      this.countInRemaining = null;
    } else if (s === 'waiting' || this.followRestartAt !== null) {
      this.releaseAll(keepMonitor);
      this.followRestartAt = null;
      this.status = 'paused';
      this.waitingFor = EMPTY;
      this.wrong = EMPTY;
    }
    this.syncInterval();
  }

  /** Stops playback without moving the marker (used when the sequence or mode changes). */
  private haltPlayback(): void {
    this.playToken++;
    this.run = null;
    this.followRestartAt = null;
    this.countInRemaining = null;
    this.waitingFor = EMPTY;
    this.wrong = EMPTY;
    if (this.status !== 'paused') this.status = 'stopped';
  }

  /** Passage time at which playback from step k begins. Step 0 includes any opening rest. */
  private startRelFor(k: number): number {
    if (k <= 0) return 0;
    return this.timeline().times[k] ?? 0;
  }

  /** Listen / Steady playback from step k would sound at least one note (a strike, or a key still held there). */
  private soundsFrom(k: number): boolean {
    return this.buildEvents(this.timeline().times, this.startRelFor(k)).length > 0;
  }

  /* -------------------------------------------------------------------- */
  /* Listen / Steady scheduling                                            */
  /* -------------------------------------------------------------------- */

  private timeline(): Timeline {
    const mode: TimedMode = this.settings.mode === 'steady' ? 'steady' : 'listen';
    const { speed, stepSeconds } = this.settings;
    const c = this.timelineCache;
    if (c && c.seq === this.seq && c.mode === mode && c.speed === speed && c.stepSeconds === stepSeconds) return c;
    const times =
      mode === 'listen' ? listenStepTimes(this.seq, this.score.tempo, speed) : steadyStepTimes(this.seq, stepSeconds);
    const duration =
      mode === 'listen'
        ? passageDurationListen(this.seq, this.score.tempo, speed)
        : passageDurationSteady(this.seq, stepSeconds);
    const t: Timeline = { seq: this.seq, mode, speed, stepSeconds, times, duration: Math.max(0, duration) };
    this.timelineCache = t;
    return t;
  }

  /**
   * Seconds between count-in clicks: the step length in Steady steps; in
   * Listen one beat of the time signature in force where playback starts,
   * at the tempo there, divided by the speed.
   */
  private countInBeat(startRel: number, times: readonly number[]): number {
    if (this.settings.mode === 'steady') return this.settings.stepSeconds;
    const steps = this.seq.steps;
    const tick = startRel <= 0 || steps.length === 0 ? this.seq.startTick : steps[stepAt(times, startRel)].tick;
    const beat = (this.quartersPerBeatAt(tick) * 60) / tempoAt(this.score.tempo, tick) / this.settings.speed;
    return Number.isFinite(beat) && beat > 0 ? beat : 0.5;
  }

  /**
   * Length of one beat in quarter notes, from the time signature in force at
   * `tick` (the tempo map counts quarter notes): a dotted quarter in 6/8, 9/8
   * and 12/8 (dotted eighth in 6/16...), an eighth in 3/8, a half in x/2, and
   * a quarter in x/4 or when the score has no time signature.
   */
  private quartersPerBeatAt(tick: number): number {
    const occs = this.score.measures;
    let occ = occs.find((m) => m.startTick <= tick && tick < m.startTick + m.durationTicks);
    if (!occ) occ = [...occs].reverse().find((m) => m.startTick <= tick) ?? occs[0];
    if (!occ) return 1;
    const measures = this.score.source.measures;
    for (let i = Math.min(occ.measureIndex, measures.length - 1); i >= 0; i--) {
      const ts = measures[i]?.timeSignature;
      if (!ts) continue;
      const { beats, beatType } = ts;
      if (!(beats > 0) || !(beatType > 0)) return 1;
      const compound = beatType >= 8 && beats >= 6 && beats % 3 === 0;
      return ((compound ? 3 : 1) * 4) / beatType;
    }
    return 1;
  }

  /**
   * Note events for playback starting at `startRel`. Presses that start
   * later play normally; presses already held at the start point sound again
   * right at the start, unless they end within `minHold`; anything earlier
   * is dropped, so nothing is ever scheduled in the past.
   */
  private buildEvents(times: readonly number[], startRel: number, minHold = EPS): PlayEvent[] {
    const raw: PlayEvent[] = [];
    for (const p of this.seq.presses) {
      const s = this.stepOfTick.get(p.startTick);
      const e = this.stepOfTick.get(p.endTick);
      if (s === undefined || e === undefined) continue;
      const ts = times[s];
      const te = times[e];
      const velocity = p.velocity ?? DEFAULT_PLAY_VELOCITY;
      if (ts >= startRel - EPS) {
        raw.push({ t: ts, on: true, midi: p.midi, velocity }, { t: te, on: false, midi: p.midi, velocity });
      } else if (te > startRel + minHold) {
        raw.push({ t: startRel, on: true, midi: p.midi, velocity }, { t: te, on: false, midi: p.midi, velocity });
      }
    }
    // Releases before strikes at the same instant, so a repeated key is struck again.
    raw.sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on) || a.midi - b.midi);

    // Both hands can hold the same key; it is one physical key, so it only
    // comes up when the last hand lets go, and one strike per instant is enough.
    const holders = new Map<number, number>();
    const lastStrike = new Map<number, number>();
    const out: PlayEvent[] = [];
    for (const ev of raw) {
      const count = holders.get(ev.midi) ?? 0;
      if (ev.on) {
        holders.set(ev.midi, count + 1);
        if (count > 0 && lastStrike.get(ev.midi) === ev.t) continue;
        lastStrike.set(ev.midi, ev.t);
        out.push(ev);
      } else {
        holders.set(ev.midi, Math.max(0, count - 1));
        if (count === 1) out.push(ev);
      }
    }
    return out;
  }

  /**
   * @param minHold A key held at the start point is struck again only if it
   *   is held at least this much longer (see RESTRIKE_MIN_SEC).
   */
  private startRun(startRel: number, withCountIn: boolean, minHold = EPS): void {
    this.countInInterrupted = false;
    // A previewed chord is let go before playback strikes it again.
    this.endPreview();
    const tl = this.timeline();
    const mode: TimedMode = tl.mode;
    const clock = this.pickClock();
    const now = this.clockNow(clock);
    const rel = Math.min(Math.max(0, startRel), tl.duration);
    const startStep = stepAt(tl.times, rel);
    let lead = START_LEAD_SEC;
    if (this.outputActive()) {
      // Messages the output still holds from before cannot be withdrawn
      // everywhere; start after them so none can cut this run's notes.
      lead = Math.max(lead, (this.midiQueuedUntilMs - this.nowMs()) / 1000 + MIDI_QUEUE_MARGIN_SEC);
    }
    const first = now + lead;
    const beat = withCountIn ? this.countInBeat(rel, tl.times) : 0;
    const clicks = withCountIn ? Array.from({ length: COUNT_IN_BEATS }, (_, j) => first + j * beat) : [];
    const startAt = withCountIn ? first + COUNT_IN_BEATS * beat : first;
    const run: Run = {
      clock,
      mode,
      speed: this.settings.speed,
      stepSeconds: this.settings.stepSeconds,
      times: tl.times,
      duration: tl.duration,
      anchor: startAt - rel,
      startRel: rel,
      startStep,
      startAt,
      events: this.buildEvents(tl.times, rel, minHold),
      nextEvent: 0,
      nextMidiEvent: 0,
      clicks,
      nextClick: 0,
      next: null,
    };
    this.run = run;
    this.status = withCountIn ? 'count-in' : 'playing';
    this.countInRemaining = withCountIn ? COUNT_IN_BEATS : null;
    this.stepIndex = startStep;
    this.waitingFor = EMPTY;
    this.wrong = EMPTY;
    this.followRestartAt = null;
    this.advanceRun(run);
    if (!withCountIn && this.run === run) {
      // The first strike (and the held keys struck again) go to the MIDI
      // output now, START_LEAD ahead, instead of on the next timer tick: that
      // tick follows the re-render the Play click or seek itself causes, and
      // a late tick would send them late. `lead` already starts the run after
      // anything still queued, so this cannot cut an earlier message.
      const now = this.clockNow(run.clock);
      this.dispatchMidi(run, now, Math.max(now + MIDI_LOOKAHEAD_SEC, run.startAt + EPS));
    }
    this.syncInterval();
  }

  /**
   * Re-anchors the current run at its present musical position (after a
   * speed, step-length, sound or output change, or a change of MIDI input).
   * Everything sounding is released and the keys held at that point are
   * struck again, except those about to be let go anyway.
   */
  private reanchor(release = true): void {
    if (!this.run) return;
    const run = this.livePass(this.run);
    const countingIn = this.status === 'count-in';
    const rel = countingIn
      ? run.startRel
      : Math.min(run.duration, Math.max(run.startRel, this.clockNow(run.clock) - run.anchor));
    // Position in tempo-free units: seconds at 1x (Listen) or steps (Steady).
    const units = run.mode === 'listen' ? rel * run.speed : rel / run.stepSeconds;
    const newRel = run.mode === 'listen' ? units / this.settings.speed : units * this.settings.stepSeconds;
    if (release) this.releaseAll();
    // During a count-in the position is a step, as for a seek.
    this.startRun(newRel, countingIn && this.settings.countIn, countingIn ? EPS : RESTRIKE_MIN_SEC);
  }

  private tick(): void {
    if (this.disposed) return;
    this.mutate(() => {
      if (this.previewOffAtMs !== null && this.nowMs() >= this.previewOffAtMs) this.releasePreviewOutput();
      if (this.followRestartAt !== null && this.nowMs() >= this.followRestartAt) {
        this.followRestartAt = null;
        this.releaseAll(true);
        this.startFollow(0);
      }
      const run = this.run;
      if (run) {
        const clock = this.pickClock();
        if (run.clock !== clock) this.switchClock(clock);
        if (this.run) this.advanceRun(this.run);
      }
      this.syncInterval();
    });
  }

  /**
   * Moves the running playback onto the other clock in place: browser audio
   * has just started during silent playback (a monitored key, or "Hear my
   * playing", count-in or Sound turned on). Nothing is released, delayed or
   * struck again on the MIDI output, so the learner's monitored notes keep
   * sounding and the marker does not hitch. MIDI timestamps are converted
   * from the run's clock when sent, so the output's cursor carries on.
   *
   * On the wall clock nothing went to the browser sampler, so its cursor and
   * the count-in clicks restart from now; with Sound on, the keys held at
   * this point sound from now (unless they are about to be let go).
   */
  private switchClock(to: ClockKind): void {
    const first = this.run;
    if (!first) return;
    const offset = this.clockNow(to) - this.clockNow(first.clock);
    const now = this.clockNow(to);
    const toSampler = to === 'audio';
    for (let pass: Run | null = first; pass; pass = pass.next) {
      pass.clock = to;
      pass.anchor += offset;
      pass.startAt += offset;
      pass.clicks = pass.clicks.map((c) => c + offset);
      if (!toSampler) continue;
      let c = 0;
      while (c < pass.clicks.length && pass.clicks[c] < now) c++;
      pass.nextClick = c;
      let e = 0;
      while (e < pass.events.length && pass.anchor + pass.events[e].t < now) e++;
      pass.nextEvent = e;
    }
    if (!toSampler || !this.settings.sound) return;
    const live = this.livePass(first);
    const held = new Map<number, number>();
    for (const ev of live.events) {
      const when = live.anchor + ev.t;
      if (when >= now + RESTRIKE_MIN_SEC) break;
      if (!ev.on) held.delete(ev.midi);
      else if (when < now) held.set(ev.midi, ev.velocity);
    }
    for (const [midi, velocity] of held) this.sampler.noteOn(midi, velocity, now);
  }

  private advanceRun(first: Run): void {
    const now = this.clockNow(first.clock);
    this.schedulePasses(first, now);
    // A chained loop pass takes over at its anchor (its predecessor's end).
    let run = first;
    while (run.next && now >= run.next.anchor) run = run.next;
    this.run = run;

    if (now < run.startAt) {
      if (this.status === 'count-in') {
        let sounded = 0;
        for (const c of run.clicks) if (c <= now) sounded++;
        this.countInRemaining = COUNT_IN_BEATS - Math.max(0, sounded - 1);
      }
      return;
    }
    if (this.status === 'count-in') {
      this.status = 'playing';
      this.countInRemaining = null;
    }
    const rel = now - run.anchor;
    this.stepIndex = Math.max(run.startStep, stepAt(run.times, rel));
    if (rel >= run.duration) {
      if (this.settings.loop && run.duration > 0) {
        // With count-in (or when the timer was too late to chain the next
        // pass ahead): release everything and start again.
        this.releaseAll();
        this.startRun(0, this.settings.countIn);
      } else {
        this.run = null;
        this.status = 'finished';
        this.stepIndex = Math.max(0, this.seq.steps.length - 1);
        this.countInRemaining = null;
      }
    }
  }

  /**
   * Hands over everything due within the lookahead, for this pass and any
   * loop passes chained after it. A loop without count-in is chained while
   * the current pass's end is still ahead, with the next pass anchored exactly
   * there: its only remaining events by then are note-offs at or before the
   * end, which release every key before the next pass strikes (off before on
   * at equal times), so no release-all and no restart lead is needed.
   */
  private schedulePasses(first: Run, now: number): void {
    const horizon = now + LOOKAHEAD_SEC;
    for (let pass: Run | null = first; pass; pass = pass.next) {
      this.dispatchDue(pass, now);
      const end = pass.anchor + pass.duration;
      if (!pass.next && this.chainsLoop(pass) && end >= now && end <= horizon) pass.next = this.chainedPass(pass);
    }
  }

  private chainsLoop(pass: Run): boolean {
    return this.settings.loop && !this.settings.countIn && pass.duration >= MIN_CHAIN_SEC;
  }

  private chainedPass(prev: Run): Run {
    const anchor = prev.anchor + prev.duration;
    return {
      clock: prev.clock,
      mode: prev.mode,
      speed: prev.speed,
      stepSeconds: prev.stepSeconds,
      times: prev.times,
      duration: prev.duration,
      anchor,
      startRel: 0,
      startStep: 0,
      startAt: anchor,
      events: this.buildEvents(prev.times, 0),
      nextEvent: 0,
      nextMidiEvent: 0,
      clicks: [],
      nextClick: 0,
      next: null,
    };
  }

  /** Sampler events and clicks go LOOKAHEAD_SEC ahead; MIDI output only MIDI_LOOKAHEAD_SEC. */
  private dispatchDue(run: Run, now: number): void {
    const horizon = now + LOOKAHEAD_SEC;
    const toSampler = run.clock === 'audio';
    // Each cursor moves past its item before the sampler is called, and an
    // item the sampler throws on is skipped, so one bad item can never stall
    // the scheduler by being retried on every tick.
    while (run.nextClick < run.clicks.length && run.clicks[run.nextClick] <= horizon) {
      const i = run.nextClick++;
      if (toSampler) {
        try {
          this.sampler.click(run.clicks[i], i === 0);
        } catch {
          // Skipped: a missing click is harmless.
        }
      }
    }
    const sound = toSampler && this.settings.sound;
    while (run.nextEvent < run.events.length) {
      const ev = run.events[run.nextEvent];
      const when = run.anchor + ev.t;
      if (when > horizon) break;
      run.nextEvent++;
      if (sound) {
        try {
          if (ev.on) this.sampler.noteOn(ev.midi, ev.velocity, when);
          else this.sampler.noteOff(ev.midi, when);
        } catch {
          // Skipped: the rest of the piece still plays.
        }
      }
    }
    this.dispatchMidi(run, now, now + MIDI_LOOKAHEAD_SEC);
  }

  /** Hands the MIDI output the run's events due by `horizon` (run clock). */
  private dispatchMidi(run: Run, now: number, horizon: number): void {
    const output = this.outputActive();
    while (run.nextMidiEvent < run.events.length) {
      const ev = run.events[run.nextMidiEvent];
      const when = run.anchor + ev.t;
      if (when > horizon) break;
      run.nextMidiEvent++;
      if (output) {
        // MIDI output timestamps live in the performance.now() millisecond domain.
        const atMs = this.nowMs() + (when - now) * 1000;
        this.midiQueuedUntilMs = Math.max(this.midiQueuedUntilMs, atMs);
        try {
          if (ev.on) this.midi.sendNoteOn(ev.midi, ev.velocity, atMs);
          else this.midi.sendNoteOff(ev.midi, atMs);
        } catch {
          // Skipped, as in dispatchDue.
        }
      }
    }
  }

  /** Short demonstration of a step's struck keys after manual stepping. */
  private preview(k: number): void {
    if (this.settings.mode === 'follow') return;
    const step = this.seq.steps[k];
    if (!step) return;
    this.endPreview();
    const keys = unionOver(step, this.seq.hands, 'attacks');
    if (keys.length === 0) return;
    const velocity = new Map<number, number>();
    for (const p of this.seq.presses) {
      if (p.startTick === step.tick) velocity.set(p.midi, p.velocity ?? DEFAULT_PLAY_VELOCITY);
    }
    if (this.settings.sound) {
      this.startAudioQuietly();
      if (this.audioUsable()) {
        const t = this.sampler.currentTime;
        for (const key of keys) this.sampler.noteOn(key, velocity.get(key) ?? DEFAULT_PLAY_VELOCITY, t);
        for (const key of keys) this.sampler.noteOff(key, t + PREVIEW_SEC);
      }
    }
    if (this.outputActive()) {
      // Only the strike is sent now. The release is sent when due (see
      // tick), never queued ahead: a queued note-off could not be withdrawn
      // and would cut the same keys if playback or another preview followed.
      const ms = this.nowMs();
      for (const key of keys) this.midi.sendNoteOn(key, velocity.get(key) ?? DEFAULT_PLAY_VELOCITY, ms);
      this.previewOffAtMs = ms + PREVIEW_SEC * 1000;
    }
    this.previewKeys = keys;
    this.syncInterval();
  }

  /** The MIDI-output preview has lasted PREVIEW_SEC: release it (the sampler's release is already scheduled). */
  private releasePreviewOutput(): void {
    this.previewOffAtMs = null;
    if (this.outputActive()) {
      const ms = this.nowMs();
      for (const key of this.previewKeys) this.midi.sendNoteOff(key, ms);
    }
    this.previewKeys = EMPTY;
  }

  private endPreview(): void {
    this.previewOffAtMs = null;
    if (this.previewKeys.length === 0) return;
    if (this.settings.sound && this.audioUsable()) {
      const t = this.sampler.currentTime;
      for (const key of this.previewKeys) this.sampler.noteOff(key, t);
    }
    if (this.outputActive()) {
      const ms = this.nowMs();
      for (const key of this.previewKeys) this.midi.sendNoteOff(key, ms);
    }
    this.previewKeys = EMPTY;
  }

  /**
   * Silences everything the app is sounding and forgets every queued event.
   * With `keepMonitor` (Follow me, which plays no app sound) the browser
   * sampler is left alone, so the learner's own monitored notes keep sounding
   * until their own note-off or pedal release.
   */
  private releaseAll(keepMonitor = false): void {
    if (!keepMonitor) {
      this.sampler.allNotesOff();
      this.sustained.clear();
      this.monitorOnAt.clear();
    }
    if (this.outputActive()) this.midi.allNotesOff();
    if (this.run) {
      const run = this.livePass(this.run);
      run.nextEvent = run.events.length;
      run.nextMidiEvent = run.events.length;
      run.nextClick = run.clicks.length;
      run.next = null;
      this.run = run;
    }
    this.previewKeys = EMPTY;
    this.previewOffAtMs = null;
  }

  private releaseMonitored(): void {
    for (const k of new Set([...this.physical, ...this.sustained])) this.monitorOff(k);
    this.sustained.clear();
    this.monitorOnAt.clear();
  }

  /* -------------------------------------------------------------------- */
  /* Follow me                                                             */
  /* -------------------------------------------------------------------- */

  private beginFollow(): void {
    this.message = null;
    if (!this.midi.inputConnected) {
      this.message = SESSION_MESSAGES.needPiano;
      return;
    }
    if (this.seq.steps.length === 0) {
      this.message = SESSION_MESSAGES.nothingToPlay;
      return;
    }
    this.endPreview();
    if (this.settings.monitorInput) this.startAudioQuietly();
    // From the marker, unless the passage is finished or nothing is left to
    // strike from there (paused in the loop gap, or on the closing release).
    const fromMarker = this.status !== 'finished' && this.attackAtOrAfter(this.stepIndex);
    this.startFollow(fromMarker ? this.stepIndex : 0);
  }

  /**
   * The step has a key to strike for the included hands, which is where
   * Follow me waits (the matcher's rule: it skips the other steps forwards).
   */
  private hasAttacks(k: number): boolean {
    const step = this.seq.steps[k];
    return step !== undefined && !step.releaseOnly && unionOver(step, this.seq.hands, 'attacks').some(isOnPiano);
  }

  private attackAtOrAfter(k: number): boolean {
    for (let i = Math.max(0, k); i < this.seq.steps.length; i++) if (this.hasAttacks(i)) return true;
    return false;
  }

  private startFollow(k: number): void {
    this.countInInterrupted = false;
    this.followRestartAt = null;
    this.run = null;
    this.countInRemaining = null;
    // Keys already down when the step begins count as down but not as new presses.
    const m = this.matcher;
    m.resetPhysical();
    const time = this.nowMs();
    for (const key of this.physical) m.handle({ type: 'noteon', midi: key, velocity: 64, channel: 1, time });
    if (this.pedal) m.handle({ type: 'sustain', down: true, value: 127, channel: 1, time });
    m.start(k);
    this.applyFollowStatus();
  }

  private applyFollowStatus(): void {
    const st = this.matcher.status();
    if (st.finished) {
      this.status = 'finished';
      this.stepIndex = Math.max(0, this.seq.steps.length - 1);
      this.waitingFor = EMPTY;
      this.wrong = EMPTY;
      this.followRestartAt = this.settings.loop ? this.nowMs() + FOLLOW_LOOP_DELAY_MS : null;
    } else {
      this.status = 'waiting';
      this.stepIndex = st.stepIndex;
      const satisfied = new Set(st.satisfied);
      this.waitingFor = st.expected.filter((k) => !satisfied.has(k));
      this.wrong = st.wrong;
    }
    this.syncInterval();
  }

  /* -------------------------------------------------------------------- */
  /* MIDI input                                                            */
  /* -------------------------------------------------------------------- */

  private onMidiEvent(ev: MidiInputEvent): void {
    if (this.disposed) return;
    this.mutate(() => {
      const monitor = this.settings.monitorInput;
      if (ev.type === 'sustain') {
        this.pedal = ev.down;
        if (!ev.down) {
          for (const k of this.sustained) if (!this.physical.has(k) && monitor) this.monitorOff(k);
          this.sustained.clear();
        }
      } else if (ev.type === 'noteon' && ev.velocity > 0) {
        if (!this.physical.has(ev.midi)) {
          this.physical.add(ev.midi);
          if (monitor) {
            // "Hear my playing" may be on from a stored setting with no gesture
            // having started browser audio yet. The page has had one (Connect
            // piano), so starting it now is allowed; say so if it fails.
            if (this.sampler.state === 'not-started') this.startAudioQuietly(SESSION_MESSAGES.monitorNoSound);
            this.sustained.delete(ev.midi);
            const t = this.sampler.currentTime;
            this.monitorOnAt.set(ev.midi, t);
            this.sampler.noteOn(ev.midi, ev.velocity, t, 'input');
          }
        }
      } else if (this.physical.delete(ev.midi) && monitor) {
        // The browser sampler has no pedal, so the pedal holds monitored keys here.
        if (this.pedal) this.sustained.add(ev.midi);
        else this.monitorOff(ev.midi);
      }
      if (this.settings.mode === 'follow' && this.status === 'waiting') {
        this.matcher.handle(ev);
        this.applyFollowStatus();
      }
    });
  }

  /**
   * A release in the same audio instant as its strike would not end the
   * voice, so a very quick tap is released just after it began. Only the
   * learner's own voice of the key is released, never the app's.
   */
  private monitorOff(midi: number): void {
    const struck = this.monitorOnAt.get(midi);
    this.monitorOnAt.delete(midi);
    const now = this.sampler.currentTime;
    this.sampler.noteOff(midi, struck === undefined ? now : Math.max(now, struck + MONITOR_MIN_SEC), 'input');
  }

  private onMidiChange(): void {
    if (this.disposed) return;
    this.mutate(() => {
      const connected = this.midi.inputConnected;
      const id = this.midi.selectedInputId;
      const lost = this.lastInputConnected && (!connected || id !== this.lastInputId);
      this.lastInputConnected = connected;
      this.lastInputId = id;
      this.midiInputName = this.readInputName();
      this.followOutputId();
      if (lost) this.inputLost(!connected);
      else if (connected && this.message === SESSION_MESSAGES.disconnected) this.message = null;
    });
  }

  /**
   * The output came back under a new id with the same name, and the manager
   * re-found it: playback goes there, so the setting (and the output menu,
   * and the saved piece state) must name it too. Nothing is released: it is
   * the same device.
   */
  private followOutputId(): void {
    const outId = this.midi.selectedOutputId;
    if (this.settings.midiOutputId !== null && outId !== null && outId !== this.settings.midiOutputId) {
      this.settings = { ...this.settings, midiOutputId: outId };
    }
  }

  /** The old device's note-offs will never arrive, so forget its keys. */
  private inputLost(disconnected: boolean): void {
    this.physical.clear();
    this.pedal = false;
    this.matcher.resetPhysical();
    const following = this.settings.mode === 'follow' && (this.status === 'waiting' || this.followRestartAt !== null);
    if (following && disconnected) {
      // The lost device's note-offs will never arrive, so monitored notes go too.
      this.pauseInternal(false);
      this.message = SESSION_MESSAGES.disconnected;
    } else if (following) {
      this.releaseAll();
      if (this.status === 'waiting') {
        this.matcher.start(this.stepIndex);
        this.applyFollowStatus();
      }
    } else if (this.run) {
      this.reanchor();
    } else {
      this.releaseAll();
    }
    this.syncInterval();
  }

  /**
   * Name of the selected input for the transport bar. None while a remembered
   * piano has not turned up this session: it was not found, so it is not
   * reported as "<name> disconnected" (and the manager may only know it as
   * an unnamed placeholder). Re-read on every MIDI change.
   */
  private readInputName(): string | null {
    const id = this.midi.selectedInputId;
    if (id === null) return null;
    if (!this.midi.inputConnected && this.midi.inputSeen === false) return null;
    return this.midi.inputs().find((i) => i.id === id)?.name ?? null;
  }

  /** A remembered piano has not turned up this session (see SessionSnapshot.midiInputNotFound). */
  private inputNotFound(): boolean {
    const m = this.midi;
    return m.state === 'ready' && m.selectedInputId !== null && !m.inputConnected && m.inputSeen === false;
  }

  /* -------------------------------------------------------------------- */
  /* Clock, audio and output                                               */
  /* -------------------------------------------------------------------- */

  private audioUsable(): boolean {
    const s = this.sampler.state;
    return this.audioStarted || s === 'loading' || s === 'ready';
  }

  /**
   * The audio clock once the sampler runs; wall time when it never started
   * (silent modes). Audio this session has just started counts only once
   * ensureStarted() has resolved: until the AudioContext is running its time
   * stands still, and a run mapped onto it would freeze. A run already on the
   * audio clock stays there: samples that fail to load (state 'error', or a
   * retried load) do not stop the AudioContext, and the fallback voice plays.
   */
  private pickClock(): ClockKind {
    if (this.audioStarted) return 'audio';
    if (this.run?.clock === 'audio' && this.sampler.state !== 'not-started') return 'audio';
    if (this.audioPending) return 'wall';
    return this.audioUsable() ? 'audio' : 'wall';
  }

  private clockNow(kind: ClockKind): number {
    return kind === 'audio' ? this.sampler.currentTime : this.nowMs() / 1000;
  }

  /**
   * Starts browser audio without waiting; `failMessage` is shown if it cannot
   * start. Also from 'error' (the sampler may have been left there by an
   * earlier page): some samples failed to load, and ensureStarted() retries
   * them while the fallback voice plays, or the AudioContext could not be
   * created, and it is tried again. Called only on the learner's own actions.
   */
  private startAudioQuietly(failMessage?: string): void {
    const st = this.sampler.state;
    if ((st !== 'not-started' && st !== 'error') || this.audioPending) return;
    this.audioPending = true;
    this.sampler.ensureStarted().then(
      () => {
        this.audioPending = false;
        this.audioStarted = true;
      },
      () => {
        this.audioPending = false;
        if (failMessage === undefined || this.disposed) return;
        this.mutate(() => {
          this.message = failMessage;
        });
      },
    );
  }

  private outputActive(): boolean {
    return this.settings.midiOutputId !== null;
  }

  /** The pass sounding now: a chained loop pass takes over at its anchor. */
  private livePass(run: Run): Run {
    const t = this.clockNow(run.clock);
    let pass = run;
    while (pass.next && t >= pass.next.anchor) pass = pass.next;
    return pass;
  }

  /**
   * Reload, tab close or leaving the site: no React cleanup runs and Web MIDI
   * sends no note-offs of its own, so pause and release every app-sent note
   * now. Not a dispose: a page restored from the back/forward cache keeps a
   * working, paused session.
   */
  private onPageHide(): void {
    if (this.disposed) return;
    this.playToken++;
    this.mutate(() => {
      if (this.isRunning()) this.pauseInternal(false);
      else this.releaseAll();
      this.syncInterval();
    });
  }

  private syncInterval(): void {
    const needed =
      !this.disposed && (this.run !== null || this.followRestartAt !== null || this.previewOffAtMs !== null);
    if (needed && !this.intervalActive) {
      this.intervalHandle = this.setIntervalFn(() => this.tick(), SCHEDULER_INTERVAL_MS);
      this.intervalActive = true;
    } else if (!needed && this.intervalActive) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
      this.intervalActive = false;
    }
  }

  /* -------------------------------------------------------------------- */
  /* Snapshot                                                              */
  /* -------------------------------------------------------------------- */

  private deriveSequence(): StepSequence {
    const seq = deriveSteps(this.score, handsOf(this.settings.hands), this.settings.range);
    this.stepOfTick = new Map(seq.steps.map((s, i) => [s.tick, i]));
    this.timelineCache = null;
    return seq;
  }

  private displayIndex(): number {
    const n = this.seq.steps.length;
    return n === 0 ? 0 : Math.min(n - 1, Math.max(0, this.stepIndex));
  }

  /** Runs `fn`, then publishes one snapshot for all of its changes. */
  private mutate(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
      if (this.depth === 0) this.refresh();
    }
  }

  private refresh(): void {
    if (this.disposed) return;
    const prev = this.snapshot;
    const next = this.buildSnapshot();
    if (sameSnapshot(prev, next)) return;
    this.snapshot = reuseArrays(prev, next);
    for (const fn of [...this.listeners]) fn();
  }

  private buildSnapshot(): SessionSnapshot {
    const seq = this.seq;
    const idx = this.displayIndex();
    const step = seq.steps[idx];
    const expected: Record<Hand, number[]> = { R: EMPTY, L: EMPTY };
    const struck: Record<Hand, number[]> = { R: EMPTY, L: EMPTY };
    if (step) {
      for (const h of seq.hands) {
        expected[h] = step.heldAfter[h] ?? EMPTY;
        struck[h] = step.attacks[h] ?? EMPTY;
      }
    }
    const occ = step ? step.occ : seq.range.startOcc;
    return {
      status: this.status,
      settings: this.settings,
      sequence: seq,
      stepIndex: idx,
      stepCount: seq.steps.length,
      measureLabel: this.occLabels.get(occ) ?? '',
      expected,
      struck,
      physicalDown: [...this.physical].sort(ascending),
      pedalDown: this.pedal,
      wrong: this.wrong,
      waitingFor: this.waitingFor,
      countInRemaining: this.countInRemaining,
      audioState: this.sampler.state,
      midiState: this.midi.state,
      midiInputName: this.midiInputName,
      midiInputConnected: this.midi.inputConnected,
      midiInputNotFound: this.inputNotFound(),
      message: this.message,
    };
  }
}

function sameHandRecord(a: Record<Hand, number[]>, b: Record<Hand, number[]>): boolean {
  return HAND_KEYS.every((h) => sameNumbers(a[h], b[h]));
}

function sameSnapshot(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return (
    a.status === b.status &&
    a.settings === b.settings &&
    a.sequence === b.sequence &&
    a.stepIndex === b.stepIndex &&
    a.stepCount === b.stepCount &&
    a.measureLabel === b.measureLabel &&
    sameHandRecord(a.expected, b.expected) &&
    sameHandRecord(a.struck, b.struck) &&
    sameNumbers(a.physicalDown, b.physicalDown) &&
    a.pedalDown === b.pedalDown &&
    sameNumbers(a.wrong, b.wrong) &&
    sameNumbers(a.waitingFor, b.waitingFor) &&
    a.countInRemaining === b.countInRemaining &&
    a.audioState === b.audioState &&
    a.midiState === b.midiState &&
    a.midiInputName === b.midiInputName &&
    a.midiInputConnected === b.midiInputConnected &&
    a.midiInputNotFound === b.midiInputNotFound &&
    a.message === b.message
  );
}

/** Keeps unchanged arrays (and hand records) identical across snapshots, for cheap memoised rendering. */
function reuseArrays(prev: SessionSnapshot, next: SessionSnapshot): SessionSnapshot {
  return {
    ...next,
    expected: sameHandRecord(prev.expected, next.expected) ? prev.expected : next.expected,
    struck: sameHandRecord(prev.struck, next.struck) ? prev.struck : next.struck,
    physicalDown: sameNumbers(prev.physicalDown, next.physicalDown) ? prev.physicalDown : next.physicalDown,
    wrong: sameNumbers(prev.wrong, next.wrong) ? prev.wrong : next.wrong,
    waitingFor: sameNumbers(prev.waitingFor, next.waitingFor) ? prev.waitingFor : next.waitingFor,
  };
}
