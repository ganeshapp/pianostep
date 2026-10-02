import type { CatalogEntry, Difficulty } from '../../core/types';

export type DifficultyFilter = 'All' | Difficulty;

/** Display and sort order of difficulty levels. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['Beginner', 'Intermediate', 'Advanced', 'Unrated'];
export const DIFFICULTY_FILTERS: readonly DifficultyFilter[] = ['All', ...DIFFICULTY_ORDER];

export interface FilterResult {
  /** Matching entries, sorted by difficulty order, then title. */
  entries: CatalogEntry[];
  /**
   * Per-chip counts for the current search text and review setting, ignoring
   * the selected difficulty, so each chip tells how many pieces it would show.
   */
  counts: Record<DifficultyFilter, number>;
}

/**
 * Lower-case, accents removed ("Für Élise" -> "fur elise"), apostrophes dropped
 * ("d'Amour" -> "damour") and other punctuation turned into spaces.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[æ]/g, 'ae')
    .replace(/[œ]/g, 'oe')
    .replace(/[ø]/g, 'o')
    .replace(/[đð]/g, 'd')
    .replace(/[ł]/g, 'l')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every word of the query must appear somewhere in the fields. */
export function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(fields.filter((f): f is string => typeof f === 'string').join(' '));
  return terms.every((t) => haystack.includes(t));
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  const byLevel = DIFFICULTY_ORDER.indexOf(levelOf(a)) - DIFFICULTY_ORDER.indexOf(levelOf(b));
  if (byLevel !== 0) return byLevel;
  return collator.compare(a.title, b.title) || collator.compare(a.arrangement, b.arrangement) || a.id.localeCompare(b.id);
}

export function sortEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort(compareEntries);
}

/** Level used for filtering and sorting; anything unexpected counts as Unrated. */
export function levelOf(entry: CatalogEntry): Difficulty {
  const level = entry.difficulty?.level;
  return DIFFICULTY_ORDER.includes(level) ? level : 'Unrated';
}

/** Hiding "pieces that need review" also hides pieces that can't be used at all. */
export function passesReadiness(readiness: CatalogEntry['readiness'], showReview: boolean): boolean {
  return showReview || readiness === 'ready';
}

export function filterCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  difficulty: DifficultyFilter,
  showReview: boolean,
): FilterResult {
  const counts: Record<DifficultyFilter, number> = { All: 0, Beginner: 0, Intermediate: 0, Advanced: 0, Unrated: 0 };
  const matching: CatalogEntry[] = [];
  for (const entry of entries) {
    if (!passesReadiness(entry.readiness, showReview)) continue;
    if (!matchesQuery([entry.title, entry.composer, entry.arrangement], query)) continue;
    const level = levelOf(entry);
    counts.All++;
    counts[level]++;
    if (difficulty === 'All' || difficulty === level) matching.push(entry);
  }
  return { entries: sortEntries(matching), counts };
}
