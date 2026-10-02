import type { CatalogEntry, PreparedScore, ScoreOverrides } from '../core/types';
import { ImportError } from '../core/xml';
import { loadSourceScore } from '../core/musicxml/parse';
import { prepareScore } from '../core/model/prepare';
import { getImportBytes, getImportMeta, isImportId } from '../storage/imports';
import type { ImportedPieceMeta } from '../storage/imports';
import catalogData from './catalog.json';

export interface LoadedPiece {
  id: string;
  kind: 'builtin' | 'import';
  title: string;
  arrangement: string | null;
  composer: string | null;
  /** builtin */
  entry?: CatalogEntry;
  /** import */
  importMeta?: ImportedPieceMeta;
  prepared: PreparedScore;
  /** builtin: resolved URL of the .mxl */
  fileUrl?: string;
}

/* ------------------------------------------------------------------------ */
/* Catalog                                                                   */
/* ------------------------------------------------------------------------ */

function normalizeEntry(raw: CatalogEntry): CatalogEntry {
  // The generator may write `overrides: null`; prepareScore expects undefined.
  const overrides: ScoreOverrides | null | undefined = raw.overrides;
  return overrides ? raw : { ...raw, overrides: undefined };
}

function isUsableEntry(v: unknown): v is CatalogEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.title === 'string' &&
    typeof e.file === 'string' &&
    typeof e.difficulty === 'object' &&
    e.difficulty !== null &&
    typeof e.stats === 'object' &&
    e.stats !== null
  );
}

let catalog: CatalogEntry[] | null = null;
let byId: Map<string, CatalogEntry> | null = null;

/** Entries from the generated catalog.json, in file order. */
export function getCatalog(): CatalogEntry[] {
  if (!catalog) {
    const raw: unknown = catalogData;
    catalog = Array.isArray(raw) ? raw.filter(isUsableEntry).map(normalizeEntry) : [];
  }
  return catalog;
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  if (!byId) byId = new Map(getCatalog().map((e) => [e.id, e]));
  return byId.get(id);
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

function baseUrl(): string {
  // import.meta.env is undefined outside Vite (e.g. Node scripts).
  const base = import.meta.env?.BASE_URL ?? './';
  return base.endsWith('/') ? base : `${base}/`;
}

/** Resolved URL of a built-in score file, honouring the site's base path (GitHub Pages subpath). */
export function builtinFileUrl(entry: Pick<CatalogEntry, 'file'>): string {
  const relative = baseUrl() + entry.file.replace(/^\/+/, '');
  const docBase = typeof document !== 'undefined' ? document.baseURI : undefined;
  return docBase ? new URL(relative, docBase).href : relative;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('The load was cancelled.', 'AbortError');
  }
}

export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError';
}

function prepare(bytes: Uint8Array, fileName: string, overrides?: ScoreOverrides): PreparedScore {
  try {
    return prepareScore(loadSourceScore(bytes, fileName), overrides);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new Error('This piece could not be read. The file may use something the app does not understand.', {
      cause: e,
    });
  }
}

async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('The piece could not be downloaded. Check your internet connection and try again.', {
      cause: e,
    });
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'The piece’s file was not found on this site. It may have been removed.'
        : 'The piece could not be downloaded right now. Please try again.',
    );
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error('The download was interrupted. Please try again.', { cause: e });
  }
}

function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

async function loadBuiltin(id: string, signal?: AbortSignal): Promise<LoadedPiece> {
  const entry = getCatalogEntry(id);
  if (!entry) throw new Error('This piece is not in the library. It may have been removed or renamed.');
  if (entry.readiness === 'unsupported') {
    const reason = entry.readinessReasons[0];
    throw new Error(reason ? `This piece can’t be used for practice. ${reason}` : 'This piece can’t be used for practice.');
  }
  const fileUrl = builtinFileUrl(entry);
  const bytes = await fetchBytes(fileUrl, signal);
  throwIfAborted(signal);
  const prepared = prepare(bytes, fileNameOf(entry.file), entry.overrides);
  return {
    id,
    kind: 'builtin',
    title: entry.title,
    arrangement: entry.arrangement || null,
    composer: entry.composer,
    entry,
    prepared,
    fileUrl,
  };
}

async function loadImported(id: string, signal?: AbortSignal): Promise<LoadedPiece> {
  const missing = 'This imported piece is no longer saved in this browser. It may have been deleted, or the browser’s data was cleared.';
  const importMeta = await getImportMeta(id);
  throwIfAborted(signal);
  if (!importMeta) throw new Error(missing);
  const bytes = await getImportBytes(id);
  throwIfAborted(signal);
  if (!bytes) throw new Error(missing);
  const prepared = prepare(bytes, importMeta.fileName);
  const arranger = prepared.meta.arranger?.trim();
  return {
    id,
    kind: 'import',
    title: importMeta.title,
    arrangement: arranger ? `Arranged by ${arranger}` : null,
    composer: importMeta.composer,
    importMeta,
    prepared,
  };
}

/**
 * Fetches (BASE_URL + entry.file) or reads IndexedDB, parses and prepares the
 * score (with the catalog entry's overrides). Throws ImportError or Error with
 * a plain-language message; an aborted load rejects with an AbortError.
 */
export async function loadPiece(id: string, signal?: AbortSignal): Promise<LoadedPiece> {
  throwIfAborted(signal);
  // Yield once so a caller that aborts synchronously (e.g. a remounting effect) skips the parse.
  await Promise.resolve();
  throwIfAborted(signal);
  const piece = isImportId(id) ? await loadImported(id, signal) : await loadBuiltin(id, signal);
  throwIfAborted(signal);
  return piece;
}
