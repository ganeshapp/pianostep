import { SAMPLE_MIDIS, sampleFileName, sampleForMidi } from './sampleMap';

export type AudioState = 'not-started' | 'loading' | 'ready' | 'error';

/**
 * Who started a voice: the app's own playback (Listen, Steady, previews) or
 * the learner's monitored MIDI input ("Hear my playing"). They are two
 * players: a strike or a release by one never ends the other's voice on the
 * same key.
 */
export type VoiceOwner = 'app' | 'input';

export interface PianoSamplerOptions {
  /** Folder holding the sample files; defaults to `<BASE_URL>audio/piano/`. */
  baseUrl?: string;
  createContext?: () => AudioContext;
  fetchFn?: typeof fetch;
}

/** Time for a released key to fall by 60 dB (the damper settling on the string). */
export const RELEASE_SEC = 0.25;
/** Fade of a key's previous voice when the same key is struck again. */
export const RESTRIKE_FADE_SEC = 0.03;
export const DEFAULT_VELOCITY = 80;
export const DEFAULT_VOLUME = 0.8;

/** A MIDI note number: an integer from 0 to 127. */
function isMidiNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 127;
}

/** -60 dB: the end point of every exponential fade, after which the source is stopped. */
const SILENT = 0.001;
const MIN_VELOCITY_GAIN = 0.02;
/** Headroom per voice so several loud keys together stay below clipping. */
const SAMPLE_LEVEL = 0.6;
/** The triangle fallback is deliberately quieter and plainer than the piano. */
const FALLBACK_LEVEL = 0.15;
const FALLBACK_ATTACK_SEC = 0.005;
const FALLBACK_DECAY_TAU = 1.2;
const FALLBACK_MAX_SEC = 8;
const MIN_FADE_SEC = 0.005;
const CLICK_SEC = 0.05;
const VOLUME_SMOOTHING_TAU = 0.015;
/** Voices whose `ended` event was somehow lost are dropped this long after their end. */
const PRUNE_GRACE_SEC = 1;

/**
 * Perceptual velocity curve. Amplitude follows the square of velocity, which is
 * the MIDI DLS curve (40·log10(v/127) dB), so equal velocity steps sound like
 * roughly equal loudness steps. A small floor keeps velocity 1 audible.
 * Velocity 127 -> 1.0, 80 -> ~0.41, 40 -> ~0.12, 1 -> ~0.02.
 */
export function velocityToGain(velocity: number): number {
  const v = Number.isFinite(velocity) ? Math.min(127, Math.max(1, velocity)) : DEFAULT_VELOCITY;
  const x = v / 127;
  return MIN_VELOCITY_GAIN + (1 - MIN_VELOCITY_GAIN) * x * x;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

interface Voice {
  midi: number;
  /** Strikes and releases only affect voices of the same owner. */
  owner: VoiceOwner;
  /** Requested start on the engine clock; decides which noteOff applies to this voice. */
  start: number;
  /** Actual scheduled start (never earlier than the context time at scheduling). */
  startAt: number;
  source: AudioScheduledSourceNode;
  /** Velocity gain (and, for the fallback, its attack/decay). */
  level: GainNode;
  /** Release envelope: 1 until released, then exponential fades to SILENT. */
  env: GainNode;
  /** The envelope automation as scheduled (empty = not released); mirrors `env.gain`. */
  fade: FadePoint[];
  /** When the voice stops sounding (natural end or end of its fade). */
  endAt: number;
}

interface FadePoint {
  time: number;
  level: number;
}

/** Envelope level at time `x`: 1 before the first point, exponential between points. */
function fadeLevelAt(points: readonly FadePoint[], x: number): number {
  if (points.length === 0 || x <= points[0].time) return 1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.time) return a.level * (b.level / a.level) ** ((x - a.time) / (b.time - a.time));
  }
  return points[points.length - 1].level;
}

interface ClickVoice {
  startAt: number;
  source: OscillatorNode;
  gain: GainNode;
}

function defaultBaseUrl(): string {
  // Vite replaces import.meta.env at build time; under plain Node (scripts) it is undefined.
  const base = import.meta.env?.BASE_URL;
  return typeof base === 'string' ? `${base}audio/piano/` : './audio/piano/';
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function safeStop(source: AudioScheduledSourceNode, when?: number): void {
  try {
    source.stop(when);
  } catch {
    // Older WebKit throws when stop() is called twice; the source is stopping anyway.
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

export class PianoSampler {
  private readonly baseUrl: string;
  private readonly createContext: () => AudioContext;
  private readonly fetchFn: typeof fetch;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private currentState: AudioState = 'not-started';
  private loadError: Error | null = null;
  private readonly listeners = new Set<(s: AudioState) => void>();
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly voices = new Set<Voice>();
  private readonly clicks = new Set<ClickVoice>();
  private volume = DEFAULT_VOLUME;
  private loadGeneration = 0;
  private loadAbort: AbortController | null = null;
  private disposed = false;

  constructor(opts: PianoSamplerOptions = {}) {
    this.baseUrl = withSlash(opts.baseUrl ?? defaultBaseUrl());
    this.createContext = opts.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
    this.fetchFn = opts.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  }

  get state(): AudioState {
    return this.currentState;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Call from a user-gesture handler. Creating and resuming the context happen
   * synchronously, before the first await, so the browser's autoplay policy
   * counts them as part of the gesture.
   */
  async ensureStarted(): Promise<void> {
    if (this.disposed) throw new Error('The piano sound has been shut down.');
    let ctx = this.ctx;
    if (!ctx) {
      try {
        ctx = this.openContext();
      } catch (e) {
        this.loadError = new Error(`Browser audio is not available: ${toError(e).message}`);
        this.setState('error');
        throw this.loadError;
      }
    }
    if (ctx.state === 'closed') throw new Error('Browser audio was closed.');
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    // A failed load is retried on the next gesture; already-decoded samples are kept.
    if (this.currentState === 'not-started' || this.currentState === 'error') this.startLoading(ctx);
    await resumed;
  }

  /** Resolves when every sample is decoded; rejects if loading failed (the fallback still plays). */
  whenLoaded(): Promise<void> {
    if (this.currentState === 'ready') return Promise.resolve();
    if (this.currentState === 'error') {
      return Promise.reject(this.loadError ?? new Error('Piano samples failed to load.'));
    }
    return new Promise<void>((resolve, reject) => {
      const off = this.onStateChange((s) => {
        if (s === 'ready') {
          off();
          resolve();
        } else if (s === 'error') {
          off();
          reject(this.loadError ?? new Error('Piano samples failed to load.'));
        }
      });
    });
  }

  /** Called on every later state change (not immediately with the current state). */
  onStateChange(fn: (s: AudioState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  noteOn(midi: number, velocity: number = DEFAULT_VELOCITY, when?: number, owner: VoiceOwner = 'app'): void {
    const ctx = this.ctx;
    const master = this.master;
    // Anything but a MIDI note number (0-127) is ignored: a far-out pitch would
    // need a non-finite playback rate, which the Web Audio API refuses by throwing.
    if (!ctx || !master || this.disposed || !isMidiNumber(midi)) return;
    // MIDI convention: a note-on with velocity 0 is a note-off.
    if (velocity <= 0) {
      this.noteOff(midi, when, owner);
      return;
    }
    const now = ctx.currentTime;
    const t = when !== undefined && Number.isFinite(when) ? when : now;
    this.prune(now);

    // A key has one string set: striking it again silences what was still ringing.
    // If a later strike of this key is already scheduled, this voice must end there.
    // The app and the learner each have their own (see VoiceOwner).
    let nextStrike = Infinity;
    for (const v of this.voicesOf(midi, owner)) {
      if (v.start > t) nextStrike = Math.min(nextStrike, v.start);
      else if (v.endAt > t) this.releaseVoice(v, t, RESTRIKE_FADE_SEC);
    }

    const gain = velocityToGain(velocity);
    const at = Math.max(t, now);
    const choice = sampleForMidi(midi);
    const buffer = this.buffers.get(choice.sampleMidi);
    const voice = buffer
      ? this.startSampleVoice(ctx, master, midi, owner, gain, t, at, buffer, choice.playbackRate)
      : this.startFallbackVoice(ctx, master, midi, owner, gain, t, at);
    this.voices.add(voice);
    if (nextStrike < Infinity) this.releaseVoice(voice, nextStrike, RESTRIKE_FADE_SEC);
  }

  /**
   * Releases this key's voices of `owner` that started strictly before `when`
   * and are still sounding after it. A voice starting at or after `when` is
   * never touched, so off(k, t) and on(k, t) give the same result in either
   * call order. Voices of the other owner are left alone.
   */
  noteOff(midi: number, when?: number, owner: VoiceOwner = 'app'): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed || !isMidiNumber(midi)) return;
    const t = when !== undefined && Number.isFinite(when) ? when : ctx.currentTime;
    for (const v of this.voicesOf(midi, owner)) {
      if (v.start < t) this.releaseVoice(v, t, RELEASE_SEC);
    }
  }

  /** Fades every sounding voice and cancels every voice and click scheduled for later. */
  allNotesOff(fadeSec = 0.05): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const v of [...this.voices]) {
      if (v.startAt > now || !(fadeSec > 0)) this.cancelVoice(v);
      else this.releaseVoice(v, now, fadeSec);
    }
    for (const c of [...this.clicks]) {
      if (c.startAt > now) this.cancelClick(c);
    }
  }

  /** Count-in tick: a short bright blip; the accented (first) beat is higher and louder. */
  click(when: number, accent = false): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.disposed || !Number.isFinite(when)) return;
    const at = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 2000 : 1500;
    const gain = ctx.createGain();
    const peak = accent ? 0.5 : 0.3;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(peak * SILENT, at + CLICK_SEC);
    osc.connect(gain);
    gain.connect(master);
    const c: ClickVoice = { startAt: at, source: osc, gain };
    osc.onended = () => this.cleanupClick(c);
    osc.start(at);
    osc.stop(at + CLICK_SEC);
    this.clicks.add(c);
  }

  setVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      // Smoothed so dragging a slider does not crackle.
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.volume, now, VOLUME_SMOOTHING_TAU);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadAbort?.abort();
    this.loadAbort = null;
    for (const v of [...this.voices]) this.cancelVoice(v);
    for (const c of [...this.clicks]) this.cancelClick(c);
    this.listeners.clear();
    this.buffers.clear();
    if (this.master) safeDisconnect(this.master);
    if (this.limiter) safeDisconnect(this.limiter);
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  /* ---------------------------------------------------------------------- */

  private openContext(): AudioContext {
    const ctx = this.createContext();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    let out: AudioNode = ctx.destination;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      // A gentle limiter: dense full-velocity chords would otherwise clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      limiter.connect(ctx.destination);
      this.limiter = limiter;
      out = limiter;
    }
    master.connect(out);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  private startLoading(ctx: AudioContext): void {
    const generation = ++this.loadGeneration;
    this.loadAbort?.abort();
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    this.loadAbort = abort;
    this.loadError = null;
    this.setState('loading');
    const pending = SAMPLE_MIDIS.filter((m) => !this.buffers.has(m));
    void Promise.allSettled(pending.map((m) => this.loadSample(ctx, m, abort?.signal))).then((results) => {
      if (this.disposed || generation !== this.loadGeneration) return;
      this.loadAbort = null;
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failures.push(`${sampleFileName(pending[i])}: ${toError(r.reason).message}`);
      });
      if (failures.length === 0) {
        this.setState('ready');
        return;
      }
      const shown = failures.slice(0, 3).join('; ');
      const more = failures.length > 3 ? `; and ${failures.length - 3} more` : '';
      this.loadError = new Error(
        `Could not load ${failures.length} of ${SAMPLE_MIDIS.length} piano samples (${shown}${more}). ` +
          'A simpler fallback sound is used for those notes.',
      );
      this.setState('error');
    });
  }

  private async loadSample(ctx: AudioContext, midi: number, signal: AbortSignal | undefined): Promise<void> {
    const res = await this.fetchFn(this.baseUrl + sampleFileName(midi), signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    if (!this.disposed && this.ctx === ctx) this.buffers.set(midi, buffer);
  }

  private setState(s: AudioState): void {
    if (s === this.currentState) return;
    this.currentState = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  private voicesOf(midi: number, owner: VoiceOwner): Voice[] {
    return [...this.voices].filter((v) => v.midi === midi && v.owner === owner);
  }

  private startSampleVoice(
    ctx: AudioContext,
    master: GainNode,
    midi: number,
    owner: VoiceOwner,
    gain: number,
    t: number,
    at: number,
    buffer: AudioBuffer,
    playbackRate: number,
  ): Voice {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const level = ctx.createGain();
    level.gain.value = gain * SAMPLE_LEVEL;
    return this.wireVoice(ctx, master, midi, owner, t, at, source, level, at + buffer.duration / playbackRate, false);
  }

  /** Used until a note's sample is decoded, or when it failed to load. */
  private startFallbackVoice(
    ctx: AudioContext,
    master: GainNode,
    midi: number,
    owner: VoiceOwner,
    gain: number,
    t: number,
    at: number,
  ): Voice {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);
    const level = ctx.createGain();
    const peak = gain * FALLBACK_LEVEL;
    // Quick attack then a free decay, so it reads as struck notes rather than an organ,
    // and a forgotten note-off cannot leave a tone sounding forever.
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(peak, at + FALLBACK_ATTACK_SEC);
    level.gain.setTargetAtTime(0, at + FALLBACK_ATTACK_SEC, FALLBACK_DECAY_TAU);
    return this.wireVoice(ctx, master, midi, owner, t, at, osc, level, at + FALLBACK_MAX_SEC, true);
  }

  private wireVoice(
    ctx: AudioContext,
    master: GainNode,
    midi: number,
    owner: VoiceOwner,
    t: number,
    at: number,
    source: AudioScheduledSourceNode,
    level: GainNode,
    endAt: number,
    stopAtEnd: boolean,
  ): Voice {
    const env = ctx.createGain();
    env.gain.value = 1;
    source.connect(level);
    level.connect(env);
    env.connect(master);
    const voice: Voice = { midi, owner, start: t, startAt: at, source, level, env, fade: [], endAt };
    source.onended = () => this.cleanupVoice(voice);
    source.start(at);
    if (stopAtEnd) source.stop(endAt);
    return voice;
  }

  /**
   * Fades `v` from time `t` over `fadeSec`, unless it already ends by then.
   * Calls may arrive in any time order. If `t` falls inside an earlier fade,
   * that curve is kept up to `t` (its level there is computed exactly, since
   * cancelAndHoldAtTime is not available everywhere) and the new fade starts
   * from that level, so the envelope never jumps back up.
   */
  private releaseVoice(v: Voice, t: number, fadeSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = Math.max(t, ctx.currentTime, v.startAt);
    const end = at + Math.max(fadeSec, MIN_FADE_SEC);
    if (end >= v.endAt) return;
    const g = v.env.gain;
    const kept = v.fade.filter((p) => p.time < at);
    const from = fadeLevelAt(v.fade, at);
    g.cancelScheduledValues(at);
    if (kept.length === 0) g.setValueAtTime(1, at);
    else g.exponentialRampToValueAtTime(from, at);
    g.exponentialRampToValueAtTime(SILENT, end);
    safeStop(v.source, end);
    v.fade = [...kept, { time: at, level: from }, { time: end, level: SILENT }];
    v.endAt = end;
  }

  /** Silences a voice at once; used for voices that have not started yet, and on dispose. */
  private cancelVoice(v: Voice): void {
    safeStop(v.source);
    this.cleanupVoice(v);
  }

  private cleanupVoice(v: Voice): void {
    this.voices.delete(v);
    v.source.onended = null;
    safeDisconnect(v.source);
    safeDisconnect(v.level);
    safeDisconnect(v.env);
  }

  private cancelClick(c: ClickVoice): void {
    safeStop(c.source);
    this.cleanupClick(c);
  }

  private cleanupClick(c: ClickVoice): void {
    this.clicks.delete(c);
    c.source.onended = null;
    safeDisconnect(c.source);
    safeDisconnect(c.gain);
  }

  private prune(now: number): void {
    for (const v of [...this.voices]) {
      if (v.endAt + PRUNE_GRACE_SEC < now) this.cleanupVoice(v);
    }
    for (const c of [...this.clicks]) {
      if (c.startAt + CLICK_SEC + PRUNE_GRACE_SEC < now) this.cleanupClick(c);
    }
  }
}
