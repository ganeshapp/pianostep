/**
 * An ossia (alternative passage) written as an extra staff inside the piano
 * part (brief §10: the user's four-staff "Ossia" screenshot; §17 fixture 14).
 * The ossia must never be played, and never in place of the real right hand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { detectHandMapping } from '../src/core/model/hands';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { midiToLabel } from '../src/core/pitch';
import type { Hand, PreparedScore, SourcePart, SourceScore, StaffDetails } from '../src/core/types';
import { ScoreBuilder } from './helpers/sourceBuilder';
import { withCpuMs } from './helpers/cpuTime';

const FIXTURES = join(__dirname, 'fixtures');

function prepare(name: string): PreparedScore {
  return prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(FIXTURES, name))), name));
}

function attackLabels(p: PreparedScore, h: Hand): string[][] {
  const seq = deriveSteps(p, ['R', 'L'], null);
  return seq.steps.filter((s) => (s.attacks[h] ?? []).length > 0).map((s) => s.attacks[h]!.map(midiToLabel));
}

function expectNothingDoubled(p: PreparedScore): void {
  const seen = new Set<string>();
  for (const x of p.presses) {
    const key = `${x.midi}@${x.startTick}`;
    expect(seen.has(key), `duplicate ${midiToLabel(x.midi)} at ${x.startTick}`).toBe(false);
    seen.add(key);
  }
}

describe('fixtures: an ossia staff inside the piano part', () => {
  it('f14b (3 staves, small ossia staff on top): the real right hand is played and the ossia is left out', () => {
    const p = prepare('f14b-ossia-staff.musicxml');
    expect(p.source.parts[0].staffDetails?.[1]).toEqual({ size: 70, words: ['Ossia:'] });
    expect(p.handMapping.staffHands).toEqual({ 'P1:2': 'R', 'P1:3': 'L' });
    expect(attackLabels(p, 'R')).toEqual([['C5'], ['B4'], ['A4'], ['G4'], ['F4']]);
    expect(attackLabels(p, 'L')).toEqual([['C3'], ['F2']]);
    expect(p.notes.every((n) => n.staff !== 1)).toBe(true);
    expectNothingDoubled(p);
    const w = p.warnings.find((x) => x.code === 'alternative-part-excluded');
    expect(w?.severity).toBe('review');
    expect(w?.message).toBe(
      'The top staff of the piano music looks like an alternative version of some of the music, such as an ossia (it is marked as an alternative), so it is left out and never played together with the main music.',
    );
    expect(p.warnings.map((x) => x.code)).not.toContain('unclear-hand-mapping');
    expect(p.readiness).toBe('review');
  });

  it('f14c (4 staves, an ossia for both hands above the music): only the real two staves are played', () => {
    const p = prepare('f14c-ossia-four-staves.musicxml');
    expect(p.handMapping.staffHands).toEqual({ 'P1:3': 'R', 'P1:4': 'L' });
    expect(attackLabels(p, 'R')).toEqual([['C5'], ['B4'], ['A4'], ['G4'], ['F4']]);
    expect(attackLabels(p, 'L')).toEqual([['C3'], ['F2']]);
    expect(p.presses.map((x) => midiToLabel(x.midi))).not.toContain('D3');
    expectNothingDoubled(p);
    expect(p.handMapping.description).toBe(
      'The third staff from the top of “Piano” is played by the right hand and the bottom staff by the left hand; the top staff and the second staff from the top are left out.',
    );
    expect(p.warnings.find((x) => x.code === 'alternative-part-excluded')?.severity).toBe('review');
  });
});

describe('detectHandMapping: which staff of a 3-staff part is an ossia', () => {
  /** Staff 1: 3 notes in measure 2 only; staff 2: the right hand, 8 notes; staff 3: the left hand, 4 notes. */
  function threeStaves(part: Partial<SourcePart> = {}): SourceScore {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(2);
    for (let k = 0; k < 3; k++) b.note({ staff: 1, voice: '1', measure: 1, beat: k, dur: 1, midi: 81 });
    for (let k = 0; k < 8; k++) b.note({ staff: 2, voice: '2', measure: k >> 2, beat: k % 4, dur: 1, midi: 72 });
    for (let k = 0; k < 4; k++) b.note({ staff: 3, voice: '5', measure: k >> 1, beat: (k % 2) * 2, dur: 2, midi: 48 });
    const s = b.build();
    s.parts[0] = { ...s.parts[0], ...part };
    return s;
  }
  const details = (d: StaffDetails): Partial<SourcePart> => ({ staffDetails: { 1: d } });

  it.each([
    ['hidden in the printed music', { hiddenStaves: [1] }],
    ['marked with the staff type "ossia"', details({ type: 'ossia' })],
    ['carrying the words "ossia"', details({ words: ['ossia'] })],
    ['printed small', details({ size: 75 })],
  ])('a staff %s is left out and the next staff is the right hand', (_label, part) => {
    const { mapping, warnings } = detectHandMapping(threeStaves(part));
    expect(mapping.staffHands).toEqual({ 'P1:2': 'R', 'P1:3': 'L' });
    expect(warnings.map((w) => [w.code, w.severity])).toEqual([['alternative-part-excluded', 'review']]);
  });

  it('a nearly empty staff is left out', () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(40);
    b.note({ staff: 1, measure: 3, dur: 1, midi: 84 });
    for (let m = 0; m < 40; m++) {
      for (let k = 0; k < 4; k++) b.note({ staff: 2, voice: '2', measure: m, beat: k, dur: 1, midi: 72 });
      b.note({ staff: 3, voice: '5', measure: m, dur: 4, midi: 48 });
    }
    const { mapping, warnings } = detectHandMapping(b.build());
    expect(mapping.staffHands).toEqual({ 'P1:2': 'R', 'P1:3': 'L' });
    expect(warnings[0].message).toContain('it has very few notes');
  });

  it('a left hand with very few notes is still the left hand', () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(40);
    b.note({ staff: 3, measure: 39, dur: 4, midi: 36 });
    for (let m = 0; m < 40; m++) {
      for (let k = 0; k < 4; k++) b.note({ staff: 1, voice: '1', measure: m, beat: k, dur: 1, midi: 76 });
      b.note({ staff: 2, voice: '2', measure: m, dur: 4, midi: 67 });
    }
    expect(detectHandMapping(b.build()).mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
  });

  it('three staves of real music keep the documented rule: top staff right hand, bottom staff left hand', () => {
    const { mapping, warnings } = detectHandMapping(threeStaves());
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
    expect(mapping.source).toBe('unclear');
    expect(warnings.map((w) => w.message)).toEqual([
      'The piano music is written on 3 staves. The top staff is given to the right hand and the bottom staff to the left hand; the middle staff is left out.',
    ]);
  });

  it('the busiest staff is never treated as an ossia, whatever its markings say', () => {
    const s = threeStaves({ staffDetails: { 2: { words: ['ornament ad lib.'] } } });
    expect(detectHandMapping(s).mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
  });

  it('an empty extra staff is simply unused: the two staves with notes are the hands', () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(1);
    b.note({ staff: 1, voice: '1', measure: 0, dur: 4, midi: 72 }).note({ staff: 2, voice: '5', measure: 0, dur: 4, midi: 48 });
    const { mapping, warnings } = detectHandMapping(b.build());
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(warnings).toEqual([]);
  });
});

describe('detectHandMapping: "printed smaller" compares the staves with each other', () => {
  /**
   * Staff 1: the right hand, 8 notes; staff 2: a middle line with `middle`
   * notes (12 makes it the busiest staff); staff 3: the left hand, 4 notes.
   */
  function threeRealStaves(sizes: Record<number, number>, middle = 12): SourceScore {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 3 }).measures(2);
    for (let k = 0; k < 8; k++) b.note({ staff: 1, voice: '1', measure: k >> 2, beat: k % 4, dur: 1, midi: 79 });
    const half = middle / 2;
    for (let k = 0; k < middle; k++) b.note({ staff: 2, voice: '2', measure: k >= half ? 1 : 0, beat: (k % half) * 0.5, dur: 0.5, midi: 67 });
    for (let k = 0; k < 4; k++) b.note({ staff: 3, voice: '5', measure: k >> 1, beat: (k % 2) * 2, dur: 2, midi: 43 });
    const s = b.build();
    const staffDetails: Record<number, StaffDetails> = {};
    for (const [staff, size] of Object.entries(sizes)) staffDetails[Number(staff)] = { size };
    s.parts[0] = { ...s.parts[0], staffDetails };
    return s;
  }

  it.each([[75], [80]])('every staff scaled to %i%% alike: no staff is an ossia, so the left hand is kept', (size) => {
    const { mapping, warnings } = detectHandMapping(threeRealStaves({ 1: size, 2: size, 3: size }));
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
    expect(warnings.map((w) => w.code)).toEqual(['unclear-hand-mapping']);
    expect(warnings.map((w) => w.message).join(' ')).not.toContain('printed smaller');
  });

  it('a staff smaller than the others is still left out when every staff has a size (80/70/80)', () => {
    const { mapping, warnings } = detectHandMapping(threeRealStaves({ 1: 80, 2: 70, 3: 80 }, 6));
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:3': 'L' });
    const w = warnings.find((x) => x.code === 'alternative-part-excluded');
    expect(w?.message).toContain('The second staff from the top of the piano music looks like an alternative');
    expect(w?.message).toContain('it is printed smaller than the others');
  });
});

describe('a part that declares a huge number of staves', () => {
  it('is mapped by the staves that carry notes, without work sized by the declared count', () => {
    const b = new ScoreBuilder().part({ id: 'P1', name: 'Piano', staves: 100_000_000 }).measures(1);
    b.note({ staff: 1, voice: '1', measure: 0, dur: 4, midi: 72 }).note({ staff: 2, voice: '5', measure: 0, dur: 4, midi: 48 });
    // CPU time, so a busy machine cannot fail it.
    const { result, ms } = withCpuMs(() => detectHandMapping(b.build()));
    expect(ms).toBeLessThan(500);
    const { mapping } = result;
    expect(mapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
  });

  it('an absurd <staves> value in a file is ignored and the staves with notes are used', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <staves>100000000</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff></note>
      </measure></part></score-partwise>`;
    const { result: p, ms } = withCpuMs(() => prepareScore(loadSourceScore(new TextEncoder().encode(xml), 'staves.musicxml')));
    expect(ms).toBeLessThan(1000);
    expect(p.source.parts[0].staves).toBe(2);
    expect(p.handMapping.staffHands).toEqual({ 'P1:1': 'R', 'P1:2': 'L' });
    expect(p.presses.map((x) => [x.hand, midiToLabel(x.midi)])).toEqual([
      ['R', 'C5'],
      ['L', 'C3'],
    ]);
  });
});
