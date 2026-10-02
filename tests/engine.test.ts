import { describe, expect, it } from 'vitest';
import {
  COUNT_IN_BEATS,
  LOOKAHEAD_SEC,
  MIDI_LOOKAHEAD_SEC,
  PREVIEW_SEC,
  PracticeSession,
  SCHEDULER_INTERVAL_MS,
  SESSION_MESSAGES,
  START_LEAD_SEC,
} from '../src/engine/session';
import { MidiManager } from '../src/midi/manager';
import { DEFAULT_SETTINGS } from '../src/core/types';
import type { MeasureOccurrence, PracticeSettings, PreparedScore, SourceScore, TempoMap } from '../src/core/types';
import { L, R, TPQ, buildMeasures, buildScore, tempoMap } from './helpers/pressBuilder';
import type { PressSpec } from './helpers/pressBuilder';
import { FakeClock, FakeMidi, FakeSampler } from './helpers/fakes';
import type { SamplerCall } from './helpers/fakes';

const C3 = 48;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;

/* ------------------------------------------------------------------------ */
/* Builders                                                                  */
/* ------------------------------------------------------------------------ */

function prepared(
  specs: readonly PressSpec[],
  opts: { measures?: MeasureOccurrence[]; tempo?: TempoMap; velocity?: number } = {},
): PreparedScore {
  const base = buildScore(specs, opts.measures);
  const presses = opts.velocity === undefined ? base.presses : base.presses.map((p) => ({ ...p, velocity: opts.velocity }));
  const source: SourceScore = {
    title: 'Test piece',
    subtitle: null,
    composer: null,
    arranger: null,
    rights: null,
    software: null,
    credits: [],
    ticksPerQuarter: TPQ,
    parts: [],
    measures: [],
    notes: [],
    tempos: [],
    pedalMarks: 0,
    warnings: [],
  };
  const midis = presses.map((p) => p.midi);
  return {
    meta: { title: 'Test piece', composer: null, arranger: null },
    source,
    handMapping: { staffHands: {}, excludedParts: [], source: 'two-staff-part', description: '' },
    measures: base.measures,
    tempo: opts.tempo ?? tempoMap([[0, 120]]),
    notes: [],
    presses,
    endTick: base.endTick,
    range: midis.length ? { min: Math.min(...midis), max: Math.max(...midis) } : null,
    warnings: [],
    readiness: 'ready',
    readinessReasons: [],
  };
}

/**
 * Score A — 120 qpm for ticks 0-8, then 60 qpm (one tick = 0.125 s, then 0.25 s).
 * RH: C4 0-4, C4 again 4-8, G4 8-12. LH: C3 held 0-16. One 16-tick measure.
 * Steps at ticks 0, 4, 8, 12, 16 → 0, 0.5, 1.0, 2.0, 3.0 s at speed 1.
 */
const SCORE_A = prepared([R('C4', 0, 4), R('C4', 4, 8), R('G4', 8, 12), L('C3', 0, 16)], {
  tempo: tempoMap([
    [0, 120],
    [8, 60],
  ]),
});

/** Short notes, then a long E4: steps at 0, 0.125, 0.25 and 2.0 s. */
const SCORE_LONG = prepared([R('C4', 0, 1), R('D4', 1, 2), R('E4', 2, 16)]);

/** One note, then a 12-tick rest to the end of the measure: steps at 0 and 0.5 s, passage 2 s. */
const SCORE_TAIL = prepared([R('C4', 0, 4)]);

/** Opens with a 4-tick rest: steps at 0.5 and 1.0 s. */
const SCORE_REST_FIRST = prepared([R('C4', 4, 8)]);

interface Harness {
  sampler: FakeSampler;
  midi: FakeMidi;
  clock: FakeClock;
  session: PracticeSession;
}

function setup(score: PreparedScore, patch: Partial<PracticeSettings> = {}, shared?: Omit<Harness, 'session'>): Harness {
  const sampler = shared?.sampler ?? new FakeSampler();
  const clock = shared?.clock ?? new FakeClock(sampler);
  const midi = shared?.midi ?? new FakeMidi(clock.nowMs);
  const session = new PracticeSession(
    score,
    { ...DEFAULT_SETTINGS, ...patch },
    {
      sampler,
      midi,
      nowMs: clock.nowMs,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    },
  );
  return { sampler, midi, clock, session };
}

/** Starts playback and returns the audio-clock time of passage time 0 (when starting at step 0). */
async function start(h: Harness): Promise<number> {
  const t0 = h.clock.audioNow;
  await h.session.play();
  return t0 + START_LEAD_SEC;
}

type Ev = [kind: 'on' | 'off', midi: number, rel: number];

function noteEvents(calls: readonly SamplerCall[], anchor: number): Ev[] {
  const out: Ev[] = [];
  for (const c of calls) {
    if (c.kind === 'noteOn') out.push(['on', c.midi, round(c.when - anchor)]);
    else if (c.kind === 'noteOff') out.push(['off', c.midi, round(c.when - anchor)]);
  }
  return out;
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

function expectNoPastScheduling(calls: readonly SamplerCall[]): void {
  for (const c of calls) {
    if (c.kind === 'noteOn' || c.kind === 'noteOff' || c.kind === 'click') {
      expect(c.when).toBeGreaterThanOrEqual(c.now - 1e-9);
    }
  }
}

/** Every note-on is eventually released by a later note-off, a re-strike or an all-notes-off. */
function expectNothingStuck(sampler: FakeSampler): void {
  expect(sampler.stuck()).toEqual([]);
}

/** Tiny deterministic PRNG. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/* ------------------------------------------------------------------------ */
/* Listen                                                                    */
/* ------------------------------------------------------------------------ */

describe('Listen: scheduling', () => {
  it('plays exact note-on and note-off times through a tempo change at speed 1', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    expect(h.session.getSnapshot().status).toBe('playing');
    h.clock.advance(4000);

    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C4, 0.5],
      ['on', C4, 0.5],
      ['off', C4, 1],
      ['on', G4, 1],
      ['off', G4, 2],
      ['off', C3, 3],
    ]);
    for (const c of h.sampler.noteOns()) expect(c.velocity).toBe(80);
    expectNoPastScheduling(h.sampler.calls);
    // Lookahead: nothing is handed over more than one window (plus one timer period) early.
    for (const c of [...h.sampler.noteOns(), ...h.sampler.noteOffs()]) {
      expect(c.when - c.now).toBeLessThanOrEqual(LOOKAHEAD_SEC + SCHEDULER_INTERVAL_MS / 1000 + 1e-9);
    }
    expect(h.session.getSnapshot().status).toBe('finished');
    expectNothingStuck(h.sampler);
  });

  it('doubles every time at speed 0.5 and uses press velocities', async () => {
    const h = setup(
      prepared([R('C4', 0, 4), R('C4', 4, 8), R('G4', 8, 12), L('C3', 0, 16)], {
        tempo: SCORE_A.tempo,
        velocity: 100,
      }),
      { speed: 0.5 },
    );
    const anchor = await start(h);
    h.clock.advance(7000);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C4, 1],
      ['on', C4, 1],
      ['off', C4, 2],
      ['on', G4, 2],
      ['off', G4, 4],
      ['off', C3, 6],
    ]);
    for (const c of h.sampler.noteOns()) expect(c.velocity).toBe(100);
  });

  it('puts note-offs before note-ons at the same instant (same float time)', async () => {
    const h = setup(SCORE_A);
    await start(h);
    h.clock.advance(1500);
    const calls = h.sampler.calls.filter((c) => c.kind === 'noteOn' || c.kind === 'noteOff');
    const off = calls.findIndex((c) => c.kind === 'noteOff' && c.midi === C4);
    const on = calls.findIndex((c, i) => i > off && c.kind === 'noteOn' && c.midi === C4);
    expect(off).toBeGreaterThan(-1);
    expect(on).toBe(off + 1);
    const offCall = calls[off] as Extract<SamplerCall, { kind: 'noteOff' }>;
    const onCall = calls[on] as Extract<SamplerCall, { kind: 'noteOn' }>;
    expect(offCall.when).toBe(onCall.when);
  });

  it('runs to the passage end, including trailing rests, before finishing', async () => {
    const h = setup(SCORE_TAIL);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.9);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 1 });
    expect(h.session.getVisualPosition()).toBe(1);
    h.clock.advanceToAudio(anchor + 2.03);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'finished', stepIndex: 1 });
    expect(h.clock.activeIntervals).toBe(0);
    expect(h.session.getVisualPosition()).toBe(1);
  });

  it('moves the marker at the step times', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    const at = (rel: number): number => {
      h.clock.advanceToAudio(anchor + rel);
      return h.session.getSnapshot().stepIndex;
    };
    expect(at(0.475)).toBe(0);
    expect(at(0.525)).toBe(1);
    expect(at(0.975)).toBe(1);
    expect(at(1.025)).toBe(2);
    expect(at(1.975)).toBe(2);
    expect(at(2.025)).toBe(3);
    expect(at(2.975)).toBe(3);
    expect(at(3.025)).toBe(4);
  });

  it('interpolates the visual position by time and dwells during a long note', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 0.25);
    expect(h.session.getVisualPosition()).toBeCloseTo(0.5, 6);
    h.clock.advanceToAudio(anchor + 1.5);
    expect(h.session.getVisualPosition()).toBeCloseTo(2.5, 6);

    const long = setup(SCORE_LONG);
    const a2 = await start(long);
    const samples: number[] = [];
    for (const rel of [0.3, 0.7, 1.1, 1.5, 1.9]) {
      long.clock.advanceToAudio(a2 + rel);
      expect(long.session.getSnapshot().stepIndex).toBe(2);
      samples.push(long.session.getVisualPosition());
    }
    // E4 lasts 1.75 s, so the marker creeps from column 2 towards column 3.
    samples.forEach((p, i) => expect(p).toBeCloseTo(2 + (0.3 + 0.4 * i - 0.25) / 1.75, 6));
  });

  it('keeps the marker on column 0 through an opening rest, as the snapshot step', async () => {
    const h = setup(SCORE_REST_FIRST);
    expect(h.session.getVisualPosition()).toBe(0);
    const anchor = await start(h);
    // No jump back to an empty column -1 on Play: the marker waits on step 0.
    expect(h.session.getVisualPosition()).toBe(0);
    h.clock.advanceToAudio(anchor + 0.25);
    expect(h.session.getVisualPosition()).toBe(0);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    h.clock.advanceToAudio(anchor + 0.75);
    expect(h.session.getVisualPosition()).toBeCloseTo(0.5, 6);
    h.clock.advanceToAudio(anchor + 1.2);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C4, 0.5],
      ['off', C4, 1],
    ]);
  });

  it('treats a key held by both hands as one key: struck by each hand, released by the last', async () => {
    const h = setup(prepared([R('C4', 0, 16), L('C4', 4, 8)]));
    const anchor = await start(h);
    h.clock.advance(3000);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C4, 0],
      ['on', C4, 0.5],
      ['off', C4, 2],
    ]);
    expect(h.sampler.soundingAt(anchor + 1.5)).toEqual([C4]);
    expectNothingStuck(h.sampler);
  });

  it('reports the integer step while paused or stopped', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.5);
    h.session.pause();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 2 });
    h.clock.advance(500);
    expect(h.session.getVisualPosition()).toBe(2);
    h.session.stop();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', stepIndex: 0 });
    expect(h.session.getVisualPosition()).toBe(0);
  });

  it('resumes from the marker step after a pause and re-sounds held keys', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.5);
    h.session.pause();
    h.clock.advance(1000);
    const mark = h.sampler.calls.length;
    const resumeAt = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    h.clock.advance(3000);
    // Step 2 starts at 1.0 s: G4 is struck there and C3 is still held.
    expect(noteEvents(h.sampler.since(mark), resumeAt - 1)).toEqual([
      ['on', C3, 1],
      ['on', G4, 1],
      ['off', G4, 2],
      ['off', C3, 3],
    ]);
    expectNothingStuck(h.sampler);
  });
});

/* ------------------------------------------------------------------------ */
/* Seeking and manual stepping                                               */
/* ------------------------------------------------------------------------ */

describe('Seeking and stepping', () => {
  it('seeking mid-piece while playing re-sounds held keys and schedules nothing stale', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 0.3);
    const offs = h.sampler.allNotesOffCount();
    const mark = h.sampler.calls.length;
    const now = h.clock.audioNow;
    h.session.seek(2);
    expect(h.sampler.allNotesOffCount()).toBe(offs + 1);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 2 });
    h.clock.advance(4000);
    const after = h.sampler.since(mark);
    for (const c of after) if (c.kind === 'noteOn' || c.kind === 'noteOff') expect(c.when).toBeGreaterThanOrEqual(now);
    // Step 2 is reached at 1.0 s; playback resumes there after the start lead.
    const restartAt = now + START_LEAD_SEC;
    expect(noteEvents(after, restartAt - 1)).toEqual([
      ['on', C3, 1],
      ['on', G4, 1],
      ['off', G4, 2],
      ['off', C3, 3],
    ]);
    expectNothingStuck(h.sampler);
  });

  it('seeking backwards while playing reconstructs the state at that step', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 2.5);
    const mark = h.sampler.calls.length;
    const now = h.clock.audioNow;
    h.session.seek(1);
    h.clock.advance(4000);
    expect(noteEvents(h.sampler.since(mark), now + START_LEAD_SEC - 0.5)).toEqual([
      ['on', C3, 0.5],
      ['on', C4, 0.5],
      ['off', C4, 1],
      ['on', G4, 1],
      ['off', G4, 2],
      ['off', C3, 3],
    ]);
  });

  it('seeking while stopped or paused is silent', async () => {
    const h = setup(SCORE_A);
    h.session.seek(3);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', stepIndex: 3 });
    expect(h.sampler.calls).toEqual([]);
    expect(h.midi.sends).toEqual([]);

    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 0.2);
    h.session.pause();
    const mark = h.sampler.calls.length;
    h.session.seek(1);
    h.session.seek(4);
    h.clock.advance(2000);
    expect(h.sampler.since(mark)).toEqual([]);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 4 });
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('clamps seek targets', () => {
    const h = setup(SCORE_A);
    h.session.seek(99);
    expect(h.session.getSnapshot().stepIndex).toBe(4);
    h.session.seek(-3);
    expect(h.session.getSnapshot().stepIndex).toBe(0);
    h.session.seek(Number.NaN);
    expect(h.session.getSnapshot().stepIndex).toBe(0);
  });

  it('next/prev preview the struck keys and release them within 0.5 s', () => {
    const h = setup(SCORE_A);
    h.session.next();
    expect(h.session.getSnapshot().stepIndex).toBe(1);
    const t = h.clock.audioNow;
    expect(noteEvents(h.sampler.calls, t)).toEqual([
      ['on', C4, 0],
      ['off', C4, PREVIEW_SEC],
    ]);
    expect(h.sampler.soundingAt(t + 0.1)).toEqual([C4]);
    expect(h.sampler.soundingAt(t + PREVIEW_SEC)).toEqual([]);

    h.clock.advance(100);
    const mark = h.sampler.calls.length;
    h.session.prev();
    const t2 = h.clock.audioNow;
    expect(h.session.getSnapshot().stepIndex).toBe(0);
    expect(noteEvents(h.sampler.since(mark), t2)).toEqual([
      ['off', C4, 0],
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C3, PREVIEW_SEC],
      ['off', C4, PREVIEW_SEC],
    ]);
    expect(h.sampler.soundingAt(t2 + PREVIEW_SEC)).toEqual([]);
    expectNothingStuck(h.sampler);
    // No interval is needed for a preview.
    expect(h.clock.created).toBe(0);
  });

  it('a release-only step previews nothing; prev at the start and next at the end do nothing', () => {
    const h = setup(SCORE_A);
    h.session.prev();
    expect(h.sampler.calls).toEqual([]);
    h.session.seek(3);
    h.session.next();
    expect(h.session.getSnapshot().stepIndex).toBe(4);
    expect(h.sampler.noteOns()).toEqual([]);
    h.session.next();
    expect(h.session.getSnapshot().stepIndex).toBe(4);
  });

  it('does not preview with sound off or in Follow me', () => {
    const silent = setup(SCORE_A, { sound: false });
    silent.session.next();
    expect(silent.session.getSnapshot().stepIndex).toBe(1);
    expect(silent.sampler.noteOns()).toEqual([]);

    const follow = setup(SCORE_A, { mode: 'follow' });
    follow.session.next();
    expect(follow.session.getSnapshot().stepIndex).toBe(1);
    expect(follow.sampler.noteOns()).toEqual([]);
  });

  it('next while playing jumps and keeps playing without a separate preview', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 0.1);
    h.session.next();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 1 });
    h.clock.advance(4000);
    expect(h.session.getSnapshot().status).toBe('finished');
    expectNothingStuck(h.sampler);
  });

  it('restart goes to step 0 and keeps playing', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 2.2);
    const mark = h.sampler.calls.length;
    const now = h.clock.audioNow;
    h.session.restart();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    h.clock.advance(200);
    expect(noteEvents(h.sampler.since(mark), now + START_LEAD_SEC)).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* No stuck notes                                                            */
/* ------------------------------------------------------------------------ */

describe('No stuck notes', () => {
  type Action = (h: Harness) => void | Promise<void>;
  const stopping: [string, Action][] = [
    ['pause', (h) => h.session.pause()],
    ['stop', (h) => h.session.stop()],
    ['mode change', (h) => h.session.updateSettings({ mode: 'steady' })],
    ['hands change', (h) => h.session.updateSettings({ hands: 'R' })],
    ['range change', (h) => h.session.updateSettings({ range: { startOcc: 0, endOcc: 0 } })],
    ['dispose', (h) => h.session.dispose()],
  ];

  for (const [name, act] of stopping) {
    it(`${name} releases everything and nothing sounds afterwards`, async () => {
      const h = setup(SCORE_A, { midiOutputId: 'out-1' });
      const anchor = await start(h);
      h.clock.advanceToAudio(anchor + 1.3);
      expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([C3, G4]);
      const offs = h.sampler.allNotesOffCount();
      const midiOffs = h.midi.sends.filter((s) => s.kind === 'allNotesOff').length;
      const mark = h.sampler.calls.length;
      const sendMark = h.midi.sends.length;
      await act(h);
      expect(h.sampler.allNotesOffCount()).toBe(offs + 1);
      expect(h.midi.sends.filter((s) => s.kind === 'allNotesOff').length).toBeGreaterThan(midiOffs);
      h.clock.advance(10_000);
      expect(h.sampler.since(mark).filter((c) => c.kind === 'noteOn' || c.kind === 'click')).toEqual([]);
      expect(h.midi.sends.slice(sendMark).filter((s) => s.kind === 'on')).toEqual([]);
      expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([]);
      expectNothingStuck(h.sampler);
      expect(h.clock.activeIntervals).toBe(0);
    });
  }

  const continuing: [string, Partial<PracticeSettings>][] = [
    ['speed change', { speed: 0.75 }],
    ['sound change', { sound: false }],
    ['output change', { midiOutputId: null }],
  ];
  for (const [name, patch] of continuing) {
    it(`${name} while playing releases, re-anchors and still pairs every note`, async () => {
      const h = setup(SCORE_A, { midiOutputId: 'out-1' });
      const anchor = await start(h);
      h.clock.advanceToAudio(anchor + 1.3);
      const offs = h.sampler.allNotesOffCount();
      h.session.updateSettings(patch);
      expect(h.sampler.allNotesOffCount()).toBe(offs + 1);
      expect(h.session.getSnapshot().status).toBe('playing');
      h.clock.advance(10_000);
      expect(h.session.getSnapshot().status).toBe('finished');
      expectNothingStuck(h.sampler);
      expectNoPastScheduling(h.sampler.calls);
    });
  }

  it('a speed change keeps the musical position and re-sounds held keys', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.5);
    const mark = h.sampler.calls.length;
    const now = h.clock.audioNow;
    h.session.updateSettings({ speed: 0.5 });
    expect(h.session.getSnapshot().stepIndex).toBe(2);
    h.clock.advance(8000);
    // 1.5 s at 1x = 3.0 s at 0.5x; G4 ends at 2 s (now 4 s) and C3 at 3 s (now 6 s).
    expect(noteEvents(h.sampler.since(mark).slice(1), now + START_LEAD_SEC - 3)).toEqual([
      ['on', C3, 3],
      ['on', G4, 3],
      ['off', G4, 4],
      ['off', C3, 6],
    ]);
  });

  it('a step-length change in Steady steps re-anchors at the same step fraction', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 1 });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 2.5);
    const offs = h.sampler.allNotesOffCount();
    const mark = h.sampler.calls.length;
    const now = h.clock.audioNow;
    h.session.updateSettings({ stepSeconds: 2 });
    expect(h.sampler.allNotesOffCount()).toBe(offs + 1);
    h.clock.advance(10_000);
    // 2.5 steps → 5 s at 2 s per step; G4 ends at step 3 (6 s), C3 at step 4 (8 s).
    expect(noteEvents(h.sampler.since(mark).slice(1), now + START_LEAD_SEC - 5)).toEqual([
      ['on', C3, 5],
      ['on', G4, 5],
      ['off', G4, 6],
      ['off', C3, 8],
    ]);
    expectNothingStuck(h.sampler);
  });

  it('a loop restart without count-in starts again cleanly, every key released by its own note-off', async () => {
    const h = setup(SCORE_A, { loop: true });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 2.9);
    const offs = h.sampler.allNotesOffCount();
    h.clock.advanceToAudio(anchor + 3.03);
    // Chained seamlessly: nothing is cut by a release-all at the seam.
    expect(h.sampler.allNotesOffCount()).toBe(offs);
    expect(h.sampler.soundingAt(anchor + 3 - 1e-6)).toEqual([C3]);
    expect(h.sampler.soundingAt(anchor + 3 + 1e-6)).toEqual([C3, C4]);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    h.clock.advance(1500);
    h.session.updateSettings({ loop: false });
    h.clock.advance(4000);
    expect(h.session.getSnapshot().status).toBe('finished');
    expectNothingStuck(h.sampler);
    expectNoPastScheduling(h.sampler.calls);
    // Two full passes of four strikes each.
    expect(h.sampler.noteOns().length).toBe(8);
  });

  it('every note-on in a long random run is released', async () => {
    const rand = lcg(20240611);
    const specs: PressSpec[] = [];
    const keys = [C3, 52, 55, C4, D4, E4, G4];
    for (const hand of ['R', 'L'] as const) {
      for (const key of keys) {
        let t = Math.floor(rand() * 6);
        while (t < 60) {
          const len = 1 + Math.floor(rand() * 10);
          specs.push({ hand, key, start: t, end: Math.min(64, t + len) });
          t += len + Math.floor(rand() * 4);
        }
      }
    }
    const score = prepared(specs, {
      measures: buildMeasures(4),
      tempo: tempoMap([
        [0, 132],
        [24, 90],
        [40, 150],
      ]),
    });
    const h = setup(score, { midiOutputId: 'out-1' });
    const n = () => h.session.getSnapshot().stepCount;

    const actions: (() => void | Promise<void>)[] = [
      () => h.session.play(),
      () => h.session.play(),
      () => h.session.pause(),
      () => h.session.stop(),
      () => h.session.togglePlay(),
      () => h.session.seek(Math.floor(rand() * n())),
      () => h.session.next(),
      () => h.session.prev(),
      () => h.session.restart(),
      () => h.session.updateSettings({ speed: 0.25 + Math.round(rand() * 35) * 0.05 }),
      () => h.session.updateSettings({ stepSeconds: 0.3 + rand() * 1.2 }),
      () => h.session.updateSettings({ mode: rand() < 0.5 ? 'listen' : 'steady' }),
      () => h.session.updateSettings({ loop: rand() < 0.5 }),
      () => h.session.updateSettings({ countIn: rand() < 0.3 }),
      () => h.session.updateSettings({ sound: rand() < 0.8 }),
      () => h.session.updateSettings({ hands: (['both', 'R', 'L'] as const)[Math.floor(rand() * 3)] }),
      () => {
        const a = Math.floor(rand() * 4);
        const b = Math.floor(rand() * 4);
        h.session.updateSettings({ range: rand() < 0.3 ? null : { startOcc: Math.min(a, b), endOcc: Math.max(a, b) } });
      },
    ];

    for (let i = 0; i < 400; i++) {
      const pick = Math.floor(rand() * actions.length);
      const wasPlaying = ['playing', 'count-in'].includes(h.session.getSnapshot().status);
      await actions[pick]();
      if (pick === 3 || (pick === 2 && wasPlaying)) {
        expect(h.sampler.soundingAt(h.clock.audioNow + 1e-6)).toEqual([]);
      }
      h.clock.advance(Math.floor(rand() * 900));
    }

    h.session.updateSettings({ loop: false, sound: true });
    await h.session.play();
    h.clock.advance(200_000);
    expect(h.session.getSnapshot().status).toMatch(/finished|stopped/);
    expect(h.sampler.noteOns().length).toBeGreaterThan(200);
    expectNothingStuck(h.sampler);
    expectNoPastScheduling(h.sampler.calls);
    expect(h.clock.activeIntervals).toBe(0);

    // MIDI output: every key sent on is followed by an off or an all-notes-off.
    const down = new Map<number, number>();
    for (const s of h.midi.sends) {
      if (s.kind === 'on') down.set(s.midi, (down.get(s.midi) ?? 0) + 1);
      else if (s.kind === 'off') down.delete(s.midi);
      else down.clear();
    }
    expect([...down.keys()]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Count-in and loop                                                         */
/* ------------------------------------------------------------------------ */

describe('Count-in and loop', () => {
  // Measure 2 of two: C3 is held over the bar line (carried), then E4 and G4.
  const SCORE_CARRY = prepared([L('C3', 8, 24), R('C4', 0, 8), R('E4', 16, 20), R('G4', 20, 24)], {
    measures: buildMeasures(2),
  });

  it('clicks four beats, then plays; loops with clicks again and carried keys at step 0', async () => {
    const h = setup(SCORE_CARRY, { countIn: true, loop: true, range: { startOcc: 1, endOcc: 1 } });
    const t0 = h.clock.audioNow;
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', countInRemaining: 4, stepIndex: 0 });

    const first = t0 + START_LEAD_SEC;
    const beat = 0.5; // 120 qpm at speed 1
    const remaining: (number | null)[] = [];
    for (let j = 0; j < COUNT_IN_BEATS; j++) {
      h.clock.advanceToAudio(first + j * beat + 0.03);
      remaining.push(h.session.getSnapshot().countInRemaining);
    }
    expect(remaining).toEqual([4, 3, 2, 1]);
    expect(h.sampler.noteOns()).toEqual([]);
    const clicks = h.sampler.clicks();
    expect(clicks.map((c) => round(c.when - first))).toEqual([0, 0.5, 1, 1.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);

    const startAt = first + COUNT_IN_BEATS * beat;
    h.clock.advanceToAudio(startAt + 0.03);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', countInRemaining: null });
    expect(noteEvents(h.sampler.noteOns(), startAt)).toEqual([
      ['on', C3, 0],
      ['on', E4, 0],
    ]);

    // Passage = one measure = 2 s; then release, count in again, restart with C3.
    h.clock.advanceToAudio(startAt + 2.03);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', countInRemaining: 4, stepIndex: 0 });
    expect(h.sampler.soundingAt(h.clock.audioNow + 1e-6)).toEqual([]);
    const loopFirst = h.sampler.clicks()[4].when;
    expect(h.sampler.clicks().length).toBe(4 + 1);
    const mark = h.sampler.calls.length;
    h.clock.advanceToAudio(loopFirst + 2.03);
    expect(h.sampler.clicks().length).toBe(8);
    expect(noteEvents(h.sampler.since(mark), loopFirst + 2)).toEqual([
      ['on', C3, 0],
      ['on', E4, 0],
    ]);
    h.session.stop();
    expectNothingStuck(h.sampler);
  });

  it('counts in from a seeked step and holds the marker there meanwhile', async () => {
    const h = setup(SCORE_A, { countIn: true });
    h.session.seek(2);
    const first = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    h.clock.advance(1000);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', stepIndex: 2 });
    expect(h.session.getVisualPosition()).toBe(2);
    expect(h.sampler.noteOns()).toEqual([]);
    // Step 2 starts at tick 8, where the tempo is 60 qpm: one beat = 1 s.
    h.clock.advanceToAudio(first + 4.03);
    expect(h.sampler.clicks().map((c) => round(c.when - first))).toEqual([0, 1, 2, 3]);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 2 });
    expect(noteEvents(h.sampler.noteOns(), first + 4 - 1)).toEqual([
      ['on', C3, 1],
      ['on', G4, 1],
    ]);
  });

  it('does not count in when resuming from pause', async () => {
    const h = setup(SCORE_A, { countIn: true });
    await h.session.play();
    h.clock.advance(3000);
    h.session.pause();
    const clicks = h.sampler.clicks().length;
    await h.session.play();
    expect(h.session.getSnapshot().status).toBe('playing');
    h.clock.advance(500);
    expect(h.sampler.clicks().length).toBe(clicks);
  });

  it('uses the step length as the Steady steps count-in beat', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 0.8, countIn: true });
    const first = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    h.clock.advance(100);
    h.clock.advance(3000);
    expect(
      h.sampler
        .clicks()
        .slice(0, 4)
        .map((c) => round(c.when - first)),
    ).toEqual([0, 0.8, 1.6, 2.4]);
  });

  it('divides the count-in beat by the speed in Listen', async () => {
    const h = setup(SCORE_A, { speed: 2, countIn: true });
    const first = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    h.clock.advance(1000);
    expect(h.sampler.clicks().map((c) => round(c.when - first))).toEqual([0, 0.25, 0.5, 0.75]);
  });
});

/* ------------------------------------------------------------------------ */
/* Steady steps                                                              */
/* ------------------------------------------------------------------------ */

describe('Steady steps', () => {
  it('plays at equal intervals and holds long keys across steps', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 0.5 });
    const anchor = await start(h);
    const marks: number[] = [];
    for (const rel of [0.1, 0.6, 1.1, 1.6, 2.1]) {
      h.clock.advanceToAudio(anchor + rel);
      marks.push(h.session.getSnapshot().stepIndex);
    }
    expect(marks).toEqual([0, 1, 2, 3, 4]);
    h.clock.advance(2000);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C4, 0.5],
      ['on', C4, 0.5],
      ['off', C4, 1],
      ['on', G4, 1],
      ['off', G4, 1.5],
      ['off', C3, 2],
    ]);
    // C3 is struck once and sustains across four steps.
    expect(h.sampler.noteOns().filter((c) => c.midi === C3)).toHaveLength(1);
    // The passage lasts steps × step length = 2.5 s.
    expect(h.session.getSnapshot().status).toBe('finished');
  });

  it('interpolates the visual position evenly', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 1 });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 2.25);
    expect(h.session.getVisualPosition()).toBeCloseTo(2.25, 6);
  });

  it('with sound off plays no notes and runs on wall-clock time', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 0.5, sound: false });
    await h.session.play();
    expect(h.sampler.startCalls).toBe(0);
    h.clock.advance(1100);
    expect(h.session.getSnapshot().stepIndex).toBe(2);
    h.clock.advance(2000);
    expect(h.session.getSnapshot().status).toBe('finished');
    expect(h.sampler.noteOns()).toEqual([]);
  });

  it('with sound off plays no notes even when browser sound is already running', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 0.5 });
    await h.session.play();
    h.clock.advance(600);
    h.session.updateSettings({ sound: false, countIn: true });
    expect(h.session.getSnapshot().status).toBe('playing');
    const ons = h.sampler.noteOns().length;
    h.clock.advance(3000);
    expect(h.sampler.noteOns().length).toBe(ons);
    // Count-in clicks still sound; notes do not.
    h.session.stop();
    await h.session.play();
    h.clock.advance(5000);
    expect(h.sampler.clicks().length).toBe(4);
    expect(h.sampler.noteOns().length).toBe(ons);
    expect(h.session.getSnapshot().status).toBe('finished');
  });

  it('switching sound on while playing starts the sampler and continues on its clock', async () => {
    const h = setup(SCORE_A, { mode: 'steady', stepSeconds: 0.5, sound: false });
    await h.session.play();
    h.clock.advance(1100);
    h.session.updateSettings({ sound: true });
    expect(h.sampler.startCalls).toBe(1);
    expect(h.session.getSnapshot().stepIndex).toBe(2);
    // The run moves onto the audio clock once ensureStarted() has resolved.
    await Promise.resolve();
    h.clock.advance(3000);
    // Steps 2.1: C3 and G4 are held there and sound again on the audio clock.
    expect(h.sampler.noteOns().map((c) => c.midi)).toEqual([C3, G4]);
    expect(h.session.getSnapshot().status).toBe('finished');
    expectNothingStuck(h.sampler);
  });
});

/* ------------------------------------------------------------------------ */
/* Follow me                                                                 */
/* ------------------------------------------------------------------------ */

describe('Follow me', () => {
  /**
   * Steps: 0 R C4 + L C3 · 1 R E4 · 2 R E4 again, L releases C3 ·
   * 3 R G4 · 4 release G4 (release-only).
   */
  const SCORE_F = prepared([R('C4', 0, 4), R('E4', 4, 8), R('E4', 8, 12), R('G4', 12, 16), L('C3', 0, 8)]);

  it('needs a connected piano', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    h.midi.inputConnected = false;
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', message: SESSION_MESSAGES.needPiano });
  });

  it('waits, advances on correct keys, flags wrong keys and finishes', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    await h.session.play();
    const snap = () => h.session.getSnapshot();
    expect(snap()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C3, C4] });
    h.clock.advance(5000);
    expect(snap()).toMatchObject({ status: 'waiting', stepIndex: 0 });
    expect(h.clock.activeIntervals).toBe(0);

    h.midi.press(C4);
    expect(snap()).toMatchObject({ stepIndex: 0, waitingFor: [C3], physicalDown: [C4] });
    h.midi.press(C3);
    expect(snap()).toMatchObject({ stepIndex: 1, waitingFor: [E4] });

    h.midi.release(C4);
    h.midi.press(F4);
    expect(snap()).toMatchObject({ stepIndex: 1, wrong: [F4] });
    h.midi.press(E4);
    expect(snap()).toMatchObject({ stepIndex: 1, wrong: [F4] });
    h.midi.release(F4);
    expect(snap()).toMatchObject({ stepIndex: 2, wrong: [], waitingFor: [E4] });

    // E4 is still held: it must be struck again.
    h.midi.press(E4);
    expect(snap().stepIndex).toBe(2);
    h.midi.release(E4);
    h.midi.press(E4);
    expect(snap()).toMatchObject({ stepIndex: 3, waitingFor: [G4] });

    // Step 4 only releases G4, so it is skipped and the passage is complete.
    h.midi.press(G4);
    expect(snap()).toMatchObject({ status: 'finished', stepIndex: 4, waitingFor: [], wrong: [] });
    expect(h.sampler.noteOns()).toEqual([]);
  });

  it('ignores the piano while stopped or paused', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    h.midi.press(C3);
    h.midi.press(C4);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', stepIndex: 0, physicalDown: [C3, C4] });
    h.midi.release(C3);
    h.midi.release(C4);
    await h.session.play();
    h.session.pause();
    h.midi.press(C3);
    h.midi.press(C4);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 0, waitingFor: [] });
    // Keys already down when Follow me resumes do not count as new presses.
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C3, C4] });
  });

  it('forgets keys released while paused, so they can be struck again', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    h.session.pause();
    h.midi.release(C4);
    await h.session.play();
    h.midi.press(C4);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C3] });
    h.midi.press(C3);
    expect(h.session.getSnapshot().stepIndex).toBe(1);
  });

  it('skips release-only steps in the middle', async () => {
    const h = setup(prepared([R('C4', 0, 4), R('D4', 8, 12)]), { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 2, waitingFor: [D4] });
  });

  it('restarts after 1 s when looping', async () => {
    const h = setup(prepared([R('C4', 0, 4), R('D4', 4, 8)]), { mode: 'follow', loop: true });
    await h.session.play();
    h.midi.press(C4);
    h.midi.press(D4);
    expect(h.session.getSnapshot().status).toBe('finished');
    h.clock.advance(950);
    expect(h.session.getSnapshot().status).toBe('finished');
    h.clock.advance(100);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
    // C4 is still physically down from the first pass but must be struck again.
    expect(h.session.getSnapshot().physicalDown).toEqual([C4, D4]);
    h.midi.release(C4);
    h.midi.press(C4);
    expect(h.session.getSnapshot().stepIndex).toBe(1);
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('is not advanced by app playback from a Listen session', async () => {
    const f = setup(SCORE_F, { mode: 'follow' });
    await f.session.play();
    const l = setup(SCORE_F, { mode: 'listen', midiOutputId: 'out-1' }, f);
    await l.session.play();
    f.clock.advance(3000);
    expect(f.midi.sends.filter((s) => s.kind === 'on').length).toBeGreaterThan(0);
    expect(f.sampler.noteOns().length).toBeGreaterThan(0);
    expect(f.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, physicalDown: [] });
    l.session.dispose();
    f.session.dispose();
  });

  it('seek, next and prev restart the matcher at the new step', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    h.session.seek(3);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 3, waitingFor: [G4] });
    h.session.prev();
    expect(h.session.getSnapshot()).toMatchObject({ stepIndex: 2, waitingFor: [E4] });
    h.session.next();
    expect(h.session.getSnapshot()).toMatchObject({ stepIndex: 3, waitingFor: [G4] });
  });

  it('pauses with a message when the piano disconnects', async () => {
    const h = setup(SCORE_F, { mode: 'follow', monitorInput: true });
    await h.session.play();
    h.midi.press(C4);
    h.midi.pedal(true);
    const offs = h.sampler.allNotesOffCount();
    h.midi.disconnect();
    expect(h.session.getSnapshot()).toMatchObject({
      status: 'paused',
      message: SESSION_MESSAGES.disconnected,
      physicalDown: [],
      pedalDown: false,
      midiInputConnected: false,
      waitingFor: [],
    });
    expect(h.sampler.allNotesOffCount()).toBe(offs + 1);
    expectNothingStuck(h.sampler);

    h.midi.reconnect();
    expect(h.session.getSnapshot()).toMatchObject({ message: null, midiInputConnected: true });
    // The lost C4 note-off does not leave a phantom key: C4 must be struck again.
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C3, C4] });
  });

  it('forgets the old keyboard\'s keys when another input is chosen, and keeps waiting', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    h.midi.selectedInputId = 'piano-2';
    h.midi.inputName = 'Second Piano';
    h.midi.emitChange();
    expect(h.session.getSnapshot()).toMatchObject({
      status: 'waiting',
      physicalDown: [],
      waitingFor: [C3, C4],
      midiInputName: 'Second Piano',
      message: null,
    });
    h.midi.press(C4);
    h.midi.press(C3);
    expect(h.session.getSnapshot().stepIndex).toBe(1);
  });

  it('plays input through the browser only when monitorInput is on', async () => {
    const h = setup(SCORE_F, { mode: 'follow' });
    expect(h.session.getSnapshot().settings.monitorInput).toBe(false);
    await h.session.play();
    h.midi.press(C4, 90);
    h.midi.release(C4);
    expect(h.sampler.calls.filter((c) => c.kind === 'noteOn' || c.kind === 'noteOff')).toEqual([]);

    h.session.updateSettings({ monitorInput: true });
    expect(h.sampler.startCalls).toBe(1);
    h.midi.press(D4, 90);
    expect(h.sampler.noteOns()).toEqual([expect.objectContaining({ midi: D4, velocity: 90 })]);
    h.clock.advance(200);
    h.midi.release(D4);
    expect(h.sampler.noteOffs()).toEqual([expect.objectContaining({ midi: D4, when: h.clock.audioNow })]);

    // The pedal keeps a monitored key sounding but never counts as a held key.
    h.midi.press(E4);
    h.midi.pedal(true);
    h.clock.advance(200);
    h.midi.release(E4);
    expect(h.session.getSnapshot()).toMatchObject({ physicalDown: [], pedalDown: true });
    expect(h.sampler.noteOffs().map((c) => c.midi)).toEqual([D4]);
    h.midi.pedal(false);
    expect(h.sampler.noteOffs().map((c) => c.midi)).toEqual([D4, E4]);
    expectNothingStuck(h.sampler);
  });
});

/* ------------------------------------------------------------------------ */
/* Physical input in every mode                                              */
/* ------------------------------------------------------------------------ */

describe('Physical input', () => {
  it('tracks keys and pedal in Listen without touching playback', async () => {
    const h = setup(SCORE_A);
    h.midi.press(C4);
    h.midi.press(E4);
    h.midi.pedal(true);
    h.midi.release(C4);
    expect(h.session.getSnapshot()).toMatchObject({ physicalDown: [E4], pedalDown: true, stepIndex: 0 });
    expect(h.sampler.calls).toEqual([]);
    h.midi.emit({ type: 'noteon', midi: E4, velocity: 0, channel: 3, time: 1 });
    expect(h.session.getSnapshot().physicalDown).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* MIDI output                                                               */
/* ------------------------------------------------------------------------ */

describe('MIDI output', () => {
  it('sends nothing when no output is chosen', async () => {
    const h = setup(SCORE_A);
    await h.session.play();
    h.clock.advance(4000);
    h.session.stop();
    expect(h.midi.sends).toEqual([]);
    expect(h.midi.selectOutputCalls).toEqual([]);
  });

  it('selects the output and sends timestamped notes, then all-notes-off on stop', async () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    expect(h.midi.selectOutputCalls).toEqual(['out-1']);
    const startMs = h.clock.ms + START_LEAD_SEC * 1000;
    await h.session.play();
    h.clock.advance(4000);
    const notes = h.midi.sends
      .filter((s) => s.kind !== 'allNotesOff')
      .map((s) => [s.kind, s.midi, Math.round((s.atMs ?? NaN) - startMs)]);
    expect(notes).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C4, 500],
      ['on', C4, 500],
      ['off', C4, 1000],
      ['on', G4, 1000],
      ['off', G4, 2000],
      ['off', C3, 3000],
    ]);
    for (const s of h.midi.sends) if (s.kind === 'on') expect(s.velocity).toBe(80);
    const before = h.midi.sends.length;
    h.session.stop();
    expect(h.midi.sends.slice(before)).toEqual([expect.objectContaining({ kind: 'allNotesOff' })]);
  });

  it('keeps sending with browser sound off, on the wall clock', async () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1', sound: false });
    const startMs = h.clock.ms + START_LEAD_SEC * 1000;
    await h.session.play();
    h.clock.advance(1200);
    expect(h.sampler.noteOns()).toEqual([]);
    expect(
      h.midi.sends.filter((s) => s.kind === 'on').map((s) => [s.midi, Math.round((s.atMs ?? NaN) - startMs)]),
    ).toEqual([
      [C3, 0],
      [C4, 0],
      [C4, 500],
      [G4, 1000],
    ]);
  });

  it('releases the old output before switching', () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    h.session.updateSettings({ midiOutputId: 'out-2' });
    expect(h.midi.sends).toEqual([expect.objectContaining({ kind: 'allNotesOff' })]);
    expect(h.midi.selectOutputCalls).toEqual(['out-1', 'out-2']);
    h.session.updateSettings({ midiOutputId: null });
    expect(h.midi.selectOutputCalls).toEqual(['out-1', 'out-2', null]);
    h.session.stop();
    expect(h.midi.sends.filter((s) => s.kind === 'allNotesOff')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------ */
/* Settings, sequence and snapshot                                           */
/* ------------------------------------------------------------------------ */

describe('Settings and sequence', () => {
  it('recomputes on a hands change, stops, and keeps the marker near the same tick', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.2);
    expect(h.session.getSnapshot().stepIndex).toBe(2);
    h.session.updateSettings({ hands: 'L' });
    const s = h.session.getSnapshot();
    // Left hand alone has steps at ticks 0 and 16; tick 8 maps to the step at 16.
    expect(s).toMatchObject({ status: 'stopped', stepIndex: 1, stepCount: 2 });
    expect(s.sequence.hands).toEqual(['L']);
    expect(s.expected).toEqual({ R: [], L: [] });
    h.session.updateSettings({ hands: 'both' });
    expect(h.session.getSnapshot()).toMatchObject({ stepIndex: 4, stepCount: 5 });
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('keeps the marker on a range change and reports the measure label', () => {
    const score = prepared([R('C4', 0, 8), R('D4', 8, 16), R('E4', 16, 24), R('G4', 24, 32)], {
      measures: buildMeasures(2),
    });
    const h = setup(score);
    h.session.seek(3);
    expect(h.session.getSnapshot()).toMatchObject({ measureLabel: '2', expected: { R: [G4], L: [] } });
    h.session.updateSettings({ range: { startOcc: 1, endOcc: 1 } });
    expect(h.session.getSnapshot()).toMatchObject({ stepIndex: 1, stepCount: 3, measureLabel: '2' });
    h.session.updateSettings({ range: { startOcc: 0, endOcc: 0 } });
    expect(h.session.getSnapshot()).toMatchObject({ stepIndex: 0, measureLabel: '1' });
  });

  it('clamps speed and step length', () => {
    const h = setup(SCORE_A, { speed: 0, stepSeconds: 99 });
    expect(h.session.getSnapshot().settings).toMatchObject({ speed: 0.25, stepSeconds: 4 });
    h.session.updateSettings({ speed: Number.NaN, stepSeconds: 0.01 });
    expect(h.session.getSnapshot().settings).toMatchObject({ speed: 1, stepSeconds: 0.3 });
    h.session.updateSettings({ speed: 7 });
    expect(h.session.getSnapshot().settings.speed).toBe(2);
  });

  it('says so when the chosen hand has nothing to play', async () => {
    const h = setup(prepared([R('C4', 0, 4)]), { hands: 'L' });
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({
      status: 'stopped',
      stepCount: 0,
      stepIndex: 0,
      message: SESSION_MESSAGES.nothingToPlay,
    });
    expect(h.session.getVisualPosition()).toBe(0);
  });

  it('keeps playing silently with a message when browser sound cannot start', async () => {
    const h = setup(SCORE_A);
    h.sampler.failStart = true;
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', message: SESSION_MESSAGES.noSound });
    h.clock.advance(600);
    expect(h.session.getSnapshot().stepIndex).toBe(1);
    expect(h.sampler.noteOns()).toEqual([]);
  });

  it('a mode change stops playback but keeps the marker', async () => {
    const h = setup(SCORE_A);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.2);
    h.session.updateSettings({ mode: 'follow' });
    expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', stepIndex: 2 });
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 2, waitingFor: [G4] });
  });
});

describe('Snapshot', () => {
  it('keeps the same object until something changes', async () => {
    const h = setup(SCORE_LONG);
    let notified = 0;
    h.session.subscribe(() => notified++);
    const s1 = h.session.getSnapshot();
    expect(h.session.getSnapshot()).toBe(s1);
    h.session.updateSettings({});
    h.session.updateSettings({ speed: 1, hands: 'both' });
    h.session.seek(0);
    h.session.pause();
    h.clock.advance(1000);
    expect(h.session.getSnapshot()).toBe(s1);
    expect(notified).toBe(0);

    const anchor = await start(h);
    const s2 = h.session.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.status).toBe('playing');
    expect(notified).toBeGreaterThan(0);

    // During the long E4 nothing visible changes between scheduler ticks.
    h.clock.advanceToAudio(anchor + 0.5);
    const s3 = h.session.getSnapshot();
    const count = notified;
    h.clock.advance(1000);
    expect(h.session.getSnapshot()).toBe(s3);
    expect(notified).toBe(count);
  });

  it('works with detached methods, as useSyncExternalStore and click handlers call them', async () => {
    const h = setup(SCORE_A);
    const { subscribe, getSnapshot, getVisualPosition, togglePlay, next } = h.session;
    let notified = 0;
    const off = subscribe(() => notified++);
    next();
    expect(getSnapshot().stepIndex).toBe(1);
    expect(getVisualPosition()).toBe(1);
    togglePlay();
    await Promise.resolve();
    await Promise.resolve();
    expect(getSnapshot().status).toBe('playing');
    expect(notified).toBeGreaterThan(1);
    off();
  });

  it('keeps unchanged arrays identical across snapshots', () => {
    const h = setup(SCORE_A);
    const s1 = h.session.getSnapshot();
    h.midi.pedal(true);
    const s2 = h.session.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.expected).toBe(s1.expected);
    expect(s2.physicalDown).toBe(s1.physicalDown);
  });

  it('dispose clears the interval, unsubscribes and releases notes', async () => {
    const h = setup(SCORE_A);
    expect(h.midi.listenerCount).toBe(2);
    expect(h.sampler.listenerCount).toBe(1);
    await h.session.play();
    let notified = 0;
    h.session.subscribe(() => notified++);
    expect(h.clock.activeIntervals).toBe(1);
    h.session.dispose();
    expect(h.clock.activeIntervals).toBe(0);
    expect(h.midi.listenerCount).toBe(0);
    expect(h.sampler.listenerCount).toBe(0);
    expect(h.sampler.allNotesOffCount()).toBe(1);
    h.midi.press(C4);
    h.session.seek(2);
    await h.session.play();
    h.clock.advance(1000);
    expect(notified).toBe(0);
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('uses one scheduler interval only while playing', async () => {
    const h = setup(SCORE_A);
    expect(h.clock.created).toBe(0);
    await h.session.play();
    h.session.seek(2);
    h.session.updateSettings({ speed: 1.5 });
    expect(h.clock.activeIntervals).toBe(1);
    expect(h.clock.created).toBe(1);
    h.session.pause();
    expect(h.clock.activeIntervals).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* MIDI output through the real MidiManager, on a port without clear()       */
/* ------------------------------------------------------------------------ */

/**
 * A Web MIDI output as the device experiences it: each message takes effect
 * at its timestamp (or when sent, if that is later). Without clear() a
 * message handed over for the future can never be withdrawn, as in Chrome
 * and Edge; with it, clear() drops everything not yet due.
 */
class DevicePort {
  readonly type = 'output';
  readonly manufacturer = 'Test';
  readonly version = '1';
  state = 'connected';
  connection = 'open';
  onmidimessage = null;
  onstatechange = null;
  clear?: () => void;
  private log: { data: number[]; eff: number; seq: number }[] = [];
  private seq = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly now: () => number,
    withClear: boolean,
  ) {
    if (withClear) {
      this.clear = () => {
        const t = this.now();
        this.log = this.log.filter((m) => m.eff <= t);
      };
    }
  }

  send(data: number[], at?: number): void {
    const t = this.now();
    this.log.push({ data: [...data], eff: at === undefined ? t : Math.max(at, t), seq: this.seq++ });
  }

  /** Every strike the device plays, in time order, with when it was released (Infinity: never). */
  strikes(): { key: number; on: number; off: number }[] {
    const ordered = [...this.log].sort((a, b) => a.eff - b.eff || a.seq - b.seq);
    const open = new Map<number, { key: number; on: number; off: number }>();
    const out: { key: number; on: number; off: number }[] = [];
    for (const m of ordered) {
      const [status, key] = m.data;
      if (status === 0x90) {
        const held = open.get(key);
        if (held) held.off = m.eff;
        const strike = { key, on: m.eff, off: Infinity };
        open.set(key, strike);
        out.push(strike);
      } else if (status === 0x80) {
        const held = open.get(key);
        if (held) held.off = m.eff;
        open.delete(key);
      } else if (status === 0xb0 && key === 123) {
        for (const held of open.values()) held.off = m.eff;
        open.clear();
      }
    }
    return out;
  }
}

/** C4 0-0.5 s, C4 again 0.5-1 s, E4 1-2 s; LH C3 0-2 s. */
const SCORE_REPEAT = prepared([R('C4', 0, 4), R('C4', 4, 8), R('E4', 8, 16), L('C3', 0, 16)]);

async function deviceSetup(score: PreparedScore, withClear: boolean, patch: Partial<PracticeSettings> = {}) {
  const sampler = new FakeSampler();
  const clock = new FakeClock(sampler);
  const port = new DevicePort('out', 'Digital Piano', clock.nowMs, withClear);
  const access = { inputs: new Map(), outputs: new Map([['out', port]]), onstatechange: null, sysexEnabled: false };
  const midi = new MidiManager({
    requestMIDIAccess: async () => access as unknown as MIDIAccess,
    now: clock.nowMs,
  });
  await midi.connect();
  const session = new PracticeSession(
    score,
    { ...DEFAULT_SETTINGS, midiOutputId: 'out', ...patch },
    {
      sampler,
      midi,
      nowMs: clock.nowMs,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      pageEvents: null,
    },
  );
  return { sampler, clock, port, midi, session };
}

describe('MIDI output on a port that cannot clear its queue', () => {
  const lookaheadMs = MIDI_LOOKAHEAD_SEC * 1000;

  const stopping: [string, (s: PracticeSession) => void][] = [
    ['pause', (s) => s.pause()],
    ['stop', (s) => s.stop()],
    ['dispose', (s) => s.dispose()],
  ];

  for (const [name, act] of stopping) {
    it(`${name}: the piano strikes nothing afterwards`, async () => {
      const h = await deviceSetup(SCORE_REPEAT, false);
      await h.session.play();
      h.clock.advance(400);
      const at = h.clock.ms;
      act(h.session);
      h.clock.advance(3000);
      expect(h.port.strikes().filter((s) => s.on > at)).toEqual([]);
      expect(h.port.strikes().filter((s) => s.off === Infinity)).toEqual([]);
    });

    it(`${name} at any moment: at most a strike already due within the MIDI lookahead, released at once`, async () => {
      for (let t = 300; t <= 1600; t += 15) {
        const h = await deviceSetup(SCORE_REPEAT, false, { sound: t % 2 === 0 });
        await h.session.play();
        h.clock.advance(t);
        const at = h.clock.ms;
        act(h.session);
        h.clock.advance(3000);
        for (const s of h.port.strikes().filter((x) => x.on > at)) {
          expect(s.on - at).toBeLessThanOrEqual(lookaheadMs);
          expect(s.off - s.on).toBeLessThanOrEqual(1);
        }
        expect(h.port.strikes().filter((s) => s.off === Infinity)).toEqual([]);
      }
    });
  }

  it('restart: the re-struck notes are not cut by notes queued before', async () => {
    const h = await deviceSetup(SCORE_REPEAT, false);
    await h.session.play();
    h.clock.advance(400);
    const at = h.clock.ms;
    h.session.restart();
    h.clock.advance(3000);
    const lead = START_LEAD_SEC * 1000;
    expect(h.port.strikes().filter((s) => s.on > at).map((s) => [s.key, s.on - at, s.off - at])).toEqual([
      [C3, lead, lead + 2000],
      [C4, lead, lead + 500],
      [C4, lead + 500, lead + 1000],
      [E4, lead + 1000, lead + 2000],
    ]);
  });

  const continuing: [string, (s: PracticeSession) => void][] = [
    ['restart', (s) => s.restart()],
    ['seek(0)', (s) => s.seek(0)],
    ['seek(2)', (s) => s.seek(2)],
    ['speed 0.9', (s) => s.updateSettings({ speed: 0.9 })],
    ['speed 1.5', (s) => s.updateSettings({ speed: 1.5 })],
  ];
  for (const [name, act] of continuing) {
    it(`${name}: the new run sounds exactly as on a port that can clear its queue`, async () => {
      for (let t = 300; t <= 1700; t += 35) {
        const runs = [];
        for (const withClear of [false, true]) {
          const h = await deviceSetup(SCORE_REPEAT, withClear);
          await h.session.play();
          h.clock.advance(t);
          const at = h.clock.ms;
          act(h.session);
          h.clock.advance(4000);
          // Strikes of the new run (anything still queued lands before it starts).
          const fresh = h.port.strikes().filter((s) => s.on >= at + START_LEAD_SEC * 1000);
          expect(fresh.length).toBeGreaterThan(0);
          runs.push(fresh.map((s) => [s.key, s.on - at, s.off - at]));
          expect(h.port.strikes().filter((s) => s.off === Infinity)).toEqual([]);
        }
        expect(runs[0]).toEqual(runs[1]);
      }
    });
  }

  it('hands MIDI messages over no more than the MIDI lookahead (plus one timer period) ahead', async () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    await h.session.play();
    h.clock.advance(4000);
    const sent = h.midi.sends.flatMap((s) => (s.kind === 'allNotesOff' ? [] : [s]));
    expect(sent.length).toBe(8);
    for (const s of sent) {
      expect((s.atMs ?? NaN) - s.nowMs).toBeLessThanOrEqual(lookaheadMs + SCHEDULER_INTERVAL_MS + 1e-6);
      expect((s.atMs ?? NaN) - s.nowMs).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Manual-stepping previews on the MIDI output                               */
/* ------------------------------------------------------------------------ */

describe('MIDI output previews', () => {
  it('Play right after a preview holds the previewed key for its full length', async () => {
    // C4 0-0.5 s, then E4 0.5-2 s.
    const h = await deviceSetup(prepared([R('C4', 0, 4), R('E4', 4, 16)]), false);
    h.session.next();
    const nextAt = h.clock.ms;
    h.clock.advance(100);
    const playAt = h.clock.ms;
    await h.session.play();
    h.clock.advance(3000);
    const lead = START_LEAD_SEC * 1000;
    expect(h.port.strikes().map((s) => [s.key, s.on - nextAt, s.off - nextAt])).toEqual([
      // The preview, let go when playback starts...
      [E4, 0, playAt - nextAt],
      // ...then struck again and held for the whole 1.5 s.
      [E4, playAt - nextAt + lead, playAt - nextAt + lead + 1500],
    ]);
  });

  it('a second preview of the same key lasts its full 0.5 s', async () => {
    const h = await deviceSetup(SCORE_A, false);
    h.session.next(); // step 1: C4
    const t0 = h.clock.ms;
    h.clock.advance(300);
    h.session.prev(); // step 0: C3 + C4
    h.clock.advance(1000);
    const ms = PREVIEW_SEC * 1000;
    expect(h.port.strikes().map((s) => [s.key, s.on - t0, s.off - t0])).toEqual([
      [C4, 0, 300],
      [C3, 300, 300 + ms],
      [C4, 300, 300 + ms],
    ]);
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('sends the preview release when due, not queued ahead, and then needs no timer', () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    h.session.next();
    expect(h.midi.sends).toEqual([expect.objectContaining({ kind: 'on', midi: C4 })]);
    expect(h.clock.activeIntervals).toBe(1);
    h.clock.advance(PREVIEW_SEC * 1000 - 1);
    expect(h.midi.sends.filter((s) => s.kind === 'off')).toEqual([]);
    h.clock.advance(SCHEDULER_INTERVAL_MS);
    const offs = h.midi.sends.filter((s) => s.kind === 'off');
    expect(offs).toEqual([expect.objectContaining({ midi: C4, atMs: h.clock.ms - (h.clock.ms % 25) })]);
    for (const s of offs) expect(s.atMs).toBe(s.nowMs);
    expect(h.clock.activeIntervals).toBe(0);
    // The browser sound needs no timer for its preview.
    const silent = setup(SCORE_A);
    silent.session.next();
    expect(silent.clock.created).toBe(0);
  });

  it('Stop releases a pending preview at once, with nothing left queued for later', async () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    h.session.next();
    h.session.stop();
    expect(h.midi.sends.at(-1)).toEqual(expect.objectContaining({ kind: 'allNotesOff' }));
    expect(h.clock.activeIntervals).toBe(0);
    h.clock.advance(2000);
    expect(h.midi.sends.filter((s) => s.kind === 'off')).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Seamless loop                                                             */
/* ------------------------------------------------------------------------ */

describe('Loop without count-in', () => {
  /** A 2 s passage: C4 0-1 s, E4 1-2 s, LH C3 0-2 s. */
  const SCORE_LOOP = prepared([R('C4', 0, 8), R('E4', 8, 16), L('C3', 0, 16)]);

  it('repeats exactly at the passage length on both the sampler and the MIDI output', async () => {
    const h = setup(SCORE_LOOP, { loop: true, midiOutputId: 'out-1' });
    const startMs = h.clock.ms + START_LEAD_SEC * 1000;
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 6.5);
    expect(noteEvents(h.sampler.calls, anchor).filter(([, midi]) => midi === C3)).toEqual([
      ['on', C3, 0],
      ['off', C3, 2],
      ['on', C3, 2],
      ['off', C3, 4],
      ['on', C3, 4],
      ['off', C3, 6],
      ['on', C3, 6],
    ]);
    // At the seam every release comes before the next pass's strikes.
    const seam = noteEvents(h.sampler.calls, anchor).filter(([, , t]) => t === 2);
    expect(seam).toEqual([
      ['off', C3, 2],
      ['off', E4, 2],
      ['on', C3, 2],
      ['on', C4, 2],
    ]);
    expect(
      h.midi.sends.flatMap((s) => (s.kind === 'on' && s.midi === C3 ? [Math.round((s.atMs ?? NaN) - startMs)] : [])),
    ).toEqual([0, 2000, 4000, 6000]);
    expect(h.sampler.allNotesOffCount()).toBe(0);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    h.session.stop();
    expectNothingStuck(h.sampler);
    expectNoPastScheduling(h.sampler.calls);
  });

  it('keeps the seam exact when the main thread is busy just before it', async () => {
    const h = setup(SCORE_LOOP, { loop: true });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.9);
    h.clock.stall(110); // no timer runs from 1.9 s to past the seam
    h.clock.advance(300);
    expect(noteEvents(h.sampler.noteOns(), anchor).filter(([, midi]) => midi === C3)).toEqual([
      ['on', C3, 0],
      ['on', C3, 2],
    ]);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    expectNoPastScheduling(h.sampler.calls);
  });

  it('moves the marker back to column 0 at the seam', async () => {
    const h = setup(SCORE_LOOP, { loop: true });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.99);
    expect(h.session.getVisualPosition()).toBeCloseTo(1.99, 6);
    h.clock.advanceToAudio(anchor + 2.01);
    expect(h.session.getVisualPosition()).toBeCloseTo(0.01, 6);
    h.clock.advanceToAudio(anchor + 2.5);
    expect(h.session.getVisualPosition()).toBeCloseTo(0.5, 6);
    expect(h.session.getSnapshot().stepIndex).toBe(0);
  });

  it('pausing or seeking just before the seam drops the chained pass', async () => {
    const h = setup(SCORE_LOOP, { loop: true, midiOutputId: 'out-1' });
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.95);
    h.session.pause();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 1 });
    const ons = h.sampler.noteOns().length;
    h.clock.advance(3000);
    expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([]);
    expectNothingStuck(h.sampler);
    expect(h.clock.activeIntervals).toBe(0);
    // The chained pass's strikes were cancelled, not played.
    expect(h.sampler.voices.filter((v) => v.start > anchor + 1.95)).toEqual([]);
    expect(h.sampler.noteOns().length).toBe(ons);

    const g = setup(SCORE_LOOP, { loop: true });
    const a2 = await start(g);
    g.clock.advanceToAudio(a2 + 1.95);
    const now = g.clock.audioNow;
    g.session.seek(1);
    g.clock.advance(700);
    expect(noteEvents(g.sampler.noteOns().filter((c) => c.now >= now), now + START_LEAD_SEC - 1)).toEqual([
      ['on', C3, 1],
      ['on', E4, 1],
    ]);
  });

  it('with count-in, still releases everything and counts in again', async () => {
    const h = setup(SCORE_LOOP, { loop: true, countIn: true });
    await h.session.play();
    h.clock.advance(2000 + 2000 + 100);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', stepIndex: 0 });
    expect(h.sampler.allNotesOffCount()).toBe(1);
    expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Browser audio for count-in and "Hear my playing"                          */
/* ------------------------------------------------------------------------ */

describe('Starting browser audio', () => {
  const SCORE_LOOP = prepared([R('C4', 0, 8), R('E4', 8, 16), L('C3', 0, 16)]);

  it('turning count-in on while silent playback runs starts audio, so the next loop counts in audibly', async () => {
    const h = setup(SCORE_LOOP, { sound: false, loop: true });
    await h.session.play();
    expect(h.sampler.startCalls).toBe(0);
    h.clock.advance(500);
    h.session.updateSettings({ countIn: true });
    expect(h.sampler.startCalls).toBe(1);
    await Promise.resolve();
    h.clock.advance(2000);
    expect(h.session.getSnapshot().status).toBe('count-in');
    h.clock.advance(2100);
    expect(h.sampler.clicks()).toHaveLength(COUNT_IN_BEATS);
    expect(h.session.getSnapshot().status).toBe('playing');
    // Sound is still off: clicks only.
    expect(h.sampler.noteOns()).toEqual([]);
  });

  it('starts audio for monitored input that arrives before any other sound', () => {
    const h = setup(SCORE_A, { monitorInput: true });
    expect(h.sampler.state).toBe('not-started');
    h.midi.press(C4, 90);
    expect(h.sampler.startCalls).toBe(1);
    expect(h.sampler.noteOns()).toEqual([expect.objectContaining({ midi: C4, velocity: 90 })]);
    h.midi.release(C4);
    expectNothingStuck(h.sampler);
  });

  it('says so when audio for monitored input cannot start', async () => {
    const h = setup(SCORE_A, { monitorInput: true });
    h.sampler.failStart = true;
    h.midi.press(C4);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.session.getSnapshot().message).toBe(SESSION_MESSAGES.monitorNoSound);
  });
});

/* ------------------------------------------------------------------------ */
/* Leaving the page                                                          */
/* ------------------------------------------------------------------------ */

describe('Page hide (reload, tab close, leaving the site)', () => {
  function pageSetup(patch: Partial<PracticeSettings>, page: EventTarget | undefined) {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const midi = new FakeMidi(clock.nowMs);
    const deps = { sampler, midi, nowMs: clock.nowMs, setInterval: clock.setInterval, clearInterval: clock.clearInterval };
    const session = new PracticeSession(
      SCORE_A,
      { ...DEFAULT_SETTINGS, ...patch },
      page === undefined ? deps : { ...deps, pageEvents: page },
    );
    return { sampler, clock, midi, session };
  }

  it('pauses playback and releases every note on the MIDI output', async () => {
    const page = new EventTarget();
    const h = pageSetup({ midiOutputId: 'out-1', mode: 'listen' }, page);
    await h.session.play();
    h.clock.advance(1300);
    const sends = h.midi.sends.length;
    page.dispatchEvent(new Event('pagehide'));
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 2 });
    expect(h.midi.sends.slice(sends)).toEqual([expect.objectContaining({ kind: 'allNotesOff' })]);
    expect(h.sampler.allNotesOffCount()).toBe(1);
    expect(h.clock.activeIntervals).toBe(0);
    h.clock.advance(5000);
    expect(h.midi.sends.slice(sends).filter((s) => s.kind === 'on')).toEqual([]);
    // Restored from the back/forward cache: the session still works.
    await h.session.play();
    expect(h.session.getSnapshot().status).toBe('playing');
  });

  it('releases a pending preview and the learner\'s monitored notes', () => {
    const page = new EventTarget();
    const h = pageSetup({ midiOutputId: 'out-1', monitorInput: true }, page);
    h.session.next();
    h.midi.press(G4);
    page.dispatchEvent(new Event('pagehide'));
    expect(h.midi.sends.at(-1)).toEqual(expect.objectContaining({ kind: 'allNotesOff' }));
    expect(h.sampler.soundingAt(h.clock.audioNow + 0.1)).toEqual([]);
    expect(h.clock.activeIntervals).toBe(0);
  });

  it('pauses Follow me', async () => {
    const page = new EventTarget();
    const h = pageSetup({ mode: 'follow' }, page);
    await h.session.play();
    expect(h.session.getSnapshot().status).toBe('waiting');
    page.dispatchEvent(new Event('pagehide'));
    expect(h.session.getSnapshot().status).toBe('paused');
  });

  it('listens on the window by default and stops listening on dispose', async () => {
    const h = pageSetup({ midiOutputId: 'out-1' }, undefined);
    await h.session.play();
    window.dispatchEvent(new Event('pagehide'));
    expect(h.session.getSnapshot().status).toBe('paused');
    h.session.dispose();
    const sends = h.midi.sends.length;
    window.dispatchEvent(new Event('pagehide'));
    expect(h.midi.sends.length).toBe(sends);
  });
});

/* ------------------------------------------------------------------------ */
/* Follow me: stepping, loop gap and monitored notes                         */
/* ------------------------------------------------------------------------ */

describe('Follow me transport', () => {
  /** Detached notes: 0 C4 · 1 release · 2 D4 · 3 release · 4 E4 · 5 release. */
  const SCORE_DETACHED = prepared([R('C4', 0, 3), R('D4', 4, 7), R('E4', 8, 12)]);

  it('Previous steps back over release-only steps while waiting', async () => {
    const h = setup(SCORE_DETACHED, { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    h.midi.release(C4);
    h.midi.press(D4);
    h.midi.release(D4);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 4, waitingFor: [E4] });
    h.session.prev();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 2, waitingFor: [D4] });
    h.session.prev();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
    h.session.next();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 2, waitingFor: [D4] });
  });

  it('Previous while paused lands on a step to play, and Start waits there', async () => {
    const h = setup(SCORE_DETACHED, { mode: 'follow' });
    await h.session.play();
    h.midi.press(C4);
    h.midi.release(C4);
    h.midi.press(D4);
    h.midi.release(D4);
    h.session.pause();
    h.session.prev();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 2 });
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 2, waitingFor: [D4] });
    h.session.pause();
    h.session.next();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 4 });
  });

  describe('during the loop gap', () => {
    const SCORE_TWO = prepared([R('C4', 0, 4), R('D4', 4, 8)]);

    async function finished() {
      const h = setup(SCORE_TWO, { mode: 'follow', loop: true });
      await h.session.play();
      h.midi.press(C4);
      h.midi.press(D4);
      h.midi.release(C4);
      h.midi.release(D4);
      expect(h.session.getSnapshot().status).toBe('finished');
      return h;
    }

    it('Start (the play button) starts again from step 0 at once', async () => {
      const h = await finished();
      h.clock.advance(300);
      h.session.togglePlay();
      expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
      h.clock.advance(2000);
      expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0 });
      expect(h.clock.activeIntervals).toBe(0);
    });

    it('play() starts again from step 0 at once', async () => {
      const h = await finished();
      await h.session.play();
      expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
    });

    it('after a pause in the gap, Start begins at step 0 instead of finishing again', async () => {
      const h = await finished();
      h.session.pause();
      expect(h.session.getSnapshot().status).toBe('paused');
      h.session.togglePlay();
      expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
    });

    it('after a disconnect in the gap, Start begins at step 0', async () => {
      const h = await finished();
      h.midi.disconnect();
      h.midi.reconnect();
      await h.session.play();
      expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, waitingFor: [C4] });
    });
  });
});

describe('Follow me keeps the learner\'s own monitored notes', () => {
  const SCORE_TWO = prepared([R('C4', 0, 4), R('D4', 4, 8)]);

  it('through the loop restart', async () => {
    const h = setup(SCORE_TWO, { mode: 'follow', loop: true, monitorInput: true });
    await h.session.play();
    h.midi.press(C4);
    h.midi.release(C4);
    h.midi.press(D4); // held through the restart
    expect(h.session.getSnapshot().status).toBe('finished');
    h.clock.advance(1100);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, physicalDown: [D4] });
    expect(h.sampler.allNotesOffCount()).toBe(0);
    expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([D4]);
    h.midi.release(D4);
    expect(h.sampler.soundingAt(h.clock.audioNow + 0.01)).toEqual([]);
    expectNothingStuck(h.sampler);
  });

  it('through Pause and settings changes, including pedal-held notes', async () => {
    const h = setup(SCORE_TWO, { mode: 'follow', monitorInput: true, midiOutputId: 'out-1' });
    await h.session.play();
    h.midi.press(E4);
    h.midi.pedal(true);
    h.midi.press(G4);
    h.midi.release(G4); // sustained by the pedal
    h.session.updateSettings({ sound: false });
    h.session.updateSettings({ hands: 'R' });
    h.session.updateSettings({ midiOutputId: 'out-2' });
    h.session.pause();
    expect(h.sampler.allNotesOffCount()).toBe(0);
    // The MIDI output is still released on each change.
    expect(h.midi.sends.filter((s) => s.kind === 'allNotesOff').length).toBeGreaterThan(0);
    expect(h.sampler.soundingAt(h.clock.audioNow)).toEqual([E4, G4]);
    h.midi.release(E4);
    h.midi.pedal(false);
    expect(h.sampler.soundingAt(h.clock.audioNow + 0.01)).toEqual([]);
    expectNothingStuck(h.sampler);
  });

  it('but Stop, a mode change and a disconnect still release everything', async () => {
    for (const act of [
      (h: Harness) => h.session.stop(),
      (h: Harness) => h.session.updateSettings({ mode: 'listen' }),
      (h: Harness) => h.midi.disconnect(),
    ]) {
      const h = setup(SCORE_TWO, { mode: 'follow', monitorInput: true });
      await h.session.play();
      h.midi.press(E4);
      act(h);
      expect(h.sampler.allNotesOffCount()).toBe(1);
      expect(h.sampler.soundingAt(h.clock.audioNow + 0.1)).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Play from the end of the passage                                          */
/* ------------------------------------------------------------------------ */

const G2 = 43;

/** Both hands end on one chord: steps at 0, 0.5 and 1 s, and the closing release at 2 s. */
const SCORE_END = prepared([R('C4', 0, 4), R('D4', 4, 8), R('E4', 8, 16), L('C3', 0, 8), L('G2', 8, 16)]);

function strikesSince(h: Harness, mark: number): { midi: number; when: number }[] {
  return h.sampler.since(mark).flatMap((c) => (c.kind === 'noteOn' ? [{ midi: c.midi, when: c.when }] : []));
}

describe('Play from the end of the passage (Listen / Steady)', () => {
  const changes: [Partial<PracticeSettings>, number[], number][] = [
    [{ mode: 'steady' }, [C3, C4], 5],
    [{ hands: 'R' }, [C4], 3],
    [{ hands: 'L' }, [C3], 2],
  ];
  for (const [patch, firstChord, total] of changes) {
    it(`after the end, then ${JSON.stringify(patch)}, Play plays the passage from step 0`, async () => {
      for (const countIn of [false, true]) {
        const h = setup(SCORE_END, { countIn });
        await h.session.play();
        h.clock.advance(8000);
        expect(h.session.getSnapshot().status).toBe('finished');
        h.session.updateSettings(patch);
        const s = h.session.getSnapshot();
        expect(s).toMatchObject({ status: 'stopped', stepIndex: s.stepCount - 1 });

        const mark = h.sampler.calls.length;
        await h.session.play();
        expect(h.session.getSnapshot()).toMatchObject({ status: countIn ? 'count-in' : 'playing', stepIndex: 0 });
        h.clock.advance(10_000);
        const strikes = strikesSince(h, mark);
        expect(strikes).toHaveLength(total);
        const t0 = strikes[0].when;
        expect(strikes.filter((x) => x.when === t0).map((x) => x.midi)).toEqual(firstChord);
        const clicks = h.sampler.since(mark).filter((c) => c.kind === 'click');
        expect(clicks).toHaveLength(countIn ? COUNT_IN_BEATS : 0);
        for (const c of clicks) expect(c.when).toBeLessThan(t0);
        expect(h.session.getSnapshot().status).toBe('finished');
      }
    });
  }

  it('a piece reopened on the closing release (its saved position) plays from step 0, after the count-in when on', async () => {
    for (const countIn of [false, true]) {
      const h = setup(SCORE_END, { countIn });
      h.session.seek(3);
      expect(h.session.getSnapshot()).toMatchObject({ status: 'stopped', stepIndex: 3 });
      const anchor = h.clock.audioNow + START_LEAD_SEC + (countIn ? COUNT_IN_BEATS * 0.5 : 0);
      await h.session.play();
      h.clock.advance(6000);
      expect(noteEvents(h.sampler.calls, anchor)).toEqual([
        ['on', C3, 0],
        ['on', C4, 0],
        ['off', C4, 0.5],
        ['on', D4, 0.5],
        ['off', C3, 1],
        ['off', D4, 1],
        ['on', G2, 1],
        ['on', E4, 1],
        ['off', G2, 2],
        ['off', E4, 2],
      ]);
      expect(h.sampler.clicks()).toHaveLength(countIn ? COUNT_IN_BEATS : 0);
      expect(h.session.getSnapshot().status).toBe('finished');
    }
  });

  it('Play after a pause in the trailing rest starts again from step 0', async () => {
    const h = setup(SCORE_TAIL);
    const anchor = await start(h);
    h.clock.advanceToAudio(anchor + 1.2);
    h.session.pause();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 1 });
    const mark = h.sampler.calls.length;
    const again = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'playing', stepIndex: 0 });
    h.clock.advance(3000);
    expect(noteEvents(h.sampler.since(mark), again)).toEqual([
      ['on', C4, 0],
      ['off', C4, 0.5],
    ]);
  });

  it('Play from a step where a key is still held carries on from there', async () => {
    const h = setup(prepared([R('C4', 0, 16), L('C3', 0, 8)]));
    h.session.seek(1); // the left hand has let go; C4 is still held
    const anchor = h.clock.audioNow + START_LEAD_SEC;
    await h.session.play();
    expect(h.session.getSnapshot().stepIndex).toBe(1);
    h.clock.advance(3000);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C4, 0],
      ['off', C4, 1],
    ]);
  });

  it('says there is nothing to play in silent measures with both hands, without naming a hand', async () => {
    const score = prepared([R('C4', 0, 16), L('C3', 0, 16)], { measures: buildMeasures(2) });
    const h = setup(score, { range: { startOcc: 1, endOcc: 1 } });
    expect(h.session.getSnapshot().stepCount).toBe(0);
    await h.session.play();
    expect(h.session.getSnapshot().message).toBe(SESSION_MESSAGES.nothingToPlay);
    expect(SESSION_MESSAGES.nothingToPlay).not.toMatch(/hand/i);
  });
});

/* ------------------------------------------------------------------------ */
/* MIDI output with a busy main thread                                       */
/* ------------------------------------------------------------------------ */

describe('MIDI output when the main thread is busy', () => {
  const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;

  it('sends the first chord after Play at its time, even when the next timer tick comes late', async () => {
    for (const busyMs of [60, 100]) {
      const h = setup(SCORE_A, { midiOutputId: 'out-1' });
      const startMs = h.clock.ms + START_LEAD_SEC * 1000;
      await h.session.play();
      h.clock.stall(busyMs); // the re-render the Play click itself causes
      h.clock.advance(400);
      const first = h.midi.sends.flatMap((s) => (s.kind === 'on' && near(s.atMs, startMs) ? [s] : []));
      expect(first.map((s) => s.midi).sort((a, b) => a - b)).toEqual([C3, C4]);
      for (const s of first) expect(s.nowMs).toBeLessThanOrEqual(startMs);
    }
  });

  it('sends the first chord after a seek while playing (and the held keys struck again) at its time', async () => {
    const h = setup(SCORE_A, { midiOutputId: 'out-1' });
    await h.session.play();
    h.clock.advance(300);
    const startMs = h.clock.ms + START_LEAD_SEC * 1000;
    const mark = h.midi.sends.length;
    h.session.seek(2);
    h.clock.stall(60);
    h.clock.advance(300);
    const first = h.midi.sends.slice(mark).flatMap((s) => (s.kind === 'on' && near(s.atMs, startMs) ? [s] : []));
    expect(first.map((s) => s.midi).sort((a, b) => a - b)).toEqual([C3, G4]);
    for (const s of first) expect(s.nowMs).toBeLessThanOrEqual(startMs);
  });
});

/* ------------------------------------------------------------------------ */
/* Browser audio starting while silent playback runs                         */
/* ------------------------------------------------------------------------ */

/**
 * Like the real PianoSampler: 'loading' as soon as it is asked to start, but
 * its clock stands still until the AudioContext runs (resume()).
 */
class SuspendedSampler extends FakeSampler {
  private running = false;
  private frozenAt: number | null = null;
  private time = 0;
  private waiting: (() => void)[] = [];

  constructor() {
    super();
    Object.defineProperty(this, 'currentTime', {
      get: () => (this.frozenAt !== null && !this.running ? this.frozenAt : this.time),
      set: (v: number) => {
        this.time = v;
      },
    });
  }

  ensureStarted(): Promise<void> {
    this.startCalls++;
    if (this.state === 'not-started') {
      this.frozenAt = this.time;
      this.setState('loading');
    }
    if (this.running) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  /** The AudioContext starts running; ensureStarted() resolves. */
  resume(): void {
    this.running = true;
    for (const fn of this.waiting.splice(0)) fn();
  }
}

function suspendedSetup(score: PreparedScore, patch: Partial<PracticeSettings>) {
  const sampler = new SuspendedSampler();
  const clock = new FakeClock(sampler);
  const h = setup(score, patch, { sampler, clock, midi: new FakeMidi(clock.nowMs) });
  return { ...h, sampler };
}

describe('Browser audio starting while silent playback runs', () => {
  it("keeps the learner's first monitored note sounding, with no hitch and nothing struck again on the MIDI output", async () => {
    const h = suspendedSetup(SCORE_A, { mode: 'steady', sound: false, monitorInput: true, midiOutputId: 'out-1' });
    await h.session.play();
    h.clock.advance(1100); // step 1 (at 1.05 s) has passed; step 2 is at 2.05 s
    const sends = h.midi.sends.length;
    h.midi.press(F4); // the learner's own note starts browser audio
    expect(h.sampler.state).toBe('loading');
    const positions: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (i === 10) {
        h.sampler.resume(); // the AudioContext runs 100 ms later
        await Promise.resolve();
      }
      positions.push(h.session.getVisualPosition());
      h.clock.advance(10);
    }
    const releaseAt = h.sampler.currentTime;
    h.midi.release(F4);
    h.clock.advance(50);

    expect(h.sampler.allNotesOffCount()).toBe(0);
    const voices = h.sampler.voices.filter((v) => v.midi === F4);
    expect(voices).toHaveLength(1);
    expect(voices[0].end).toBeCloseTo(releaseAt, 6);
    // Steady at 1 s per step: the marker moves 0.01 every 10 ms throughout.
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeCloseTo(0.01, 6);
    // Nothing was released or struck again on the MIDI output (the next step is at 2 s).
    expect(h.midi.sends.slice(sends)).toEqual([]);
  });

  it('Sound turned on during silent playback: the marker keeps moving, then the held keys sound once audio runs', async () => {
    const h = suspendedSetup(SCORE_A, { mode: 'steady', stepSeconds: 0.5, sound: false, midiOutputId: 'out-1' });
    await h.session.play();
    h.clock.advance(1100); // step 2: G4 struck at 1 s, C3 held
    h.session.updateSettings({ sound: true });
    const sends = h.midi.sends.length;
    const p0 = h.session.getVisualPosition();
    h.clock.advance(120); // the AudioContext is still starting
    expect(h.session.getVisualPosition()).toBeGreaterThan(p0 + 0.1);
    expect(h.sampler.noteOns()).toEqual([]);

    h.sampler.resume();
    await Promise.resolve();
    const joinAt = h.sampler.currentTime;
    h.clock.advance(3000);
    const ons = h.sampler.noteOns();
    expect(ons.map((c) => c.midi)).toEqual([C3, G4]);
    for (const c of ons) {
      expect(c.when).toBeGreaterThanOrEqual(joinAt - 1e-9);
      expect(c.when).toBeLessThanOrEqual(joinAt + SCHEDULER_INTERVAL_MS / 1000 + 1e-9);
    }
    expect(h.session.getSnapshot().status).toBe('finished');
    expectNothingStuck(h.sampler);
    expectNoPastScheduling(h.sampler.calls);
    // The switch itself releases and strikes nothing on the MIDI output.
    expect(h.midi.sends.slice(sends).filter((s) => s.kind !== 'off')).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Speed or step-length change just before a release                         */
/* ------------------------------------------------------------------------ */

describe('Speed or step-length change just before a release', () => {
  /** C4 0-1 s, then E4 1-2 s, over C3 held 0-2 s. */
  const SCORE_T = prepared([R('C4', 0, 8), R('E4', 8, 16), L('C3', 0, 16)]);
  const cases: [string, Partial<PracticeSettings>, Partial<PracticeSettings>][] = [
    ['speed 0.5', {}, { speed: 0.5 }],
    ['speed 1.5', {}, { speed: 1.5 }],
    ['step length 2 s', { mode: 'steady' }, { stepSeconds: 2 }],
  ];
  for (const [name, base, patch] of cases) {
    it(`${name}, 5 ms before C4 is let go, does not strike C4 again for an instant`, async () => {
      const h = setup(SCORE_T, { ...base, midiOutputId: 'out-1' });
      const anchor = await start(h);
      h.clock.advanceToAudio(anchor + 0.995);
      const mark = h.sampler.calls.length;
      const sends = h.midi.sends.length;
      h.session.updateSettings(patch);
      h.clock.advance(6000);
      // C3, held on, sounds again; E4 comes in on time; C4 is not struck again.
      expect(h.sampler.since(mark).flatMap((c) => (c.kind === 'noteOn' ? [c.midi] : []))).toEqual([C3, E4]);
      expect(h.midi.sends.slice(sends).flatMap((s) => (s.kind === 'on' ? [s.midi] : []))).toEqual([C3, E4]);
      expectNothingStuck(h.sampler);
    });
  }
});

/* ------------------------------------------------------------------------ */
/* A piano that echoes what the app sends it                                 */
/* ------------------------------------------------------------------------ */

class LoopPort {
  readonly manufacturer = 'Test';
  readonly version = '1';
  state = 'connected';
  connection = 'open';
  onstatechange = null;
  onmidimessage: ((ev: { data: Uint8Array; timeStamp: number }) => void) | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: 'input' | 'output',
    private readonly onSend: (data: number[], at?: number) => void = () => undefined,
  ) {}

  send(data: number[], at?: number): void {
    this.onSend(data, at);
  }

  emit(data: number[], timeStamp: number): void {
    this.onmidimessage?.({ data: Uint8Array.from(data), timeStamp });
  }
}

/** One piano for input and output; it plays back everything it receives 3 ms later. */
async function echoingPianoSetup(score: PreparedScore, patch: Partial<PracticeSettings>) {
  const sampler = new FakeSampler();
  const clock = new FakeClock(sampler);
  const input = new LoopPort('piano-in', 'Loop Piano', 'input');
  const output = new LoopPort('piano-out', 'Loop Piano', 'output', (data, at) =>
    input.emit(data, Math.max(at ?? clock.ms, clock.ms) + 3),
  );
  const access = {
    inputs: new Map([['piano-in', input]]),
    outputs: new Map([['piano-out', output]]),
    onstatechange: null,
    sysexEnabled: false,
  };
  const midi = new MidiManager({ requestMIDIAccess: async () => access as unknown as MIDIAccess, now: clock.nowMs });
  await midi.connect();
  await sampler.ensureStarted();
  const session = new PracticeSession(
    score,
    { ...DEFAULT_SETTINGS, midiOutputId: 'piano-out', ...patch },
    { sampler, midi, nowMs: clock.nowMs, setInterval: clock.setInterval, clearInterval: clock.clearInterval, pageEvents: null },
  );
  /** The learner plays on the same piano. */
  const learner = (data: number[]): void => input.emit(data, clock.ms);
  return { sampler, clock, session, learner };
}

describe('Play through a connected piano that echoes', () => {
  it('Follow me: the loop restart does not lift the pedal the learner is holding', async () => {
    const h = await echoingPianoSetup(prepared([R('C4', 0, 4), R('D4', 4, 8)]), {
      mode: 'follow',
      loop: true,
      monitorInput: true,
    });
    await h.session.play();
    h.learner([0xb0, 64, 127]);
    h.learner([0x90, C4, 80]);
    h.clock.advance(200);
    h.learner([0x80, C4, 0]);
    h.clock.advance(10);
    h.learner([0x90, D4, 80]);
    h.clock.advance(200);
    h.learner([0x80, D4, 0]); // both still sound through the pedal
    expect(h.session.getSnapshot()).toMatchObject({ status: 'finished', pedalDown: true });

    h.clock.advance(1100); // the loop restarts
    expect(h.session.getSnapshot()).toMatchObject({ status: 'waiting', stepIndex: 0, pedalDown: true });
    expect(h.sampler.soundingAt(h.sampler.currentTime)).toEqual([C4, D4]);

    h.learner([0xb0, 64, 0]);
    expect(h.session.getSnapshot().pedalDown).toBe(false);
    expect(h.sampler.soundingAt(h.sampler.currentTime + 0.01)).toEqual([]);
  });

  it('Listen: Pause keeps a key the learner holds that the app played earlier', async () => {
    const h = await echoingPianoSetup(prepared([R('C4', 0, 4), R('E4', 4, 16)]), {
      sound: false,
      monitorInput: true,
    });
    await h.session.play();
    h.clock.advance(800); // the app's C4 has ended; E4 sounds
    h.learner([0x90, C4, 70]); // the learner plays C4 and holds it
    h.clock.advance(100);
    h.session.pause();
    h.clock.advance(50);
    expect(h.session.getSnapshot().physicalDown).toEqual([C4]);
    expect(h.sampler.noteOffs().filter((c) => c.midi === C4)).toEqual([]);
    h.learner([0x80, C4, 0]);
    expect(h.session.getSnapshot().physicalDown).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* "Hear my playing" with the app's sound: two players on one sampler        */
/* ------------------------------------------------------------------------ */

describe("'Hear my playing' with the app's sound: the learner and the app never cut each other's notes", () => {
  /** C4 0-1 s, then D4 1-2 s (one measure at 120 qpm; steps at 0, 1, 2 s in Steady at 1 s per step too). */
  const SCORE_CD = prepared([R('C4', 0, 8), R('D4', 8, 16)]);

  function spans(h: Harness, owner: 'app' | 'input', midi: number, anchor: number): [number, number][] {
    return h.sampler.voices
      .filter((v) => v.owner === owner && v.midi === midi)
      .map((v): [number, number] => [round(v.start - anchor), round(v.end - anchor)]);
  }

  for (const mode of ['listen', 'steady'] as const) {
    it(`${mode}: a key held past the app's release sounds to the learner's own release, and a short tap leaves the app's note whole`, async () => {
      const h = setup(SCORE_CD, { mode, stepSeconds: 1, monitorInput: true });
      const anchor = await start(h);
      h.clock.advanceToAudio(anchor + 0.02);
      h.midi.press(C4); // held to 1.6 s, past the app's release at 1 s
      h.clock.advanceToAudio(anchor + 0.95);
      h.midi.press(D4); // a little early, and let go early
      h.clock.advanceToAudio(anchor + 1.1);
      h.midi.release(D4);
      h.clock.advanceToAudio(anchor + 1.6);
      h.midi.release(C4);
      h.clock.advance(2000);
      expect(h.session.getSnapshot().status).toBe('finished');

      expect(spans(h, 'input', C4, anchor)).toEqual([[0.02, 1.6]]);
      expect(spans(h, 'app', C4, anchor)).toEqual([[0, 1]]);
      expect(spans(h, 'app', D4, anchor)).toEqual([[1, 2]]);
      expect(spans(h, 'input', D4, anchor)).toEqual([[0.95, 1.1]]);
      expectNothingStuck(h.sampler);
    });
  }

  it("turning 'Hear my playing' off, or lifting the pedal, ends only the learner's notes", async () => {
    for (const how of ['monitor off', 'pedal up'] as const) {
      const h = setup(SCORE_CD, { monitorInput: true });
      const anchor = await start(h);
      h.clock.advanceToAudio(anchor + 0.1);
      h.midi.pedal(true);
      h.midi.press(C4);
      h.midi.release(C4); // held by the pedal
      h.clock.advanceToAudio(anchor + 0.5);
      if (how === 'monitor off') h.session.updateSettings({ monitorInput: false });
      else h.midi.pedal(false);
      h.clock.advance(2000);
      expect(spans(h, 'input', C4, anchor)).toEqual([[0.1, 0.5]]);
      expect(spans(h, 'app', C4, anchor)).toEqual([[0, 1]]);
      expectNothingStuck(h.sampler);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Browser audio left in 'error' by an earlier page                          */
/* ------------------------------------------------------------------------ */

describe("Browser audio whose samples failed to load ('error') still sounds", () => {
  const SCORE_LOOPED = prepared([R('C4', 0, 4), R('D4', 4, 8), R('E4', 8, 12), R('F4', 12, 16)], {
    measures: buildMeasures(1),
  });

  /** Page A played (audio running), then a sample failed to load; page B is a new session on the same sampler. */
  async function pageB(patch: Partial<PracticeSettings>): Promise<Harness> {
    const a = setup(SCORE_A);
    await a.session.play();
    a.clock.advance(300);
    a.session.dispose();
    a.sampler.setState('error');
    return setup(SCORE_LOOPED, patch, { sampler: a.sampler, clock: a.clock, midi: a.midi });
  }

  it('a new page previews the step after Next', async () => {
    const h = await pageB({});
    const mark = h.sampler.calls.length;
    h.session.next();
    expect(strikes(h.sampler.since(mark))).toEqual([D4]);
  });

  it('Sound turned on during silent Steady steps is heard', async () => {
    const h = await pageB({ mode: 'steady', stepSeconds: 0.5, sound: false });
    await h.session.play();
    h.clock.advance(300);
    const mark = h.sampler.calls.length;
    h.session.updateSettings({ sound: true });
    await Promise.resolve();
    h.clock.advance(1000);
    // C4, held when Sound came on, sounds from then; D4 and E4 on their steps.
    expect(strikes(h.sampler.since(mark))).toEqual([C4, D4, E4]);
  });

  it('a run on the audio clock keeps sounding when loading ends in an error', async () => {
    const a = setup(SCORE_A);
    a.sampler.setState('loading'); // an earlier page started audio; the samples are still loading
    const h = setup(SCORE_LOOPED, { mode: 'steady', stepSeconds: 0.5, sound: false }, a);
    await h.session.play();
    h.session.updateSettings({ sound: true });
    h.clock.advance(300);
    expect(strikes(h.sampler.calls)).toEqual([C4]);
    h.sampler.setState('error');
    h.clock.advance(3000);
    expect(strikes(h.sampler.calls)).toEqual([C4, D4, E4, F4]);
    expect(h.session.getSnapshot().status).toBe('finished');
  });

  function strikes(calls: readonly SamplerCall[]): number[] {
    return calls.flatMap((c) => (c.kind === 'noteOn' ? [c.midi] : []));
  }
});

/* ------------------------------------------------------------------------ */
/* Count-in beat from the time signature                                     */
/* ------------------------------------------------------------------------ */

describe('Count-in beat follows the time signature', () => {
  type Meter = readonly [beats: number, beatType: number] | null;

  /** Sets the written time signatures (one per source measure; null = none written there). */
  function withMeters(score: PreparedScore, meters: readonly Meter[]): PreparedScore {
    const measures = meters.map((m, index) => ({
      index,
      number: String(index + 1),
      startTick: 0,
      durationTicks: 0,
      implicit: false,
      ...(m ? { timeSignature: { beats: m[0], beatType: m[1] } } : {}),
      repeatForward: false,
      repeatBackwardTimes: null,
      endings: [],
      segno: false,
      coda: false,
      fine: false,
      daCapo: false,
      dalSegno: false,
      toCoda: false,
    }));
    return { ...score, source: { ...score.source, measures } };
  }

  async function clickGaps(score: PreparedScore, patch: Partial<PracticeSettings> = {}, fromTick = 0): Promise<number[]> {
    const h = setup(score, { countIn: true, ...patch });
    if (fromTick) h.session.seek(h.session.getSnapshot().sequence.steps.findIndex((st) => st.tick === fromTick));
    await h.session.play();
    h.clock.advance(6000);
    const clicks = h.sampler.clicks().slice(0, COUNT_IN_BEATS).map((c) => c.when);
    return clicks.slice(1).map((w, i) => round(w - clicks[i]));
  }

  // 120 qpm, speed 1: a quarter note is 0.5 s.
  const SCORE_M = prepared([R('C4', 0, 4), R('D4', 12, 16), R('E4', 24, 28)], { measures: buildMeasures(3, 12) });

  it.each([
    ['6/8 (dotted quarter)', [6, 8], 0.75],
    ['9/8', [9, 8], 0.75],
    ['12/8', [12, 8], 0.75],
    ['3/8 (eighth)', [3, 8], 0.25],
    ['2/2 (half)', [2, 2], 1],
    ['4/4 (quarter)', [4, 4], 0.5],
    ['3/4', [3, 4], 0.5],
  ] as const)('%s', async (_name, meter, gap) => {
    expect(await clickGaps(withMeters(SCORE_M, [meter, null, null]))).toEqual([gap, gap, gap]);
  });

  it('is a quarter note when the score has no time signature, and divides by the speed', async () => {
    expect(await clickGaps(SCORE_M)).toEqual([0.5, 0.5, 0.5]);
    expect(await clickGaps(withMeters(SCORE_M, [[6, 8], null, null]), { speed: 0.5 })).toEqual([1.5, 1.5, 1.5]);
  });

  it('uses the time signature in force where playback starts', async () => {
    // 3/4 from measure 1, 6/8 from measure 3: D4 (tick 12) is in measure 2, E4 (tick 24) in measure 3.
    const score = withMeters(SCORE_M, [[3, 4], null, [6, 8]]);
    expect(await clickGaps(score, {}, 12)).toEqual([0.5, 0.5, 0.5]);
    expect(await clickGaps(score, {}, 24)).toEqual([0.75, 0.75, 0.75]);
  });

  it('Steady steps still count in at the step length', async () => {
    expect(await clickGaps(withMeters(SCORE_M, [[6, 8], null, null]), { mode: 'steady', stepSeconds: 0.8 })).toEqual([
      0.8, 0.8, 0.8,
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Pause during the count-in                                                 */
/* ------------------------------------------------------------------------ */

describe('Pause during the count-in', () => {
  it('Play again counts in again from the same step before the music starts', async () => {
    const h = setup(SCORE_A, { countIn: true });
    h.session.seek(2);
    await h.session.play();
    h.clock.advance(1300); // "Get ready… 3" (one beat is 1 s at step 2)
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', countInRemaining: 3 });
    h.session.pause();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'paused', stepIndex: 2 });
    h.clock.advance(2000);
    const clicks = h.sampler.clicks().length;
    const restartAt = h.clock.audioNow;
    await h.session.play();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'count-in', countInRemaining: 4, stepIndex: 2 });
    h.clock.advance(6000);
    const newClicks = h.sampler.clicks().slice(clicks);
    expect(newClicks).toHaveLength(COUNT_IN_BEATS);
    // Step 2 is at 60 qpm: one beat = 1 s.
    const first = restartAt + START_LEAD_SEC;
    expect(newClicks.map((c) => round(c.when - first))).toEqual([0, 1, 2, 3]);
    const ons = h.sampler.noteOns();
    expect(ons.length).toBeGreaterThan(0);
    for (const c of ons) expect(c.when).toBeGreaterThanOrEqual(first + COUNT_IN_BEATS - 1e-9);
  });

  it("also for the count-in before a loop restart, and after the page was hidden", async () => {
    for (const how of ['pause', 'pagehide'] as const) {
      const page = { fn: null as null | (() => void) };
      const sampler = new FakeSampler();
      const clock = new FakeClock(sampler);
      const midi = new FakeMidi(clock.nowMs);
      const session = new PracticeSession(
        SCORE_TAIL,
        { ...DEFAULT_SETTINGS, countIn: true, loop: true },
        {
          sampler,
          midi,
          nowMs: clock.nowMs,
          setInterval: clock.setInterval,
          clearInterval: clock.clearInterval,
          pageEvents: { addEventListener: (_t, fn) => (page.fn = fn), removeEventListener: () => undefined },
        },
      );
      await session.play();
      clock.advance(2050 + 2000 + 600); // count-in, one 2 s pass, then into the loop's count-in
      expect(session.getSnapshot().status).toBe('count-in');
      if (how === 'pause') session.pause();
      else page.fn?.();
      expect(session.getSnapshot().status).toBe('paused');
      const clicks = sampler.clicks().length;
      const notes = sampler.noteOns().length;
      await session.play();
      clock.advance(1700); // four clicks at 120 qpm take 2 s
      expect(sampler.clicks().length - clicks).toBe(COUNT_IN_BEATS);
      expect(sampler.noteOns().length).toBe(notes);
      clock.advance(500);
      expect(sampler.noteOns().length).toBe(notes + 1);
      session.dispose();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Late MIDI sends after a busy main thread, on a piano that echoes          */
/* ------------------------------------------------------------------------ */

describe('MIDI sent late after a busy main thread, on a piano that echoes', () => {
  it("does not take the echoes of late notes for the learner's keys", async () => {
    // Overdue by 75-125 ms: the tick before the note just missed it, then the thread was busy 150 ms.
    for (const offset of [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
      const h = await echoingPianoSetup(prepared([R('C4', 0, 4), R('D4', 4, 8), R('E4', 8, 12), R('F4', 12, 16)]), {
        monitorInput: true,
      });
      const seen: number[][] = [];
      h.session.subscribe(() => seen.push(h.session.getSnapshot().physicalDown));
      await h.session.play();
      h.clock.advance(450 + offset);
      h.clock.stall(150);
      h.clock.advance(2500);
      expect(h.session.getSnapshot().status).toBe('finished');
      expect(seen.filter((keys) => keys.length > 0)).toEqual([]);
      expect(h.sampler.noteOns().filter((c) => c.owner === 'input')).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Output piano back under a new id                                          */
/* ------------------------------------------------------------------------ */

describe('The output piano comes back under a new id with the same name', () => {
  it('the setting follows it, so the output menu shows it and Off stops playback there', async () => {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const sent: { port: string; data: number[] }[] = [];
    const port = (id: string, type: 'input' | 'output') =>
      new LoopPort(id, 'Digital Piano', type, (data) => sent.push({ port: id, data }));
    const access = {
      inputs: new Map([['in-1', port('in-1', 'input')]]),
      outputs: new Map([['out-1', port('out-1', 'output')]]),
      onstatechange: null as null | (() => void),
      sysexEnabled: false,
    };
    const midi = new MidiManager({ requestMIDIAccess: async () => access as unknown as MIDIAccess, now: clock.nowMs });
    await midi.connect();
    const session = new PracticeSession(
      prepared([R('C4', 0, 8), R('D4', 8, 16), R('E4', 16, 24)], { measures: buildMeasures(2) }),
      { ...DEFAULT_SETTINGS, sound: false, midiOutputId: 'out-1' },
      { sampler, midi, nowMs: clock.nowMs, setInterval: clock.setInterval, clearInterval: clock.clearInterval, pageEvents: null },
    );
    await session.play();
    clock.advance(300);

    // USB re-plug: both ports re-enumerate under new ids with the same name.
    access.inputs.clear();
    access.outputs.clear();
    access.inputs.set('in-2', port('in-2', 'input'));
    access.outputs.set('out-2', port('out-2', 'output'));
    access.onstatechange?.();
    expect(midi.selectedOutputId).toBe('out-2');
    expect(session.getSnapshot().settings.midiOutputId).toBe('out-2');

    clock.advance(1000); // D4 at 1.05 s goes to the piano under its new id (C4 is struck again: the input changed)
    expect(sent.filter((s) => s.port === 'out-2' && s.data[0] === 0x90).map((s) => s.data[1])).toEqual([C4, D4]);

    session.updateSettings({ midiOutputId: null });
    expect(midi.selectedOutputId).toBeNull();
    const mark = sent.length;
    clock.advance(3000);
    expect(sent.slice(mark)).toEqual([]);
  });

  /** A piece saved with output 'out-1'; the browser has since forgotten that id. */
  async function reopened(opts: { connectFirst: boolean; known?: LoopPort }) {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const sent: { port: string; data: number[] }[] = [];
    const port = (id: string, name: string) => new LoopPort(id, name, 'output', (data) => sent.push({ port: id, data }));
    const outputs = new Map<string, LoopPort>([['out-2', port('out-2', 'Digital Piano')]]);
    if (opts.known) outputs.set(opts.known.id, opts.known);
    const access = { inputs: new Map<string, LoopPort>(), outputs, onstatechange: null, sysexEnabled: false };
    const midi = new MidiManager({ requestMIDIAccess: async () => access as unknown as MIDIAccess, now: clock.nowMs });
    if (opts.connectFirst) await midi.connect();
    const session = new PracticeSession(
      prepared([R('C4', 0, 8), R('D4', 8, 16)], { measures: buildMeasures(1) }),
      { ...DEFAULT_SETTINGS, sound: false, midiOutputId: 'out-1' },
      {
        sampler,
        midi,
        nowMs: clock.nowMs,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
        pageEvents: null,
        midiOutputName: 'Digital Piano', // remembered with the learner's preferences
      },
    );
    if (!opts.connectFirst) await midi.connect(); // Connect piano on this page
    return { midi, session, clock, sent };
  }

  for (const connectFirst of [false, true]) {
    it(`a piece reopened after the browser forgot the old id finds the output by its remembered name (MIDI ${connectFirst ? 'already open' : 'opened on this page'})`, async () => {
      const { midi, session, clock, sent } = await reopened({ connectFirst });
      expect(midi.selectedOutputId).toBe('out-2');
      expect(session.getSnapshot().settings.midiOutputId).toBe('out-2');
      await session.play();
      clock.advance(2000);
      expect(sent.filter((s) => s.data[0] === 0x90).map((s) => [s.port, s.data[1]])).toEqual([
        ['out-2', C4],
        ['out-2', D4],
      ]);
    });
  }

  it('the remembered name never redirects playback away from a saved output the browser still knows', async () => {
    const off = new LoopPort('out-1', 'Sound Module', 'output');
    off.state = 'disconnected';
    for (const connectFirst of [false, true]) {
      const { midi, session, clock, sent } = await reopened({ connectFirst, known: off });
      expect(midi.selectedOutputId).toBe('out-1');
      expect(session.getSnapshot().settings.midiOutputId).toBe('out-1');
      await session.play();
      clock.advance(2000);
      expect(sent).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Status line name of a remembered piano that has not turned up             */
/* ------------------------------------------------------------------------ */

describe('The input name for the status line', () => {
  it('is not given while a remembered piano has not turned up (it was not found, not disconnected)', () => {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const midi = Object.assign(new FakeMidi(clock.nowMs), { inputSeen: false });
    midi.inputConnected = false;
    midi.inputName = 'Unnamed MIDI device';
    const h = setup(SCORE_A, {}, { sampler, clock, midi });
    expect(h.session.getSnapshot()).toMatchObject({ midiInputName: null, midiInputConnected: false, midiInputNotFound: true });
    midi.inputSeen = true;
    midi.inputName = 'Yamaha P-125';
    midi.reconnect();
    expect(h.session.getSnapshot()).toMatchObject({
      midiInputName: 'Yamaha P-125',
      midiInputConnected: true,
      midiInputNotFound: false,
    });
    // Seen, then unplugged: still named, so it is reported as disconnected.
    midi.disconnect();
    expect(h.session.getSnapshot()).toMatchObject({
      midiInputName: 'Yamaha P-125',
      midiInputConnected: false,
      midiInputNotFound: false,
    });
  });

  it('with the real MIDI manager: none for a saved piano that is off, its name once it is switched on', async () => {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const access = {
      inputs: new Map<string, LoopPort>(),
      outputs: new Map<string, LoopPort>(),
      onstatechange: null as null | (() => void),
      sysexEnabled: false,
    };
    const midi = new MidiManager({ requestMIDIAccess: async () => access as unknown as MIDIAccess, now: clock.nowMs });
    midi.selectInput('in-a'); // saved with the piece
    await midi.connect();
    const session = new PracticeSession(SCORE_A, DEFAULT_SETTINGS, {
      sampler,
      midi,
      nowMs: clock.nowMs,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      pageEvents: null,
    });
    expect(session.getSnapshot()).toMatchObject({
      midiState: 'ready',
      midiInputName: null,
      midiInputConnected: false,
      midiInputNotFound: true,
    });
    const piano = new LoopPort('in-a', 'Yamaha P-125', 'input');
    access.inputs.set('in-a', piano);
    access.onstatechange?.();
    expect(session.getSnapshot()).toMatchObject({ midiInputName: 'Yamaha P-125', midiInputConnected: true });
    piano.state = 'disconnected';
    access.onstatechange?.();
    expect(session.getSnapshot()).toMatchObject({
      midiInputName: 'Yamaha P-125',
      midiInputConnected: false,
      midiInputNotFound: false,
    });
  });

  it('no piano is reported as not found before MIDI is ready, or with no input selected', () => {
    const sampler = new FakeSampler();
    const clock = new FakeClock(sampler);
    const midi = Object.assign(new FakeMidi(clock.nowMs), { inputSeen: false });
    midi.inputConnected = false;
    midi.state = 'idle';
    const h = setup(SCORE_A, {}, { sampler, clock, midi });
    expect(h.session.getSnapshot().midiInputNotFound).toBe(false);
    midi.state = 'ready';
    midi.selectedInputId = null;
    midi.emitChange();
    expect(h.session.getSnapshot().midiInputNotFound).toBe(false);
  });
});

describe('A sampler that throws on one note does not stall playback', () => {
  it('skips the note it throws on and plays the rest of the piece on time', async () => {
    const h = setup(SCORE_A);
    const realOn = h.sampler.noteOn.bind(h.sampler);
    let throws = 0;
    h.sampler.noteOn = (midi, velocity, when, owner) => {
      if (midi === G4) {
        throws++;
        throw new TypeError('The provided float value is non-finite.');
      }
      realOn(midi, velocity, when, owner);
    };
    const anchor = await start(h);
    h.clock.advance(4000);
    // G4 was tried once, not again on every scheduler tick.
    expect(throws).toBe(1);
    expect(noteEvents(h.sampler.calls, anchor)).toEqual([
      ['on', C3, 0],
      ['on', C4, 0],
      ['off', C4, 0.5],
      ['on', C4, 0.5],
      ['off', C4, 1],
      ['off', G4, 2],
      ['off', C3, 3],
    ]);
    expect(h.session.getSnapshot().status).toBe('finished');
  });
});
