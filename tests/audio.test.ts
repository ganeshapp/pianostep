import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlackKey } from '../src/core/pitch';
import { SAMPLE_MIDIS, nearestSampleMidi, sampleFileName, sampleForMidi } from '../src/audio/sampleMap';
import { PianoSampler, midiToFrequency, velocityToGain, type AudioState } from '../src/audio/sampler';

/* ------------------------------------------------------------------------ */
/* Fake Web Audio                                                            */
/* ------------------------------------------------------------------------ */

type AutomationKind = 'set' | 'linear' | 'exp' | 'target';
interface Automation {
  kind: AutomationKind;
  value: number;
  time: number;
  tau?: number;
}

/** Records automation and evaluates it with Web Audio semantics (no cancelAndHold). */
class FakeParam {
  value: number;
  events: Automation[] = [];
  constructor(value: number) {
    this.value = value;
  }
  private add(e: Automation): this {
    // Same-time events go after existing ones, as in the Web Audio spec.
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
    return this;
  }
  setValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number): this {
    return this.add({ kind: 'linear', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('exponential ramp target must be positive');
    return this.add({ kind: 'exp', value, time });
  }
  setTargetAtTime(value: number, time: number, tau: number): this {
    return this.add({ kind: 'target', value, time, tau });
  }
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
  valueAt(t: number): number {
    let curTime = 0;
    let curValue = this.value;
    let target: Automation | null = null;
    const follow = (x: number): number =>
      target ? target.value + (curValue - target.value) * Math.exp(-(x - curTime) / (target.tau ?? 1)) : curValue;
    for (const e of this.events) {
      if (e.kind === 'linear' || e.kind === 'exp') {
        if (t < e.time) {
          const f = (t - curTime) / (e.time - curTime);
          return e.kind === 'linear' ? curValue + (e.value - curValue) * f : curValue * (e.value / curValue) ** f;
        }
        curTime = e.time;
        curValue = e.value;
        target = null;
      } else {
        if (t < e.time) return follow(t);
        curValue = e.kind === 'set' ? e.value : follow(e.time);
        curTime = e.time;
        target = e.kind === 'target' ? e : null;
      }
    }
    return follow(t);
  }
}

class FakeNode {
  outputs: FakeNode[] = [];
  disconnectCalls = 0;
  connect(n: FakeNode): FakeNode {
    this.outputs.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnectCalls++;
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

interface FakeBuffer {
  name: string;
  duration: number;
}

class FakeSource extends FakeNode {
  startTime: number | undefined;
  stopTime: number | undefined;
  stopCalls: number[] = [];
  onended: (() => void) | null = null;
  start(when = 0): void {
    if (this.startTime !== undefined) throw new Error('InvalidStateError: start called twice');
    this.startTime = when;
  }
  stop(when = 0): void {
    if (this.startTime === undefined) throw new Error('InvalidStateError: stop before start');
    this.stopCalls.push(when);
    this.stopTime = when;
  }
  fireEnded(): void {
    this.onended?.();
  }
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam(1);
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
}

const SAMPLE_DURATION = 12;

class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  gains: FakeGain[] = [];
  sources: FakeBufferSource[] = [];
  oscillators: FakeOscillator[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  /** Names of encoded buffers to fail decoding. */
  corrupt = new Set<string>();
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor();
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    const name = encoded.get(data) ?? '?';
    if (this.corrupt.has(name)) return Promise.reject(new Error('EncodingError'));
    return Promise.resolve({ name, duration: SAMPLE_DURATION });
  }
}

const encoded = new WeakMap<ArrayBuffer, string>();

type FetchOutcome = 'ok' | 'http404' | 'network';
interface FakeFetch {
  fn: typeof fetch;
  urls: string[];
  signals: (AbortSignal | undefined)[];
  /** Resolves every held request (when created with hold = true). */
  release(): void;
}

function makeFetch(outcome: (file: string) => FetchOutcome = () => 'ok', hold = false): FakeFetch {
  const urls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const held: (() => void)[] = [];
  const fn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    signals.push(init?.signal ?? undefined);
    const file = url.slice(url.lastIndexOf('/') + 1);
    const respond = (): Promise<Response> => {
      const kind = outcome(file);
      if (kind === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      const ab = new ArrayBuffer(8);
      encoded.set(ab, file);
      const res = { ok: kind === 'ok', status: kind === 'ok' ? 200 : 404, arrayBuffer: () => Promise.resolve(ab) };
      return Promise.resolve(res as unknown as Response);
    };
    if (!hold) return respond();
    return new Promise<Response>((res, rej) => held.push(() => respond().then(res, rej)));
  };
  return {
    fn: fn as typeof fetch,
    urls,
    signals,
    release: () => held.splice(0).forEach((r) => r()),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(fetch: FakeFetch = makeFetch()) {
  const ctx = new FakeContext();
  let created = 0;
  const sampler = new PianoSampler({
    baseUrl: 'https://example.test/app/audio/piano/',
    createContext: () => {
      created++;
      return ctx as unknown as AudioContext;
    },
    fetchFn: fetch.fn,
  });
  return { ctx, sampler, fetch, createdCount: () => created };
}

async function loaded(fetch?: FakeFetch) {
  const s = setup(fetch);
  await s.sampler.ensureStarted();
  await s.sampler.whenLoaded();
  return s;
}

/**
 * Per-voice level at time t: product of the gain nodes between the source and
 * the master gain (excluded). 0 when not playing or disconnected.
 */
function voiceLevel(src: FakeSource, t: number): number {
  if (src.startTime === undefined || t < src.startTime) return 0;
  if (src.stopTime !== undefined && t >= Math.max(src.stopTime, src.startTime)) return 0;
  const chain: FakeGain[] = [];
  let node: FakeNode | undefined = src.outputs[0];
  while (node instanceof FakeGain) {
    chain.push(node);
    node = node.outputs[0];
  }
  if (node === undefined) return 0;
  chain.pop();
  return chain.reduce((p, g) => p * g.gain.valueAt(t), 1);
}

function sourcesFor(ctx: FakeContext, file: string): FakeBufferSource[] {
  return ctx.sources.filter((s) => s.buffer?.name === file);
}

const SEMITONE = 2 ** (1 / 12);

/* ------------------------------------------------------------------------ */
/* Sample map                                                                */
/* ------------------------------------------------------------------------ */

describe('sampleMap', () => {
  it('lists the 30 recordings A0..C8, every third semitone, and every file exists', () => {
    expect(SAMPLE_MIDIS).toHaveLength(30);
    expect(SAMPLE_MIDIS[0]).toBe(21);
    expect(SAMPLE_MIDIS[29]).toBe(108);
    SAMPLE_MIDIS.forEach((m, i) => expect(m).toBe(21 + 3 * i));
    const dir = resolve(__dirname, '../public/audio/piano');
    for (const m of SAMPLE_MIDIS) expect(existsSync(resolve(dir, sampleFileName(m))), sampleFileName(m)).toBe(true);
  });

  it('names files with the Salamander convention', () => {
    expect(sampleFileName(21)).toBe('A0v8.mp3');
    expect(sampleFileName(24)).toBe('C1v8.mp3');
    expect(sampleFileName(27)).toBe('Ds1v8.mp3');
    expect(sampleFileName(30)).toBe('Fs1v8.mp3');
    expect(sampleFileName(60)).toBe('C4v8.mp3');
    expect(sampleFileName(63)).toBe('Ds4v8.mp3');
    expect(sampleFileName(69)).toBe('A4v8.mp3');
    expect(sampleFileName(105)).toBe('A7v8.mp3');
    expect(sampleFileName(108)).toBe('C8v8.mp3');
    expect(() => sampleFileName(61)).toThrow(RangeError);
    expect(() => sampleFileName(18)).toThrow(RangeError); // F#0 is not recorded
    expect(() => sampleFileName(111)).toThrow(RangeError); // D#8 is not recorded
  });

  it.each([
    // [midi, file, shift]
    [21, 'A0v8.mp3', 0], // A0, lowest key
    [22, 'A0v8.mp3', 1], // A#0
    [23, 'C1v8.mp3', -1], // B0
    [60, 'C4v8.mp3', 0],
    [61, 'C4v8.mp3', 1], // C#4
    [62, 'Ds4v8.mp3', -1], // D4
    [63, 'Ds4v8.mp3', 0], // D#4
    [64, 'Ds4v8.mp3', 1], // E4
    [65, 'Fs4v8.mp3', -1], // F4
    [66, 'Fs4v8.mp3', 0], // F#4
    [67, 'Fs4v8.mp3', 1], // G4
    [68, 'A4v8.mp3', -1], // G#4
    [69, 'A4v8.mp3', 0],
    [70, 'A4v8.mp3', 1], // A#4
    [71, 'C5v8.mp3', -1], // B4
    [106, 'A7v8.mp3', 1], // A#7
    [107, 'C8v8.mp3', -1], // B7
    [108, 'C8v8.mp3', 0], // C8, highest key
    [20, 'A0v8.mp3', -1], // G#0, below the piano
    [12, 'A0v8.mp3', -9], // C0
    [0, 'A0v8.mp3', -21],
    [109, 'C8v8.mp3', 1], // C#8, above the piano
    [120, 'C8v8.mp3', 12], // C9
    [127, 'C8v8.mp3', 19],
  ])('midi %i -> %s shifted %i semitones', (midi, file, shift) => {
    const c = sampleForMidi(midi);
    expect(c.file).toBe(file);
    expect(c.shift).toBe(shift);
    expect(c.sampleMidi).toBe(midi - shift);
    expect(c.playbackRate).toBeCloseTo(2 ** (shift / 12), 12);
  });

  it('exact playback rates at a few anchors', () => {
    expect(sampleForMidi(60).playbackRate).toBe(1);
    expect(sampleForMidi(61).playbackRate).toBeCloseTo(1.0594630943592953, 12);
    expect(sampleForMidi(62).playbackRate).toBeCloseTo(0.9438743126816935, 12);
    expect(sampleForMidi(120).playbackRate).toBe(2);
    expect(sampleForMidi(12).playbackRate).toBeCloseTo(0.5946035575013605, 12);
  });

  it('every key on the piano, black or white, is within one semitone of its recording', () => {
    let black = 0;
    for (let m = 21; m <= 108; m++) {
      const c = sampleForMidi(m);
      expect(Math.abs(c.shift)).toBeLessThanOrEqual(1);
      expect(nearestSampleMidi(m)).toBe(c.sampleMidi);
      if (isBlackKey(m)) {
        black++;
        // A# uses A, C# uses C, D# is recorded, F# is recorded, G# uses A.
        expect([-1, 0, 1]).toContain(c.shift);
      }
    }
    expect(black).toBe(36);
  });
});

/* ------------------------------------------------------------------------ */
/* Velocity curve                                                            */
/* ------------------------------------------------------------------------ */

describe('velocityToGain', () => {
  it('is strictly increasing over 1..127 and reaches 1 at 127', () => {
    for (let v = 2; v <= 127; v++) expect(velocityToGain(v)).toBeGreaterThan(velocityToGain(v - 1));
    expect(velocityToGain(127)).toBe(1);
    expect(velocityToGain(1)).toBeGreaterThan(0.015);
  });

  it('follows a square-law (perceptual) curve rather than a linear one', () => {
    expect(velocityToGain(80)).toBeCloseTo(0.02 + 0.98 * (80 / 127) ** 2, 12);
    // Half velocity is about -11 dB, not -6 dB as a linear map would give.
    const halfDb = 20 * Math.log10(velocityToGain(64) / velocityToGain(127));
    expect(halfDb).toBeGreaterThan(-12);
    expect(halfDb).toBeLessThan(-10);
  });

  it('midiToFrequency is equal-tempered at A4 = 440 Hz', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(21)).toBe(27.5);
    expect(midiToFrequency(81)).toBe(880);
    expect(midiToFrequency(108)).toBeCloseTo(4186.009, 3);
  });

  it('clamps out-of-range velocities', () => {
    expect(velocityToGain(0)).toBe(velocityToGain(1));
    expect(velocityToGain(500)).toBe(1);
    expect(velocityToGain(Number.NaN)).toBe(velocityToGain(80));
  });
});

/* ------------------------------------------------------------------------ */
/* Sampler                                                                   */
/* ------------------------------------------------------------------------ */

describe('PianoSampler startup and loading', () => {
  it('does nothing before ensureStarted', () => {
    const { ctx, sampler, createdCount } = setup();
    expect(sampler.state).toBe('not-started');
    expect(sampler.currentTime).toBe(0);
    expect(sampler.context).toBeNull();
    sampler.noteOn(60, 80, 1);
    sampler.noteOff(60, 2);
    sampler.click(1, true);
    sampler.allNotesOff();
    expect(createdCount()).toBe(0);
    expect(ctx.sources.length + ctx.oscillators.length).toBe(0);
  });

  it('creates and resumes the context once, loads all 30 samples in parallel, and resolves before they decode', async () => {
    const fetch = makeFetch(() => 'ok', true);
    const { ctx, sampler, createdCount } = setup(fetch);
    const states: AudioState[] = [];
    sampler.onStateChange((s) => states.push(s));
    const loadedP = sampler.whenLoaded();

    const started = sampler.ensureStarted();
    // Everything that needs the user gesture happened synchronously.
    expect(createdCount()).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(fetch.urls).toHaveLength(30);
    expect(fetch.urls[0]).toBe('https://example.test/app/audio/piano/A0v8.mp3');
    expect(new Set(fetch.urls).size).toBe(30);
    expect(fetch.urls).toContain('https://example.test/app/audio/piano/Ds4v8.mp3');
    expect(fetch.urls).toContain('https://example.test/app/audio/piano/C8v8.mp3');

    await started;
    expect(ctx.state).toBe('running');
    expect(sampler.state).toBe('loading');
    expect(sampler.context).toBe(ctx as unknown as AudioContext);

    await sampler.ensureStarted();
    expect(createdCount()).toBe(1);
    expect(fetch.urls).toHaveLength(30);

    fetch.release();
    await loadedP;
    expect(sampler.state).toBe('ready');
    expect(states).toEqual(['loading', 'ready']);
    await expect(sampler.whenLoaded()).resolves.toBeUndefined();
  });

  it('reports the context clock as currentTime', async () => {
    const { ctx, sampler } = await loaded();
    ctx.currentTime = 3.5;
    expect(sampler.currentTime).toBe(3.5);
  });

  it('uses BASE_URL + audio/piano/ by default', async () => {
    const ctx = new FakeContext();
    const fetch = makeFetch();
    const sampler = new PianoSampler({ createContext: () => ctx as unknown as AudioContext, fetchFn: fetch.fn });
    await sampler.ensureStarted();
    expect(fetch.urls[0]).toBe(`${import.meta.env.BASE_URL}audio/piano/A0v8.mp3`);
  });

  it('enters the error state when a fetch fails, keeps the fallback, and retries on the next ensureStarted', async () => {
    let failC4 = true;
    const fetch = makeFetch((file) => (file === 'C4v8.mp3' && failC4 ? 'http404' : 'ok'));
    const { ctx, sampler } = setup(fetch);
    const states: AudioState[] = [];
    sampler.onStateChange((s) => states.push(s));
    await sampler.ensureStarted();
    await expect(sampler.whenLoaded()).rejects.toThrow(/C4v8\.mp3: HTTP 404/);
    expect(sampler.state).toBe('error');
    expect(states).toEqual(['loading', 'error']);

    // Middle C's sample is missing: triangle fallback. A4's sample loaded: piano.
    sampler.noteOn(60, 80, 1);
    sampler.noteOn(69, 80, 1);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('triangle');
    expect(ctx.oscillators[0].frequency.value).toBeCloseTo(261.6256, 3);
    expect(ctx.oscillators[0].frequency.value).toBe(midiToFrequency(60));
    expect(sourcesFor(ctx, 'A4v8.mp3')).toHaveLength(1);

    failC4 = false;
    await sampler.ensureStarted();
    expect(sampler.state).toBe('loading');
    await sampler.whenLoaded();
    expect(sampler.state).toBe('ready');
    // Only the missing file was fetched again.
    expect(fetch.urls.filter((u) => u.endsWith('C4v8.mp3'))).toHaveLength(2);
    expect(fetch.urls).toHaveLength(31);
    sampler.noteOn(60, 80, 2);
    expect(sourcesFor(ctx, 'C4v8.mp3')).toHaveLength(1);
  });

  it('treats network and decode failures as errors too', async () => {
    const network = setup(makeFetch(() => 'network'));
    await network.sampler.ensureStarted();
    await expect(network.sampler.whenLoaded()).rejects.toThrow(/Could not load 30 of 30 piano samples/);
    network.sampler.noteOn(64, 80, 1);
    expect(network.ctx.oscillators).toHaveLength(1);
    expect(network.ctx.sources).toHaveLength(0);

    const decode = setup();
    decode.ctx.corrupt.add('Fs3v8.mp3');
    await decode.sampler.ensureStarted();
    await expect(decode.sampler.whenLoaded()).rejects.toThrow(/Fs3v8\.mp3: EncodingError/);
    expect(decode.sampler.state).toBe('error');
  });

  it('reports an error when Web Audio cannot be created', async () => {
    const sampler = new PianoSampler({
      createContext: () => {
        throw new Error('no AudioContext');
      },
      fetchFn: makeFetch().fn,
    });
    await expect(sampler.ensureStarted()).rejects.toThrow(/no AudioContext/);
    expect(sampler.state).toBe('error');
  });
});

describe('PianoSampler voices', () => {
  it('plays a fallback triangle voice before samples are decoded', async () => {
    const fetch = makeFetch(() => 'ok', true);
    const { ctx, sampler } = setup(fetch);
    await sampler.ensureStarted();
    expect(sampler.state).toBe('loading');

    sampler.noteOn(69, 127, 1);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.type).toBe('triangle');
    expect(osc.frequency.value).toBe(440);
    expect(osc.startTime).toBe(1);
    // Bounded even without a note-off.
    expect(osc.stopTime).toBe(9);
    expect(voiceLevel(osc, 0.999)).toBe(0);
    expect(voiceLevel(osc, 1.005)).toBeCloseTo(0.15, 6);
    // It decays like a struck string.
    expect(voiceLevel(osc, 2.205)).toBeCloseTo(0.15 * Math.exp(-1), 6);

    sampler.noteOff(69, 2);
    expect(osc.stopTime).toBe(2.25);

    fetch.release();
    await sampler.whenLoaded();
    sampler.noteOn(69, 127, 3);
    expect(ctx.oscillators).toHaveLength(1);
    expect(sourcesFor(ctx, 'A4v8.mp3')).toHaveLength(1);
    // The fallback is quieter than the piano at the same velocity.
    expect(voiceLevel(sourcesFor(ctx, 'A4v8.mp3')[0], 3.1)).toBeGreaterThan(voiceLevel(osc, 1.005));
  });

  it('ignores anything that is not a MIDI note number (0-127), without throwing', async () => {
    const { ctx, sampler } = await loaded();
    for (const midi of [1e8, -1e8, -1, 128, 60.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sampler.noteOn(midi, 80, 1)).not.toThrow();
      expect(() => sampler.noteOff(midi, 2)).not.toThrow();
    }
    expect(ctx.sources.length + ctx.oscillators.length).toBe(0);
    sampler.noteOn(0, 80, 1);
    sampler.noteOn(127, 80, 1);
    expect(ctx.sources).toHaveLength(2);
  });

  it('picks the sample and playback rate for in-range, black and out-of-range notes', async () => {
    const { ctx, sampler } = await loaded();
    const cases: [number, string, number][] = [
      [21, 'A0v8.mp3', 1],
      [61, 'C4v8.mp3', SEMITONE],
      [68, 'A4v8.mp3', 1 / SEMITONE],
      [108, 'C8v8.mp3', 1],
      [12, 'A0v8.mp3', 2 ** (-9 / 12)],
      [120, 'C8v8.mp3', 2],
    ];
    cases.forEach(([midi], i) => sampler.noteOn(midi, 80, 1 + i));
    cases.forEach(([, file, rate], i) => {
      const src = ctx.sources[i];
      expect(src.buffer?.name).toBe(file);
      expect(src.playbackRate.value).toBeCloseTo(rate, 12);
      expect(src.startTime).toBe(1 + i);
      expect(src.stopTime).toBeUndefined();
    });
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('scales voice gain by the velocity curve', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 100, 1);
    sampler.noteOn(64, 50, 1);
    sampler.noteOn(67, 127, 1);
    const [a, b, c] = ctx.sources;
    expect(voiceLevel(a, 1.5) / voiceLevel(b, 1.5)).toBeCloseTo(velocityToGain(100) / velocityToGain(50), 12);
    expect(voiceLevel(c, 1.5)).toBeGreaterThan(voiceLevel(a, 1.5));
    sampler.noteOn(72, undefined, 1);
    expect(voiceLevel(ctx.sources[3], 1.5) / voiceLevel(c, 1.5)).toBeCloseTo(velocityToGain(80), 12);
  });

  it('releases over about 0.25 s with an exponential fade', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 127, 1);
    sampler.noteOff(60, 2);
    const src = ctx.sources[0];
    const full = voiceLevel(src, 1.5);
    expect(voiceLevel(src, 2) / full).toBeCloseTo(1, 12);
    expect(voiceLevel(src, 2.125) / full).toBeCloseTo(Math.sqrt(0.001), 9);
    expect(voiceLevel(src, 2.2499) / full).toBeCloseTo(0.001, 4);
    expect(src.stopTime).toBe(2.25);
    expect(voiceLevel(src, 2.25)).toBe(0);
  });

  it('re-strikes: the ringing voice fades in 30 ms at the new attack', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    sampler.noteOn(60, 80, 2);
    const [old, fresh] = ctx.sources;
    const full = voiceLevel(old, 1.5);
    expect(voiceLevel(old, 1.999) / full).toBeCloseTo(1, 12);
    expect(voiceLevel(old, 2.015) / full).toBeCloseTo(Math.sqrt(0.001), 9);
    expect(old.stopTime).toBe(2.03);
    expect(fresh.startTime).toBe(2);
    expect(fresh.stopTime).toBeUndefined();
    expect(voiceLevel(fresh, 2.5)).toBeCloseTo(full, 12);
  });

  it('re-striking a key that is already fading continues its curve without jumping back up', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    sampler.noteOff(60, 2);
    sampler.noteOn(60, 80, 2.1);
    const old = ctx.sources[0];
    const full = voiceLevel(old, 1.5);
    const at21 = 0.001 ** (0.1 / 0.25);
    expect(voiceLevel(old, 2.05) / full).toBeCloseTo(0.001 ** (0.05 / 0.25), 9);
    expect(voiceLevel(old, 2.1) / full).toBeCloseTo(at21, 9);
    expect(voiceLevel(old, 2.115) / full).toBeCloseTo(Math.sqrt(at21 * 0.001), 9);
    expect(old.stopTime).toBeCloseTo(2.13, 12);
  });

  it('fades requested out of time order keep the envelope continuous', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    sampler.noteOff(60, 2);
    sampler.noteOn(60, 80, 2.2);
    sampler.noteOn(60, 80, 2.1); // arrives late, lands inside the release and before the 2.2 strike
    const [first, at22, at21] = ctx.sources;
    const full = voiceLevel(first, 1.5);
    expect(voiceLevel(first, 2.05) / full).toBeCloseTo(0.001 ** (0.05 / 0.25), 9);
    expect(voiceLevel(first, 2.1) / full).toBeCloseTo(0.001 ** (0.1 / 0.25), 9);
    expect(first.stopTime).toBeCloseTo(2.13, 12);
    expect(at21.startTime).toBe(2.1);
    expect(at21.stopTime).toBeCloseTo(2.23, 12);
    expect(at22.stopTime).toBeUndefined();
  });

  function offOnAtSameTime(order: 'off-first' | 'on-first') {
    return (async () => {
      const { ctx, sampler } = await loaded();
      sampler.noteOn(60, 80, 1);
      if (order === 'off-first') {
        sampler.noteOff(60, 2);
        sampler.noteOn(60, 80, 2);
      } else {
        sampler.noteOn(60, 80, 2);
        sampler.noteOff(60, 2);
      }
      return { ctx, sampler };
    })();
  }

  it.each(['off-first', 'on-first'] as const)(
    'off(k,t) and on(k,t) at the same time (%s) re-attack the key and keep the new voice',
    async (order) => {
      const { ctx, sampler } = await offOnAtSameTime(order);
      const [old, fresh] = ctx.sources;
      expect(ctx.sources).toHaveLength(2);
      expect(old.stopTime).toBeCloseTo(2.03, 12);
      expect(voiceLevel(old, 2.015) / voiceLevel(old, 1.5)).toBeCloseTo(Math.sqrt(0.001), 9);
      expect(fresh.startTime).toBe(2);
      expect(fresh.stopTime).toBeUndefined();
      expect(voiceLevel(fresh, 2.9)).toBeGreaterThan(0.1);
      // The next note-off releases the new voice normally.
      sampler.noteOff(60, 3);
      expect(fresh.stopTime).toBe(3.25);
      expect(old.stopTime).toBeCloseTo(2.03, 12);
    },
  );

  it('never releases a voice that starts at or after the note-off time', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 5);
    sampler.noteOff(60, 4);
    sampler.noteOff(60, 5);
    expect(ctx.sources[0].stopTime).toBeUndefined();
    sampler.noteOff(60, 6);
    expect(ctx.sources[0].stopTime).toBe(6.25);
  });

  it('an earlier note-off wins over a later one, whatever the call order', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    sampler.noteOff(60, 3);
    sampler.noteOff(60, 2);
    const src = ctx.sources[0];
    expect(src.stopTime).toBe(2.25);
    expect(voiceLevel(src, 2.125) / voiceLevel(src, 1.5)).toBeCloseTo(Math.sqrt(0.001), 9);
    expect(voiceLevel(src, 2.9)).toBe(0);
    sampler.noteOff(60, 4);
    expect(src.stopTime).toBe(2.25);
  });

  it('a strike scheduled out of order is cut by the later strike already scheduled', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 3);
    sampler.noteOn(60, 80, 2);
    const [later, earlier] = ctx.sources;
    expect(earlier.startTime).toBe(2);
    expect(earlier.stopTime).toBeCloseTo(3.03, 12);
    expect(later.stopTime).toBeUndefined();
  });

  it('two strikes of a key at the same instant leave one voice sounding', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 2);
    sampler.noteOn(60, 100, 2);
    const [first, second] = ctx.sources;
    expect(first.stopTime).toBeCloseTo(2.03, 12);
    expect(second.stopTime).toBeUndefined();
  });

  it('treats velocity 0 as a note-off', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    sampler.noteOn(60, 0, 2);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].stopTime).toBe(2.25);
  });

  it("keeps the app's voices and the learner's monitored voices of a key apart", async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1); // the app's C4, 1-3 s
    sampler.noteOff(60, 3);
    sampler.noteOn(60, 80, 1.02, 'input'); // the learner holds C4 from 1.02 s...
    sampler.noteOff(60, 3, 'app'); // (the app's release again: only the app's voice)
    const [app, learner] = ctx.sources;
    // The learner's strike does not cut the app's voice, and the app's release leaves the learner's.
    expect(app.stopTime).toBe(3.25);
    expect(learner.stopTime).toBeUndefined();
    sampler.noteOff(60, 4, 'input'); // ...to 4 s
    expect(learner.stopTime).toBe(4.25);
    expect(app.stopTime).toBe(3.25);

    // A short learner tap does not cut the app's next strike, and vice versa.
    sampler.noteOn(62, 80, 5.95, 'input');
    sampler.noteOn(62, 80, 6); // the app's D4, 6-7 s
    sampler.noteOff(62, 7);
    sampler.noteOff(62, 6.1, 'input');
    const [tap, appD] = ctx.sources.slice(2);
    expect(appD.stopTime).toBe(7.25);
    expect(tap.stopTime).toBeCloseTo(6.35, 12);
    // A velocity-0 note-on releases only its own owner's voice.
    sampler.noteOn(64, 80, 8);
    sampler.noteOn(64, 0, 8.5, 'input');
    expect(ctx.sources[4].stopTime).toBeUndefined();
    // allNotesOff still silences both.
    sampler.allNotesOff();
    expect(ctx.sources[4].stopTime).toBeDefined();
  });

  it('schedules a past "when" at the current time', async () => {
    const { ctx, sampler } = await loaded();
    ctx.currentTime = 5;
    sampler.noteOn(60, 80, 4.99);
    sampler.noteOn(62, 80);
    expect(ctx.sources[0].startTime).toBe(5);
    expect(ctx.sources[1].startTime).toBe(5);
    // Bookkeeping keeps the requested time, so off(60, 4.99) does not cut it.
    sampler.noteOff(60, 4.99);
    expect(ctx.sources[0].stopTime).toBeUndefined();
  });

  it('cleans up finished voices', async () => {
    const { ctx, sampler } = await loaded();
    sampler.noteOn(60, 80, 1);
    const src = ctx.sources[0];
    const [level, env] = [src.outputs[0] as FakeGain, (src.outputs[0] as FakeGain).outputs[0] as FakeGain];
    src.fireEnded();
    expect(src.disconnectCalls).toBe(1);
    expect(level.disconnectCalls).toBe(1);
    expect(env.disconnectCalls).toBe(1);
    // The voice is forgotten: a later note-off does not touch it.
    sampler.noteOff(60, 2);
    expect(src.stopCalls).toEqual([]);
  });
});

describe('PianoSampler allNotesOff, click, volume, dispose', () => {
  it('allNotesOff fades sounding voices and cancels future-scheduled voices and clicks', async () => {
    const { ctx, sampler } = await loaded();
    ctx.currentTime = 1;
    sampler.noteOn(60, 80); // sounding now
    sampler.noteOn(64, 80, 3); // scheduled ahead
    sampler.noteOn(67, 80, 1.02); // scheduled just ahead
    sampler.click(2.5, true);
    const [now60, future64, future67] = ctx.sources;
    const click = ctx.oscillators[0];

    sampler.allNotesOff();

    expect(now60.stopTime).toBeCloseTo(1.05, 12);
    expect(voiceLevel(now60, 1.025) / voiceLevel(now60, 1)).toBeCloseTo(Math.sqrt(0.001), 9);
    for (const t of [1.02, 3, 3.5, 10]) {
      expect(voiceLevel(future64, t)).toBe(0);
      expect(voiceLevel(future67, t)).toBe(0);
      expect(voiceLevel(click, t)).toBe(0);
    }
    expect(future64.stopCalls).toEqual([0]);
    expect(future64.outputs).toEqual([]);
    expect(click.stopCalls.at(-1)).toBe(0);

    // Cancelled voices are forgotten; nothing comes back.
    sampler.noteOff(64, 4);
    expect(future64.stopCalls).toEqual([0]);
  });

  it('allNotesOff accepts a custom fade, and 0 stops at once', async () => {
    const { ctx, sampler } = await loaded();
    ctx.currentTime = 1;
    sampler.noteOn(60, 80);
    sampler.noteOn(62, 80);
    sampler.allNotesOff(0.2);
    expect(ctx.sources[0].stopTime).toBeCloseTo(1.2, 12);
    sampler.noteOn(64, 80);
    sampler.allNotesOff(0);
    expect(ctx.sources[2].stopCalls).toEqual([0]);
    expect(voiceLevel(ctx.sources[2], 1)).toBe(0);
  });

  it('click is a short blip; the accent is higher and louder', async () => {
    const { ctx, sampler } = await loaded();
    sampler.click(2, true);
    sampler.click(3);
    const [accent, plain] = ctx.oscillators;
    expect(accent.startTime).toBe(2);
    expect(accent.stopTime).toBeCloseTo(2.05, 12);
    expect(plain.startTime).toBe(3);
    expect(plain.stopTime).toBeCloseTo(3.05, 12);
    expect(accent.frequency.value).toBeGreaterThan(plain.frequency.value);
    const peak = (o: FakeOscillator) => (o.outputs[0] as FakeGain).gain.valueAt(o.startTime! + 0.001);
    expect(peak(accent)).toBeCloseTo(0.5, 12);
    expect(peak(plain)).toBeCloseTo(0.3, 12);
    expect(ctx.sources).toHaveLength(0);
  });

  it('setVolume clamps to 0..1 and applies before and after start', async () => {
    const { ctx, sampler } = setup();
    sampler.setVolume(0.3);
    await sampler.ensureStarted();
    const master = ctx.gains[0];
    expect(master.gain.value).toBe(0.3);
    sampler.setVolume(2);
    expect(master.gain.events.at(-1)).toMatchObject({ kind: 'target', value: 1 });
    sampler.setVolume(-1);
    expect(master.gain.events.at(-1)).toMatchObject({ kind: 'target', value: 0 });
    expect(master.gain.events).toHaveLength(1);
  });

  it('dispose stops everything, closes the context and ignores later calls', async () => {
    const { ctx, sampler } = await loaded();
    const states: AudioState[] = [];
    sampler.onStateChange((s) => states.push(s));
    sampler.noteOn(60, 80, 0.5);
    sampler.noteOn(62, 80, 3);
    sampler.click(4);
    sampler.dispose();

    expect(ctx.closeCalls).toBe(1);
    expect(sampler.context).toBeNull();
    expect(sampler.currentTime).toBe(0);
    for (const src of [...ctx.sources, ...ctx.oscillators]) {
      expect(src.stopCalls.length).toBeGreaterThan(0);
      expect(voiceLevel(src, 5)).toBe(0);
    }
    const before = ctx.sources.length + ctx.oscillators.length;
    sampler.noteOn(64, 80, 6);
    sampler.click(6);
    sampler.allNotesOff();
    sampler.dispose();
    expect(ctx.sources.length + ctx.oscillators.length).toBe(before);
    expect(ctx.closeCalls).toBe(1);
    await expect(sampler.ensureStarted()).rejects.toThrow();
    expect(states).toEqual([]);
  });

  it('dispose during loading aborts the fetches and freezes the state', async () => {
    const fetch = makeFetch(() => 'ok', true);
    const { sampler } = setup(fetch);
    const states: AudioState[] = [];
    sampler.onStateChange((s) => states.push(s));
    await sampler.ensureStarted();
    sampler.dispose();
    expect(fetch.signals.every((s) => s?.aborted === true)).toBe(true);
    fetch.release();
    await tick();
    expect(sampler.state).toBe('loading');
    expect(states).toEqual(['loading']);
  });
});
