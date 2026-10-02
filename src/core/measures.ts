import type { SourceMeasure } from './types';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** Most letter suffixes one number may need ("12a" ... "12zz") before the measures are counted instead. */
const MAX_SUFFIXES = 2 * LETTERS.length;

/**
 * Readable measure numbers for display, one per written measure (§13, §16).
 * Every label is different, so a passage can always be chosen by its number.
 *
 * A measure number from the file is shown as written when it starts with a
 * digit ("12", "12a"). Some programs give measures they leave out of the
 * count an internal id instead, such as MuseScore's "X1" (usually with
 * implicit="yes"); such a measure is named after the numbered measure before
 * it with a letter, "19a", "19b", ..., or "0", "0a", ... before the first
 * numbered measure. A number the file has already given to an earlier measure
 * gets a letter too ("12", then "12a"). When every measure carries the same
 * number (an unmetered piece exported with "0" on each measure), the measures
 * are counted instead: "1", "2", "3", ... A measure without a number gets its
 * 1-based position.
 */
export function measureDisplayNumbers(measures: readonly Pick<SourceMeasure, 'number' | 'index'>[]): string[] {
  const written = measures.map((m) => m.number.trim());
  const filled = written.filter((n) => n !== '');
  if (filled.length > 1 && filled.every((n) => n === filled[0])) {
    return measures.map((m) => String(m.index + 1));
  }
  const used = new Set(written.filter((n) => /^\d/.test(n)));
  const shown = new Set<string>();
  /**
   * Per base, the first letter suffix not yet tried. Every earlier suffix of
   * that base is already in `used` (which only grows), so resuming there
   * gives the same labels as searching again from "a", in linear time: a
   * damaged file repeating a few numbers thousands of times stays fast.
   */
  const nextExtra = new Map<string | null, number>();
  let base: string | null = null;
  let tooMany = false;
  const labels = measures.map((m, k) => {
    const raw = written[k];
    if (raw === '') return String(m.index + 1);
    if (/^\d/.test(raw)) {
      base = raw;
      if (!shown.has(raw)) {
        shown.add(raw);
        return raw;
      }
    }
    let extra = nextExtra.get(base) ?? 0;
    let label: string;
    do {
      label = nextLabel(base, extra++);
    } while (used.has(label));
    nextExtra.set(base, extra);
    if (extra > MAX_SUFFIXES) tooMany = true;
    used.add(label);
    return label;
  });
  // Hundreds of measures sharing one number (a damaged file) would need labels
  // like "1zzzzzzzzzc": the measures are counted instead, as above.
  return tooMany ? measures.map((m) => String(m.index + 1)) : labels;
}

function nextLabel(base: string | null, k: number): string {
  if (base === null) return k === 0 ? '0' : `0${letters(k - 1)}`;
  return `${base}${letters(k)}`;
}

/** a, b, ..., z, za, zb, ... */
function letters(k: number): string {
  return 'z'.repeat(Math.floor(k / LETTERS.length)) + LETTERS[k % LETTERS.length];
}
