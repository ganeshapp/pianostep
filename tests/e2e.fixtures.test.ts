/**
 * End-to-end checks of the core pipeline on the hand-written fixtures:
 * file bytes -> loadSourceScore -> prepareScore -> deriveSteps -> roundTrip,
 * with exact §6/§17 notation for the brief's required fixtures.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { roundTrip } from '../src/core/actions/interpret';
import { listenStepTimes, passageDurationListen } from '../src/core/actions/timing';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { midiToLabel } from '../src/core/pitch';
import type { Hand, HandCell, HandSelection, PassageRange, PreparedScore, StepSequence } from '../src/core/types';
import { handsOf } from '../src/core/types';
import { ImportError } from '../src/core/xml';
import { HOLD, REST, add, change, keys, press, rel, replace, repress } from './helpers/pressBuilder';

const FIXTURES = join(__dirname, 'fixtures');
const ERROR_FIXTURES = new Set(['f15-malformed.musicxml', 'f-entity.musicxml']);
const SELECTIONS: HandSelection[] = ['both', 'R', 'L'];

const fixtureFiles = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.musicxml') && !ERROR_FIXTURES.has(f))
  .sort();

function bytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function prepare(name: string): PreparedScore {
  return prepareScore(loadSourceScore(bytes(name), name));
}

function derive(p: PreparedScore, sel: HandSelection, range: PassageRange | null = null): StepSequence {
  return deriveSteps(p, handsOf(sel), range);
}

const cells = (seq: StepSequence, h: Hand): HandCell[] => seq.steps.map((s) => s.cells[h]!);
const ticks = (seq: StepSequence): number[] => seq.steps.map((s) => s.tick);
const attackLabels = (seq: StepSequence, h: Hand): string[][] =>
  seq.steps.filter((s) => (s.attacks[h] ?? []).length > 0).map((s) => s.attacks[h]!.map(midiToLabel));

/** Every passage worth checking: the whole piece, each occurrence, and every pair of neighbours. */
function ranges(p: PreparedScore): (PassageRange | null)[] {
  const out: (PassageRange | null)[] = [null];
  const n = p.measures.length;
  for (let i = 0; i < n; i++) out.push({ startOcc: i, endOcc: i });
  for (let i = 0; i + 1 < n; i++) out.push({ startOcc: i, endOcc: i + 1 });
  if (n > 2) out.push({ startOcc: 1, endOcc: n - 1 });
  return out;
}

/** Sorted unique press boundaries of one hand inside a sequence (what its own steps must be). */
function boundaryTicks(seq: StepSequence, hands: readonly Hand[]): number[] {
  const set = new Set<number>();
  for (const p of seq.presses) {
    if (!hands.includes(p.hand)) continue;
    set.add(p.startTick);
    set.add(p.endTick);
  }
  return [...set].sort((a, b) => a - b);
}

describe('every fixture survives parse -> prepare -> derive -> round trip', () => {
  it('finds the fixtures', () => {
    expect(fixtureFiles.length).toBe(22);
  });

  it.each(fixtureFiles)('%s', (name) => {
    const p = prepare(name);
    expect(p.readiness, name).not.toBe('unsupported');
    expect(p.presses.length, name).toBeGreaterThan(0);

    for (const range of ranges(p)) {
      const where = `${name} ${range ? `${range.startOcc}-${range.endOcc}` : 'full'}`;
      const bySel = new Map<HandSelection, StepSequence>();
      for (const sel of SELECTIONS) {
        const seq = derive(p, sel, range);
        bySel.set(sel, seq);
        const rt = roundTrip(seq);
        expect(rt.mismatches, `${where} ${sel}`).toEqual([]);
        expect(rt.ok).toBe(true);
        for (const s of seq.steps) {
          const acts = seq.hands.some((h) => (s.attacks[h] ?? []).length + (s.releases[h] ?? []).length > 0);
          expect(acts, `${where} ${sel} step ${s.index} is empty`).toBe(true);
        }
        const times = listenStepTimes(seq, p.tempo, 1);
        times.forEach((t, i) => {
          if (i > 0) expect(t, `${where} ${sel} step ${i}`).toBeGreaterThan(times[i - 1]);
        });
        if (times.length > 0) {
          expect(times[times.length - 1]).toBeLessThanOrEqual(passageDurationListen(seq, p.tempo, 1) + 1e-9);
        }
      }
      // §8/§17 hand filtering: a hand's own steps are exactly its own press boundaries,
      // and the two-hand sequence is their union.
      const both = bySel.get('both')!;
      expect(ticks(bySel.get('R')!), where).toEqual(boundaryTicks(both, ['R']));
      expect(ticks(bySel.get('L')!), where).toEqual(boundaryTicks(both, ['L']));
      expect(ticks(both), where).toEqual(boundaryTicks(both, ['R', 'L']));
    }
  });
});

describe('§17 fixtures end to end, with exact notation', () => {
  it('f01: repeated notes are normal replace stacks, never "—"', () => {
    const seq = derive(prepare('f01-melody-repeated.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 48, 96, 144, 192, 240, 288, 384]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      replace(press('C4')),
      replace(press('D4')),
      replace(press('E4')),
      replace(press('E4')),
      replace(press('D4')),
      replace(press('C4')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual(Array(8).fill(HOLD));
    expect(seq.steps[1].attacks.R).toEqual(keys('C4'));
    expect(seq.steps[4].attacks.R).toEqual(keys('E4'));
  });

  it('f02: the RH note and the LH chord share a column', () => {
    const seq = derive(prepare('f02-melody-and-chord.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 96, 192]);
    expect(cells(seq, 'R')).toStrictEqual([replace(press('E4')), replace(press('D4')), REST]);
    expect(cells(seq, 'L')).toStrictEqual([
      replace(press('G3'), press('E3'), press('C3')),
      // G3 ends and is struck again with the new chord: a plain new stack.
      replace(press('G3'), press('D3'), press('B2')),
      REST,
    ]);
    expect(seq.steps[0].attacks).toEqual({ R: keys('E4'), L: keys('C3', 'E3', 'G3') });
  });

  it('f03: the LH shows "—" while the RH changes', () => {
    const seq = derive(prepare('f03-long-lh-hold.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 48, 96, 144, 192]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('E4')),
      replace(press('F4')),
      replace(press('G4')),
      replace(press('A4')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), HOLD, HOLD, HOLD, REST]);
    expect(seq.steps.slice(1, 4).map((s) => s.heldAfter.L)).toEqual([keys('C3'), keys('C3'), keys('C3')]);
  });

  it('f04: the exact §6 sequence (normal C4; red E4; blue E4 + red G4; blue G4 + red F4; ".")', () => {
    const p = prepare('f04-moving-line.musicxml');
    const seq = derive(p, 'R');
    expect(ticks(seq)).toEqual([0, 480, 960, 1440, 1920]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      change(add('E4')),
      change(add('G4'), rel('E4')),
      change(rel('G4'), add('F4')),
      REST,
    ]);
    expect(seq.steps.map((s) => s.heldAfter.R)).toEqual([
      keys('C4'),
      keys('C4', 'E4'),
      keys('C4', 'G4'),
      keys('C4', 'F4'),
      [],
    ]);
    // The file's tempo is quarter = 60, so each step is one second apart.
    expect(listenStepTimes(seq, p.tempo, 1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('f05: a red re-press of C5 while G4 is held', () => {
    const seq = derive(prepare('f05-repeat-while-held.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 48, 96, 192]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C5'), press('G4')),
      change(repress('C5')),
      change(repress('C5')),
      REST,
    ]);
    expect(seq.steps[1].attacks.R).toEqual(keys('C5'));
    expect(seq.steps[1].releases.R).toEqual(keys('C5'));
    expect(seq.steps[1].heldAfter.R).toEqual(keys('G4', 'C5'));
  });

  it('f06: release-only steps', () => {
    const seq = derive(prepare('f06-release-between.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 48, 96, 192, 288, 336]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('C4')),
      REST,
      HOLD,
      replace(press('E4'), press('C4')),
      change(rel('E4')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), HOLD, REST, HOLD, HOLD, HOLD]);
    expect(seq.steps.map((s) => s.releaseOnly)).toEqual([false, true, true, false, true, true]);
  });

  it('f07: no new press where a tie arrives', () => {
    const p = prepare('f07-tie-across-barline.musicxml');
    const seq = derive(p, 'both');
    expect(ticks(seq)).toEqual([0, 96, 192, 240, 288, 384, 432, 480]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('E4')),
      replace(press('C5')),
      HOLD, // C5 is tied over the bar line
      replace(press('D5')),
      replace(press('G4'), press('E4')),
      HOLD, // E4 + G4 tied over the bar line (written with <tied> only)
      REST,
      HOLD,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([
      replace(press('C3')),
      HOLD,
      replace(press('G2')),
      HOLD,
      HOLD,
      replace(press('C3')),
      HOLD,
      REST,
    ]);
    const r = p.presses.filter((x) => x.hand === 'R').map((x) => [midiToLabel(x.midi), x.startTick, x.endTick]);
    expect(r).toEqual([
      ['E4', 0, 96],
      ['C5', 96, 240],
      ['D5', 240, 288],
      ['E4', 288, 432],
      ['G4', 288, 432],
    ]);
    expect(p.warnings.map((w) => w.code)).not.toContain('tie-unmatched');
  });

  it('f08: the step ticks are the exact union of both rhythms (triplets, quintuplets, dotted)', () => {
    const p = prepare('f08-tuplets-two-rhythms.musicxml');
    expect(p.source.ticksPerQuarter).toBe(240);
    const rh = [0, 80, 160, 240, 320, 400, 480, 528, 576, 624, 672, 720, 900, 960];
    const lh = [0, 120, 240, 360, 480, 600, 720, 840, 960];
    expect(ticks(derive(p, 'R'))).toEqual(rh);
    expect(ticks(derive(p, 'L'))).toEqual(lh);
    const both = derive(p, 'both');
    expect(ticks(both)).toEqual([...new Set([...rh, ...lh])].sort((a, b) => a - b));
    expect(ticks(both)).toEqual([0, 80, 120, 160, 240, 320, 360, 400, 480, 528, 576, 600, 624, 672, 720, 840, 900, 960]);
    const at = (t: number) => both.steps.find((s) => s.tick === t)!;
    expect(at(80).cells).toStrictEqual({ R: replace(press('D5')), L: HOLD });
    expect(at(120).cells).toStrictEqual({ R: HOLD, L: replace(press('E3')) });
    expect(at(240).cells).toStrictEqual({ R: replace(press('F5')), L: replace(press('G3')) });
  });

  it('f09: a rest then an entry, and the final note keeps its full duration', () => {
    const p = prepare('f09-rest-entry-final.musicxml');
    const seq = derive(p, 'both');
    expect(ticks(seq)).toEqual([96, 192, 240, 288, 336, 384, 528]);
    expect(cells(seq, 'R')).toStrictEqual([
      HOLD,
      HOLD,
      replace(press('E4')),
      replace(press('D4')),
      replace(press('C4')),
      replace(press('C4')), // a new C4, not a tie
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([
      replace(press('C3')),
      replace(press('G2')),
      HOLD,
      HOLD,
      HOLD,
      replace(press('C3')),
      REST,
    ]);
    const finalC4 = p.presses.find((x) => x.hand === 'R' && x.startTick === 384)!;
    expect(finalC4.endTick - finalC4.startTick).toBe(144); // dotted half = 3 quarters of 48
    // The passage still runs to the end of the final rest: 12 quarters at the default 120.
    expect(seq.endTick).toBe(576);
    expect(p.tempo.defaulted).toBe(true);
    expect(passageDurationListen(seq, p.tempo, 1)).toBe(6);
    expect(listenStepTimes(seq, p.tempo, 1)).toEqual([1, 2, 2.5, 3, 3.5, 4, 5.5]);
  });

  it('f10: a passage from occurrence 1 carries the LH C2 into step 0', () => {
    const p = prepare('f10-held-into-passage.musicxml');
    expect(p.source.ticksPerQuarter).toBe(240);
    const c2 = p.presses.filter((x) => x.hand === 'L');
    expect(c2.map((x) => [midiToLabel(x.midi), x.startTick, x.endTick])).toEqual([['C2', 0, 2400]]);

    const seq = derive(p, 'both', { startOcc: 1, endOcc: 2 });
    expect(seq.startTick).toBe(960);
    expect(ticks(seq)).toEqual([960, 1200, 1440, 1680, 1920, 2400]);
    expect(seq.steps[0].cells).toStrictEqual({
      R: replace(press('F4')),
      L: replace(press('C2', { carried: true })),
    });
    expect(seq.steps[0].heldBefore.L).toEqual([]);
    expect(seq.steps[0].heldAfter.L).toEqual(keys('C2'));
    expect(seq.steps[0].attacks.L).toEqual(keys('C2'));
    expect(cells(seq, 'L').slice(1)).toStrictEqual([HOLD, HOLD, HOLD, HOLD, REST]);
    expect(seq.presses.find((x) => x.hand === 'L')).toMatchObject({ startTick: 960, endTick: 2400, carried: true });

    // Only measure 2: the held C2 is carried in and let go at the passage end.
    const one = derive(p, 'L', { startOcc: 1, endOcc: 1 });
    expect(ticks(one)).toEqual([960, 1920]);
    expect(cells(one, 'L')).toStrictEqual([replace(press('C2', { carried: true })), REST]);
    expect(one.steps[1].occ).toBe(1);
  });

  it('f12: enharmonic spellings and the piano edges get sharp-only labels', () => {
    const p = prepare('f12-enharmonics.musicxml');
    const seq = derive(p, 'both');
    expect(attackLabels(seq, 'R')).toEqual([['C4'], ['B3'], ['C#4'], ['F4'], ['E4'], ['A#3'], ['B3'], ['C4'], ['C8']]);
    expect(attackLabels(seq, 'L')).toEqual([['A0']]);
    expect(cells(seq, 'R').slice(0, 6)).toStrictEqual([
      replace(press('C4')),
      replace(press('B3')),
      replace(press('C#4')),
      replace(press('F4')),
      replace(press('E4')),
      replace(press('A#3')),
    ]);
    expect(seq.usedKeys.map(midiToLabel)).toEqual(['A0', 'A#3', 'B3', 'C4', 'C#4', 'E4', 'F4', 'C8']);
    expect(p.warnings.map((w) => w.code)).not.toContain('out-of-piano-range');
  });

  it('f14: the ossia part is left out, so nothing is doubled', () => {
    const p = prepare('f14-ossia-parts.musicxml');
    expect(p.handMapping.excludedParts).toEqual(['P2']);
    expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(new Set(p.notes.map((n) => n.partId))).toEqual(new Set(['P1']));
    const seen = new Set<string>();
    for (const x of p.presses) {
      const key = `${x.midi}@${x.startTick}`;
      expect(seen.has(key), `duplicate ${midiToLabel(x.midi)} at ${x.startTick}`).toBe(false);
      seen.add(key);
    }
    const seq = derive(p, 'both');
    expect(attackLabels(seq, 'R')).toEqual([['C5'], ['B4'], ['A4'], ['G4'], ['F4']]);
    expect(attackLabels(seq, 'L')).toEqual([['C3'], ['F2']]);
    expect(p.warnings.find((w) => w.code === 'alternative-part-excluded')?.severity).toBe('review');
  });

  it('f-repeats-endings: plays 1 2 3 1 2 4', () => {
    const p = prepare('f-repeats-endings.musicxml');
    expect(p.measures.map((o) => o.label)).toEqual(['1', '2', '3', '1 (2nd time)', '2 (2nd time)', '4']);
    expect(p.measures.map((o) => o.startTick)).toEqual([0, 192, 384, 576, 768, 960]);
    const seq = derive(p, 'both');
    expect(attackLabels(seq, 'R')).toEqual([['C4'], ['D4'], ['E4'], ['C4'], ['D4'], ['F4']]);
    expect(seq.steps.filter((s) => s.attacks.R!.length > 0).map((s) => p.measures[s.occ].label)).toEqual([
      '1',
      '2',
      '3',
      '1 (2nd time)',
      '2 (2nd time)',
      '4',
    ]);
    // The LH C3 is struck again in every measure: never a hold.
    expect(cells(seq, 'L').slice(0, 6)).toStrictEqual(Array(6).fill(replace(press('C3'))));
  });

  it('f-dc-al-fine: plays 1 2 3 4 1 2 and stops at Fine', () => {
    const p = prepare('f-dc-al-fine.musicxml');
    expect(p.measures.map((o) => o.label)).toEqual(['1', '2', '3', '4', '1 (2nd time)', '2 (2nd time)']);
    expect(p.endTick).toBe(6 * 192);
    const seq = derive(p, 'R');
    expect(attackLabels(seq, 'R')).toEqual([['C4'], ['D4'], ['E4'], ['F4'], ['C4'], ['D4']]);
  });

  it('f-grace: grace steps come just before their principal note', () => {
    const p = prepare('f-grace.musicxml');
    const seq = derive(p, 'R');
    expect(ticks(seq)).toEqual([0, 6, 48, 54, 60, 96, 192, 378, 384]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('D5')), // grace
      replace(press('C5')), // principal, 6 ticks later
      replace(press('E5')), // grace
      replace(press('F5')), // grace
      replace(press('G5')), // principal
      replace(press('C5')),
      replace(press('E4')),
      replace(press('D4')), // a grace with no principal takes the end of E4
      REST,
    ]);
    expect(p.warnings.find((w) => w.code === 'grace-notes-approximated')?.severity).toBe('info');
  });

  it('f-two-parts-hands: the upper part is the right hand and the lower part the left hand', () => {
    const p = prepare('f-two-parts-hands.musicxml');
    expect(p.handMapping.source).toBe('two-single-staff-parts');
    expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P2:1': 'L' });
    const seq = derive(p, 'both');
    expect(attackLabels(seq, 'R')).toEqual([['E4'], ['G4'], ['E4'], ['G4'], ['C5']]);
    expect(attackLabels(seq, 'L')).toEqual([['C3'], ['G2']]);
    expect(p.readiness).toBe('ready');
  });

  it('f-single-staff: one staff goes to the right hand and the piece needs review', () => {
    const p = prepare('f-single-staff.musicxml');
    expect(p.readiness).toBe('review');
    expect(p.warnings.map((w) => [w.code, w.severity])).toContainEqual(['single-staff-part', 'review']);
    expect(p.readinessReasons).toEqual([
      'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
    ]);
    expect(derive(p, 'L').steps).toEqual([]);
    expect(attackLabels(derive(p, 'R'), 'R')).toEqual([['C4'], ['D4'], ['E4'], ['F4'], ['G4']]);
  });

  it('f-backup-forward: two voices on one staff become one stack when nothing continues', () => {
    const seq = derive(prepare('f-backup-forward.musicxml'), 'both');
    expect(ticks(seq)).toEqual([0, 48, 96, 192, 288]);
    expect(cells(seq, 'R')).toStrictEqual([
      replace(press('E5')),
      replace(press('F5'), press('C5')),
      replace(press('G5')),
      replace(press('D5')),
      REST,
    ]);
    expect(cells(seq, 'L')).toStrictEqual([replace(press('C3')), HOLD, HOLD, REST, HOLD]);
    expect(seq.endTick).toBe(384);
  });

  it('f-tempo-changes: Listen times follow every tempo change', () => {
    const p = prepare('f-tempo-changes.musicxml');
    const seq = derive(p, 'R');
    expect(ticks(seq)).toEqual([0, 192, 288, 384, 576, 624, 672, 720, 768]);
    const expected = [0, 2, 3, 3 + 4 / 3, 7 + 4 / 3, 8 + 4 / 3, 8.6 + 4 / 3, 9.2 + 4 / 3, 9.2 + 4 / 3 + 60 / 132];
    listenStepTimes(seq, p.tempo, 1).forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9));
    listenStepTimes(seq, p.tempo, 2).forEach((t, i) => expect(t).toBeCloseTo(expected[i] / 2, 9));
  });

  it('f-timewise: a timewise file plays exactly like its partwise equivalent', () => {
    const p = prepare('f-timewise.musicxml');
    expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P2:1': 'L' });
    const seq = derive(p, 'both');
    expect(ticks(seq)).toEqual([0, 96, 192, 384]);
    expect(seq.steps.map((s) => s.cells)).toStrictEqual([
      { R: replace(press('C4')), L: replace(press('C3')) },
      { R: replace(press('E4')), L: HOLD },
      { R: replace(press('G4')), L: replace(press('G2')) },
      { R: REST, L: REST },
    ]);
  });
});

describe('§17 fixture 15: broken input is rejected with a readable error', () => {
  function importError(data: Uint8Array, name: string): ImportError {
    try {
      loadSourceScore(data, name);
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      return e as ImportError;
    }
    throw new Error(`${name} was accepted`);
  }

  it('malformed XML', () => {
    const e = importError(bytes('f15-malformed.musicxml'), 'f15-malformed.musicxml');
    expect(e.code).toBe('malformed-xml');
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.message).not.toMatch(/xml|parser|dom/i);
  });

  it('entity declarations', () => {
    const e = importError(bytes('f-entity.musicxml'), 'f-entity.musicxml');
    expect(e.code).toBe('unsafe-content');
  });

  const container =
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
    '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>' +
    '</rootfiles></container>';

  function mxl(scoreText: string): Uint8Array {
    return zipSync(
      {
        mimetype: strToU8('application/vnd.recordare.musicxml'),
        'META-INF/container.xml': strToU8(container),
        'score.musicxml': strToU8(scoreText),
      },
      { level: 6 },
    );
  }

  it('a sound .mxl plays exactly like the plain file it contains', () => {
    const text = readFileSync(join(FIXTURES, 'f04-moving-line.musicxml'), 'utf8');
    const fromZip = prepareScore(loadSourceScore(mxl(text), 'f04.mxl'));
    const plain = prepare('f04-moving-line.musicxml');
    expect(derive(fromZip, 'both').steps).toStrictEqual(derive(plain, 'both').steps);
  });

  it('a truncated .mxl is a broken archive', () => {
    const whole = mxl(readFileSync(join(FIXTURES, 'f04-moving-line.musicxml'), 'utf8'));
    const e = importError(whole.slice(0, Math.floor(whole.length * 0.6)), 'broken.mxl');
    expect(e.code).toBe('bad-archive');
    expect(e.message).not.toMatch(/zip|fflate|inflate/i);
  });

  it('an .mxl whose compressed score is damaged is a broken archive', () => {
    const whole = mxl(readFileSync(join(FIXTURES, 'f07-tie-across-barline.musicxml'), 'utf8'));
    const damaged = whole.slice();
    // Overwrite the middle of the deflated score (the last and largest entry).
    for (let i = Math.floor(whole.length * 0.45); i < Math.floor(whole.length * 0.55); i++) damaged[i] ^= 0xa5;
    expect(importError(damaged, 'damaged.mxl').code).toBe('bad-archive');
  });
});
