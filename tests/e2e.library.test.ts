/**
 * End-to-end checks over the whole vendored library (public/scores/*.mxl):
 * parse -> prepare (automatic hand detection, no catalog overrides) -> derive
 * for both hands and each hand alone -> independent round trip, plus random
 * passages, timing sanity, and spot checks against the files' own markup.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { roundTrip } from '../src/core/actions/interpret';
import { listenStepTimes, passageDurationListen } from '../src/core/actions/timing';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { midiToLabel } from '../src/core/pitch';
import type { HandSelection, PassageRange, PreparedScore, Readiness, StepSequence } from '../src/core/types';
import { handsOf } from '../src/core/types';
import { measureList } from '../src/ui/practice/diagnostics';

const SCORES_DIR = join(__dirname, '..', 'public', 'scores');
const files = readdirSync(SCORES_DIR)
  .filter((f) => f.toLowerCase().endsWith('.mxl'))
  .sort();
const SELECTIONS: HandSelection[] = ['both', 'R', 'L'];

const cache = new Map<string, PreparedScore>();
function prepare(file: string): PreparedScore {
  let p = cache.get(file);
  if (!p) {
    p = prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(SCORES_DIR, file))), file));
    cache.set(file, p);
  }
  return p;
}

/** A real event-loop turn, so long synchronous work never starves the runner's messaging. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Deterministic pseudo-random numbers in [0, 1), seeded from the file name. */
function rng(seedText: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seedText.length; i++) state = Math.imul(state ^ seedText.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomPassages(p: PreparedScore, file: string, count: number): PassageRange[] {
  const next = rng(file);
  const n = p.measures.length;
  return Array.from({ length: count }, () => {
    const startOcc = Math.floor(next() * n);
    const length = 1 + Math.floor(next() * Math.min(12, n - startOcc));
    return { startOcc, endOcc: startOcc + length - 1 };
  });
}

function checkSequence(p: PreparedScore, seq: StepSequence, where: string): void {
  const rt = roundTrip(seq);
  expect(rt.mismatches.slice(0, 5), where).toEqual([]);
  for (const s of seq.steps) {
    const acts = seq.hands.some((h) => (s.attacks[h] ?? []).length + (s.releases[h] ?? []).length > 0);
    if (!acts) expect.fail(`${where}: step ${s.index} (tick ${s.tick}) has no press or release`);
  }
  const times = listenStepTimes(seq, p.tempo, 1);
  for (let i = 1; i < times.length; i++) {
    if (!(times[i] >= times[i - 1])) expect.fail(`${where}: Listen time goes back at step ${i}`);
  }
  if (times.length > 0) expect(times[times.length - 1], where).toBeLessThanOrEqual(passageDurationListen(seq, p.tempo, 1) + 1e-9);
}

/** Performance order as runs of consecutive written measures, by measure number: "1-9, 2-8, 10-19". */
function orderRuns(p: PreparedScore): string {
  const runs: string[] = [];
  let first = p.measures[0];
  let prev = first;
  for (let i = 1; i <= p.measures.length; i++) {
    const o = p.measures[i];
    if (o && o.measureIndex === prev.measureIndex + 1) {
      prev = o;
      continue;
    }
    runs.push(first === prev ? first.number : `${first.number}-${prev.number}`);
    if (o) first = prev = o;
  }
  return runs.join(', ');
}

/** Presses starting in one occurrence: "R B4@0+1" = hand, key, start and length in quarter notes. */
function pressesIn(p: PreparedScore, occ: number): string[] {
  const o = p.measures[occ];
  const tpq = p.source.ticksPerQuarter;
  return p.presses
    .filter((x) => x.startTick >= o.startTick && x.startTick < o.startTick + o.durationTicks)
    .map((x) => `${x.hand} ${midiToLabel(x.midi)}@${(x.startTick - o.startTick) / tpq}+${(x.endTick - x.startTick) / tpq}`);
}

describe('the whole library through the core pipeline', () => {
  const lines: string[] = [];
  const readiness: Record<Readiness, string[]> = { ready: [], review: [], unsupported: [] };
  let totalMs = 0;

  afterAll(() => {
    const counts = `ready ${readiness.ready.length} / review ${readiness.review.length} / unsupported ${readiness.unsupported.length}`;
    console.log(`${lines.join('\n')}\n[e2e-library] ${files.length} files, ${counts}, ${Math.round(totalMs)} ms of pipeline work`);
  });

  it('finds the vendored library', () => {
    expect(files.length).toBe(69);
  });

  it.each(files)(
    '%s',
    async (file) => {
      await breathe();
      const started = performance.now();
      const p = prepare(file);
      const full = new Map<HandSelection, StepSequence>();
      for (const sel of SELECTIONS) {
        const seq = deriveSteps(p, handsOf(sel), null);
        full.set(sel, seq);
        checkSequence(p, seq, `${file} full ${sel}`);
      }
      for (const range of randomPassages(p, file, 3)) {
        for (const sel of SELECTIONS) {
          checkSequence(p, deriveSteps(p, handsOf(sel), range), `${file} ${range.startOcc}-${range.endOcc} ${sel}`);
        }
      }
      totalMs += performance.now() - started;

      expect(p.readiness, file).not.toBe('unsupported');
      readiness[p.readiness].push(file);
      const both = full.get('both')!;
      const seconds = passageDurationListen(both, p.tempo, 1);
      const warnings = p.warnings.map((w) => `${w.code}:${w.severity}x${w.count ?? 1}`).join(', ') || '-';
      lines.push(
        `[e2e-library] ${file} | ${p.readiness} | measures ${p.source.measures.length} -> ${p.measures.length}` +
          ` | presses ${p.presses.length} | steps ${both.steps.length} | ${seconds.toFixed(1)} s` +
          ` | tempo ${p.tempo.defaulted ? 'defaulted' : 'from file'} | ${warnings}`,
      );
    },
    120_000,
  );
});

describe('hand mapping on the library (automatic, no overrides)', () => {
  it('Chopin Ballade leaves out its 3-note ossia part', () => {
    const p = prepare('Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl');
    expect(p.handMapping.excludedParts).toEqual(['P2']);
    expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(new Set(p.notes.map((n) => n.partId))).toEqual(new Set(['P1']));
  });

  it('G minor Bach leaves out its written-out ornament part', () => {
    const p = prepare('G_Minor_Bach.mxl');
    expect(p.handMapping.excludedParts).toEqual(['P1']);
    expect(p.handMapping.staffHands).toEqual({ 'P2:1': 'R', 'P2:2': 'L' });
    expect(new Set(p.notes.map((n) => n.partId))).toEqual(new Set(['P2']));
  });

  it.each(['The_Entertainer_-_Scott_Joplin.mxl', 'Schubert_Serenade_-_Standchen_-_By_Lizst.mxl'])(
    '%s: two single-staff parts map P1 to the right hand and P2 to the left hand',
    (file) => {
      const p = prepare(file);
      expect(p.handMapping.source).toBe('two-single-staff-parts');
      expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P2:1': 'L' });
      expect(p.handMapping.excludedParts).toEqual([]);
    },
  );

  it('every other file is one two-staff piano part', () => {
    const special = new Set([
      'Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl',
      'G_Minor_Bach.mxl',
      'The_Entertainer_-_Scott_Joplin.mxl',
      'Schubert_Serenade_-_Standchen_-_By_Lizst.mxl',
    ]);
    for (const file of files.filter((f) => !special.has(f))) {
      expect(prepare(file).handMapping.source, file).toBe('two-staff-part');
    }
  });
});

describe('repeats, endings and jumps on the library, compared with the files’ barlines', () => {
  it.each([
    // Endings: 1st ending closes the repeat, 2nd ending continues.
    ['Bella_Ciao.mxl', '1-9, 2-8, 10-19, 12-18, 20-29, 22-28, 30-38'],
    ['DANSE_VILLAGEOISE_Beethoven.mxl', '1-9, 2-8, 10-18, 11-17, 19-27, 20-26, 28-44, 29-43, 45-61'],
    // A 1st ending at 16 with no marked 2nd ending; the return of A is written out (34-50).
    ['Maple_Leaf_Rag_Scott_Joplin.mxl', '0-16, 1-15, 17-33, 18-32, 34-66, 51-65, 67-83, 68-82, 84'],
    // The 2nd ending at 9 is never closed in the file; it must not swallow the repeat at 10-23.
    ['Fur_Elise.mxl', '0-8, 0-7, 9-23, 10-22, 24-105'],
    ['Fur_Elise_fingered.mxl', '0-8, 0-7, 9-23, 10-22, 24-105'],
    // Segno at 10, "To Coda" at 14, "D.S. al Coda" at 31, coda at 32.
    ['Hungarian_Sonata.mxl', '1-31, 10-14, 32-49'],
    ['Canon_in_D_easy.mxl', '1-48, 45-49'],
    ['Erik_Satie_-_Gymnopedie_No.1.mxl', '1-39, 1-31, 40-47'],
    ['Sonate_No._14_Moonlight_3rd_Movement.mxl', '1-65, 2-64, 66-201'],
  ])('%s plays %s', (file, expected) => {
    expect(orderRuns(prepare(file))).toBe(expected);
  });

  it('Hungarian Sonata labels the measures replayed after D.S. as second passes', () => {
    const p = prepare('Hungarian_Sonata.mxl');
    expect(p.measures.length).toBe(54);
    expect(p.measures.slice(30, 37).map((o) => o.label)).toEqual([
      '31',
      '10 (2nd time)',
      '11 (2nd time)',
      '12 (2nd time)',
      '13 (2nd time)',
      '14 (2nd time)',
      '32',
    ]);
    expect(p.warnings.map((w) => w.code)).not.toContain('jump-unsupported');
  });

  it('no file falls back to written order, and none unrolls to more than twice its length', () => {
    for (const file of files) {
      const p = prepare(file);
      const codes = p.warnings.map((w) => w.code);
      expect(codes, file).not.toContain('repeats-unsupported');
      expect(codes, file).not.toContain('jump-unsupported');
      expect(p.measures.length, file).toBeLessThanOrEqual(2 * p.source.measures.length);
    }
  });
});

describe('spot checks of the first measures against the MusicXML', () => {
  it('Ode to Joy (easy): melody over held LH triads, repeated notes struck again', () => {
    const p = prepare('Ode_to_Joy_Easy_variation.mxl');
    expect(p.tempo.points).toEqual([{ tick: 0, qpm: 140 }]);
    expect(pressesIn(p, 0)).toEqual(['R B4@0+1', 'L G3@0+4', 'L B3@0+4', 'L D4@0+4', 'R B4@1+1', 'R C5@2+1', 'R D5@3+1']);
    expect(pressesIn(p, 1)).toEqual(['R D5@0+1', 'L F#3@0+4', 'L A3@0+4', 'L D4@0+4', 'R C5@1+1', 'R B4@2+1', 'R A4@3+1']);
    expect(pressesIn(p, 2)).toEqual(['R G4@0+1', 'L G3@0+4', 'L B3@0+4', 'L D4@0+4', 'R G4@1+1', 'R A4@2+1', 'R B4@3+1']);
    const seq = deriveSteps(p, ['R', 'L'], { startOcc: 0, endOcc: 0 });
    expect(seq.steps.map((s) => s.cells.R!.kind)).toEqual(['replace', 'replace', 'replace', 'replace', 'rest']);
    expect(seq.steps.map((s) => s.cells.L!.kind)).toEqual(['replace', 'hold', 'hold', 'hold', 'rest']);
  });

  it('Für Elise (easy, 3/4): the E–D# motif after a half rest, then the A minor arpeggio', () => {
    const p = prepare('Fur_Elise_Easy_Piano.mxl');
    expect(p.tempo.defaulted).toBe(true);
    expect(pressesIn(p, 0)).toEqual(['R E5@2+0.5', 'R D#5@2.5+0.5']);
    expect(pressesIn(p, 1)).toEqual(['R E5@0+0.5', 'R D#5@0.5+0.5', 'R E5@1+0.5', 'R B4@1.5+0.5', 'R D5@2+0.5', 'R C5@2.5+0.5']);
    expect(pressesIn(p, 2)).toEqual(['R A4@0+1', 'L A3@0+2', 'R C4@1.5+0.5', 'R E4@2+0.5', 'R A4@2.5+0.5']);
    expect(pressesIn(p, 3)).toEqual(['R B4@0+1', 'L E3@0+2', 'R E4@1.5+0.5', 'R G#4@2+0.5', 'R B4@2.5+0.5']);
  });

  it('Minuet in G (BWV Anh. 114): D5 over a G triad, the eighth-note run, the repeated G4', () => {
    const p = prepare('Bach_Minuet_in_G_Major_BWV_Anh._114.mxl');
    expect(p.tempo.points).toEqual([{ tick: 0, qpm: 126 }]);
    expect(pressesIn(p, 0)).toEqual([
      'R D5@0+1',
      'L G3@0+2',
      'L B3@0+2',
      'L D4@0+2',
      'R G4@1+0.5',
      'R A4@1.5+0.5',
      'R B4@2+0.5',
      'L A3@2+1',
      'R C5@2.5+0.5',
    ]);
    expect(pressesIn(p, 1)).toEqual(['R D5@0+1', 'L B3@0+3', 'R G4@1+1', 'R G4@2+1']);
    expect(pressesIn(p, 2)).toEqual(['R E5@0+1', 'L C4@0+3', 'R C5@1+0.5', 'R D5@1.5+0.5', 'R E5@2+0.5', 'R F#5@2.5+0.5']);
  });

  it('Happy Birthday (C major): G G A G over a LH chord entering on beat 2', () => {
    const p = prepare('Happy_Birthday_To_You_C_Major.mxl');
    expect(p.tempo.defaulted).toBe(true);
    expect(pressesIn(p, 0)).toEqual(['R G4@0+0.5', 'R G4@0.5+0.5', 'R A4@1+1', 'L C3@1+2', 'L E3@1+2', 'L G3@1+2', 'R G4@2+1']);
    expect(pressesIn(p, 1)).toEqual(['R C5@0+1', 'R B4@1+2', 'L D3@1+2', 'L F3@1+2', 'L G3@1+2']);
    expect(pressesIn(p, 2)).toEqual(['R G4@0+0.5', 'R G4@0.5+0.5', 'R A4@1+1', 'L B2@1+2', 'L F3@1+2', 'L G3@1+2', 'R G4@2+1']);
  });

  it('Canon in D (easy): the LH eighth-note bass pattern alone for the first measures', () => {
    const p = prepare('Canon_in_D_easy.mxl');
    expect(p.tempo.points).toEqual([{ tick: 0, qpm: 100 }]);
    const eighths = (labels: string[]) => labels.map((k, i) => `L ${k}@${i / 2}+0.5`);
    expect(pressesIn(p, 0)).toEqual(eighths(['D3', 'F#3', 'A3', 'D4', 'A2', 'C#3', 'E3', 'A3']));
    expect(pressesIn(p, 1)).toEqual(eighths(['B2', 'D3', 'F#3', 'B3', 'F#2', 'A2', 'C#3', 'F#3']));
    expect(pressesIn(p, 2)).toEqual(eighths(['G2', 'B2', 'D3', 'G3', 'D2', 'F#2', 'A2', 'D3']));
    expect(deriveSteps(p, ['R'], { startOcc: 0, endOcc: 2 }).steps).toEqual([]);
  });
});

describe('readiness and warning policy on the library', () => {
  const INFO_ONLY = ['grace-notes-approximated', 'arpeggio-not-rolled', 'pedal-not-modelled'];
  const DEVELOPER_WORDS = /\b(P\d+|xml|musicxml|parser|tick|ticks|midi|undefined|null|NaN|voice \d|staff \d)\b/i;

  it('grace notes, rolled chords and pedal marks are information only', () => {
    for (const file of files) {
      for (const w of prepare(file).warnings) {
        if (INFO_ONLY.includes(w.code)) expect(w.severity, `${file} ${w.code}`).toBe('info');
      }
    }
  });

  it('trills, mordents and turns played as their main note mark the piece for review (§12)', () => {
    for (const file of files) {
      const p = prepare(file);
      const w = p.warnings.find((x) => x.code === 'ornament-not-played');
      if (!w) continue;
      expect(w.severity, file).toBe('review');
      expect(p.readiness, file).not.toBe('ready');
    }
  });

  it('every message is plain language, and cross-staff warnings name their measures', () => {
    for (const file of files) {
      const p = prepare(file);
      for (const w of p.warnings) {
        expect(w.message, `${file} ${w.code}`).not.toMatch(DEVELOPER_WORDS);
        expect(w.message, `${file} ${w.code}`).toMatch(/^[A-Z“"].*[.]$/s);
        if (w.code === 'cross-staff-notes') {
          expect(w.severity, file).toBe('review');
          expect(w.measures?.length ?? 0, file).toBeGreaterThan(0);
          expect(w.count ?? 0, file).toBeGreaterThanOrEqual(w.measures!.length);
          for (const m of w.measures!) expect(p.source.measures.some((sm) => sm.number === m), `${file} measure ${m}`).toBe(true);
        }
      }
      const reviews = p.warnings.filter((w) => w.severity === 'review').map((w) => w.message);
      expect(p.readiness, file).toBe(reviews.length > 0 ? 'review' : 'ready');
      expect(p.readinessReasons, file).toEqual(reviews);
    }
  });

  it('a measure list ("About this arrangement") says "and others" only when it was cut short at 20', () => {
    let completeButBusy = 0;
    for (const file of files) {
      const p = prepare(file);
      for (const w of p.warnings) {
        const list = measureList(w);
        if (list === null) continue;
        const truncated = w.measuresTruncated === true;
        expect(list.endsWith(' and others'), `${file} ${w.code}: ${list}`).toBe(truncated);
        if (truncated) expect(w.measures!.length, `${file} ${w.code}`).toBe(20);
        // `count` counts notes: a complete list of measures holding several notes each.
        if (!truncated && (w.count ?? 0) > w.measures!.length) completeButBusy++;
      }
    }
    expect(completeButBusy).toBeGreaterThan(50);
  });

  it('counts: 37 ready, 32 review, none unsupported (a change here must be deliberate)', () => {
    // 49/20 until the Chopin E minor Prelude's right-hand chords written on the bass staff were
    // recognised as cross-staff, and The Entertainer's "Repeat 8va" words were flagged as not applied.
    // 47/22 until trills, mordents and turns played as their main note became a review reason (8 files),
    // and one-hand chords wider than a tenth were flagged (Gymnopédie, Erik Satie edition, and the
    // Schubert/Liszt Serenade; this test uses no catalog overrides).
    const count = (r: Readiness) => files.filter((f) => prepare(f).readiness === r).length;
    expect([count('ready'), count('review'), count('unsupported')]).toEqual([37, 32, 0]);
  });

  it('files that need review only for an automatic ossia exclusion are exactly the two known ones', () => {
    const onlyAlternative = files.filter((f) => {
      const reviews = prepare(f).warnings.filter((w) => w.severity === 'review');
      return reviews.length > 0 && reviews.every((w) => w.code === 'alternative-part-excluded');
    });
    expect(onlyAlternative).toEqual(['G_Minor_Bach.mxl']);
  });

  it('ties are joined: at most 3 unjoinable ties in any file, all from broken tie markup', () => {
    const unmatched = Object.fromEntries(
      files
        .map((f) => [f, prepare(f).warnings.find((w) => w.code === 'tie-unmatched')?.count ?? 0] as const)
        .filter(([, n]) => n > 0),
    );
    expect(unmatched).toEqual({
      'Nocturne_in_C_sharp_Minor.mxl': 3,
      'Schubert_Serenade_-_Standchen_-_By_Lizst.mxl': 2,
    });
  });

  it('a default tempo is used only where the file has no tempo mark at all', () => {
    const defaulted = files.filter((f) => prepare(f).tempo.defaulted);
    expect(defaulted).toEqual([
      'Bella_Ciao.mxl',
      'Carol_of_the_Bells_easy_piano.mxl',
      'Fur_Elise_Easy_Piano.mxl',
      'Happy_Birthday_To_You_C_Major.mxl',
      'Happy_Birthday_To_You_Piano.mxl',
      'Minuet_in_G_Major_Bach.mxl',
    ]);
    for (const f of defaulted) expect(prepare(f).source.tempos, f).toEqual([]);
  });
});
