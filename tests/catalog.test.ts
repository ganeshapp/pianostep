import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  ANOTHER_EDITION,
  LIBRARY_COMMIT,
  MAX_NOTES,
  UNRATED,
  assignStatuses,
  buildEntry,
  catalogDate,
  creditInfo,
  defaultPaths,
  findMuseScoreUrl,
  fingerprint,
  formatSimilarity,
  generateCatalog,
  inFileLabelProblem,
  internalWording,
  isPianoPart,
  parseDifficulty,
  parseMetadata,
  readPartList,
  resolveArrangements,
  scoreStats,
  serialiseJson,
  similarity,
  slugFromFileName,
  stripAnotherCopy,
  upstreamUrl,
  wordingProblems,
  type Candidate,
  type CuratedMetadata,
  type FingerprintPress,
} from '../scripts/build-catalog';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import type { CatalogEntry, Hand, InventoryRow } from '../src/core/types';
import { parseXmlSafely } from '../src/core/xml';
import { ScoreBuilder } from './helpers/sourceBuilder';

const ROOT = join(__dirname, '..');
const SCORES_DIR = join(ROOT, 'public', 'scores');

/* ------------------------------------------------------------------------ */
/* Synthetic helpers                                                         */
/* ------------------------------------------------------------------------ */

function press(hand: Hand, midi: number, startTick: number, endTick: number): FingerprintPress {
  return { hand, midi, startTick, endTick };
}

/** `count` distinct right-hand quarter notes starting at quarter `from`. */
function run(count: number, from = 0, midi = 60): FingerprintPress[] {
  return Array.from({ length: count }, (_, i) => press('R', midi, (from + i) * 4, (from + i + 1) * 4));
}

function cand(file: string, presses: FingerprintPress[], over: Partial<Candidate> = {}): Candidate {
  return {
    file,
    id: slugFromFileName(file),
    hasMetadata: true,
    importError: null,
    hasPiano: true,
    partNames: ['Piano'],
    readiness: 'ready',
    readinessReasons: [],
    fingerprint: fingerprint(presses, 4),
    credit: { facts: 2, lines: 2, rights: false },
    ...over,
  };
}

function byFile<T extends { file: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.file, r]));
}

function meta(over: Partial<CuratedMetadata> = {}): CuratedMetadata {
  return {
    file: 'Little Piece (easy).mxl',
    id: 'little-piece-easy',
    title: 'Little Piece',
    composer: 'Anon.',
    arrangement: 'Original piano work',
    attribution: 'Composed by Anon.',
    rightsInFile: null,
    licenseNote: null,
    suspectedDuplicateOf: null,
    overrides: null,
    notes: [],
    ...over,
  };
}

/** Two-staff piece: measures 1–2 repeated, then measure 3; 90 qpm; keys G2–E5. */
function samplePrepared() {
  const source = new ScoreBuilder()
    .meta({ title: 'Little Piece', composer: 'Anon.' })
    .measure({ forward: true })
    .measure({ backward: true })
    .measure()
    .tempo(0, 0, 90)
    .note({ staff: 1, measure: 0, beat: 0, dur: 2, midi: 72 })
    .note({ staff: 1, measure: 0, beat: 2, dur: 2, midi: 74, tieStart: true })
    .note({ staff: 1, measure: 1, beat: 0, dur: 1, midi: 74, tieStop: true })
    .note({ staff: 1, measure: 1, beat: 1, dur: 3, midi: 76 })
    .note({ staff: 1, measure: 2, beat: 0, dur: 4, midi: 72 })
    .note({ staff: 2, measure: 0, beat: 0, dur: 4, midi: 48 })
    .note({ staff: 2, measure: 1, beat: 0, dur: 4, midi: 43 })
    .note({ staff: 2, measure: 2, beat: 0, dur: 4, midi: 48 })
    .warning({ code: 'grace-notes-approximated', severity: 'info', message: 'Grace notes are approximated.', count: 1 })
    .warning({ code: 'pedal-not-modelled', severity: 'info', message: 'Pedal marks are ignored.', count: 1 })
    .build();
  return prepareScore(source);
}

function xml(body: string): Document {
  return parseXmlSafely(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">${body}</score-partwise>`);
}

/* ------------------------------------------------------------------------ */
/* Pure functions                                                            */
/* ------------------------------------------------------------------------ */

describe('fingerprint and similarity', () => {
  it('compares times in quarter notes, so the same music at different resolutions is identical', () => {
    const a = fingerprint([press('R', 60, 0, 4), press('L', 48, 4, 10)], 4);
    const b = fingerprint([press('R', 60, 0, 12), press('L', 48, 12, 30)], 12);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(similarity(a, b)).toBe(1);
  });

  it('is a multiset: repeated presses count, and the hand is part of the key', () => {
    const a = fingerprint([press('R', 60, 0, 4), press('R', 60, 0, 4), press('R', 62, 4, 8)], 4);
    const b = fingerprint([press('R', 60, 0, 4), press('R', 62, 4, 8), press('L', 62, 4, 8)], 4);
    expect(a.get('R|60|0/1|1/1')).toBe(2);
    // shared = 1 + 1, either = 2 + 1 + 1
    expect(similarity(a, b)).toBe(0.5);
    expect(similarity(fingerprint([press('R', 60, 0, 4)], 4), fingerprint([press('L', 60, 0, 4)], 4))).toBe(0);
  });

  it('never treats two empty files as similar', () => {
    expect(similarity(new Map(), new Map())).toBe(0);
  });

  it('formats similarity without ever rounding a near-copy up to 100%', () => {
    expect(formatSimilarity(1)).toBe('100%');
    expect(formatSimilarity(0.99999)).toBe('99.9%');
    expect(formatSimilarity(0.9836)).toBe('98.3%');
    expect(formatSimilarity(0.995)).toBe('99.5%');
    expect(formatSimilarity(99 / 101)).toBe('98.0%');
  });
});

describe('assignStatuses', () => {
  it('leaves out the weaker copy of identical notes: ready beats review even when it sorts later', () => {
    const d = byFile(
      assignStatuses([
        cand('A_copy.mxl', run(8), { readiness: 'review', readinessReasons: ['Check the hands.'] }),
        cand('B_copy.mxl', run(8)),
      ]),
    );
    expect(d['B_copy.mxl'].status).toBe('included');
    expect(d['A_copy.mxl'].status).toBe('duplicate');
    expect(d['A_copy.mxl'].reason).toMatch(/^Same notes as B_copy\.mxl \(similarity 100%\)\./);
    expect(d['A_copy.mxl'].reason).toContain('ready to practise');
    expect(d['A_copy.mxl'].duplicateOf).toMatchObject({ file: 'B_copy.mxl', similarity: 1 });
  });

  it('then prefers the copy with a difficulty label over fuller credits or a rights statement', () => {
    const d = byFile(
      assignStatuses([
        cand('A.mxl', run(8), { credit: { facts: 4, lines: 5, rights: true } }),
        cand('B.mxl', run(8), { credit: { facts: 1, lines: 1, rights: false }, rated: true }),
      ]),
    );
    expect(d['A.mxl'].status).toBe('duplicate');
    expect(d['A.mxl'].reason).toContain('it has a difficulty label and this copy is Unrated');
    // A recorded label is not a verified one (verification lives in the research log).
    expect(d['A.mxl'].reason).not.toContain('verified');
    expect(d['B.mxl'].status).toBe('included');
  });

  it('then prefers fuller credits, then a rights statement, then the first file name', () => {
    const credits = byFile(
      assignStatuses([
        cand('A.mxl', run(8), { credit: { facts: 2, lines: 5, rights: true } }),
        cand('B.mxl', run(8), { credit: { facts: 3, lines: 1, rights: false } }),
      ]),
    );
    expect(credits['A.mxl'].status).toBe('duplicate');
    expect(credits['A.mxl'].reason).toContain('fuller credits');

    const rights = byFile(
      assignStatuses([cand('A.mxl', run(8)), cand('B.mxl', run(8), { credit: { facts: 2, lines: 2, rights: true } })]),
    );
    expect(rights['A.mxl'].status).toBe('duplicate');
    expect(rights['A.mxl'].reason).toContain('rights statement');

    const alpha = byFile(assignStatuses([cand('B.mxl', run(8)), cand('A.mxl', run(8))]));
    expect(alpha['A.mxl'].status).toBe('included');
    expect(alpha['B.mxl'].status).toBe('duplicate');
    expect(alpha['B.mxl'].reason).toContain('alphabetically');
  });

  it('uses 98% as the duplicate threshold and keeps 90–98% pairs as separate editions', () => {
    const base = run(99);
    const d = byFile(
      assignStatuses([
        // 99 shared of 101 → 98.02%
        cand('B_near.mxl', [...base, press('R', 61, 0, 4)]),
        cand('A_original.mxl', [...base, press('R', 62, 0, 4)]),
      ]),
    );
    expect(d['A_original.mxl'].status).toBe('included');
    expect(d['B_near.mxl'].status).toBe('duplicate');
    expect(d['B_near.mxl'].reason).toMatch(/^Same notes as A_original\.mxl \(similarity 98\.0%\)/);

    const short = run(19);
    const e = byFile(
      assignStatuses([
        // 19 shared of 21 → 90.47%
        cand('Edition_A.mxl', [...short, press('R', 61, 0, 4)]),
        cand('Edition_B.mxl', [...short, press('R', 62, 0, 4)]),
        cand('Other.mxl', run(10, 0, 70)),
      ]),
    );
    expect(e['Edition_A.mxl'].status).toBe('included');
    expect(e['Edition_B.mxl'].status).toBe('included');
    expect(e['Edition_A.mxl'].similarTo).toEqual([{ file: 'Edition_B.mxl', similarity: 19 / 21 }]);
    expect(e['Edition_A.mxl'].reason).toContain('Similar to Edition_B.mxl (similarity 90.4%)');
    expect(e['Other.mxl'].similarTo).toEqual([]);
  });

  it('marks a file a duplicate of the most similar kept file in a cluster', () => {
    const shared = run(200);
    const strong = { credit: { facts: 4, lines: 4, rights: true } };
    const d = byFile(
      assignStatuses([
        // K1 ~ K2: 200 of 205 (97.6%), so both are kept
        cand('K1.mxl', [...shared, ...run(3, 0, 40)], strong),
        cand('K2.mxl', [...shared, ...run(2, 0, 41)], strong),
        // C ~ K1: 200 of 203 (98.5%); C ~ K2: 200 of 202 (99.0%)
        cand('C.mxl', shared),
      ]),
    );
    expect(d['K1.mxl'].status).toBe('included');
    expect(d['K2.mxl'].status).toBe('included');
    expect(d['C.mxl'].duplicateOf).toMatchObject({ file: 'K2.mxl', similarity: 200 / 202 });
    expect(d['C.mxl'].reason).toMatch(/^Same notes as K2\.mxl \(similarity 99\.0%\)/);
  });

  it('gives unreadable, unplayable, non-piano and undescribed files their own status', () => {
    const decisions = assignStatuses([
      cand('Broken.mxl', [], { importError: 'The score file is damaged or incomplete, so it cannot be read.', readiness: null }),
      cand('Empty.mxl', [], { readiness: 'unsupported', readinessReasons: ['There are no notes to play for either hand.'] }),
      cand('Quartet.mxl', run(4), { hasPiano: false, partNames: ['Violin', 'Cello'] }),
      cand('New.mxl', run(4, 0, 50), { hasMetadata: false }),
      cand('Fine.mxl', run(4, 0, 80)),
    ]);
    const d = byFile(decisions);
    expect(d['Broken.mxl']).toMatchObject({ status: 'unsupported' });
    expect(d['Broken.mxl'].reason).toContain('damaged');
    expect(d['Empty.mxl']).toMatchObject({ status: 'unsupported', reason: "Can't be used: There are no notes to play for either hand." });
    expect(d['Quartet.mxl']).toMatchObject({ status: 'non-solo-piano', reason: 'No piano part in this file (parts: Violin, Cello).' });
    expect(d['New.mxl'].status).toBe('review');
    expect(d['Fine.mxl']).toMatchObject({ status: 'included', reason: 'Included: ready to practise.' });
    expect(decisions.map((x) => x.id)).toEqual(['broken', 'empty', 'fine', 'new', 'quartet']);
  });

  it('says why a review piece is still included', () => {
    const [d] = assignStatuses([cand('R.mxl', run(3), { readiness: 'review', readinessReasons: ['Some notes cross staves.'] })]);
    expect(d).toMatchObject({ status: 'included', reason: 'Included, marked "Needs review": Some notes cross staves.' });
  });
});

describe('arrangement lines', () => {
  it('strips the curator\'s "another copy" marker', () => {
    expect(stripAnotherCopy('Original piano work (another copy)')).toBe('Original piano work');
    expect(stripAnotherCopy('Original piano piece (another copy, with chord names)')).toBe('Original piano piece (with chord names)');
    expect(stripAnotherCopy('Piano solo version (another copy; credits name X)')).toBe('Piano solo version (credits name X)');
  });

  it('appends "(another edition)" only to the less preferred of two near-copies with identical lines', () => {
    const shared = run(19);
    const decisions = assignStatuses([
      cand('A.mxl', [...shared, press('R', 61, 0, 4)]),
      cand('B.mxl', [...shared, press('R', 62, 0, 4)], { credit: { facts: 4, lines: 4, rights: false } }),
      cand('C.mxl', [...shared, press('R', 63, 80, 84)].map((p) => ({ ...p, midi: p.midi + 12 }))),
      cand('D.mxl', [...shared, press('R', 64, 80, 84)].map((p) => ({ ...p, midi: p.midi + 12 }))),
    ]);
    const lines = resolveArrangements(
      [
        { file: 'A.mxl', arrangement: 'Original piano work', suspectedDuplicateOf: null },
        { file: 'B.mxl', arrangement: 'Original piano work', suspectedDuplicateOf: null },
        { file: 'C.mxl', arrangement: 'Easy version', suspectedDuplicateOf: null },
        { file: 'D.mxl', arrangement: 'Easy version with fingering', suspectedDuplicateOf: null },
      ],
      decisions,
      ['B.mxl', 'A.mxl', 'C.mxl', 'D.mxl'],
    );
    expect(lines.get('B.mxl')).toBe('Original piano work');
    expect(lines.get('A.mxl')).toBe(`Original piano work${ANOTHER_EDITION}`);
    expect(lines.get('C.mxl')).toBe('Easy version');
    expect(lines.get('D.mxl')).toBe('Easy version with fingering');
  });

  it('keeps "another copy" while the other copy is listed and drops it once that copy is left out', () => {
    const decisions = assignStatuses([
      cand('Kept.mxl', run(10)),
      cand('Twin.mxl', run(10, 50)),
      cand('Left_out.mxl', run(10, 100), { readiness: 'review', readinessReasons: ['x'] }),
      cand('Survivor.mxl', run(10, 100)),
    ]);
    const lines = resolveArrangements(
      [
        { file: 'Twin.mxl', arrangement: 'Original piano work (another copy)', suspectedDuplicateOf: 'Kept.mxl' },
        { file: 'Survivor.mxl', arrangement: 'Original piano work (another copy)', suspectedDuplicateOf: 'Left_out.mxl' },
      ],
      decisions,
      [],
    );
    expect(byFile(decisions)['Left_out.mxl'].status).toBe('duplicate');
    expect(lines.get('Twin.mxl')).toBe('Original piano work (another copy)');
    expect(lines.get('Survivor.mxl')).toBe('Original piano work');
  });
});

describe('buildEntry', () => {
  const prepared = samplePrepared();

  it('builds stats, links and default difficulty from the prepared score and metadata', () => {
    const { entry } = buildEntry({ meta: meta(), prepared });
    expect(entry).toMatchObject({
      id: 'little-piece-easy',
      title: 'Little Piece',
      composer: 'Anon.',
      arrangement: 'Original piano work',
      file: 'scores/Little Piece (easy).mxl',
      upstreamUrl: `https://github.com/musetrainer/library/blob/${LIBRARY_COMMIT}/scores/Little%20Piece%20(easy).mxl`,
      rightsInFile: null,
      attribution: 'Composed by Anon.',
      difficulty: UNRATED,
      readiness: 'ready',
      readinessReasons: [],
      stats: { measures: 3, performanceMeasures: 5, notes: 12, durationSec: 13.3, lowest: 'G2', highest: 'E5' },
    });
    expect('originalSourceUrl' in entry).toBe(false);
    expect('licenseNote' in entry).toBe(false);
    expect('overrides' in entry).toBe(false);
  });

  it('prefers the arrangement page from difficulty.json over the file\'s own link, and keeps it out of the difficulty', () => {
    const difficulty = {
      level: 'Beginner' as const,
      basis: 'source' as const,
      originalLabel: 'easy',
      sourceName: 'MuseScore',
      sourceUrl: 'https://musescore.com/user/1/scores/2',
      checkedOn: '2026-10-02',
      arrangementUrl: 'https://musescore.com/user/1/scores/2',
    };
    const { entry } = buildEntry({ meta: meta(), prepared, difficulty, museScoreUrl: 'http://musescore.com/score/9' });
    expect(entry.originalSourceUrl).toBe('https://musescore.com/user/1/scores/2');
    expect(entry.difficulty).toEqual({
      level: 'Beginner',
      basis: 'source',
      originalLabel: 'easy',
      sourceName: 'MuseScore',
      sourceUrl: 'https://musescore.com/user/1/scores/2',
      checkedOn: '2026-10-02',
    });
    expect(buildEntry({ meta: meta(), prepared, museScoreUrl: 'http://musescore.com/score/9' }).entry.originalSourceUrl).toBe(
      'http://musescore.com/score/9',
    );
  });

  it('merges curated and derived notes, drops notes naming other files, de-duplicates and caps at six', () => {
    const { entry, droppedNotes } = buildEntry({
      meta: meta({
        notes: ['Contains repeat signs', 'About 99% of its notes match Other_File.mxl', 'Grace notes are approximated.'],
        licenseNote: 'Modern arrangement.',
        overrides: { excludeParts: ['P2'], reason: 'Ossia.' },
      }),
      prepared,
      extraNotes: ['Another edition in this library has nearly the same notes (95.0% match)'],
    });
    expect(entry.notes).toEqual([
      'Contains repeat signs',
      'Grace notes are approximated.',
      'Another edition in this library has nearly the same notes (95.0% match)',
      'Repeats are followed',
      'Pedal marks are not turned into held notes',
    ]);
    expect(droppedNotes).toEqual(['About 99% of its notes match Other_File.mxl']);
    expect(entry.licenseNote).toBe('Modern arrangement.');
    expect(entry.overrides).toEqual({ excludeParts: ['P2'], reason: 'Ossia.' });

    const many = buildEntry({ meta: meta({ notes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), prepared }).entry.notes;
    expect(many).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(many.length).toBe(MAX_NOTES);
  });

  it('notes a glissando that is played as its first and last notes only', () => {
    const glissando = {
      ...prepared,
      warnings: [
        ...prepared.warnings,
        { code: 'glissando-not-played' as const, severity: 'review' as const, message: 'A glissando is written here.' },
      ],
    };
    const { entry } = buildEntry({ meta: meta(), prepared: glissando });
    expect(entry.notes).toContain('Glissandos are played as their first and last notes only');
    // A curated note that already says so is not repeated.
    const curated = buildEntry({ meta: meta({ notes: ['The glissando in m. 9 is not played.'] }), prepared: glissando });
    expect(curated.entry.notes.filter((n) => /glissando/i.test(n))).toEqual(['The glissando in m. 9 is not played.']);
  });

  it("keeps the curator's override evidence out of the catalog entry", () => {
    const overrides = {
      excludeParts: ['P2'],
      reason: 'The second piano part is only an optional alternative, so it is left out.',
      evidence: 'P2 "Grand Piano" has 3 notes, all in measure 7.',
    };
    const { entry } = buildEntry({ meta: meta({ overrides }), prepared });
    expect(entry.overrides).toEqual({ excludeParts: ['P2'], reason: overrides.reason });
  });
});

describe('plain wording in text the app shows (§16: no internal ids)', () => {
  const prepared = samplePrepared();

  it('flags part ids, score file names and "file name" remarks, and nothing else', () => {
    expect(internalWording('P2 "Grand Piano" is an ossia staff; P1 holds the full part.')).toEqual([
      'an internal part id (P1, P2, ...)',
    ]);
    expect(internalWording('Staff map P1:1 → R')).toEqual(['an internal part id (P1, P2, ...)']);
    expect(internalWording('It matches G_Minor_Bach_Original.mxl at about 99%')).toEqual(['a score file name']);
    expect(internalWording('The arrangement’s published title (file name) says “easy piano”.')).toEqual([
      'the words "file name"',
    ]);
    expect(internalWording('Its filename says "C Minor"')).toEqual(['the words "file name"']);
    for (const plain of [
      'The second piano part only holds a short alternative passage (ossia), so it is left out.',
      'Ballade No. 1 in G Minor, Op. 23',
      'Liebestraum No. 3, S. 541/3; BWV 1067; K. 265; measures 21–22',
      'The extra part named “PianoVoorslagen” is left out.',
      'MusicXML from the MuseTrainer library',
      null,
      undefined,
      '',
    ]) {
      expect(internalWording(plain), String(plain)).toEqual([]);
    }
  });

  it('reports every curated field of an entry that would show internal wording', () => {
    const { entry } = buildEntry({
      meta: meta({
        overrides: { staffHands: { 'P1:1': 'R', 'P2:1': 'L' }, reason: 'P1 is the upper staff and P2 the lower.' },
        notes: ['The file name says "C Minor"; the piece is in C-sharp minor', 'Starts with a pickup measure'],
        licenseNote: 'Same edition as Other_File.musicxml.',
      }),
      prepared,
      difficulty: { level: 'Beginner', basis: 'in-file', originalLabel: 'easy piano', note: 'The title (file name) says “easy piano”.' },
    });
    expect(wordingProblems([entry])).toEqual([
      'little-piece-easy: the licenseNote shown in the app mentions a score file name; reword it in plain language in metadata.json.',
      'little-piece-easy: the overrides.reason shown in the app mentions an internal part id (P1, P2, ...); reword it in plain language in metadata.json.',
      'little-piece-easy: the notes[0] shown in the app mentions the words "file name"; reword it in plain language in metadata.json.',
      'little-piece-easy: the difficulty note shown in the app mentions the words "file name"; reword it in plain language in difficulty.json.',
    ]);
    expect(wordingProblems([buildEntry({ meta: meta(), prepared }).entry])).toEqual([]);
  });

  it('accepts a string evidence next to the override reason and rejects other types', () => {
    const base = { file: 'A.mxl', id: 'a', title: 'A', arrangement: 'Original piano work', attribution: 'Composed by Anon.' };
    const [parsed] = parseMetadata([{ ...base, overrides: { excludeParts: ['P2'], reason: 'Plain.', evidence: 'P2 has 3 notes.' } }]);
    expect(parsed.overrides).toEqual({ excludeParts: ['P2'], reason: 'Plain.', evidence: 'P2 has 3 notes.' });
    expect(() => parseMetadata([{ ...base, overrides: { evidence: 3 } }])).toThrow(/evidence/);
    expect(() => parseMetadata([{ ...base, overrides: { reason: ['x'] } }])).toThrow(/reason/);
  });
});

describe('raw MusicXML facts', () => {
  const doc = xml(`
    <identification>
      <creator type="composer">Someone</creator>
      <rights>https://example.org</rights>
      <miscellaneous><miscellaneous-field name="a">see https://musescore.com/user/5/scores/6.</miscellaneous-field></miscellaneous>
      <source>http://musescore.com/user/1/scores/2</source>
    </identification>
    <part-list>
      <score-part id="P1"><part-name>Violin</part-name>
        <midi-instrument id="P1-I1"><midi-program>41</midi-program></midi-instrument></score-part>
      <score-part id="P2"><part-name></part-name>
        <score-instrument id="P2-I1"><instrument-name></instrument-name></score-instrument>
        <midi-instrument id="P2-I1"><midi-program>1</midi-program></midi-instrument></score-part>
      <score-part id="P3"><part-name>PianoVoorslagen</part-name></score-part>
      <score-part id="P4"><part-name>Solo</part-name>
        <score-instrument id="P4-I1"><instrument-name>Solo</instrument-name><instrument-sound>keyboard.piano.grand</instrument-sound></score-instrument></score-part>
    </part-list>
    <part id="P1"/>`);

  it('reads the part list and recognises piano parts by name, sound or General MIDI program', () => {
    const parts = readPartList(doc);
    expect(parts.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(parts.map(isPianoPart)).toEqual([false, true, true, true]);
  });

  it('finds a MuseScore link in <identification>, preferring <source>, and keeps it verbatim', () => {
    expect(findMuseScoreUrl(doc)).toBe('http://musescore.com/user/1/scores/2');
    expect(findMuseScoreUrl(xml('<identification><miscellaneous><miscellaneous-field name="x">https://musescore.com/user/5/scores/6.</miscellaneous-field></miscellaneous></identification>'))).toBe(
      'https://musescore.com/user/5/scores/6',
    );
    expect(findMuseScoreUrl(xml('<identification><source>https://example.org/score</source></identification>'))).toBeNull();
    expect(findMuseScoreUrl(xml('<part-list/>'))).toBeNull();
  });
});

describe('inputs and small helpers', () => {
  it('counts credit facts from the file only', () => {
    const source = { title: null, composer: null, arranger: null, rights: null, credits: ['Passacaglia', 'Arrangement by Handel Halvorsen'] };
    expect(creditInfo(source, 'George Frideric Handel', false)).toEqual({ facts: 3, lines: 2, rights: false });
    expect(creditInfo({ ...source, credits: ['Minuet'], rights: 'Public Domain' }, 'Christian Petzold', true)).toEqual({
      facts: 2,
      lines: 1,
      rights: true,
    });
  });

  it('validates difficulty records', () => {
    const ok = parseDifficulty({
      $comment: 'ignored',
      'A.mxl': { level: 'Beginner', basis: 'source', originalLabel: 'easy', sourceName: 'MuseScore', checkedOn: '2026-10-02' },
      'B.mxl': { level: 'Intermediate', basis: 'in-file', originalLabel: 'Intermediate' },
    });
    expect(Object.keys(ok.records)).toEqual(['A.mxl', 'B.mxl']);
    expect(ok.problems).toEqual(['A.mxl: difficulty basis "source" without a source URL or original label.']);
    expect(() => parseDifficulty({ 'A.mxl': { level: 'Easy', basis: 'source' } })).toThrow(/level/);
    expect(() => parseDifficulty({ 'A.mxl': { level: 'Unrated', basis: 'source' } })).toThrow(/Unrated/);
    expect(() => parseDifficulty([])).toThrow();
  });

  it('accepts an "in-file" difficulty label only when the score itself states it', () => {
    const source = { title: 'Fur Elise', subtitle: null, credits: ['Fur Elise', 'Easy  Ver.'] };
    expect(inFileLabelProblem('A.mxl', { level: 'Beginner', basis: 'in-file', originalLabel: 'Easy Ver.' }, source)).toBeNull();
    expect(inFileLabelProblem('A.mxl', { level: 'Beginner', basis: 'in-file', originalLabel: 'easy ver.' }, source)).toBeNull();
    expect(inFileLabelProblem('A.mxl', { level: 'Beginner', basis: 'in-file', originalLabel: 'easy piano' }, source)).toMatch(
      /^A\.mxl: .*"easy piano".*do not contain it/,
    );
    expect(inFileLabelProblem('A.mxl', { level: 'Beginner', basis: 'in-file' }, source)).toMatch(/without the original label/);
    // Other bases do not claim the score states the level.
    const sourced = { level: 'Beginner' as const, basis: 'source' as const, originalLabel: 'easy', sourceUrl: 'https://example.org' };
    expect(inFileLabelProblem('A.mxl', sourced, source)).toBeNull();
    expect(inFileLabelProblem('A.mxl', undefined, source)).toBeNull();
  });

  it('a title word found only in the file name or upload title is not an "in-file" label (§14)', () => {
    const cases: [string, string][] = [
      ['Carol_of_the_Bells_easy_piano.mxl', 'easy piano'],
      ['Greensleeves_for_Piano_easy_and_beautiful.mxl', 'easy and beautiful'],
      ['Nocturne_in_E-flat_Major_Op._9_No._2_Easy.mxl', 'Easy'],
    ];
    for (const [file, label] of cases) {
      const source = loadSourceScore(new Uint8Array(readFileSync(join(SCORES_DIR, file))), file);
      expect(inFileLabelProblem(file, { level: 'Beginner', basis: 'in-file', originalLabel: label }, source), file).not.toBeNull();
    }
  });

  it('marks a length at the app\'s default speed in the stats, and only then', () => {
    const prepared = samplePrepared();
    expect('tempoDefaulted' in scoreStats(prepared)).toBe(false);
    expect(scoreStats({ ...prepared, tempo: { ...prepared.tempo, defaulted: true } }).tempoDefaulted).toBe(true);
  });

  it('dates the report from CATALOG_DATE or the latest check date, never the clock', () => {
    const records = { 'A.mxl': { ...UNRATED, checkedOn: '2026-09-30' }, 'B.mxl': { ...UNRATED, checkedOn: '2026-10-01' } };
    expect(catalogDate('2027-01-01', records).date).toBe('2027-01-01');
    expect(catalogDate(undefined, records).date).toBe('2026-10-01');
    expect(catalogDate(undefined, {}).date).toBe('not recorded');
  });

  it('derives stable slugs and upstream links from file names', () => {
    expect(slugFromFileName('Ave_Maria_D839_-_Schubert_-_Solo_Piano_Arrg..mxl')).toBe('ave-maria-d839-schubert-solo-piano-arrg');
    expect(slugFromFileName('Für Elise.mxl')).toBe('fur-elise');
    expect(upstreamUrl('a b.mxl')).toBe(`https://github.com/musetrainer/library/blob/${LIBRARY_COMMIT}/scores/a%20b.mxl`);
  });
});

/* ------------------------------------------------------------------------ */
/* Generated files                                                           */
/* ------------------------------------------------------------------------ */

const scoreFiles = readdirSync(SCORES_DIR)
  .filter((f) => f.toLowerCase().endsWith('.mxl'))
  .sort();
const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'catalog', 'catalog.json'), 'utf8')) as CatalogEntry[];
const inventory = JSON.parse(readFileSync(join(ROOT, 'catalog', 'inventory.json'), 'utf8')) as InventoryRow[];

const isStringOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

describe('src/catalog/catalog.json', () => {
  it('is a non-empty list sorted by id with unique ids', () => {
    expect(catalog.length).toBeGreaterThan(0);
    const ids = catalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('every entry satisfies CatalogEntry and points at a file on disk', () => {
    for (const e of catalog) {
      const at = e.id;
      expect(e.id, at).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      for (const key of ['title', 'arrangement', 'file', 'upstreamUrl', 'attribution'] as const) {
        expect(typeof e[key] === 'string' && e[key].trim() !== '', `${at}.${key}`).toBe(true);
      }
      expect(isStringOrNull(e.composer), at).toBe(true);
      expect(isStringOrNull(e.rightsInFile), at).toBe(true);
      expect(e.file, at).toMatch(/^scores\/.+\.mxl$/);
      expect(existsSync(join(ROOT, 'public', e.file)), at).toBe(true);
      expect(e.upstreamUrl, at).toBe(upstreamUrl(e.file.slice('scores/'.length)));
      if (e.originalSourceUrl !== undefined) expect(e.originalSourceUrl, at).toMatch(/^https?:\/\//);
      if (e.licenseNote !== undefined) expect(typeof e.licenseNote, at).toBe('string');

      expect(['Beginner', 'Intermediate', 'Advanced', 'Unrated'], at).toContain(e.difficulty.level);
      expect(['source', 'in-file', 'estimated', 'none'], at).toContain(e.difficulty.basis);
      expect(e.difficulty.level === 'Unrated', at).toBe(e.difficulty.basis === 'none');
      expect('arrangementUrl' in e.difficulty, at).toBe(false);

      expect(['ready', 'review'], at).toContain(e.readiness);
      expect(e.readinessReasons.length === 0, at).toBe(e.readiness === 'ready');

      const s = e.stats;
      for (const n of [s.measures, s.performanceMeasures, s.notes]) expect(Number.isInteger(n) && n > 0, at).toBe(true);
      expect(s.performanceMeasures, at).toBeGreaterThanOrEqual(s.measures);
      expect(s.durationSec > 0 && Math.abs(Math.round(s.durationSec * 10) - s.durationSec * 10) < 1e-6, at).toBe(true);
      expect(s.lowest, at).toMatch(/^[A-G]#?-?\d$/);
      expect(s.highest, at).toMatch(/^[A-G]#?-?\d$/);

      expect(e.notes.length, at).toBeLessThanOrEqual(MAX_NOTES);
      for (const n of e.notes) expect(n, at).not.toMatch(/\.mxl\b/i);
      if (e.overrides !== undefined) expect(typeof e.overrides, at).toBe('object');
    }
  });

  it('shows no part ids, file names or "file name" remarks in curated text (override reasons, notes, difficulty notes)', () => {
    expect(wordingProblems(catalog)).toEqual([]);
    for (const e of catalog) {
      if (e.overrides !== undefined) expect('evidence' in e.overrides, e.id).toBe(false);
    }
  });

  it('keeps arrangement lines of same-titled entries distinguishable', () => {
    const seen = new Map<string, string>();
    for (const e of catalog) {
      const key = `${e.title}\u0000${e.composer}\u0000${e.arrangement}`.toLowerCase();
      expect(seen.get(key), `${e.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, e.id);
    }
  });
});

describe('catalog/inventory.json', () => {
  it('accounts for every public/scores file exactly once', () => {
    expect(scoreFiles.length).toBeGreaterThan(0);
    const files = inventory.map((r) => r.file);
    expect(new Set(files).size).toBe(files.length);
    expect([...files].sort()).toEqual(scoreFiles);
  });

  it('has a valid status and reason per row, and its included rows match catalog.json', () => {
    const ids = new Set(catalog.map((e) => e.id));
    const included = new Map(inventory.filter((r) => r.status === 'included').map((r) => [r.file, r]));
    for (const r of inventory) {
      expect(['included', 'duplicate', 'non-solo-piano', 'unsupported', 'review']).toContain(r.status);
      expect(r.reason.trim().length, r.file).toBeGreaterThan(0);
      if (r.status === 'included') expect(ids.has(r.catalogId ?? ''), r.file).toBe(true);
      else expect(r.catalogId, r.file).toBeUndefined();
      if (r.status === 'duplicate') {
        const m = /^Same notes as (\S+\.mxl) \(similarity (100|\d{2}\.\d)%\)/.exec(r.reason);
        expect(m, r.reason).not.toBeNull();
        expect(included.has(m?.[1] ?? ''), r.reason).toBe(true);
        expect(Number(m?.[2])).toBeGreaterThanOrEqual(98);
      }
    }
    expect(included.size).toBe(catalog.length);
    for (const e of catalog) expect(included.get(e.file.slice('scores/'.length))?.catalogId).toBe(e.id);
  });

  it(
    'is reproducible: regenerating from the inputs gives the committed catalog and inventory',
    async () => {
      const original = (globalThis as { DOMParser?: unknown }).DOMParser;
      (globalThis as { DOMParser?: unknown }).DOMParser = XmlDomParser;
      // Turns of the event loop while the catalog is generated. Without them the
      // whole library is one synchronous block of many seconds (over a minute
      // on a loaded machine), and the test runner's worker misses its own
      // messages and fails the run ("Timeout calling onTaskUpdate").
      let turns = 0;
      const counter = setInterval(() => turns++, 0);
      try {
        const result = await generateCatalog(defaultPaths(ROOT));
        clearInterval(counter);
        const scoreFiles = readdirSync(join(ROOT, 'public', 'scores')).filter((f) => f.endsWith('.mxl')).length;
        expect(turns).toBeGreaterThanOrEqual(scoreFiles);
        // The data checks (in-file labels, internal wording, ...) are clean.
        expect(result.problems).toEqual([]);
        expect(serialiseJson(result.catalog)).toBe(readFileSync(join(ROOT, 'src', 'catalog', 'catalog.json'), 'utf8'));
        expect(serialiseJson(result.inventory)).toBe(readFileSync(join(ROOT, 'catalog', 'inventory.json'), 'utf8'));
      } finally {
        clearInterval(counter);
        (globalThis as { DOMParser?: unknown }).DOMParser = original;
      }
    },
    300_000,
  );
});
