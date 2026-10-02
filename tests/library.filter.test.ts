import { describe, expect, it } from 'vitest';
import type { CatalogEntry, Difficulty, DifficultyInfo, Readiness } from '../src/core/types';
import {
  DIFFICULTY_FILTERS,
  filterCatalog,
  matchesQuery,
  normalizeSearchText,
  sortEntries,
} from '../src/ui/library/filter';
import { countText, formatDuration, keyRangeText, measuresText, spokenDuration } from '../src/ui/library/format';
import { difficultyLabel, formatCheckedDate, safeExternalUrl } from '../src/ui/common/DifficultyBadge';

function entry(
  id: string,
  title: string,
  opts: {
    composer?: string | null;
    arrangement?: string;
    level?: Difficulty;
    basis?: DifficultyInfo['basis'];
    readiness?: Readiness;
  } = {},
): CatalogEntry {
  const level = opts.level ?? 'Unrated';
  return {
    id,
    title,
    composer: opts.composer === undefined ? null : opts.composer,
    arrangement: opts.arrangement ?? 'Original piano work',
    file: `scores/${id}.mxl`,
    upstreamUrl: `https://example.org/${id}.mxl`,
    rightsInFile: null,
    attribution: '',
    difficulty: { level, basis: opts.basis ?? (level === 'Unrated' ? 'none' : 'source') },
    readiness: opts.readiness ?? 'ready',
    readinessReasons: opts.readiness && opts.readiness !== 'ready' ? ['Some notes are approximated.'] : [],
    stats: { measures: 10, performanceMeasures: 10, notes: 40, durationSec: 60, lowest: 'C3', highest: 'G5' },
    notes: [],
  };
}

const CATALOG: CatalogEntry[] = [
  entry('fur-elise-easy', 'Für Elise', {
    composer: 'Ludwig van Beethoven',
    arrangement: 'Easy arrangement by Torby Brand',
    level: 'Beginner',
  }),
  entry('fur-elise', 'Für Elise', { composer: 'Ludwig van Beethoven', level: 'Intermediate', basis: 'in-file' }),
  entry('gymnopedie', 'Gymnopédie No. 1', { composer: 'Erik Satie', level: 'Intermediate' }),
  entry('mariage', 'Mariage d’Amour', { composer: 'Paul de Senneville', level: 'Intermediate', readiness: 'review' }),
  entry('campanella', 'La Campanella', {
    composer: 'Franz Liszt',
    arrangement: 'Grandes Études de Paganini No. 3',
    level: 'Advanced',
  }),
  entry('serenade', 'Ständchen (Serenade)', {
    composer: 'Franz Schubert',
    arrangement: 'Piano transcription by Liszt',
    readiness: 'unsupported',
  }),
  entry('minuet', 'Minuet in G Major', { composer: 'J. S. Bach', level: 'Beginner' }),
  entry('prelude', 'Prélude in E Minor, Op. 28 No. 4', { composer: 'Frédéric Chopin' }),
  entry('anon', 'Happy Birthday', { composer: null, level: 'Beginner', readiness: 'review' }),
];

const ids = (list: readonly CatalogEntry[]) => list.map((e) => e.id);

describe('normalizeSearchText', () => {
  it('drops accents and case', () => {
    expect(normalizeSearchText('Für Élise')).toBe('fur elise');
    expect(normalizeSearchText('GYMNOPÉDIE')).toBe('gymnopedie');
    expect(normalizeSearchText('Frédéric Chopin')).toBe('frederic chopin');
    expect(normalizeSearchText('Dvořák')).toBe('dvorak');
  });

  it('handles letters that do not decompose', () => {
    expect(normalizeSearchText('Ständchen Straße')).toBe('standchen strasse');
    expect(normalizeSearchText('Søren Łukasz')).toBe('soren lukasz');
  });

  it('drops apostrophes and turns other punctuation into spaces', () => {
    expect(normalizeSearchText('Mariage d’Amour')).toBe('mariage damour');
    expect(normalizeSearchText("Mariage d'Amour")).toBe('mariage damour');
    expect(normalizeSearchText('J. S. Bach')).toBe('j s bach');
    expect(normalizeSearchText('  Op.28/No.4 ')).toBe('op 28 no 4');
  });
});

describe('matchesQuery', () => {
  it('requires every word somewhere across the fields', () => {
    expect(matchesQuery(['Minuet in G Major', 'J. S. Bach'], 'bach minuet')).toBe(true);
    expect(matchesQuery(['Minuet in G Major', 'J. S. Bach'], 'bach waltz')).toBe(false);
    expect(matchesQuery(['Minuet', null, undefined], '')).toBe(true);
    expect(matchesQuery(['Minuet'], '   ')).toBe(true);
  });
});

describe('filterCatalog', () => {
  it('returns everything for an empty query, sorted by difficulty then title', () => {
    const r = filterCatalog(CATALOG, '', 'All', true);
    expect(ids(r.entries)).toEqual([
      'fur-elise-easy',
      'anon',
      'minuet',
      'fur-elise',
      'gymnopedie',
      'mariage',
      'campanella',
      'prelude',
      'serenade',
    ]);
    expect(r.counts).toEqual({ All: 9, Beginner: 3, Intermediate: 3, Advanced: 1, Unrated: 2 });
  });

  it('is accent-insensitive in both directions', () => {
    expect(ids(filterCatalog(CATALOG, 'fur elise', 'All', true).entries)).toEqual(['fur-elise-easy', 'fur-elise']);
    expect(ids(filterCatalog(CATALOG, 'FÜR', 'All', true).entries)).toEqual(['fur-elise-easy', 'fur-elise']);
    expect(ids(filterCatalog(CATALOG, 'gymnopedie', 'All', true).entries)).toEqual(['gymnopedie']);
    expect(ids(filterCatalog(CATALOG, 'Prélude', 'All', true).entries)).toEqual(['prelude']);
    expect(ids(filterCatalog(CATALOG, 'prelude', 'All', true).entries)).toEqual(['prelude']);
    expect(ids(filterCatalog(CATALOG, 'standchen', 'All', true).entries)).toEqual(['serenade']);
    expect(ids(filterCatalog(CATALOG, "mariage d'amour", 'All', true).entries)).toEqual(['mariage']);
  });

  it('searches composer and arrangement text as well as the title', () => {
    expect(ids(filterCatalog(CATALOG, 'satie', 'All', true).entries)).toEqual(['gymnopedie']);
    expect(ids(filterCatalog(CATALOG, 'torby', 'All', true).entries)).toEqual(['fur-elise-easy']);
    expect(ids(filterCatalog(CATALOG, 'liszt', 'All', true).entries)).toEqual(['campanella', 'serenade']);
    expect(ids(filterCatalog(CATALOG, 'beethoven easy', 'All', true).entries)).toEqual(['fur-elise-easy']);
    expect(filterCatalog(CATALOG, 'nothing like this', 'All', true).entries).toEqual([]);
  });

  it('filters by difficulty while the counts describe every chip', () => {
    const r = filterCatalog(CATALOG, '', 'Beginner', true);
    expect(ids(r.entries)).toEqual(['fur-elise-easy', 'anon', 'minuet']);
    expect(r.counts.All).toBe(9);
    expect(r.counts.Beginner).toBe(3);

    const unrated = filterCatalog(CATALOG, '', 'Unrated', true);
    expect(ids(unrated.entries)).toEqual(['prelude', 'serenade']);
  });

  it('counts reflect the search text', () => {
    const r = filterCatalog(CATALOG, 'fur elise', 'Advanced', true);
    expect(r.entries).toEqual([]);
    expect(r.counts).toEqual({ All: 2, Beginner: 1, Intermediate: 1, Advanced: 0, Unrated: 0 });
  });

  it('hides pieces that need review, and those that cannot be used, when asked', () => {
    const r = filterCatalog(CATALOG, '', 'All', false);
    expect(ids(r.entries)).not.toContain('mariage');
    expect(ids(r.entries)).not.toContain('anon');
    expect(ids(r.entries)).not.toContain('serenade');
    expect(r.counts).toEqual({ All: 6, Beginner: 2, Intermediate: 2, Advanced: 1, Unrated: 1 });
  });

  it('treats an unexpected level as Unrated', () => {
    const odd = { ...entry('odd', 'Odd'), difficulty: { level: 'Expert', basis: 'source' } } as unknown as CatalogEntry;
    const r = filterCatalog([odd], '', 'Unrated', true);
    expect(ids(r.entries)).toEqual(['odd']);
    expect(r.counts.Unrated).toBe(1);
  });

  it('does not modify its input', () => {
    const copy = [...CATALOG];
    filterCatalog(CATALOG, '', 'All', true);
    expect(CATALOG).toEqual(copy);
  });

  it('exposes the chip order', () => {
    expect(DIFFICULTY_FILTERS).toEqual(['All', 'Beginner', 'Intermediate', 'Advanced', 'Unrated']);
  });
});

describe('sortEntries', () => {
  it('orders titles naturally, ignoring case and accents', () => {
    const list = [
      entry('b', 'nocturne No. 20', { level: 'Advanced' }),
      entry('a', 'Nocturne No. 2', { level: 'Advanced' }),
      entry('c', 'Étude', { level: 'Advanced' }),
      entry('d', 'Air', { level: 'Beginner' }),
    ];
    expect(ids(sortEntries(list))).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('card text helpers', () => {
  it('formats lengths as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(92)).toBe('1:32');
    expect(formatDuration(605)).toBe('10:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(spokenDuration(92)).toBe('1 minute 32 seconds');
    expect(spokenDuration(120)).toBe('2 minutes');
    expect(spokenDuration(1)).toBe('1 second');
  });

  it('formats key ranges, measures and counts', () => {
    expect(keyRangeText('C3', 'G5')).toBe('C3–G5');
    expect(keyRangeText('C4', 'C4')).toBe('C4');
    expect(keyRangeText(null, 'G5')).toBeNull();
    expect(measuresText(1)).toBe('1 measure');
    expect(measuresText(24)).toBe('24 measures');
    expect(countText(1, 'piece')).toBe('1 piece');
    expect(countText(69, 'piece')).toBe('69 pieces');
  });

  it('labels difficulty with its basis qualifier', () => {
    expect(difficultyLabel({ level: 'Beginner', basis: 'source' })).toBe('Beginner');
    expect(difficultyLabel({ level: 'Beginner', basis: 'in-file' })).toBe('Beginner · per score');
    expect(difficultyLabel({ level: 'Advanced', basis: 'estimated' })).toBe('Advanced · estimated');
    expect(difficultyLabel({ level: 'Unrated', basis: 'none' })).toBe('Unrated');
    expect(difficultyLabel({ level: 'Unrated', basis: 'in-file' })).toBe('Unrated');
  });

  it('only renders http(s) source links', () => {
    expect(safeExternalUrl('https://musescore.com/user/1/scores/2')).toBe('https://musescore.com/user/1/scores/2');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,hi')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it('formats the checked date without time-zone drift', () => {
    expect(formatCheckedDate('2026-09-30')).toBe('30 September 2026');
    expect(formatCheckedDate('2026-01-01T00:00:00Z')).toBe('1 January 2026');
    expect(formatCheckedDate('last spring')).toBe('last spring');
    expect(formatCheckedDate(undefined)).toBeNull();
  });
});
