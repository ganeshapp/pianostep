/**
 * Difficulty labels in catalog/difficulty.json must agree with the research and
 * verification log in docs/dev/difficulty-research-raw.json (brief §14: a missing
 * or inaccessible classification means Unrated; §18.4: honest provenance).
 *
 * The log holds research passes ("research:*") and verification passes
 * ("verify:*", each with `verdicts`). Passes are applied in the order they
 * appear in the file, so a later verdict on a file replaces an earlier one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

interface Verdict {
  file: string;
  confirmed: boolean;
  level: string | null;
  reason: string;
}

interface Record {
  level: string;
  basis: string;
  sourceName?: string;
}

const log = JSON.parse(readFileSync(join(ROOT, 'docs', 'dev', 'difficulty-research-raw.json'), 'utf8')) as {
  [pass: string]: unknown;
};
const records = JSON.parse(readFileSync(join(ROOT, 'catalog', 'difficulty.json'), 'utf8')) as {
  [file: string]: Record;
};
const inventory = JSON.parse(readFileSync(join(ROOT, 'catalog', 'inventory.json'), 'utf8')) as {
  file: string;
  status: string;
  reason: string;
}[];

/** The latest verification verdict per file. */
const latest = new Map<string, Verdict & { pass: string }>();
for (const [pass, body] of Object.entries(log)) {
  if (!pass.startsWith('verify:')) continue;
  for (const v of (body as { verdicts: Verdict[] }).verdicts) latest.set(v.file, { ...v, pass });
}

const isLabelled = (r: Record | undefined): r is Record => r !== undefined && r.level !== 'Unrated';
const MUSESCORE_LEVEL_TAG = /^MuseScore score page \(level tag/;

/**
 * Sourced labels that no verification pass has looked at yet. This list may
 * only shrink: a new sourced label needs a verdict. It is empty now: the four
 * third-party labels from research batch 2 (Für Elise and Gymnopédie No. 1 on
 * LaSolSheet, Gnossienne No. 1 and Liebestraum No. 3 on Scribd) were re-checked
 * in the "verify:batch2" pass, which confirmed each at its recorded level.
 */
const AWAITING_VERIFICATION: string[] = [];

/**
 * Unrated files whose latest verdict "confirmed" a level only because of a
 * word in the file name or upload title ("easy piano", "_Easy"). The round-1
 * review ruled that such a word is a hint, not a rating (§14), so these stay
 * Unrated despite the verdict. Any other confirmed verdict must be reflected in
 * difficulty.json, or superseded by a later verdict that does not confirm it.
 */
const TITLE_HINT_ONLY = ['Carol_of_the_Bells_easy_piano.mxl', 'Nocturne_in_E-flat_Major_Op._9_No._2_Easy.mxl'];

/** Sourced labels with no verdict at all, read straight from the log. */
const unverifiedSourced = (): string[] =>
  Object.entries(records)
    .filter(([file, r]) => isLabelled(r) && r.basis === 'source' && !latest.has(file))
    .map(([file]) => file)
    .sort();

describe('difficulty labels against the verification log', () => {
  it('reads verification passes from the log', () => {
    expect(latest.size).toBeGreaterThan(0);
  });

  it('a label whose latest verification failed is not kept as a sourced label (failed or inaccessible means Unrated)', () => {
    const offending: string[] = [];
    for (const [file, v] of latest) {
      if (v.confirmed) continue;
      const r = records[file];
      if (!isLabelled(r)) continue;
      // The build checks "in-file" labels against the score's own text, so a
      // failed external check may fall back to the level the score states.
      if (r.basis === 'in-file' && v.level === r.level) continue;
      offending.push(`${file}: ${r.level} (${r.basis}) after "${v.pass}" did not confirm it`);
    }
    expect(offending).toEqual([]);
  });

  it('every MuseScore level-tag label was confirmed by a verification pass, with the same level', () => {
    const tagged = Object.entries(records).filter(([, r]) => isLabelled(r) && MUSESCORE_LEVEL_TAG.test(r.sourceName ?? ''));
    expect(tagged.length).toBeGreaterThan(0);
    for (const [file, r] of tagged) {
      const v = latest.get(file);
      expect(v?.confirmed, `${file} has no confirming verdict`).toBe(true);
      expect(v?.level, file).toBe(r.level);
    }
  });

  it('every other sourced label was confirmed too, apart from any listed backlog', () => {
    for (const [file, r] of Object.entries(records)) {
      if (!isLabelled(r) || r.basis !== 'source') continue;
      const v = latest.get(file);
      if (AWAITING_VERIFICATION.includes(file)) {
        expect(v, `${file} now has a verdict: take it off AWAITING_VERIFICATION`).toBeUndefined();
        continue;
      }
      expect(v?.confirmed, `${file} has no confirming verdict`).toBe(true);
      expect(v?.level, file).toBe(r.level);
    }
    for (const file of AWAITING_VERIFICATION) expect(records[file]?.basis, file).toBe('source');
  });

  it('a confirmed verdict is not dropped: the piece is not left Unrated as if no rating had been found', () => {
    // An Unrated piece is shown with "No published rating was found for this
    // arrangement", which is false when the log holds a confirmed rating for it.
    const dropped: string[] = [];
    for (const [file, v] of latest) {
      if (!v.confirmed || v.level === null || isLabelled(records[file])) continue;
      if (TITLE_HINT_ONLY.includes(file)) continue;
      dropped.push(`${file}: "${v.pass}" confirmed ${v.level}, but difficulty.json leaves it Unrated`);
    }
    expect(dropped).toEqual([]);
    for (const file of TITLE_HINT_ONLY) {
      expect(isLabelled(records[file]), `${file} has a label now: take it off TITLE_HINT_ONLY`).toBe(false);
    }
  });

  it('the README describes the re-check backlog as the log has it', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');
    const backlog = unverifiedSourced();
    if (backlog.length === 0) {
      const claim = /[^.]*\b(?:not been|never been|never) re-checked[^.]*\./i.exec(readme)?.[0] ?? null;
      expect(claim, 'README still says some labels were never re-checked').toBeNull();
    } else {
      for (const file of backlog) expect(readme, `README should name ${file} as not re-checked`).toContain(file);
    }
  });

  it('treats both copies of the Minuet in G (BWV Anh. 114) alike, so no label decides which copy is kept', () => {
    const a = records['Bach_Minuet_in_G_Major_BWV_Anh._114.mxl'];
    const b = records['Minuet_in_G_Major_Bach.mxl'];
    expect(a?.level ?? 'Unrated').toBe(b?.level ?? 'Unrated');
    const dropped = inventory.filter((row) => row.status === 'duplicate' && /Minuet/.test(row.file));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).not.toMatch(/difficulty label/);
  });

  it('never calls a difficulty label "verified" in the generated catalog files', () => {
    for (const path of [['catalog', 'inventory.json'], ['docs', 'CATALOG_REPORT.md'], ['scripts', 'build-catalog.ts']]) {
      expect(/verified difficulty label/i.test(readFileSync(join(ROOT, ...path), 'utf8')), path.join('/')).toBe(false);
    }
  });
});
