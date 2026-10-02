import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEndingNumbers, readJumpWords } from '../src/core/musicxml/notation';
import { prepareScore } from '../src/core/model/prepare';
import { graceSlotTicks } from '../src/core/musicxml/part';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { WarningSink } from '../src/core/musicxml/warnings';
import type { ScoreWarning, SourceMeasure, SourceNote, SourcePart, SourceScore, WarningSeverity } from '../src/core/types';
import { ImportError, type ImportErrorCode, parseXmlSafely, stripDoctype } from '../src/core/xml';
import * as samples from './helpers/musicxmlSamples';
import { cpuMs } from './helpers/cpuTime';

const FIXTURES = join(__dirname, 'fixtures');

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function fixture(name: string): SourceScore {
  return loadSourceScore(fixtureBytes(name), name);
}

/** One readable line per note: id, onset+duration, midi, staff/voice, then any flags. */
function noteLine(n: SourceNote): string {
  const flags = [
    n.tieStart && 'tieStart',
    n.tieStop && 'tieStop',
    n.grace && 'grace',
    n.chord && 'chord',
    n.tuplet && 'tuplet',
    n.crossStaff && 'crossStaff',
    !n.printed && 'hidden',
    n.velocity !== undefined && `velocity=${n.velocity}`,
  ].filter((f): f is string => typeof f === 'string');
  return [`${n.id} @${n.onsetTick}+${n.durationTicks} midi=${n.midi} s${n.staff}/v${n.voice}`, ...flags].join(' ');
}

function notes(score: SourceScore): string[] {
  return score.notes.map(noteLine);
}

const FOUR_FOUR = { beats: 4, beatType: 4 };

/** A complete SourceMeasure with no navigation marks, overridable per field. */
function measure(
  index: number,
  startTick: number,
  durationTicks: number,
  extra: Partial<SourceMeasure> = {},
): SourceMeasure {
  return {
    index,
    number: String(index + 1),
    startTick,
    durationTicks,
    implicit: false,
    repeatForward: false,
    repeatBackwardTimes: null,
    endings: [],
    segno: false,
    coda: false,
    fine: false,
    daCapo: false,
    dalSegno: false,
    toCoda: false,
    timeSignature: FOUR_FOUR,
    ...extra,
  };
}

/** `count` measures of `length` ticks laid end to end. */
function evenMeasures(count: number, length: number): SourceMeasure[] {
  return Array.from({ length: count }, (_, i) => measure(i, i * length, length));
}

function part(id: string, name: string, staves: number, clefs: Record<number, string>, pitched: number, words: string[] = []): SourcePart {
  return { id, name, staves, clefs, pitchedNoteCount: pitched, words, hiddenStaves: [] };
}

const PIANO_2_STAVES = (pitched: number, words: string[] = []) => part('P1', 'Piano', 2, { 1: 'G', 2: 'F' }, pitched, words);

interface WarningSummary {
  code: string;
  severity: WarningSeverity;
  count?: number;
  measures?: string[];
}

function warnings(score: SourceScore): WarningSummary[] {
  return score.warnings
    .map((w: ScoreWarning) => {
      const s: WarningSummary = { code: w.code, severity: w.severity };
      if (w.count !== undefined) s.count = w.count;
      if (w.measures !== undefined) s.measures = w.measures;
      return s;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

const NO_METADATA = {
  title: null,
  subtitle: null,
  composer: null,
  arranger: null,
  rights: null,
  software: null,
  credits: [],
};

function metadata(score: SourceScore) {
  const { title, subtitle, composer, arranger, rights, software, credits } = score;
  return { title, subtitle, composer, arranger, rights, software, credits };
}

function importErrorOf(fn: () => unknown): ImportError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImportError) return e;
    throw e;
  }
  throw new Error('expected an ImportError');
}

function expectImportError(fn: () => unknown, code: ImportErrorCode): ImportError {
  const err = importErrorOf(fn);
  expect(err.code).toBe(code);
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('ImportError');
  return err;
}

/** Plain-language check for anything shown to the learner. */
function expectPlainText(text: string): void {
  expect(text.trim().length).toBeGreaterThan(10);
  expect(text).not.toMatch(/[<>{}]|undefined|null|DOMParser|xmldom|jsdom|fflate|parsererror|Error:/);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------ */
/* Fixtures: exact values                                                    */
/* ------------------------------------------------------------------------ */

describe('fixture f01-melody-repeated', () => {
  const s = fixture('f01-melody-repeated.musicxml');

  it('reads metadata, part, measures and notes exactly', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(metadata(s)).toEqual({ ...NO_METADATA, title: 'Melody with repeated notes' });
    expect(s.parts).toEqual([PIANO_2_STAVES(7)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:0:1 @48+48 midi=60 s1/v1',
      'P1:0:2 @96+48 midi=62 s1/v1',
      'P1:0:3 @144+48 midi=64 s1/v1',
      'P1:1:0 @192+48 midi=64 s1/v1',
      'P1:1:1 @240+48 midi=62 s1/v1',
      'P1:1:2 @288+96 midi=60 s1/v1',
    ]);
    expect(s.tempos).toEqual([]);
    expect(s.pedalMarks).toBe(0);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f02-melody-and-chord', () => {
  const s = fixture('f02-melody-and-chord.musicxml');

  it('reads all metadata as normalised plain text', () => {
    expect(metadata(s)).toEqual({
      title: 'Melody and chord',
      subtitle: 'Second movement',
      composer: 'Test Composer',
      arranger: 'Fixture Arranger',
      rights: 'Public domain test fixture',
      software: 'Hand-written',
      credits: ['Melody and chord', 'Test Composer', '(born 1900)'],
    });
  });

  it('gives chord notes the onset of the note before them', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(8)]);
    expect(s.measures).toEqual(evenMeasures(1, 192));
    expect(notes(s)).toEqual([
      'P1:0:2 @0+96 midi=48 s2/v5',
      'P1:0:3 @0+96 midi=52 s2/v5 chord',
      'P1:0:4 @0+96 midi=55 s2/v5 chord',
      'P1:0:0 @0+96 midi=64 s1/v1',
      'P1:0:5 @96+96 midi=47 s2/v5',
      'P1:0:6 @96+96 midi=50 s2/v5 chord',
      'P1:0:7 @96+96 midi=55 s2/v5 chord',
      'P1:0:1 @96+96 midi=62 s1/v1',
    ]);
    expect(s.tempos).toEqual([]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f03-long-lh-hold', () => {
  it('converts divisions=3 to 48 ticks per quarter', () => {
    const s = fixture('f03-long-lh-hold.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(metadata(s)).toEqual(NO_METADATA);
    expect(s.parts).toEqual([PIANO_2_STAVES(5)]);
    expect(s.measures).toEqual(evenMeasures(1, 192));
    expect(notes(s)).toEqual([
      'P1:0:4 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+48 midi=64 s1/v1',
      'P1:0:1 @48+48 midi=65 s1/v1',
      'P1:0:2 @96+48 midi=67 s1/v1',
      'P1:0:3 @144+48 midi=69 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f04-moving-line', () => {
  it('keeps divisions=480 exact and reads the tempo', () => {
    const s = fixture('f04-moving-line.musicxml');
    expect(s.ticksPerQuarter).toBe(480);
    expect(s.parts).toEqual([PIANO_2_STAVES(4)]);
    expect(s.measures).toEqual(evenMeasures(1, 1920));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+1920 midi=60 s1/v1',
      'P1:0:2 @480+480 midi=64 s1/v2',
      'P1:0:3 @960+480 midi=67 s1/v2',
      'P1:0:4 @1440+480 midi=65 s1/v2',
    ]);
    expect(s.tempos).toEqual([{ tick: 0, measureIndex: 0, qpm: 60 }]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f05-repeat-while-held', () => {
  it('keeps each repeated attack as its own note', () => {
    const s = fixture('f05-repeat-while-held.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(4)]);
    expect(s.measures).toEqual(evenMeasures(1, 192));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+192 midi=67 s1/v1',
      'P1:0:1 @0+48 midi=72 s1/v2',
      'P1:0:2 @48+48 midi=72 s1/v2',
      'P1:0:3 @96+96 midi=72 s1/v2',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f06-release-between', () => {
  it('omits rests but lets them advance time', () => {
    const s = fixture('f06-release-between.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(4)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:3 @0+96 midi=48 s2/v5',
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:1:2 @192+144 midi=60 s1/v2',
      'P1:1:0 @192+96 midi=64 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f07-tie-across-barline', () => {
  it('reads <tie> and falls back to <notations><tied> only when <tie> is absent', () => {
    const s = fixture('f07-tie-across-barline.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(11)]);
    expect(s.measures).toEqual(evenMeasures(3, 192));
    expect(notes(s)).toEqual([
      'P1:0:2 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+96 midi=64 s1/v1',
      'P1:0:1 @96+96 midi=72 s1/v1 tieStart',
      'P1:1:4 @192+192 midi=43 s2/v5',
      'P1:1:0 @192+48 midi=72 s1/v1 tieStop',
      'P1:1:1 @240+48 midi=74 s1/v1',
      'P1:1:2 @288+96 midi=64 s1/v1 tieStart',
      'P1:1:3 @288+96 midi=67 s1/v1 tieStart chord',
      'P1:2:4 @384+96 midi=48 s2/v5',
      'P1:2:0 @384+48 midi=64 s1/v1 tieStop',
      'P1:2:1 @384+48 midi=67 s1/v1 tieStop chord',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f08-tuplets-two-rhythms', () => {
  it('uses lcm(60, 48) = 240 ticks so triplets and quintuplets are exact', () => {
    const s = fixture('f08-tuplets-two-rhythms.musicxml');
    expect(s.ticksPerQuarter).toBe(240);
    expect(s.parts).toEqual([PIANO_2_STAVES(21)]);
    expect(s.measures).toEqual(evenMeasures(1, 960));
    expect(notes(s)).toEqual([
      'P1:0:13 @0+120 midi=48 s2/v5',
      'P1:0:0 @0+80 midi=72 s1/v1 tuplet',
      'P1:0:1 @80+80 midi=74 s1/v1 tuplet',
      'P1:0:14 @120+120 midi=52 s2/v5',
      'P1:0:2 @160+80 midi=76 s1/v1 tuplet',
      'P1:0:15 @240+120 midi=55 s2/v5',
      'P1:0:3 @240+80 midi=77 s1/v1 tuplet',
      'P1:0:4 @320+80 midi=76 s1/v1 tuplet',
      'P1:0:16 @360+120 midi=52 s2/v5',
      'P1:0:5 @400+80 midi=74 s1/v1 tuplet',
      'P1:0:17 @480+120 midi=48 s2/v5',
      'P1:0:6 @480+48 midi=72 s1/v1 tuplet',
      'P1:0:7 @528+48 midi=74 s1/v1 tuplet',
      'P1:0:8 @576+48 midi=76 s1/v1 tuplet',
      'P1:0:18 @600+120 midi=52 s2/v5',
      'P1:0:9 @624+48 midi=77 s1/v1 tuplet',
      'P1:0:10 @672+48 midi=79 s1/v1 tuplet',
      'P1:0:19 @720+120 midi=55 s2/v5',
      'P1:0:11 @720+180 midi=81 s1/v1',
      'P1:0:20 @840+120 midi=52 s2/v5',
      'P1:0:12 @900+60 midi=79 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f09-rest-entry-final', () => {
  it('starts notes after leading rests and keeps the final note length', () => {
    const s = fixture('f09-rest-entry-final.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(7)]);
    expect(s.measures).toEqual(evenMeasures(3, 192));
    expect(notes(s)).toEqual([
      'P1:0:2 @96+96 midi=48 s2/v5',
      'P1:1:4 @192+192 midi=43 s2/v5',
      'P1:1:1 @240+48 midi=64 s1/v1',
      'P1:1:2 @288+48 midi=62 s1/v1',
      'P1:1:3 @336+48 midi=60 s1/v1',
      'P1:2:2 @384+144 midi=48 s2/v5',
      'P1:2:0 @384+144 midi=60 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f10-held-into-passage', () => {
  it('handles a divisions change between measures (1 -> 5, 240 ticks per quarter)', () => {
    const s = fixture('f10-held-into-passage.musicxml');
    expect(s.ticksPerQuarter).toBe(240);
    expect(s.parts).toEqual([PIANO_2_STAVES(12)]);
    expect(s.measures).toEqual(evenMeasures(3, 960));
    expect(notes(s)).toEqual([
      'P1:0:4 @0+960 midi=36 s2/v5 tieStart',
      'P1:0:0 @0+240 midi=64 s1/v1',
      'P1:0:1 @240+240 midi=67 s1/v1',
      'P1:0:2 @480+240 midi=64 s1/v1',
      'P1:0:3 @720+240 midi=67 s1/v1',
      'P1:1:4 @960+960 midi=36 s2/v5 tieStart tieStop',
      'P1:1:0 @960+240 midi=65 s1/v1',
      'P1:1:1 @1200+240 midi=69 s1/v1',
      'P1:1:2 @1440+240 midi=65 s1/v1',
      'P1:1:3 @1680+240 midi=69 s1/v1',
      'P1:2:2 @1920+480 midi=36 s2/v5 tieStop',
      'P1:2:0 @1920+480 midi=64 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f12-enharmonics', () => {
  const s = fixture('f12-enharmonics.musicxml');

  it('resolves spellings by pitch arithmetic', () => {
    const byId = new Map(s.notes.map((n) => [n.id, n]));
    const cases: [string, string, number, number, number][] = [
      ['P1:0:0', 'B', 1, 3, 60], // B#3 = C4
      ['P1:0:1', 'C', -1, 4, 59], // Cb4 = B3
      ['P1:0:2', 'D', -1, 4, 61], // Db4 = C#4
      ['P1:0:3', 'E', 1, 4, 65], // E#4 = F4
      ['P1:1:0', 'F', -1, 4, 64], // Fb4 = E4
      ['P1:1:1', 'B', -1, 3, 58], // Bb3 = A#3
      ['P1:1:2', 'B', 0, 3, 59],
      ['P1:1:3', 'C', 0, 4, 60],
      ['P1:2:0', 'C', 0, 8, 108], // top key
      ['P1:2:1', 'A', 0, 0, 21], // bottom key
    ];
    for (const [id, step, alter, octave, midi] of cases) {
      const n = byId.get(id);
      expect(n?.spelled, id).toEqual({ step, alter, octave });
      expect(n?.midi, id).toBe(midi);
    }
  });

  it('places every note exactly and does not warn about A0 or C8', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(10)]);
    expect(s.measures).toEqual(evenMeasures(3, 192));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:0:1 @48+48 midi=59 s1/v1',
      'P1:0:2 @96+48 midi=61 s1/v1',
      'P1:0:3 @144+48 midi=65 s1/v1',
      'P1:1:0 @192+48 midi=64 s1/v1',
      'P1:1:1 @240+48 midi=58 s1/v1',
      'P1:1:2 @288+48 midi=59 s1/v1',
      'P1:1:3 @336+48 midi=60 s1/v1',
      'P1:2:1 @384+192 midi=21 s2/v5',
      'P1:2:0 @384+192 midi=108 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f14-ossia-parts', () => {
  it('keeps both parts, index-aligned, with lcm(2, 3, 48) ticks', () => {
    const s = fixture('f14-ossia-parts.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(7), part('P2', 'Piano', 1, { 1: 'G' }, 3, ['Ossia:'])]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:2 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+96 midi=72 s1/v1',
      'P1:0:1 @96+96 midi=71 s1/v1',
      'P1:1:3 @192+192 midi=41 s2/v5',
      'P1:1:0 @192+48 midi=69 s1/v1',
      'P2:1:0 @192+48 midi=69 s1/v1',
      'P1:1:1 @240+48 midi=67 s1/v1',
      'P2:1:1 @240+48 midi=71 s1/v1',
      'P1:1:2 @288+96 midi=65 s1/v1',
      'P2:1:2 @288+96 midi=72 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f15-malformed', () => {
  it('raises malformed-xml with a plain message and the parser detail kept separately', () => {
    const err = expectImportError(() => fixture('f15-malformed.musicxml'), 'malformed-xml');
    expectPlainText(err.message);
    expect(err.detail).toBeTruthy();
  });
});

describe('fixture f-entity', () => {
  it('raises unsafe-content before any XML parsing happens', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const err = expectImportError(() => fixture('f-entity.musicxml'), 'unsafe-content');
    expectPlainText(err.message);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('fixture f-backup-forward', () => {
  it('moves the cursor with <backup> and <forward>; a forward alone sets the measure length', () => {
    const s = fixture('f-backup-forward.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(6)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:4 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+48 midi=76 s1/v1',
      'P1:0:3 @48+48 midi=72 s1/v2',
      'P1:0:1 @48+48 midi=77 s1/v1',
      'P1:0:2 @96+96 midi=79 s1/v1',
      'P1:1:0 @192+96 midi=74 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f-dc-al-fine', () => {
  it('marks Fine and D.C. from <sound>, without reading "al Fine" as Fine', () => {
    const s = fixture('f-dc-al-fine.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(8, ['Fine', 'D.C. al Fine'])]);
    expect(s.measures).toEqual([
      measure(0, 0, 192),
      measure(1, 192, 192, { fine: true }),
      measure(2, 384, 192),
      measure(3, 576, 192, { daCapo: true }),
    ]);
    expect(notes(s)).toEqual([
      'P1:0:1 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+192 midi=60 s1/v1',
      'P1:1:1 @192+192 midi=48 s2/v5',
      'P1:1:0 @192+192 midi=62 s1/v1',
      'P1:2:1 @384+192 midi=48 s2/v5',
      'P1:2:0 @384+192 midi=64 s1/v1',
      'P1:3:1 @576+192 midi=48 s2/v5',
      'P1:3:0 @576+192 midi=65 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f-grace', () => {
  const s = fixture('f-grace.musicxml');

  it('lets graces steal min(floor(D / (k + 1)), ticksPerQuarter / 8) ticks each from the start of the principal', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(10)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:6 @0+192 midi=48 s2/v5',
      // one grace before a quarter: g = min(24, 6) = 6
      'P1:0:0 @0+6 midi=74 s1/v1 grace',
      'P1:0:1 @6+42 midi=72 s1/v1',
      // two graces before a quarter: g = min(16, 6) = 6
      'P1:0:2 @48+6 midi=76 s1/v1 grace',
      'P1:0:3 @54+6 midi=77 s1/v1 grace',
      'P1:0:4 @60+36 midi=79 s1/v1',
      'P1:0:5 @96+96 midi=72 s1/v1',
      'P1:1:2 @192+192 midi=48 s2/v5',
      // a grace with no principal after it borrows from the end of the previous note
      'P1:1:0 @192+186 midi=64 s1/v1',
      'P1:1:1 @378+6 midi=62 s1/v1 grace',
    ]);
  });

  it('reports the approximation once, with its count and measures', () => {
    expect(warnings(s)).toEqual([{ code: 'grace-notes-approximated', severity: 'info', count: 4, measures: ['1', '2'] }]);
    expectPlainText(s.warnings[0].message);
  });
});

describe('fixture f-repeats-endings', () => {
  it('reads forward/backward repeats and first/second endings', () => {
    const s = fixture('f-repeats-endings.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(8)]);
    expect(s.measures).toEqual([
      measure(0, 0, 192, { repeatForward: true }),
      measure(1, 192, 192),
      measure(2, 384, 192, {
        repeatBackwardTimes: 2,
        endings: [
          { numbers: [1], type: 'start' },
          { numbers: [1], type: 'stop' },
        ],
      }),
      measure(3, 576, 192, {
        endings: [
          { numbers: [2], type: 'start' },
          { numbers: [2], type: 'discontinue' },
        ],
      }),
    ]);
    expect(notes(s)).toEqual([
      'P1:0:1 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+192 midi=60 s1/v1',
      'P1:1:1 @192+192 midi=48 s2/v5',
      'P1:1:0 @192+192 midi=62 s1/v1',
      'P1:2:1 @384+192 midi=48 s2/v5',
      'P1:2:0 @384+192 midi=64 s1/v1',
      'P1:3:1 @576+192 midi=48 s2/v5',
      'P1:3:0 @576+192 midi=65 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f-single-staff', () => {
  it('defaults staff to 1 and takes the title from <movement-title>', () => {
    const s = fixture('f-single-staff.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(metadata(s)).toEqual({ ...NO_METADATA, title: 'Single staff tune' });
    expect(s.parts).toEqual([part('P1', 'Melody', 1, { 1: 'G' }, 5)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:0:1 @48+48 midi=62 s1/v1',
      'P1:0:2 @96+48 midi=64 s1/v1',
      'P1:0:3 @144+48 midi=65 s1/v1',
      'P1:1:0 @192+192 midi=67 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f-tempo-changes', () => {
  const s = fixture('f-tempo-changes.musicxml');

  it('reads tempos at their position, converts a metronome-only dotted quarter and ignores 0 and >1000', () => {
    expect(s.tempos).toEqual([
      { tick: 0, measureIndex: 0, qpm: 120 }, // <sound tempo> wins over the metronome beside it
      { tick: 288, measureIndex: 1, qpm: 90 }, // beat 3 of m2
      { tick: 384, measureIndex: 2, qpm: 60 }, // dotted quarter = 40 -> 60 quarters per minute
      { tick: 624, measureIndex: 3, qpm: 100 }, // <offset> of one quarter
      { tick: 720, measureIndex: 3, qpm: 132 }, // beat 4; tempo="0" and tempo="2000" ignored
    ]);
  });

  it('reads notes, measures and words exactly', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([part('P1', 'Piano', 1, { 1: 'G' }, 8, ['Allegro', 'Meno mosso', 'a tempo'])]);
    expect(s.measures).toEqual(evenMeasures(4, 192));
    expect(notes(s)).toEqual([
      'P1:0:0 @0+192 midi=60 s1/v1',
      'P1:1:0 @192+96 midi=62 s1/v1',
      'P1:1:1 @288+96 midi=62 s1/v1',
      'P1:2:0 @384+192 midi=64 s1/v1',
      'P1:3:0 @576+48 midi=65 s1/v1',
      'P1:3:1 @624+48 midi=65 s1/v1',
      'P1:3:2 @672+48 midi=65 s1/v1',
      'P1:3:3 @720+48 midi=65 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('fixture f-timewise', () => {
  const s = fixture('f-timewise.musicxml');

  it('converts timewise to partwise with an info warning', () => {
    expect(warnings(s)).toEqual([{ code: 'timewise-converted', severity: 'info', count: 1 }]);
    expectPlainText(s.warnings[0].message);
  });

  it('produces exactly what the equivalent partwise document produces', () => {
    const partwise = parseMusicXml(samples.TIMEWISE_AS_PARTWISE);
    expect(partwise.warnings).toEqual([]);
    expect({ ...s, warnings: [] }).toStrictEqual(partwise);
  });

  it('reads both parts exactly', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([part('P1', 'Right Hand', 1, { 1: 'G' }, 3), part('P2', 'Left Hand', 1, { 1: 'F' }, 2)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P2:0:0 @0+192 midi=48 s1/v1',
      'P1:0:0 @0+96 midi=60 s1/v1',
      'P1:0:1 @96+96 midi=64 s1/v1',
      'P2:1:0 @192+192 midi=43 s1/v1',
      'P1:1:0 @192+192 midi=67 s1/v1',
    ]);
  });
});

describe('fixture f-two-parts-hands', () => {
  it('reads two single-staff parts into the same measure columns', () => {
    const s = fixture('f-two-parts-hands.musicxml');
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([part('P1', 'Right Hand', 1, { 1: 'G' }, 5), part('P2', 'Left Hand', 1, { 1: 'F' }, 2)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P2:0:0 @0+192 midi=48 s1/v1',
      'P1:0:0 @0+48 midi=64 s1/v1',
      'P1:0:1 @48+48 midi=67 s1/v1',
      'P1:0:2 @96+48 midi=64 s1/v1',
      'P1:0:3 @144+48 midi=67 s1/v1',
      'P2:1:0 @192+192 midi=43 s1/v1',
      'P1:1:0 @192+192 midi=72 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('every fixture file', () => {
  const ERROR_FIXTURES: Record<string, ImportErrorCode> = {
    'f15-malformed.musicxml': 'malformed-xml',
    'f-entity.musicxml': 'unsafe-content',
  };
  const files = readdirSync(FIXTURES).filter((f) => /\.(musicxml|xml|mxl)$/i.test(f));

  it('includes the fixtures checked above', () => {
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it.each(files)('%s parses to exact integer ticks in sorted order, or fails with its documented code', (file) => {
    const code = ERROR_FIXTURES[file];
    if (code) {
      expectImportError(() => fixture(file), code);
      return;
    }
    const s = fixture(file);
    expect(Number.isInteger(s.ticksPerQuarter) && s.ticksPerQuarter % 48 === 0).toBe(true);
    let previous = -Infinity;
    for (const n of s.notes) {
      expect(Number.isInteger(n.onsetTick) && Number.isInteger(n.durationTicks) && n.durationTicks > 0, n.id).toBe(true);
      expect(n.onsetTick >= previous, n.id).toBe(true);
      previous = n.onsetTick;
    }
    s.measures.forEach((m, i) => {
      expect(m.index).toBe(i);
      expect(m.startTick).toBe(i === 0 ? 0 : s.measures[i - 1].startTick + s.measures[i - 1].durationTicks);
    });
  });
});

/* ------------------------------------------------------------------------ */
/* Inline samples for cases the file fixtures do not cover                   */
/* ------------------------------------------------------------------------ */

describe('cue notes, transpose and dynamics', () => {
  const s = parseMusicXml(samples.CUE_TRANSPOSE);

  it('skips cue notes but lets them take their written time, and applies <transpose> per staff', () => {
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.parts).toEqual([PIANO_2_STAVES(6)]);
    expect(s.measures).toEqual(evenMeasures(2, 192));
    expect(notes(s)).toEqual([
      'P1:0:3 @0+192 midi=48 s2/v5', // staff-specific transpose of 0
      'P1:0:0 @0+48 midi=60 s1/v1', // D5 (74) - 2 - 12
      'P1:0:2 @96+96 midi=63 s1/v1', // F5 (77) - 14, after the silent cue quarter
      'P1:1:4 @192+192 midi=48 s2/v5 velocity=45',
      'P1:1:0 @192+48 midi=60 s1/v1 velocity=45', // <sound dynamics="50">: 50% of 90
      'P1:1:1 @240+48 midi=60 s1/v1 velocity=90', // note dynamics="100"
    ]);
    // Spelling stays as written; only the midi number is transposed.
    expect(s.notes.find((n) => n.id === 'P1:0:0')?.spelled).toEqual({ step: 'D', alter: 0, octave: 5 });
  });

  it('warns once about the skipped cue notes', () => {
    expect(warnings(s)).toEqual([{ code: 'cue-notes-skipped', severity: 'info', count: 3, measures: ['1', '2'] }]);
  });
});

describe('navigation marks', () => {
  const s = parseMusicXml(samples.NAVIGATION);

  it('reads segno, coda, To Coda, D.S., D.C., Fine, repeats and endings from signs, <sound> and words', () => {
    expect(s.measures).toEqual([
      measure(0, 0, 192, { repeatForward: true, segno: true }),
      measure(1, 192, 192, { toCoda: true }), // the coda sign belongs to the "To Coda" jump
      measure(2, 384, 192, {
        repeatBackwardTimes: 3,
        endings: [
          { numbers: [1, 2], type: 'start' },
          { numbers: [1, 2], type: 'stop' },
        ],
      }),
      measure(3, 576, 192, {
        dalSegno: true, // the segno sign beside "D.S." is not a new segno
        endings: [
          { numbers: [3], type: 'start' },
          { numbers: [3], type: 'discontinue' },
        ],
      }),
      measure(4, 768, 192, { coda: true, toCoda: true }),
      measure(5, 960, 192, { fine: true, daCapo: true }),
    ]);
    expect(s.parts[0].words).toEqual(['To Coda', 'D.S. al Coda', 'Fine', 'D.C.']);
    expect(s.warnings).toEqual([]);
  });

  it('parses ending numbers and jump words', () => {
    expect(parseEndingNumbers('1')).toEqual([1]);
    expect(parseEndingNumbers('1, 2')).toEqual([1, 2]);
    expect(parseEndingNumbers('1.')).toEqual([1]);
    expect(parseEndingNumbers('1-3')).toEqual([1, 2, 3]);
    expect(parseEndingNumbers('1 – 3')).toEqual([1, 2, 3]);
    expect(parseEndingNumbers('2. 1.')).toEqual([1, 2]);
    expect(parseEndingNumbers('')).toEqual([]);
    expect(parseEndingNumbers('last')).toEqual([]);
    expect(parseEndingNumbers(null)).toEqual([]);
    expect(readJumpWords('D.C. al Fine')).toEqual({ daCapo: true, dalSegno: false, fine: false, toCoda: false });
    expect(readJumpWords('Da Capo')).toEqual({ daCapo: true, dalSegno: false, fine: false, toCoda: false });
    expect(readJumpWords('d.s. al coda')).toEqual({ daCapo: false, dalSegno: true, fine: false, toCoda: false });
    expect(readJumpWords('FINE')).toEqual({ daCapo: false, dalSegno: false, fine: true, toCoda: false });
    expect(readJumpWords('to Coda')).toEqual({ daCapo: false, dalSegno: false, fine: false, toCoda: true });
    expect(readJumpWords('dolce')).toEqual({ daCapo: false, dalSegno: false, fine: false, toCoda: false });
  });
});

describe('pickup, short and empty measures, cross-staff notes', () => {
  const s = parseMusicXml(samples.PICKUP_CROSS_STAFF);
  const THREE_FOUR = { beats: 3, beatType: 4 };

  it('uses content length, falling back to the time signature for an empty measure', () => {
    expect(s.measures).toEqual([
      measure(0, 0, 48, { number: '0', implicit: true, timeSignature: THREE_FOUR }),
      measure(1, 48, 144, { number: '1', timeSignature: THREE_FOUR }),
      measure(2, 192, 96, { number: '2', timeSignature: THREE_FOUR }),
      measure(3, 288, 144, { number: '3', timeSignature: THREE_FOUR }),
    ]);
  });

  it("flags a note drawn on the other staff from its voice's home staff", () => {
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=67 s1/v1',
      'P1:1:2 @48+48 midi=48 s2/v5',
      'P1:1:0 @48+96 midi=72 s1/v1',
      'P1:1:3 @96+48 midi=67 s1/v5 crossStaff',
      'P1:1:4 @144+48 midi=48 s2/v5',
      'P1:1:1 @144+48 midi=74 s1/v1',
      'P1:2:0 @192+48 midi=76 s1/v1',
      'P1:2:1 @240+48 midi=76 s1/v1',
    ]);
  });

  it('warns about the short non-pickup measure and the cross-staff note, by measure number', () => {
    expect(warnings(s)).toEqual([
      { code: 'cross-staff-notes', severity: 'review', count: 1, measures: ['1'] },
      { code: 'measure-length-mismatch', severity: 'info', count: 1, measures: ['2'] },
    ]);
    for (const w of s.warnings) expectPlainText(w.message);
  });
});

describe('grace-note edge cases', () => {
  const s = parseMusicXml(samples.GRACE_EDGES);

  it('treats a grace chord as one slot, caps g at floor(D / (k + 1)) and borrows from the previous note before a rest', () => {
    expect(notes(s)).toEqual([
      'P1:0:0 @0+6 midi=76 s1/v1 grace',
      'P1:0:1 @0+6 midi=79 s1/v1 grace chord',
      'P1:0:2 @6+6 midi=74 s1/v1 grace',
      'P1:0:4 @12+36 midi=64 s1/v1 chord',
      'P1:0:3 @12+36 midi=72 s1/v1',
      'P1:0:5 @48+2 midi=71 s1/v1 grace',
      'P1:0:6 @50+2 midi=69 s1/v1 grace',
      'P1:0:7 @52+2 midi=74 s1/v1',
      'P1:0:8 @54+36 midi=77 s1/v1',
      'P1:0:9 @90+6 midi=79 s1/v1 grace',
      'P1:0:11 @144+48 midi=72 s1/v1',
    ]);
    expect(s.measures).toEqual(evenMeasures(1, 192));
  });

  it('drops graces with no note before or after them in their voice, but counts them', () => {
    expect(s.notes.some((n) => n.voice === '2')).toBe(false);
    expect(warnings(s)).toEqual([{ code: 'grace-notes-approximated', severity: 'info', count: 7, measures: ['1'] }]);
  });

  it('computes the slot length as specified', () => {
    expect(graceSlotTicks(48, 1, 48)).toBe(6);
    expect(graceSlotTicks(6, 2, 48)).toBe(2);
    expect(graceSlotTicks(2, 3, 48)).toBe(1);
    expect(graceSlotTicks(1920, 1, 480)).toBe(60);
  });
});

describe('divisions changes', () => {
  it('converts durations with the divisions in force at each note, even mid-measure', () => {
    const s = parseMusicXml(samples.DIVISIONS_MID_MEASURE);
    expect(s.ticksPerQuarter).toBe(48);
    expect(s.measures).toEqual(evenMeasures(1, 192));
    expect(notes(s)).toEqual([
      'P1:0:3 @0+192 midi=48 s2/v5',
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:0:1 @48+48 midi=62 s1/v1',
      'P1:0:2 @96+96 midi=64 s1/v1',
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe('unusual notes', () => {
  const s = parseMusicXml(samples.ODD_NOTES);

  it('rounds microtones, keeps notes beyond the piano, skips unpitched and zero-length notes, keeps hidden notes, defaults the voice', () => {
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=61 s1/v1',
      'P1:0:1 @48+48 midi=64 s1/v1',
      'P1:0:2 @96+48 midi=120 s1/v1',
      'P1:1:1 @192+192 midi=67 s1/v1 hidden',
    ]);
    expect(s.notes[0].spelled).toEqual({ step: 'C', alter: 0.5, octave: 4 });
    expect(s.parts[0].pitchedNoteCount).toBe(4);
  });

  it('reports each kind of problem once', () => {
    expect(warnings(s)).toEqual([
      { code: 'microtone-rounded', severity: 'info', count: 2, measures: ['1'] },
      { code: 'other', severity: 'info', count: 1, measures: ['1'] },
      { code: 'out-of-piano-range', severity: 'review', count: 1, measures: ['1'] },
      { code: 'zero-length-note', severity: 'info', count: 1, measures: ['2'] },
    ]);
    for (const w of s.warnings) expectPlainText(w.message);
  });
});

describe('ornaments, tremolos, arpeggios and pedal marks', () => {
  const s = parseMusicXml(samples.ORNAMENTS_PEDAL);

  it('plays every note as written and counts pedal marks other than stop', () => {
    expect(notes(s)).toEqual([
      'P1:0:0 @0+48 midi=60 s1/v1',
      'P1:0:1 @48+48 midi=62 s1/v1',
      'P1:0:2 @96+96 midi=64 s1/v1',
      'P1:0:3 @96+96 midi=67 s1/v1 chord',
      'P1:1:0 @192+192 midi=60 s1/v1',
    ]);
    expect(s.pedalMarks).toBe(2);
  });

  it('warns with the documented severities', () => {
    expect(warnings(s)).toEqual([
      { code: 'arpeggio-not-rolled', severity: 'info', count: 2, measures: ['1'] },
      { code: 'ornament-not-played', severity: 'review', count: 1, measures: ['1'] },
      { code: 'pedal-not-modelled', severity: 'info', count: 2, measures: ['1', '2'] },
      { code: 'tremolo-not-expanded', severity: 'review', count: 1, measures: ['1'] },
    ]);
    for (const w of s.warnings) expectPlainText(w.message);
  });
});

describe('octave instructions written as words', () => {
  const withDirection = (direction: string) =>
    parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
      <measure number="2">${direction}
        <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
    </part></score-partwise>`);
  const words = (text: string) => `<direction><direction-type><words>${text}</words></direction-type></direction>`;

  it.each(['Repeat 8va', 'Repeat  8va.', '8vb', '(8va bassa)', '15ma', "all'ottava"])(
    '"%s" is flagged for review, with its measure, and the notes stay as written',
    (text) => {
      const s = withDirection(words(text));
      const w = s.warnings.find((x) => x.code === 'octave-text-not-applied');
      expect(w).toMatchObject({ severity: 'review', measures: ['2'] });
      expectPlainText(w!.message);
      expect(s.notes.map((n) => n.midi)).toEqual([72, 76]);
    },
  );

  it.each(['dolce', 'a tempo', 'loco', '18 variations', 'Var. 8'])('"%s" is not an octave instruction', (text) => {
    expect(withDirection(words(text)).warnings.map((w) => w.code)).not.toContain('octave-text-not-applied');
  });

  it('words that label an <octave-shift> line are not flagged: the file already stores the sounding pitch', () => {
    const s = withDirection(
      '<direction><direction-type><words>8va</words></direction-type><direction-type><octave-shift type="down" size="8"/></direction-type></direction>',
    );
    expect(s.warnings.map((w) => w.code)).not.toContain('octave-text-not-applied');
  });

  it('The Entertainer: the "Repeat 8va" instruction makes both editions need review', () => {
    for (const [file, measure] of [
      ['The_Entertainer_-_Scott_Joplin.mxl', '22'],
      ['The_Entertainer_-_Scott_Joplin_-_1902.mxl', '21'],
    ]) {
      const s = loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', file))), file);
      expect(s.warnings.find((w) => w.code === 'octave-text-not-applied')?.measures, file).toEqual([measure]);
    }
  });
});

describe('warning aggregation', () => {
  it('keeps one entry per code with the full count and at most 20 measure numbers', () => {
    const sink = new WarningSink();
    for (let i = 24; i >= 0; i--) sink.add('cross-staff-notes', i);
    sink.add('cross-staff-notes', 3);
    sink.add('other', undefined, 1, 'First problem.');
    sink.add('other', 2, 2, 'Second problem.');
    sink.add('other', 2, 1, 'First problem.');
    expect(sink.toList((i) => `m${i + 1}`)).toEqual([
      {
        code: 'cross-staff-notes',
        severity: 'review',
        message:
          "Some notes are written on the other hand's staff. The app guesses which hand plays them from the musical line they belong to. If a hand feels wrong, the measures are listed under More → About this arrangement.",
        count: 26,
        measures: Array.from({ length: 20 }, (_, i) => `m${i + 1}`),
        // 25 measures were affected, so the list of 20 is marked as cut short.
        measuresTruncated: true,
      },
      { code: 'other', severity: 'info', message: 'First problem. Second problem.', count: 4, measures: ['m3'] },
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Safety                                                                    */
/* ------------------------------------------------------------------------ */

describe('DOCTYPE handling', () => {
  it.each(['f01-melody-repeated.musicxml', 'f04-moving-line.musicxml', 'f-timewise.musicxml'])(
    '%s: the external DTD reference is removed before parsing and never fetched',
    (file) => {
      expect(new TextDecoder().decode(fixtureBytes(file))).toMatch(/<!DOCTYPE[^>]+\.dtd"/);
      const seen: string[] = [];
      const original = DOMParser.prototype.parseFromString;
      vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (
        this: DOMParser,
        text: string,
        type: DOMParserSupportedType,
      ) {
        seen.push(text);
        return original.call(this, text, type);
      });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');

      const s = fixture(file);
      expect(s.notes.length).toBeGreaterThan(0);
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toMatch(/<!DOCTYPE/i);
      expect(seen[0]).not.toContain('.dtd');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
    },
  );

  it('removes a SYSTEM DTD with an internal subset, including quoted "]" and ">"', () => {
    const s = parseMusicXml(samples.EXTERNAL_DTD_WITH_SUBSET);
    expect(notes(s)).toEqual(['P1:0:0 @0+192 midi=60 s1/v1']);
    const stripped = stripDoctype(samples.EXTERNAL_DTD_WITH_SUBSET);
    expect(stripped).not.toMatch(/<!DOCTYPE|never-fetched|ATTLIST/);
    expect(stripped).toContain('<!-- comment before the DOCTYPE -->');
    expect(stripped).toContain('<score-partwise version="4.0">');
  });

  it('only strips a DOCTYPE from the prolog', () => {
    const text = '<a><![CDATA[<!DOCTYPE x>]]></a>';
    expect(stripDoctype(text)).toBe(text);
    expect(stripDoctype('<!doctype a SYSTEM "a.dtd"><a/>')).toBe('<a/>');
    expectImportError(() => stripDoctype('<!DOCTYPE a [ <!ELEMENT a ANY> <a/>'), 'malformed-xml');
  });
});

describe('metadata is plain text', () => {
  it('returns markup-looking titles, names and words literally', () => {
    const s = parseMusicXml(samples.MARKUP_METADATA);
    expect(metadata(s)).toEqual({
      title: '<script>alert("title")</script>',
      subtitle: '<img src=x onerror=alert(1)>',
      composer: '&lt;b&gt;Bold&lt;/b&gt;',
      arranger: 'A & B',
      rights: 'Copyright Someone', // a real child element contributes only its text
      software: '<svg onload=alert(1)>',
      credits: ['<iframe src="javascript:alert(1)">'],
    });
    expect(s.parts[0].name).toBe('<b>Piano</b>');
    expect(s.parts[0].words).toEqual(['<script>x</script>']);
    expect(notes(s)).toEqual(['P1:0:0 @0+192 midi=60 s1/v1']);
  });
});

describe('rejected input', () => {
  it.each(Object.entries(samples.INVALID_SAMPLES))('%s', (_name, { xml, code }) => {
    const err = expectImportError(() => parseMusicXml(xml), code as ImportErrorCode);
    expectPlainText(err.message);
  });

  it('accepts whitespace before the XML declaration and a byte order mark', () => {
    const text = '\uFEFF\n  ' + samples.DIVISIONS_MID_MEASURE;
    expect(notes(parseMusicXml(text))).toEqual(notes(parseMusicXml(samples.DIVISIONS_MID_MEASURE)));
  });

  it('accepts "&" inside comments, CDATA and references, and a U+FFFD from a decoding slip', () => {
    const xml = samples.MARKUP_METADATA.replace(
      '<work-title>&lt;script&gt;alert("title")&lt;/script&gt;</work-title>',
      '<!-- R & B --><work-title><![CDATA[Rock & Roll]]> &#38; &amp; Caf\uFFFD</work-title>',
    );
    expect(parseMusicXml(xml).title).toBe('Rock & Roll & & Caf\uFFFD');
  });

  it.each(['<!--', '<![CDATA[', '<?x'])(
    'rejects at once a file with a bare "&" and very many unterminated "%s" sections',
    (open) => {
      const text = `<?xml version="1.0"?><score-partwise version="4.0"><part-list/>&amp${open.repeat(Math.ceil(1_000_000 / open.length))}</score-partwise>`;
      // Rescanning the rest of the text for every unterminated section took minutes for 1 MB.
      // CPU time, so a busy machine cannot fail it.
      const ms = cpuMs(() => {
        expectImportError(() => parseXmlSafely(text), 'malformed-xml');
        expectImportError(() => parseMusicXml(text), 'malformed-xml');
      });
      expect(ms).toBeLessThan(500);
    },
  );

  it('still finds a bare "&" after an unterminated comment closes nothing', () => {
    expectImportError(() => parseXmlSafely('<a>R & B<!-- open</a>'), 'malformed-xml');
    expect(parseXmlSafely('<a><!-- R & B --></a>').documentElement.nodeName).toBe('a');
  });

  it('has a plain-language default message for every error code', () => {
    const codes: ImportErrorCode[] = [
      'not-musicxml',
      'malformed-xml',
      'bad-archive',
      'too-large',
      'no-score-in-archive',
      'unsafe-content',
      'empty-score',
      'unsupported',
    ];
    for (const code of codes) expectPlainText(new ImportError(code).message);
  });

  it('reports a missing DOMParser as unsupported', () => {
    vi.stubGlobal('DOMParser', undefined);
    expectImportError(() => parseMusicXml(samples.DIVISIONS_MID_MEASURE), 'unsupported');
  });
});

describe('instrument declarations in <score-part>', () => {
  const duet = (head: string) => `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>${head}</part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part>
  </score-partwise>`;
  const scorePart = (id: string, name: string, instrument: string, sound: string, program: number) =>
    `<score-part id="${id}"><part-name>${name}</part-name>` +
    `<score-instrument id="${id}-I1"><instrument-name>${instrument}</instrument-name><instrument-sound>${sound}</instrument-sound></score-instrument>` +
    `<midi-instrument id="${id}-I1"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument></score-part>`;

  it('records instrument names, sounds and General MIDI programs per part', () => {
    const s = parseMusicXml(duet(scorePart('P1', 'Violin', 'Violin', 'strings.violin', 41) + scorePart('P2', 'Violoncello', 'Cello', 'strings.cello', 43)));
    expect(s.parts.map((p) => [p.name, p.instrumentNames, p.instrumentSounds, p.midiPrograms])).toEqual([
      ['Violin', ['Violin'], ['strings.violin'], [41]],
      ['Violoncello', ['Cello'], ['strings.cello'], [43]],
    ]);
  });

  it('leaves the fields out when a part declares nothing', () => {
    const s = parseMusicXml(duet('<score-part id="P1"><part-name>Right</part-name></score-part><score-part id="P2"><part-name>Left</part-name></score-part>'));
    for (const p of s.parts) expect(Object.keys(p)).not.toContain('midiPrograms');
  });

  it('a string duet is not a ready piano piece; a two-part piano piece still is', () => {
    const strings = prepareScore(parseMusicXml(duet(scorePart('P1', 'Violin', 'Violin', 'strings.violin', 41) + scorePart('P2', 'Violoncello', 'Cello', 'strings.cello', 43))));
    expect(strings.readiness).toBe('review');
    expect(strings.warnings.find((w) => w.code === 'multiple-instruments')?.severity).toBe('review');
    const piano = prepareScore(parseMusicXml(duet(scorePart('P1', '', 'Piano', 'keyboard.piano', 1) + scorePart('P2', '', 'Piano', 'keyboard.piano', 1))));
    expect(piano.readiness).toBe('ready');
  });
});
