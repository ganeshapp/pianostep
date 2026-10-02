/**
 * Reproducible built-in catalog generator (brief §14). Run with `npm run catalog`.
 *
 * Inputs:  public/scores/*.mxl, catalog/metadata.json, catalog/difficulty.json (optional)
 * Outputs: src/catalog/catalog.json, catalog/inventory.json, docs/CATALOG_REPORT.md
 *
 * Every output is a pure function of the inputs (no clock, no network), so a
 * re-run on unchanged inputs produces byte-identical files.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import type {
  CatalogEntry,
  Difficulty,
  DifficultyInfo,
  InventoryRow,
  KeyPress,
  PreparedScore,
  Readiness,
  ScoreOverrides,
  SourceScore,
  WarningCode,
} from '../src/core/types';
import { midiToLabel } from '../src/core/pitch';
import { tickToSeconds } from '../src/core/model/tempo';
import { prepareScore } from '../src/core/model/prepare';
import { childElements, firstChild, nameOf, normalizeSpace, textOf } from '../src/core/musicxml/dom';
import { isKeyboardPart } from '../src/core/instruments';

/* ------------------------------------------------------------------------ */
/* Constants                                                                 */
/* ------------------------------------------------------------------------ */

export const LIBRARY_REPO = 'https://github.com/musetrainer/library';
export const LIBRARY_COMMIT = '9128876f6164d96997c877a2be843349a32bdabb';
/** Note-content similarity at or above which the weaker copy is left out. */
export const DUPLICATE_THRESHOLD = 0.98;
/** Note-content similarity from which two kept files are flagged as near-copies. */
export const SIMILAR_THRESHOLD = 0.9;
export const MAX_NOTES = 6;
export const ANOTHER_EDITION = ' (another edition)';

export const UNRATED: DifficultyInfo = {
  level: 'Unrated',
  basis: 'none',
  note: 'No public difficulty label found for this arrangement.',
};

const LEVELS: readonly Difficulty[] = ['Beginner', 'Intermediate', 'Advanced', 'Unrated'];
const BASES: readonly DifficultyInfo['basis'][] = ['source', 'in-file', 'estimated', 'none'];
const STATUSES: readonly InventoryRow['status'][] = ['included', 'duplicate', 'unsupported', 'non-solo-piano', 'review'];

/* ------------------------------------------------------------------------ */
/* Input records                                                             */
/* ------------------------------------------------------------------------ */

/** One curated record of catalog/metadata.json. */
export interface CuratedMetadata {
  file: string;
  id: string;
  title: string;
  composer: string | null;
  arrangement: string;
  attribution: string;
  rightsInFile: string | null;
  licenseNote: string | null;
  suspectedDuplicateOf: string | null;
  overrides: CuratedOverrides | null;
  notes: string[];
}

/**
 * The overrides of one metadata.json record. `reason` is shown in the app, so it
 * is written for the player; `evidence` is the curator's technical record (part
 * ids, clefs, other files) and stays in the report, never in catalog.json.
 */
export type CuratedOverrides = ScoreOverrides & { evidence?: string };

/** A catalog/difficulty.json record: DifficultyInfo plus an optional arrangement page. */
export type DifficultyRecord = DifficultyInfo & { arrangementUrl?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optString(rec: Record<string, unknown>, key: string, where: string): string | null {
  const v = rec[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new Error(`${where}: "${key}" must be a string or null`);
  return v;
}

function reqString(rec: Record<string, unknown>, key: string, where: string): string {
  const v = optString(rec, key, where);
  if (v === null || v.trim() === '') throw new Error(`${where}: "${key}" is required`);
  return v;
}

function isHand(v: unknown): v is 'R' | 'L' {
  return v === 'R' || v === 'L';
}

/**
 * Validates one `overrides` object of metadata.json: the app ignores a malformed
 * rule silently (it may come from an old cache), so the build rejects it here.
 */
function checkOverrides(o: Record<string, unknown>, where: string): void {
  for (const key of ['reason', 'evidence']) optString(o, key, where);
  const known = new Set(['reason', 'evidence', 'excludeParts', 'staffHands', 'voiceHands']);
  for (const key of Object.keys(o)) if (!known.has(key)) throw new Error(`${where}: unknown key "${key}"`);
  if (o.excludeParts !== undefined) {
    if (!Array.isArray(o.excludeParts) || o.excludeParts.some((p) => typeof p !== 'string' || p.trim() === '')) {
      throw new Error(`${where}: "excludeParts" must be a list of part ids`);
    }
  }
  if (o.staffHands !== undefined) {
    if (!isRecord(o.staffHands)) throw new Error(`${where}: "staffHands" must be an object`);
    for (const [key, hand] of Object.entries(o.staffHands)) {
      if (!/^.+:\d+$/.test(key)) throw new Error(`${where}: staffHands key "${key}" must be "<part id>:<staff>"`);
      if (!isHand(hand)) throw new Error(`${where}: staffHands["${key}"] must be "R" or "L"`);
    }
  }
  if (o.voiceHands !== undefined) {
    if (!Array.isArray(o.voiceHands)) throw new Error(`${where}: "voiceHands" must be a list`);
    o.voiceHands.forEach((rule: unknown, i: number) => {
      const at = `${where}.voiceHands[${i}]`;
      if (!isRecord(rule)) throw new Error(`${at} must be an object`);
      for (const key of Object.keys(rule)) {
        if (!['part', 'voice', 'hand', 'measures'].includes(key)) throw new Error(`${at}: unknown key "${key}"`);
      }
      if (typeof rule.part !== 'string' || rule.part.trim() === '') throw new Error(`${at}: "part" must be a part id`);
      if (typeof rule.voice !== 'string' || rule.voice.trim() === '') throw new Error(`${at}: "voice" must be a voice as written, such as "1"`);
      if (!isHand(rule.hand)) throw new Error(`${at}: "hand" must be "R" or "L"`);
      if (rule.measures !== undefined) {
        const ranges = rule.measures;
        const ok =
          Array.isArray(ranges) &&
          ranges.length > 0 &&
          ranges.every(
            (r: unknown) =>
              Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[0] <= r[1],
          );
        if (!ok) throw new Error(`${at}: "measures" must be a non-empty list of [first, last] 0-based measure indexes, first <= last`);
      }
    });
  }
}

/** Validates catalog/metadata.json. Throws on malformed records or repeated files/ids. */
export function parseMetadata(json: unknown): CuratedMetadata[] {
  if (!Array.isArray(json)) throw new Error('catalog/metadata.json must be an array');
  const files = new Set<string>();
  const ids = new Set<string>();
  return json.map((raw, i) => {
    if (!isRecord(raw)) throw new Error(`metadata[${i}] must be an object`);
    const where = `metadata[${i}]`;
    const file = reqString(raw, 'file', where);
    const id = reqString(raw, 'id', `${where} (${file})`);
    if (files.has(file)) throw new Error(`metadata lists ${file} twice`);
    if (ids.has(id)) throw new Error(`metadata uses the id ${id} twice`);
    files.add(file);
    ids.add(id);
    const notes = raw.notes ?? [];
    if (!Array.isArray(notes) || notes.some((n) => typeof n !== 'string')) {
      throw new Error(`${where} (${file}): "notes" must be a list of strings`);
    }
    const overrides = raw.overrides ?? null;
    if (overrides !== null && !isRecord(overrides)) throw new Error(`${where} (${file}): "overrides" must be an object or null`);
    if (overrides !== null) checkOverrides(overrides, `${where} (${file}).overrides`);
    return {
      file,
      id,
      title: reqString(raw, 'title', `${where} (${file})`),
      composer: optString(raw, 'composer', where),
      arrangement: reqString(raw, 'arrangement', `${where} (${file})`),
      attribution: reqString(raw, 'attribution', `${where} (${file})`),
      rightsInFile: optString(raw, 'rightsInFile', where),
      licenseNote: optString(raw, 'licenseNote', where),
      suspectedDuplicateOf: optString(raw, 'suspectedDuplicateOf', where),
      overrides: overrides as CuratedOverrides | null,
      notes: (notes as string[]).map((n) => n.trim()).filter((n) => n !== ''),
    };
  });
}

/**
 * Validates catalog/difficulty.json (an object keyed by file name). Invalid
 * levels or bases throw; softer gaps are returned as problems for the report.
 */
export function parseDifficulty(json: unknown): { records: Record<string, DifficultyRecord>; problems: string[] } {
  if (!isRecord(json)) throw new Error('catalog/difficulty.json must be an object keyed by file name');
  const records: Record<string, DifficultyRecord> = {};
  const problems: string[] = [];
  for (const file of Object.keys(json).sort(byString)) {
    if (file.startsWith('$')) continue;
    const raw = json[file];
    const where = `difficulty.json["${file}"]`;
    if (!isRecord(raw)) throw new Error(`${where} must be an object`);
    const level = raw.level;
    const basis = raw.basis;
    if (typeof level !== 'string' || !(LEVELS as readonly string[]).includes(level)) {
      throw new Error(`${where}: level must be one of ${LEVELS.join(', ')}`);
    }
    if (typeof basis !== 'string' || !(BASES as readonly string[]).includes(basis)) {
      throw new Error(`${where}: basis must be one of ${BASES.join(', ')}`);
    }
    const rec: DifficultyRecord = { level: level as Difficulty, basis: basis as DifficultyInfo['basis'] };
    for (const key of ['originalLabel', 'sourceName', 'sourceUrl', 'checkedOn', 'note', 'arrangementUrl'] as const) {
      const v = optString(raw, key, where);
      if (v !== null && v.trim() !== '') rec[key] = v.trim();
    }
    if ((rec.level === 'Unrated') !== (rec.basis === 'none')) {
      throw new Error(`${where}: "Unrated" goes with basis "none" and only with it`);
    }
    if (rec.basis === 'source' && (!rec.sourceUrl || !rec.originalLabel)) {
      problems.push(`${file}: difficulty basis "source" without a source URL or original label.`);
    }
    if (rec.checkedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(rec.checkedOn)) {
      problems.push(`${file}: difficulty checkedOn "${rec.checkedOn}" is not an ISO date (YYYY-MM-DD).`);
    }
    records[file] = rec;
  }
  return { records, problems };
}

/** The DifficultyInfo stored in the catalog (the arrangement page lives in originalSourceUrl). */
export function difficultyFor(rec: DifficultyRecord | undefined): DifficultyInfo {
  if (!rec) return { ...UNRATED };
  const out: DifficultyInfo = { level: rec.level, basis: rec.basis };
  if (rec.originalLabel !== undefined) out.originalLabel = rec.originalLabel;
  if (rec.sourceName !== undefined) out.sourceName = rec.sourceName;
  if (rec.sourceUrl !== undefined) out.sourceUrl = rec.sourceUrl;
  if (rec.checkedOn !== undefined) out.checkedOn = rec.checkedOn;
  if (rec.note !== undefined) out.note = rec.note;
  return out;
}

/**
 * Basis "in-file" claims the score itself states the level (the app shows
 * "per score" and "The arrangement's own sheet music names this level"), so
 * the original label must appear in the score's own title, subtitle or
 * credit text. A word found only in the file name or in an upload's title is
 * a discovery hint (§14), not a label, and such a record is reported.
 */
export function inFileLabelProblem(
  file: string,
  rec: DifficultyRecord | undefined,
  source: Pick<SourceScore, 'title' | 'subtitle' | 'credits'>,
): string | null {
  if (!rec || rec.basis !== 'in-file') return null;
  const label = fold(normalizeSpace(rec.originalLabel ?? '')).trim();
  if (label === '') return `${file}: difficulty basis "in-file" without the original label the score states.`;
  const texts = [source.title, source.subtitle, ...source.credits]
    .filter((t): t is string => typeof t === 'string')
    .map((t) => fold(normalizeSpace(t)));
  if (texts.some((t) => t.includes(label))) return null;
  return (
    `${file}: difficulty basis "in-file" names the label "${rec.originalLabel}", but the score's title and credits ` +
    'do not contain it. A word only in the file name or upload title is a hint, not a label: use "Unrated" or cite a source.'
  );
}

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

/** Locale-independent ordering, so output never depends on the machine's ICU data. */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function slugFromFileName(file: string): string {
  return fold(file.replace(/\.mxl$/i, ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function upstreamUrl(file: string): string {
  return `${LIBRARY_REPO}/blob/${LIBRARY_COMMIT}/scores/${encodeURIComponent(file)}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/* ------------------------------------------------------------------------ */
/* Content fingerprint and similarity                                        */
/* ------------------------------------------------------------------------ */

export type Fingerprint = ReadonlyMap<string, number>;
export type FingerprintPress = Pick<KeyPress, 'hand' | 'midi' | 'startTick' | 'endTick'>;

/** Exact quarter-note position as a reduced fraction, so files with different tick resolutions compare equal. */
function quarters(tick: number, ticksPerQuarter: number): string {
  const g = gcd(tick, ticksPerQuarter) || 1;
  return `${tick / g}/${ticksPerQuarter / g}`;
}

/** Multiset of presses as (hand, key, start, end) with times in quarter notes. */
export function fingerprint(presses: readonly FingerprintPress[], ticksPerQuarter: number): Map<string, number> {
  const fp = new Map<string, number>();
  for (const p of presses) {
    const key = `${p.hand}|${p.midi}|${quarters(p.startTick, ticksPerQuarter)}|${quarters(p.endTick, ticksPerQuarter)}`;
    fp.set(key, (fp.get(key) ?? 0) + 1);
  }
  return fp;
}

/** Multiset Jaccard similarity: shared presses / presses in either file. Empty files are never similar. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  let shared = 0;
  let total = 0;
  for (const [key, x] of a) {
    const y = b.get(key) ?? 0;
    shared += Math.min(x, y);
    total += Math.max(x, y);
  }
  for (const [key, y] of b) if (!a.has(key)) total += y;
  return total === 0 ? 0 : shared / total;
}

/** "100%" only for identical note content; otherwise rounded down to 0.1 so near-copies never read as 100%. */
export function formatSimilarity(s: number): string {
  if (s >= 1) return '100%';
  return `${(Math.floor(s * 1000 + 1e-9) / 10).toFixed(1)}%`;
}

/* ------------------------------------------------------------------------ */
/* Raw MusicXML facts the parsed score does not carry                        */
/* ------------------------------------------------------------------------ */

export interface PartListEntry {
  id: string;
  name: string;
  instrumentNames: string[];
  sounds: string[];
  midiPrograms: number[];
}

/** Reads <part-list>/<score-part> declarations. */
export function readPartList(doc: Document): PartListEntry[] {
  const partList = firstChild(doc.documentElement, 'part-list');
  if (!partList) return [];
  const out: PartListEntry[] = [];
  for (const sp of childElements(partList)) {
    if (nameOf(sp) !== 'score-part') continue;
    const entry: PartListEntry = {
      id: sp.getAttribute('id') ?? '',
      name: normalizeSpace(textOf(firstChild(sp, 'part-name'))),
      instrumentNames: [],
      sounds: [],
      midiPrograms: [],
    };
    for (const c of childElements(sp)) {
      if (nameOf(c) === 'score-instrument') {
        const n = normalizeSpace(textOf(firstChild(c, 'instrument-name')));
        if (n) entry.instrumentNames.push(n);
        const s = normalizeSpace(textOf(firstChild(c, 'instrument-sound')));
        if (s) entry.sounds.push(s);
      } else if (nameOf(c) === 'midi-instrument') {
        const p = Number(normalizeSpace(textOf(firstChild(c, 'midi-program'))));
        if (Number.isInteger(p) && p > 0) entry.midiPrograms.push(p);
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * A part is a piano by its name, its MusicXML sound id, or a General MIDI piano
 * program (1–8). The same rule as the app's hand assignment (`isKeyboardPart`).
 */
export function isPianoPart(p: PartListEntry): boolean {
  return isKeyboardPart(p);
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function isMuseScoreUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'musescore.com' || host.endsWith('.musescore.com');
  } catch {
    return false;
  }
}

/**
 * First MuseScore URL in the score's <identification>, verbatim, looking at
 * <source> first, then <relation>, then miscellaneous fields, then the rest.
 */
export function findMuseScoreUrl(doc: Document): string | null {
  const ident = firstChild(doc.documentElement, 'identification');
  if (!ident) return null;
  const order = ['source', 'relation', 'miscellaneous'];
  const rank = (el: Element): number => {
    const i = order.indexOf(nameOf(el));
    return i < 0 ? order.length : i;
  };
  const fields = childElements(ident)
    .sort((a, b) => rank(a) - rank(b))
    .flatMap((el) => (nameOf(el) === 'miscellaneous' ? childElements(el) : [el]));
  for (const field of fields) {
    for (const m of textOf(field).matchAll(URL_PATTERN)) {
      const url = m[0].replace(/[).,;]+$/, '');
      if (isMuseScoreUrl(url)) return url;
    }
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Credits completeness (used only to pick which duplicate to keep)          */
/* ------------------------------------------------------------------------ */

export interface CreditInfo {
  /** How many of title, composer, arranger credit and source link the file itself states (0–4). */
  facts: number;
  /** Distinct credit lines printed on the score. */
  lines: number;
  /** The file carries a rights statement. */
  rights: boolean;
}

const ARRANGER_WORD = /\b(arr|arranged|arrangement|arranger|transcribed|transcription)\b/i;

export function creditInfo(
  source: Pick<SourceScore, 'title' | 'composer' | 'arranger' | 'rights' | 'credits'>,
  curatedComposer: string | null,
  hasSourceLink: boolean,
): CreditInfo {
  const lines = [...new Set(source.credits.map((c) => fold(normalizeSpace(c))).filter((c) => c !== ''))];
  const family = curatedComposer ? fold(curatedComposer.replace(/\(.*?\)/g, '')).trim().split(/\s+/).pop() ?? '' : '';
  const hasTitle = Boolean(source.title?.trim()) || lines.length > 0;
  const hasComposer = Boolean(source.composer?.trim()) || (family.length > 1 && lines.some((l) => l.includes(family)));
  const hasArranger = Boolean(source.arranger?.trim()) || source.credits.some((c) => ARRANGER_WORD.test(c));
  return {
    facts: [hasTitle, hasComposer, hasArranger, hasSourceLink].filter(Boolean).length,
    lines: lines.length,
    rights: Boolean(source.rights?.trim()),
  };
}

/* ------------------------------------------------------------------------ */
/* Status assignment                                                         */
/* ------------------------------------------------------------------------ */

export interface Candidate {
  file: string;
  id: string;
  /** The file has a curated metadata.json record (required to be listed). */
  hasMetadata: boolean;
  /** Plain message when the file could not be read at all. */
  importError: string | null;
  hasPiano: boolean;
  partNames: string[];
  readiness: Readiness | null;
  readinessReasons: string[];
  fingerprint: Fingerprint;
  credit: CreditInfo;
  /**
   * catalog/difficulty.json gives this file a level other than Unrated. This
   * says a label is recorded, not that it was verified: verification lives in
   * docs/dev/difficulty-research-raw.json and is checked by the tests.
   */
  rated?: boolean;
}

export interface Decision {
  file: string;
  id: string;
  status: InventoryRow['status'];
  reason: string;
  duplicateOf?: { file: string; similarity: number; why: string };
  /** Other kept files with similar (0.90–0.98) note content. */
  similarTo: { file: string; similarity: number }[];
}

const READINESS_ORDER: Record<Readiness, number> = { ready: 0, review: 1, unsupported: 2 };

/**
 * Which copy to keep, best first: has curated metadata, ready over review,
 * has a difficulty label, fuller credits, an explicit rights
 * statement, then file name. Near-identical copies share their notes, so
 * keeping the labelled one preserves the label without transferring it.
 */
export function comparePreference(a: Candidate, b: Candidate): number {
  return (
    Number(b.hasMetadata) - Number(a.hasMetadata) ||
    READINESS_ORDER[a.readiness ?? 'unsupported'] - READINESS_ORDER[b.readiness ?? 'unsupported'] ||
    Number(b.rated ?? false) - Number(a.rated ?? false) ||
    b.credit.facts - a.credit.facts ||
    b.credit.lines - a.credit.lines ||
    Number(b.credit.rights) - Number(a.credit.rights) ||
    byString(a.file, b.file)
  );
}

function whyKept(kept: Candidate, dropped: Candidate): string {
  if (kept.hasMetadata !== dropped.hasMetadata) return 'it has curated catalog details';
  if (kept.readiness !== dropped.readiness) return 'it is ready to practise and this copy needs review';
  if (Boolean(kept.rated) !== Boolean(dropped.rated)) return 'it has a difficulty label and this copy is Unrated';
  if (kept.credit.facts !== dropped.credit.facts || kept.credit.lines !== dropped.credit.lines) return 'it has fuller credits';
  if (kept.credit.rights !== dropped.credit.rights) return 'it has an explicit rights statement';
  return 'both copies are equally complete, so the first file name alphabetically is kept';
}

function includedReason(c: Candidate): string {
  if (c.readiness === 'review') return `Included, marked "Needs review": ${c.readinessReasons.join(' ')}`;
  return 'Included: ready to practise.';
}

/**
 * Assigns every file one inventory status. Duplicates are found by note
 * content only (never by title): files are visited best-first, and a file
 * whose notes match an already kept file at ≥ 0.98 is a duplicate of the
 * most similar kept file. Returned in id order.
 */
export function assignStatuses(candidates: readonly Candidate[]): Decision[] {
  const decisions = new Map<string, Decision>();
  const eligible: Candidate[] = [];
  for (const c of candidates) {
    const base = { file: c.file, id: c.id, similarTo: [] };
    if (c.importError !== null) {
      decisions.set(c.file, { ...base, status: 'unsupported', reason: `The file cannot be read: ${c.importError}` });
    } else if (!c.hasPiano) {
      const parts = c.partNames.filter((n) => n !== '').join(', ') || 'unnamed parts';
      decisions.set(c.file, { ...base, status: 'non-solo-piano', reason: `No piano part in this file (parts: ${parts}).` });
    } else if (c.readiness === 'unsupported' || c.readiness === null) {
      decisions.set(c.file, {
        ...base,
        status: 'unsupported',
        reason: `Can't be used: ${c.readinessReasons.join(' ') || 'there is nothing to play.'}`,
      });
    } else {
      eligible.push(c);
    }
  }

  const kept: Candidate[] = [];
  for (const c of [...eligible].sort(comparePreference)) {
    let best: { other: Candidate; s: number } | null = null;
    for (const k of kept) {
      const s = similarity(c.fingerprint, k.fingerprint);
      if (s >= DUPLICATE_THRESHOLD && (best === null || s > best.s)) best = { other: k, s };
    }
    if (best) {
      const why = whyKept(best.other, c);
      decisions.set(c.file, {
        file: c.file,
        id: c.id,
        status: 'duplicate',
        reason: `Same notes as ${best.other.file} (similarity ${formatSimilarity(best.s)}). That copy is kept because ${why}.`,
        duplicateOf: { file: best.other.file, similarity: best.s, why },
        similarTo: [],
      });
      continue;
    }
    kept.push(c);
    decisions.set(c.file, {
      file: c.file,
      id: c.id,
      status: c.hasMetadata ? 'included' : 'review',
      reason: c.hasMetadata
        ? includedReason(c)
        : 'Awaiting review: the file has no record in catalog/metadata.json yet (title, arrangement and credits are needed before it can be listed).',
      similarTo: [],
    });
  }

  const included = kept.filter((c) => decisions.get(c.file)?.status === 'included');
  for (let i = 0; i < included.length; i++) {
    for (let j = i + 1; j < included.length; j++) {
      const s = similarity(included[i].fingerprint, included[j].fingerprint);
      if (s < SIMILAR_THRESHOLD) continue;
      const di = decisions.get(included[i].file);
      const dj = decisions.get(included[j].file);
      if (!di || !dj) continue;
      di.similarTo.push({ file: included[j].file, similarity: s });
      dj.similarTo.push({ file: included[i].file, similarity: s });
    }
  }
  for (const d of decisions.values()) {
    d.similarTo.sort((a, b) => b.similarity - a.similarity || byString(a.file, b.file));
    if (d.status === 'included' && d.similarTo.length > 0) {
      const list = d.similarTo.map((o) => `${o.file} (similarity ${formatSimilarity(o.similarity)})`).join(', ');
      d.reason += ` Similar to ${list}, but kept as a separate edition.`;
    }
  }
  return [...decisions.values()].sort((a, b) => byString(a.id, b.id) || byString(a.file, b.file));
}

/* ------------------------------------------------------------------------ */
/* Arrangement lines                                                         */
/* ------------------------------------------------------------------------ */

/** Removes the curator's "another copy" marker when the copy it referred to is no longer listed. */
export function stripAnotherCopy(arrangement: string): string {
  return arrangement
    .replace(/\s*\(another copy\)/gi, '')
    .replace(/\(another copy[,;]\s*/gi, '(')
    .replace(/,?\s*another copy\b/gi, '')
    .trim();
}

export interface ArrangementInput {
  file: string;
  arrangement: string;
  suspectedDuplicateOf: string | null;
}

/**
 * Final arrangement line per included file:
 * - "another copy" is dropped when no listed file is the other copy;
 * - near-copies (0.90–0.98) with identical lines get " (another edition)" on
 *   all but the preferred one, so the two list rows can be told apart.
 * `preferred` lists included files best-first.
 */
export function resolveArrangements(
  inputs: readonly ArrangementInput[],
  decisions: readonly Decision[],
  preferred: readonly string[],
): Map<string, string> {
  const byFile = new Map(decisions.map((d) => [d.file, d]));
  const isIncluded = (file: string | null): boolean => file !== null && byFile.get(file)?.status === 'included';
  const lines = new Map<string, string>();
  for (const e of inputs) {
    const d = byFile.get(e.file);
    if (!d || d.status !== 'included') continue;
    const hasListedTwin = isIncluded(e.suspectedDuplicateOf) || d.similarTo.length > 0;
    lines.set(e.file, /another copy/i.test(e.arrangement) && !hasListedTwin ? stripAnotherCopy(e.arrangement) : e.arrangement);
  }
  const rank = new Map(preferred.map((f, i) => [f, i]));
  const marked = new Set<string>();
  for (const d of decisions) {
    if (d.status !== 'included') continue;
    for (const o of d.similarTo) {
      const a = lines.get(d.file);
      const b = lines.get(o.file);
      if (a === undefined || b === undefined || fold(a.trim()) !== fold(b.trim())) continue;
      const ra = rank.get(d.file) ?? Infinity;
      const rb = rank.get(o.file) ?? Infinity;
      marked.add(ra < rb || (ra === rb && byString(d.file, o.file) < 0) ? o.file : d.file);
    }
  }
  for (const file of marked) lines.set(file, `${lines.get(file) ?? ''}${ANOTHER_EDITION}`);
  return lines;
}

/* ------------------------------------------------------------------------ */
/* Entry building                                                            */
/* ------------------------------------------------------------------------ */

type StatsSource = Pick<PreparedScore, 'source' | 'measures' | 'presses' | 'tempo' | 'endTick' | 'range'>;

export function scoreStats(p: StatsSource): CatalogEntry['stats'] {
  return {
    measures: p.source.measures.length,
    performanceMeasures: p.measures.length,
    notes: p.presses.length,
    durationSec: Math.round(tickToSeconds(p.tempo, p.endTick) * 10) / 10,
    lowest: p.range ? midiToLabel(p.range.min) : null,
    highest: p.range ? midiToLabel(p.range.max) : null,
    // Only written when true, so the duration is labelled as the app's default speed.
    ...(p.tempo.defaulted ? { tempoDefaulted: true } : {}),
  };
}

export interface DerivedNote {
  text: string;
  /** Skipped when a curated note already says the same thing. */
  coveredBy: RegExp;
}

const WARNING_NOTES: [WarningCode, DerivedNote][] = [
  ['grace-notes-approximated', { text: 'Grace notes are approximated', coveredBy: /grace notes? (are|is) (approximated|played)/i }],
  ['ornament-not-played', { text: 'Trills and other ornaments are played as the main note', coveredBy: /as the main note/i }],
  ['alternative-part-excluded', { text: 'An alternative version of some notes is left out', coveredBy: /left out/i }],
  ['extra-parts-excluded', { text: 'Extra instrument parts are left out', coveredBy: /left out/i }],
  ['arpeggio-not-rolled', { text: 'Rolled chords are played as plain chords', coveredBy: /plain chords/i }],
  ['tremolo-not-expanded', { text: 'Tremolos are played as one held note', coveredBy: /tremolo/i }],
  ['glissando-not-played', { text: 'Glissandos are played as their first and last notes only', coveredBy: /glissando|slide/i }],
  ['cue-notes-played', { text: 'Small cue notes written out as a cadenza are played', coveredBy: /cadenza|cue notes\b.*\bare played/i }],
  ['cue-notes-skipped', { text: 'Small cue notes that repeat or decorate other notes are not played', coveredBy: /cue notes\b.*\bnot played/i }],
  ['no-tempo-in-file', { text: 'No tempo is written in the file, so a default speed is used', coveredBy: /default (speed|tempo)/i }],
  [
    'opening-tempo-defaulted',
    { text: 'The opening has no tempo mark, so it plays at a default speed until the first marked tempo', coveredBy: /default (speed|tempo)/i },
  ],
  ['pedal-not-modelled', { text: 'Pedal marks are not turned into held notes', coveredBy: /pedal/i }],
  ['octave-text-not-applied', { text: 'An octave shift written in words (such as "8va") is not applied', coveredBy: /\b(8va|8vb|15ma|ottava)\b/i }],
  ['silent-notes-played', { text: 'Notes the file marks as silent are played at the loudness around them', coveredBy: /marks? as silent|silent notes/i }],
];

/** Short plain-language notes about how the app plays this file, most useful first. */
export function derivedNotes(p: Pick<PreparedScore, 'source' | 'measures' | 'warnings'>): DerivedNote[] {
  const codes = new Set(p.warnings.map((w) => w.code));
  const out: DerivedNote[] = [];
  const unrolled = p.measures.length !== p.source.measures.length || p.measures.some((o) => o.pass > 1);
  if (unrolled && !codes.has('repeats-unsupported') && !codes.has('jump-unsupported')) {
    const jumps = p.source.measures.some((m) => m.daCapo || m.dalSegno);
    out.push({
      text: jumps ? 'Repeats and D.C./D.S. jumps are followed' : 'Repeats are followed',
      coveredBy: /repeats?\b.*\b(followed|played)/i,
    });
  }
  for (const [code, note] of WARNING_NOTES) if (codes.has(code)) out.push(note);
  return out;
}

/** A curated note that names another score file would leak a file name into the app (§16). */
export const FILE_REFERENCE = /[\w.'()-]+\.mxl\b/i;

/**
 * Curator shorthand that must not reach text the app shows (§16: no internal
 * IDs): MusicXML part ids such as P1 or "P1:1", score file names, and remarks
 * about "the file name".
 */
export const INTERNAL_WORDING: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\bP\d+\b/, what: 'an internal part id (P1, P2, ...)' },
  { pattern: /[\w.'()-]+\.(mxl|musicxml)\b/i, what: 'a score file name' },
  { pattern: /\bfile ?names?\b/i, what: 'the words "file name"' },
];

/** What internal wording `text` contains (empty when it reads as plain language). */
export function internalWording(text: string | null | undefined): string[] {
  if (!text) return [];
  return INTERNAL_WORDING.filter((w) => w.pattern.test(text)).map((w) => w.what);
}

/**
 * Data-check messages for curated text in the catalog that the app shows to the
 * player (the library card, "About this arrangement", the difficulty details).
 */
export function wordingProblems(entries: readonly CatalogEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const fields: [string, string | null | undefined, string][] = [
      ['title', e.title, 'metadata.json'],
      ['composer', e.composer, 'metadata.json'],
      ['arrangement', e.arrangement, 'metadata.json'],
      ['attribution', e.attribution, 'metadata.json'],
      ['licenseNote', e.licenseNote, 'metadata.json'],
      ['overrides.reason', e.overrides?.reason, 'metadata.json'],
      ...e.notes.map((n, i): [string, string, string] => [`notes[${i}]`, n, 'metadata.json']),
      ['difficulty note', e.difficulty.note, 'difficulty.json'],
      ['difficulty source name', e.difficulty.sourceName, 'difficulty.json'],
    ];
    for (const [field, text, input] of fields) {
      const found = internalWording(text);
      if (found.length) {
        out.push(`${e.id}: the ${field} shown in the app mentions ${found.join(' and ')}; reword it in plain language in ${input}.`);
      }
    }
  }
  return out;
}

/** The overrides as the app needs them: the curator's evidence stays out of catalog.json. */
function appOverrides(o: CuratedOverrides): ScoreOverrides {
  const { evidence: _evidence, ...rest } = o;
  return rest;
}

/**
 * Curated notes first (minus ones naming other files), then extra notes, then
 * derived notes not already covered; case-insensitive de-duplication, at most 6.
 */
export function mergeNotes(
  curated: readonly string[],
  extra: readonly string[],
  derived: readonly DerivedNote[],
): { notes: string[]; dropped: string[] } {
  const dropped = curated.filter((n) => FILE_REFERENCE.test(n));
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (n: string): void => {
    const key = fold(n.trim()).replace(/[.\s]+$/, '');
    if (key === '' || seen.has(key) || notes.length >= MAX_NOTES) return;
    seen.add(key);
    notes.push(n.trim());
  };
  for (const n of curated) if (!FILE_REFERENCE.test(n)) push(n);
  for (const n of extra) push(n);
  for (const d of derived) if (!notes.some((n) => d.coveredBy.test(n))) push(d.text);
  return { notes, dropped };
}

export function similarEditionNote(s: number): string {
  return `Another edition in this library has nearly the same notes (${formatSimilarity(s)} match)`;
}

export interface EntryInput {
  meta: CuratedMetadata;
  prepared: PreparedScore;
  difficulty?: DifficultyRecord;
  museScoreUrl?: string | null;
  /** Final arrangement line (defaults to the curated one). */
  arrangement?: string;
  /** Extra plain notes placed after the curated ones. */
  extraNotes?: string[];
}

/** One catalog entry. Keys are always written in the same order. */
export function buildEntry(input: EntryInput): { entry: CatalogEntry; droppedNotes: string[] } {
  const { meta, prepared } = input;
  const { notes, dropped } = mergeNotes(meta.notes, input.extraNotes ?? [], derivedNotes(prepared));
  const originalSourceUrl = input.difficulty?.arrangementUrl ?? input.museScoreUrl ?? undefined;
  const entry: CatalogEntry = {
    id: meta.id,
    title: meta.title,
    composer: meta.composer,
    arrangement: input.arrangement ?? meta.arrangement,
    file: `scores/${meta.file}`,
    upstreamUrl: upstreamUrl(meta.file),
    ...(originalSourceUrl ? { originalSourceUrl } : {}),
    rightsInFile: prepared.source.rights,
    attribution: meta.attribution,
    ...(meta.licenseNote ? { licenseNote: meta.licenseNote } : {}),
    difficulty: difficultyFor(input.difficulty),
    readiness: prepared.readiness,
    readinessReasons: [...prepared.readinessReasons],
    ...(meta.overrides ? { overrides: appOverrides(meta.overrides) } : {}),
    stats: scoreStats(prepared),
    notes,
  };
  return { entry, droppedNotes: dropped };
}

/* ------------------------------------------------------------------------ */
/* Whole-library generation                                                  */
/* ------------------------------------------------------------------------ */

export interface CatalogPaths {
  root: string;
  scoresDir: string;
  metadata: string;
  difficulty: string;
  catalogJson: string;
  inventoryJson: string;
  report: string;
}

export function defaultPaths(root: string = resolve(fileURLToPath(import.meta.url), '..', '..')): CatalogPaths {
  return {
    root,
    scoresDir: join(root, 'public', 'scores'),
    metadata: join(root, 'catalog', 'metadata.json'),
    difficulty: join(root, 'catalog', 'difficulty.json'),
    catalogJson: join(root, 'src', 'catalog', 'catalog.json'),
    inventoryJson: join(root, 'catalog', 'inventory.json'),
    report: join(root, 'docs', 'CATALOG_REPORT.md'),
  };
}

interface FileAnalysis {
  file: string;
  id: string;
  meta: CuratedMetadata | null;
  prepared: PreparedScore | null;
  error: string | null;
  parts: PartListEntry[];
  museScoreUrl: string | null;
  candidate: Candidate;
}

export interface CatalogSummary {
  files: number;
  byStatus: Record<InventoryRow['status'], number>;
  ready: number;
  review: number;
  byLevel: Record<Difficulty, number>;
  byBasis: Record<DifficultyInfo['basis'], number>;
}

export interface GeneratedCatalog {
  catalog: CatalogEntry[];
  inventory: InventoryRow[];
  report: string;
  summary: CatalogSummary;
  problems: string[];
}

export function serialiseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** CATALOG_DATE, else the latest difficulty check date, else unrecorded — never the clock. */
export function catalogDate(envDate: string | undefined, difficulty: Record<string, DifficultyRecord>): { date: string; from: string } {
  if (envDate && envDate.trim()) return { date: envDate.trim(), from: 'CATALOG_DATE' };
  const dates = Object.values(difficulty)
    .map((d) => d.checkedOn)
    .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort(byString);
  if (dates.length) return { date: dates[dates.length - 1], from: 'latest difficulty check date in catalog/difficulty.json' };
  return { date: 'not recorded', from: 'set CATALOG_DATE=YYYY-MM-DD to record one' };
}

/**
 * Reads every input and returns the three outputs as data. Needs a global
 * DOMParser (installed by main() in Node; jsdom provides one in tests).
 */
/** A real turn of the event loop (timers and I/O run), not just a microtask. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateCatalog(paths: CatalogPaths, env: { CATALOG_DATE?: string } = {}): Promise<GeneratedCatalog> {
  const { loadSourceScore } = await import('../src/core/musicxml/parse');
  const { extractMusicXmlText } = await import('../src/core/mxl');
  const { parseXmlSafely } = await import('../src/core/xml');

  const problems: string[] = [];
  const metadata = parseMetadata(JSON.parse(readFileSync(paths.metadata, 'utf8')));
  const metaByFile = new Map(metadata.map((m) => [m.file, m]));
  const difficultyExists = existsSync(paths.difficulty);
  const difficulty = difficultyExists
    ? parseDifficulty(JSON.parse(readFileSync(paths.difficulty, 'utf8')))
    : { records: {}, problems: [] };
  problems.push(...difficulty.problems);

  const files = readdirSync(paths.scoresDir)
    .filter((f) => f.toLowerCase().endsWith('.mxl'))
    .sort(byString);
  const fileSet = new Set(files);
  for (const m of metadata) {
    if (!fileSet.has(m.file)) problems.push(`metadata.json describes ${m.file}, which is not in public/scores.`);
    if (m.suspectedDuplicateOf && !fileSet.has(m.suspectedDuplicateOf)) {
      problems.push(`${m.file}: suspectedDuplicateOf names ${m.suspectedDuplicateOf}, which is not in public/scores.`);
    }
  }
  for (const key of Object.keys(difficulty.records)) {
    if (!fileSet.has(key)) problems.push(`difficulty.json has a record for ${key}, which is not in public/scores.`);
  }

  const analyses: FileAnalysis[] = [];
  for (const file of files) {
    // One file at a time, with a turn of the event loop in between: the whole
    // library is many seconds of work, and a caller (the test runner) must
    // never be starved of its own messages for that long.
    await breathe();
    const meta = metaByFile.get(file) ?? null;
    const id = meta?.id ?? slugFromFileName(file);
    if (meta && meta.id !== slugFromFileName(file)) {
      problems.push(`${file}: curated id "${meta.id}" differs from the file-name slug "${slugFromFileName(file)}".`);
    }
    let prepared: PreparedScore | null = null;
    let error: string | null = null;
    let parts: PartListEntry[] = [];
    let museScoreUrl: string | null = null;
    try {
      const bytes = new Uint8Array(readFileSync(join(paths.scoresDir, file)));
      const doc = parseXmlSafely(extractMusicXmlText(bytes, file));
      parts = readPartList(doc);
      museScoreUrl = findMuseScoreUrl(doc);
      prepared = prepareScore(loadSourceScore(bytes, file), meta?.overrides ?? undefined);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const source = prepared?.source;
    const labelProblem = source ? inFileLabelProblem(file, difficulty.records[file], source) : null;
    if (labelProblem) problems.push(labelProblem);
    if (meta && source && (meta.rightsInFile ?? null) !== (source.rights ?? null)) {
      problems.push(
        `${file}: metadata rightsInFile ${JSON.stringify(meta.rightsInFile)} differs from the file's rights text ${JSON.stringify(source.rights)}; the file's text is used.`,
      );
    }
    const candidate: Candidate = {
      file,
      id,
      hasMetadata: meta !== null,
      importError: error,
      hasPiano: parts.some(isPianoPart),
      partNames: parts.map((p) => p.name),
      readiness: prepared?.readiness ?? null,
      readinessReasons: prepared?.readinessReasons ?? [],
      fingerprint: prepared ? fingerprint(prepared.presses, prepared.source.ticksPerQuarter) : new Map(),
      credit: source
        ? creditInfo(source, meta?.composer ?? null, museScoreUrl !== null)
        : { facts: 0, lines: 0, rights: false },
      rated: difficultyFor(difficulty.records[file]).level !== 'Unrated',
    };
    analyses.push({ file, id, meta, prepared, error, parts, museScoreUrl, candidate });
  }
  await breathe();

  const ids = new Map<string, string>();
  for (const a of analyses) {
    const other = ids.get(a.id);
    if (other) throw new Error(`${a.file} and ${other} would share the catalog id "${a.id}"`);
    ids.set(a.id, a.file);
  }

  const decisions = assignStatuses(analyses.map((a) => a.candidate));
  const decisionByFile = new Map(decisions.map((d) => [d.file, d]));
  for (const d of decisions) {
    const mine = difficulty.records[d.file];
    if (!d.duplicateOf || !mine || mine.level === 'Unrated') continue;
    const kept = difficulty.records[d.duplicateOf.file];
    if (kept?.level === mine.level) continue;
    problems.push(
      `${d.file} has a difficulty label (${mine.level}, basis ${mine.basis}) but is left out as a duplicate of ` +
        `${d.duplicateOf.file}, which is ${kept?.level ?? 'Unrated'}. Labels belong to one arrangement, so it is not transferred.`,
    );
  }
  const preferred = analyses
    .map((a) => a.candidate)
    .filter((c) => decisionByFile.get(c.file)?.status === 'included')
    .sort(comparePreference)
    .map((c) => c.file);
  const arrangements = resolveArrangements(
    analyses.flatMap((a) => (a.meta ? [{ file: a.file, arrangement: a.meta.arrangement, suspectedDuplicateOf: a.meta.suspectedDuplicateOf }] : [])),
    decisions,
    preferred,
  );

  const catalog: CatalogEntry[] = [];
  const droppedNotes: { file: string; note: string }[] = [];
  for (const a of analyses) {
    const d = decisionByFile.get(a.file);
    if (d?.status !== 'included' || !a.meta || !a.prepared) continue;
    const { entry, droppedNotes: dropped } = buildEntry({
      meta: a.meta,
      prepared: a.prepared,
      difficulty: difficulty.records[a.file],
      museScoreUrl: a.museScoreUrl,
      arrangement: arrangements.get(a.file),
      extraNotes: d.similarTo.length ? [similarEditionNote(d.similarTo[0].similarity)] : [],
    });
    catalog.push(entry);
    for (const note of dropped) droppedNotes.push({ file: a.file, note });
  }
  catalog.sort((x, y) => byString(x.id, y.id));
  problems.push(...wordingProblems(catalog));

  const inventory: InventoryRow[] = decisions.map((d) => ({
    file: d.file,
    status: d.status,
    ...(d.status === 'included' ? { catalogId: d.id } : {}),
    reason: d.reason,
  }));

  const summary = summarise(files.length, decisions, catalog);
  const date = catalogDate(env.CATALOG_DATE, difficulty.records);
  const report = renderReport({
    date,
    difficultyExists,
    analyses,
    decisions,
    catalog,
    arrangements,
    difficulty: difficulty.records,
    droppedNotes,
    problems,
    summary,
  });
  return { catalog, inventory, report, summary, problems };
}

function summarise(files: number, decisions: readonly Decision[], catalog: readonly CatalogEntry[]): CatalogSummary {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<InventoryRow['status'], number>;
  for (const d of decisions) byStatus[d.status]++;
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Difficulty, number>;
  const byBasis = Object.fromEntries(BASES.map((b) => [b, 0])) as Record<DifficultyInfo['basis'], number>;
  for (const e of catalog) {
    byLevel[e.difficulty.level]++;
    byBasis[e.difficulty.basis]++;
  }
  return {
    files,
    byStatus,
    ready: catalog.filter((e) => e.readiness === 'ready').length,
    review: catalog.filter((e) => e.readiness === 'review').length,
    byLevel,
    byBasis,
  };
}

/* ------------------------------------------------------------------------ */
/* Report                                                                    */
/* ------------------------------------------------------------------------ */

interface ReportInput {
  date: { date: string; from: string };
  difficultyExists: boolean;
  analyses: readonly FileAnalysis[];
  decisions: readonly Decision[];
  catalog: readonly CatalogEntry[];
  arrangements: ReadonlyMap<string, string>;
  difficulty: Record<string, DifficultyRecord>;
  droppedNotes: readonly { file: string; note: string }[];
  problems: readonly string[];
  summary: CatalogSummary;
}

function cell(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '—';
  return text.replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/\|/g, '\\|');
}

function link(label: string, url: string): string {
  return `[${label.replace(/[[\]]/g, '').replace(/\|/g, '\\|')}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')})`;
}

function code(file: string): string {
  return `\`${file}\``;
}

const BASIS_LABEL: Record<DifficultyInfo['basis'], string> = {
  source: 'source',
  'in-file': 'per score',
  estimated: 'estimated',
  none: 'none',
};

const STATUS_LABEL: Record<InventoryRow['status'], string> = {
  included: 'included',
  duplicate: 'duplicate',
  unsupported: 'unsupported',
  'non-solo-piano': 'not solo piano',
  review: 'awaiting review',
};

function difficultyCell(info: DifficultyInfo): string {
  const parts = [info.level, BASIS_LABEL[info.basis]];
  if (info.originalLabel) parts.push(cell(`"${info.originalLabel}"`));
  if (info.sourceUrl) parts.push(link(info.sourceName ?? 'source', info.sourceUrl));
  else if (info.sourceName) parts.push(cell(info.sourceName));
  return parts.join(' · ');
}

function readinessCell(a: FileAnalysis): string {
  if (!a.prepared) return cell(a.error ? `cannot be read: ${a.error}` : null);
  if (a.prepared.readiness === 'ready') return 'ready';
  return cell(`${a.prepared.readiness}: ${a.prepared.readinessReasons.join(' ')}`);
}

function renderReport(r: ReportInput): string {
  const s = r.summary;
  const byFile = new Map(r.analyses.map((a) => [a.file, a]));
  const decisionByFile = new Map(r.decisions.map((d) => [d.file, d]));
  const entryById = new Map(r.catalog.map((e) => [e.id, e]));
  const out: string[] = [];
  const line = (...l: string[]): void => {
    out.push(...l);
  };

  line(
    '# Built-in catalog report',
    '',
    'Generated by `npm run catalog` (`scripts/build-catalog.ts`). Do not edit by hand: change',
    '`catalog/metadata.json` or `catalog/difficulty.json` and run the script again.',
    '',
    `- Catalog date: ${r.date.date} (${r.date.from}).`,
    `- Scores: ${s.files} files in \`public/scores/\`, copied unchanged from ${link('musetrainer/library', `${LIBRARY_REPO}/tree/${LIBRARY_COMMIT}/scores`)} at commit \`${LIBRARY_COMMIT}\`.`,
    '- Curated details (titles, credits, arrangement lines, rights notes, hand overrides): `catalog/metadata.json`.',
    `- Difficulty provenance: \`catalog/difficulty.json\`${r.difficultyExists ? '' : ' (not present yet, so every file is Unrated)'}.`,
    `- Outputs: \`src/catalog/catalog.json\` (${r.catalog.length} entries), \`catalog/inventory.json\` (${r.decisions.length} rows, one per file) and this report.`,
    '- Readiness, statistics and duplicate detection come from parsing each file with the app\'s own importer and',
    '  performance model, so the catalog matches what the app will play.',
    '',
    '## Summary',
    '',
    '| Files | Count |',
    '| --- | ---: |',
    `| Source files considered | ${s.files} |`,
    `| Included in the library | ${s.byStatus.included} |`,
    `| – ready to practise | ${s.ready} |`,
    `| – included but marked "Needs review" | ${s.review} |`,
    `| Duplicate (left out) | ${s.byStatus.duplicate} |`,
    `| Unsupported (left out) | ${s.byStatus.unsupported} |`,
    `| Not solo piano (left out) | ${s.byStatus['non-solo-piano']} |`,
    `| Awaiting review (left out) | ${s.byStatus.review} |`,
    '',
    'Difficulty of the included pieces:',
    '',
    '| Level | Pieces |',
    '| --- | ---: |',
    ...LEVELS.map((l) => `| ${l} | ${s.byLevel[l]} |`),
    '',
    '| Basis | Meaning | Pieces |',
    '| --- | --- | ---: |',
    `| source | An identifiable external classification of this exact arrangement | ${s.byBasis.source} |`,
    `| per score (in-file) | The score's own title or credits state the level | ${s.byBasis['in-file']} |`,
    `| estimated | App heuristic, shown as "Estimated" | ${s.byBasis.estimated} |`,
    `| none | No label found: Unrated | ${s.byBasis.none} |`,
    '',
  );

  const estimated = Object.entries(r.difficulty).filter(([, d]) => d.basis === 'estimated');
  line(
    '## How difficulty was sourced and mapped',
    '',
    '- Difficulty comes only from `catalog/difficulty.json`, one record per score file, researched while preparing the',
    '  catalog. The app never looks anything up online when the library opens.',
    '- Each label belongs to one specific arrangement (one file). A label is never copied from a composition\'s title',
    '  to other arrangements of the same piece.',
    '- A MuseScore score page whose level tag (at the end of its page title, after "Sheet Music for Piano (Solo)")',
    '  says "easy" maps to **Beginner** with basis `source`; the original label, the source name, the page URL and',
    '  the date checked are kept. Such a tag counts only after a verification pass has seen it again on the same',
    '  upload; a tag that could not be re-checked leaves the piece **Unrated**. The research and verification log is',
    '  `docs/dev/difficulty-research-raw.json`.',
    '- A third-party listing or rating of the same arrangement (a LaSolSheet page, PianoMetric, or a Scribd copy of the',
    '  MuseScore page), matched to the file by its arranger credits and, where the listing gives it, its length, maps to',
    '  the level it names, with basis `source`. It too counts only after a verification pass has read it again. Where',
    '  the listing page could not be opened directly, the level was read from search-engine copies of it; with no',
    '  reading at all the piece stays **Unrated**.',
    '- A level stated in the score file\'s own title, subtitle or credits (for example "Easy Ver." or "Intermediate")',
    '  maps to the level it states, with basis `in-file`; the app shows this as "Beginner · per score". `npm run catalog`',
    '  checks that the label really appears in the score and reports it under "Data checks" otherwise.',
    '- A word such as "easy" found only in a file name or in an upload\'s title, with no level tag or rating behind it,',
    '  is a discovery hint, not a rating (§14): such a piece is **Unrated**.',
    '- No label found, an inaccessible source, or a file missing from `difficulty.json` means **Unrated** (basis',
    '  `none`). Unrated never means Beginner.',
    estimated.length
      ? `- ${estimated.length} record(s) use basis \`estimated\`; the app labels them "Estimated" so they stay distinguishable from sourced labels.`
      : '- No heuristic estimates are used: no record has basis `estimated`, and no precise difficulty scores are invented.',
    '- Beginner labels are selection aids, not a promise that a piece is immediately playable.',
    '',
  );
  const mapping = new Map<string, { source: string; label: string; level: Difficulty; basis: string; files: string[] }>();
  for (const [file, d] of Object.entries(r.difficulty)) {
    if (d.basis === 'none') continue;
    const key = [d.sourceName ?? '', d.originalLabel ?? '', d.level, d.basis].join('\u0000');
    const row = mapping.get(key) ?? {
      source: d.sourceName ?? '—',
      label: d.originalLabel ?? '—',
      level: d.level,
      basis: BASIS_LABEL[d.basis],
      files: [],
    };
    row.files.push(file);
    mapping.set(key, row);
  }
  if (mapping.size) {
    line(
      'Labels recorded in `difficulty.json` and the level each maps to:',
      '',
      '| Source | Original label | Level | Basis | Records |',
      '| --- | --- | --- | --- | ---: |',
    );
    for (const row of [...mapping.values()].sort((a, b) => byString(a.source, b.source) || byString(a.label, b.label))) {
      line(`| ${cell(row.source)} | ${cell(row.label)} | ${row.level} | ${row.basis} | ${row.files.length} |`);
    }
    const namesLevel = (d: DifficultyRecord): boolean => {
      const label = (d.originalLabel ?? '').toLowerCase();
      return label.includes(d.level.toLowerCase()) || (d.level === 'Beginner' && /\beasy\b/.test(label));
    };
    const indirect = Object.entries(r.difficulty).filter(([, d]) => d.basis !== 'none' && !namesLevel(d));
    line('');
    if (indirect.length) {
      line('These labels do not name their level directly, so the mapping is a judgement:', '');
      for (const [file, d] of indirect) line(`- ${code(file)}: ${cell(d.originalLabel ?? '(no label)')} → ${d.level}`);
    } else {
      line('Every label either names its level (for example "Skill Level: Intermediate" → Intermediate) or says "easy" (→ Beginner).');
    }
    line('');
  } else {
    line('No difficulty labels are recorded yet, so every file is Unrated.', '');
  }

  const duplicates = r.decisions.filter((d) => d.duplicateOf);
  const similarPairs: { a: string; b: string; s: number }[] = [];
  for (const d of r.decisions) {
    for (const o of d.similarTo) if (byString(d.file, o.file) < 0) similarPairs.push({ a: d.file, b: o.file, s: o.similarity });
  }
  line(
    '## Duplicates',
    '',
    'Duplicates are found by note content, never by title. Each file\'s fingerprint is the multiset of its key presses',
    'in performance order (repeats unrolled) as (hand, key, start, end), with times in quarter notes so files with',
    'different internal resolutions compare exactly. Similarity is shared presses divided by presses in either file.',
    '',
    `- ${formatSimilarity(DUPLICATE_THRESHOLD)} or more (including identical): the weaker copy is left out. The copy kept is,`,
    '  in order of preference: ready over needs-review, a difficulty label (over Unrated), fuller credits in the file (title, composer, arranger and',
    '  source link stated; then more distinct credit lines), an explicit rights statement, then the first file name',
    '  alphabetically.',
    `- ${formatSimilarity(SIMILAR_THRESHOLD)} up to ${formatSimilarity(DUPLICATE_THRESHOLD)}: both stay in the library as separate editions. If their arrangement`,
    `  lines would be identical, the less preferred one gets "${ANOTHER_EDITION.trim()}".`,
    '',
  );
  if (duplicates.length) {
    line('| Left out | Same notes as (kept) | Similarity | Why that copy is kept |', '| --- | --- | ---: | --- |');
    for (const d of duplicates) {
      const dup = d.duplicateOf;
      if (!dup) continue;
      line(`| ${code(d.file)} | ${code(dup.file)} | ${formatSimilarity(dup.similarity)} | ${cell(dup.why)} |`);
    }
    line('');
  } else {
    line('No duplicates were found.', '');
  }
  if (similarPairs.length) {
    line('Near-copies kept as separate editions:', '', '| File | Similar file | Similarity | Arrangement lines |', '| --- | --- | ---: | --- |');
    for (const p of similarPairs) {
      line(`| ${code(p.a)} | ${code(p.b)} | ${formatSimilarity(p.s)} | ${cell(`"${r.arrangements.get(p.a) ?? ''}" / "${r.arrangements.get(p.b) ?? ''}"`)} |`);
    }
    line('');
  }
  const hints = r.analyses.filter((a) => a.meta?.suspectedDuplicateOf);
  if (hints.length) {
    line(
      'Cross-check of the curator\'s suspected duplicates (`suspectedDuplicateOf` in `metadata.json`) against the computed',
      'note similarity. The hints are not used to decide anything.',
      '',
      '| File | Curator suspects a copy of | Note similarity | Outcome |',
      '| --- | --- | ---: | --- |',
    );
    for (const a of hints) {
      const other = a.meta?.suspectedDuplicateOf ?? '';
      const b = byFile.get(other);
      const sim = b ? formatSimilarity(similarity(a.candidate.fingerprint, b.candidate.fingerprint)) : 'file missing';
      const da = decisionByFile.get(a.file);
      const db = decisionByFile.get(other);
      const outcome = `${STATUS_LABEL[da?.status ?? 'review']} / ${db ? STATUS_LABEL[db.status] : '—'}`;
      line(`| ${code(a.file)} | ${code(other)} | ${sim} | ${outcome} |`);
    }
    line('');
  }

  line(
    '## Every source file',
    '',
    'Difficulty is shown as level · basis · original label · source. Readiness reasons are the plain messages the app shows.',
    '',
    '| File | Status | Title | Arrangement | Difficulty | Readiness | Rights in file | Licence note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const d of r.decisions) {
    const a = byFile.get(d.file);
    if (!a) continue;
    const entry = entryById.get(d.id);
    const title = a.meta?.title ?? (a.prepared ? a.prepared.meta.title : null);
    const arrangement = entry?.arrangement ?? a.meta?.arrangement ?? null;
    const info = entry?.difficulty ?? difficultyFor(r.difficulty[a.file]);
    line(
      `| ${link(a.file, upstreamUrl(a.file))} | ${STATUS_LABEL[d.status]} | ${cell(title)} | ${cell(arrangement)} | ${difficultyCell(info)} | ${readinessCell(a)} | ${cell(a.prepared?.source.rights ?? null)} | ${cell(a.meta?.licenseNote ?? null)} |`,
    );
  }
  line('');

  const leftOut = r.decisions.filter((d) => d.status !== 'included');
  line('Files left out of the library, with the reason recorded in `catalog/inventory.json`:', '');
  if (leftOut.length) for (const d of leftOut) line(`- ${code(d.file)} (${STATUS_LABEL[d.status]}): ${cell(d.reason)}`);
  else line('None.');
  line('');

  line('## Curated notes not shown in the app', '');
  if (r.droppedNotes.length) {
    line(
      'These `metadata.json` notes name other score files. File names are internal details, so the notes are left out',
      'of `catalog.json`. Rephrase them without file names in `metadata.json` to show them in the app.',
      '',
    );
    for (const d of r.droppedNotes) line(`- ${code(d.file)}: ${cell(d.note)}`);
  } else {
    line('None.');
  }
  line('');

  const overridden = r.analyses.filter((a) => a.meta?.overrides);
  line('## Hand overrides', '');
  if (overridden.length) {
    line(
      'Hand settings checked by the curator (`overrides` in `metadata.json`). The reason is shown in the app, so it is',
      'plain language without part ids or file names; the evidence is the curator\'s record and stays in this report.',
      '',
    );
    for (const a of overridden) {
      const o = a.meta?.overrides;
      if (!o) continue;
      const what: string[] = [];
      if (o.excludeParts?.length) what.push(`leaves out ${o.excludeParts.join(', ')}`);
      const hands = Object.entries(o.staffHands ?? {});
      if (hands.length) what.push(`hands ${hands.map(([k, h]) => `${k} → ${h}`).join(', ')}`);
      for (const v of o.voiceHands ?? []) {
        const where = v.measures?.length
          ? ` in measure indexes ${v.measures.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')} (0-based)`
          : '';
        what.push(`voice ${v.voice} of ${v.part} → ${v.hand}${where}`);
      }
      line(`- ${code(a.file)} (${STATUS_LABEL[decisionByFile.get(a.file)?.status ?? 'review']}): ${what.join('; ') || 'no change'}.`);
      line(`  - Shown in the app: ${cell(o.reason ?? null)}`);
      if (o.evidence) line(`  - Evidence: ${cell(o.evidence)}`);
    }
  } else {
    line('None.');
  }
  line('');

  line('## Data checks', '');
  if (r.problems.length) for (const p of r.problems) line(`- ${cell(p)}`);
  else line('No problems found in the inputs.');
  line('');

  const withRights = r.analyses.filter((a) => a.prepared?.source.rights);
  const noted = r.catalog.filter((e) => e.licenseNote);
  const linked = r.catalog.filter((e) => e.originalSourceUrl);
  line(
    '## Licensing caveats',
    '',
    '- The MIT licence of this repository covers the application code only. It does not license any musical',
    '  composition, arrangement or edition. Asset notices are in `THIRD_PARTY_NOTICES.md`.',
    '- The scores are copied unchanged from musetrainer/library. Each catalog entry keeps the rights text found in the',
    '  file verbatim, the attribution, and, where the curator found a concern, a licence note shown in the app\'s',
    '  "About this arrangement" panel.',
    `- ${withRights.length} of ${r.analyses.length} files contain rights text; ${r.analyses.length - withRights.length} contain none. A missing rights line does not`,
    '  make a file public domain, and a "public domain" line in a file is the uploader\'s statement, not a verified fact.',
    `- ${linked.length} of ${r.catalog.length} included entries link to their original publication page (taken from the file itself or from`,
    '  `difficulty.json`). Links are kept exactly as written in the file, so some point at older MuseScore addresses.',
    `- ${noted.length} included ${noted.length === 1 ? 'entry carries' : 'entries carry'} a licence note, mostly modern arrangements or compositions that are probably still`,
    '  under copyright even when the underlying tune is old:',
  );
  for (const e of noted) line(`  - ${cell(e.title)} (${code(e.file.replace(/^scores\//, ''))}): ${cell(e.licenseNote)}`);
  line(
    '- A GitHub Pages site is publicly reachable even when it is built for one person, so publishing it redistributes',
    '  these files. Before publishing, review the notes above and remove any file you are not comfortable',
    '  redistributing: delete it from `public/scores/` and its record from `catalog/metadata.json` (and',
    '  `catalog/difficulty.json`), then run `npm run catalog`.',
    '- These notes record what the files and the curated metadata say. They are not legal advice.',
    '',
  );
  return out.join('\n');
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

async function main(): Promise<void> {
  // src/core parses XML through the global DOMParser; Node has none.
  (globalThis as { DOMParser?: unknown }).DOMParser = XmlDomParser;
  const paths = defaultPaths();
  const result = await generateCatalog(paths, { CATALOG_DATE: process.env.CATALOG_DATE });
  writeFileSync(paths.catalogJson, serialiseJson(result.catalog));
  writeFileSync(paths.inventoryJson, serialiseJson(result.inventory));
  writeFileSync(paths.report, result.report);
  const s = result.summary;
  console.log(
    [
      `Catalog: ${result.catalog.length} entries from ${s.files} files`,
      `  included ${s.byStatus.included} (ready ${s.ready}, review ${s.review}), duplicate ${s.byStatus.duplicate},` +
        ` unsupported ${s.byStatus.unsupported}, non-solo-piano ${s.byStatus['non-solo-piano']}, awaiting review ${s.byStatus.review}`,
      `  difficulty: ${LEVELS.map((l) => `${l} ${s.byLevel[l]}`).join(', ')}`,
      `  basis: ${BASES.map((b) => `${b} ${s.byBasis[b]}`).join(', ')}`,
      ...result.problems.map((p) => `  check: ${p}`),
    ].join('\n'),
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
