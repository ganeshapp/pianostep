import { clear, createStore, delMany, get, getMany, keys, setMany } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
import type { PreparedScore, Readiness, SourceScore } from '../core/types';
import { ImportError } from '../core/xml';
import { MXL_LIMITS } from '../core/mxl';
import { loadSourceScore } from '../core/musicxml/parse';
import { prepareScore } from '../core/model/prepare';
import { tickToSeconds } from '../core/model/tempo';
import { midiToLabel } from '../core/pitch';

/**
 * Pieces imported by the user, kept in IndexedDB (database "piano-steps",
 * store "imports"). Metadata and file bytes live under separate keys
 * (`meta:<id>`, `bytes:<id>`) so the library can list pieces without loading
 * every file.
 */

export interface ImportedPieceMeta {
  /** "local-<uuid>" */
  id: string;
  fileName: string;
  title: string;
  composer: string | null;
  /** ISO timestamp. */
  addedAt: string;
  sizeBytes: number;
  readiness: Readiness;
  readinessReasons: string[];
  /** Written (source) measure count. */
  measures: number;
  /** Whole-piece length at the file's tempo, repeats included. */
  durationSec: number;
  /** Lowest and highest key played, e.g. "C3" / "G5" (additive fields for the card stats). */
  lowest?: string | null;
  highest?: string | null;
  /**
   * True when the file gives no tempo, so `durationSec` is at the app's
   * default speed (additive; older records lack it).
   */
  tempoDefaulted?: boolean;
}

export type ImportStage = 'reading' | 'checking' | 'saving';

export interface ImportOptions {
  /** Called as the import moves through its stages, for progress display. */
  onProgress?: (stage: ImportStage) => void;
}

export const IMPORT_ID_PREFIX = 'local-';
const META_PREFIX = 'meta:';
const BYTES_PREFIX = 'bytes:';

const SAVE_FAILED =
  'The piece could not be saved in this browser. Private browsing or a full disk can prevent saving.';
const READ_STORAGE_FAILED =
  'Imported pieces could not be read from this browser’s storage. Private browsing can block it.';

export function isImportId(id: string): boolean {
  return id.startsWith(IMPORT_ID_PREFIX) && id.length > IMPORT_ID_PREFIX.length;
}

let storeInstance: UseStore | null = null;

function store(): UseStore {
  if (!storeInstance) storeInstance = createStore('piano-steps', 'imports');
  return storeInstance;
}

/** Runs an IndexedDB operation, turning any failure (including a missing IndexedDB) into a plain Error. */
async function guarded<T>(op: () => Promise<T>, message: string): Promise<T> {
  try {
    return await op();
  } catch (e) {
    throw new Error(message, { cause: e });
  }
}

/** Without IndexedDB nothing can have been stored, so listing and clearing are trivially empty. */
function indexedDbMissing(): boolean {
  return typeof indexedDB === 'undefined';
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // randomUUID needs a secure context; getRandomValues does not.
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newImportId(): string {
  return `${IMPORT_ID_PREFIX}${randomUuid()}`;
}

/** Reads a Blob's bytes; falls back to FileReader where Blob.arrayBuffer is missing. */
export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error('Unexpected file reader result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.(musicxml|xml|mxl)$/i, '').replace(/[_]+/g, ' ').trim();
}

/** Lets the browser paint progress before a long synchronous parse. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Parses and prepares score bytes, turning unexpected failures into a plain ImportError. */
export function parseScoreBytes(bytes: Uint8Array, fileName?: string): { source: SourceScore; prepared: PreparedScore } {
  try {
    const source = loadSourceScore(bytes, fileName);
    return { source, prepared: prepareScore(source) };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      'unsupported',
      'This file could not be read as a piano score.',
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** Builds the stored metadata for a validated import. Pure; exported for tests. */
export function buildImportMeta(
  id: string,
  fileName: string,
  sizeBytes: number,
  source: SourceScore,
  prepared: PreparedScore,
  addedAt: Date = new Date(),
): ImportedPieceMeta {
  const hasTitle = Boolean(source.title?.trim()) || prepared.meta.title !== 'Untitled';
  const durationSec = tickToSeconds(prepared.tempo, prepared.endTick);
  return {
    id,
    fileName,
    title: hasTitle ? prepared.meta.title : fileStem(fileName) || 'Untitled',
    composer: prepared.meta.composer,
    addedAt: addedAt.toISOString(),
    sizeBytes,
    readiness: prepared.readiness,
    readinessReasons: [...prepared.readinessReasons],
    measures: source.measures.length,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    lowest: prepared.range ? midiToLabel(prepared.range.min) : null,
    highest: prepared.range ? midiToLabel(prepared.range.max) : null,
    tempoDefaulted: prepared.tempo.defaulted,
  };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isMeta(v: unknown): v is ImportedPieceMeta {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    isImportId(m.id) &&
    typeof m.fileName === 'string' &&
    typeof m.title === 'string' &&
    (m.composer === null || typeof m.composer === 'string') &&
    typeof m.addedAt === 'string' &&
    typeof m.sizeBytes === 'number' &&
    (m.readiness === 'ready' || m.readiness === 'review' || m.readiness === 'unsupported') &&
    isStringArray(m.readinessReasons) &&
    typeof m.measures === 'number' &&
    typeof m.durationSec === 'number'
  );
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/** Imported pieces, newest first. Rejects with a plain-language Error when storage is unavailable. */
export async function listImports(): Promise<ImportedPieceMeta[]> {
  try {
    return await guarded(async () => {
      const all = await keys<IDBValidKey>(store());
      const metaKeys = all.filter((k): k is string => typeof k === 'string' && k.startsWith(META_PREFIX));
      if (metaKeys.length === 0) return [];
      const values = await getMany<unknown>(metaKeys, store());
      return values.filter(isMeta).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }, READ_STORAGE_FAILED);
  } catch (e) {
    if (indexedDbMissing()) return [];
    throw e;
  }
}

export async function getImportMeta(id: string): Promise<ImportedPieceMeta | null> {
  const v = await guarded(() => get<unknown>(`${META_PREFIX}${id}`, store()), READ_STORAGE_FAILED);
  return isMeta(v) ? v : null;
}

export async function getImportBytes(id: string): Promise<Uint8Array | null> {
  const v = await guarded(() => get<unknown>(`${BYTES_PREFIX}${id}`, store()), READ_STORAGE_FAILED);
  return toBytes(v);
}

/**
 * Validates and parses the file first (throws ImportError with a plain
 * message), then stores it. Files that parse but contain nothing playable are
 * rejected too, so only usable scores are kept.
 */
export async function importFile(file: File, options: ImportOptions = {}): Promise<ImportedPieceMeta> {
  const { onProgress } = options;
  if (file.size > MXL_LIMITS.maxUncompressedBytes) throw new ImportError('too-large');

  onProgress?.('reading');
  let bytes: Uint8Array;
  try {
    bytes = await readBlobBytes(file);
  } catch (e) {
    throw new ImportError(
      'unsupported',
      'The file could not be read. Try choosing it again.',
      e instanceof Error ? e.message : String(e),
    );
  }
  if (bytes.byteLength === 0) throw new ImportError('not-musicxml', 'The file is empty.');

  onProgress?.('checking');
  await nextFrame();
  const { source, prepared } = parseScoreBytes(bytes, file.name);
  if (prepared.readiness === 'unsupported') {
    const reason = prepared.readinessReasons[0];
    throw new ImportError(
      'empty-score',
      reason ? `This score can’t be used for practice. ${reason}` : 'This score can’t be used for practice.',
    );
  }

  onProgress?.('saving');
  const id = newImportId();
  const meta = buildImportMeta(id, file.name, bytes.byteLength, source, prepared);
  try {
    // One transaction, so a piece is never stored without its file or vice versa.
    await setMany(
      [
        [`${BYTES_PREFIX}${id}`, bytes],
        [`${META_PREFIX}${id}`, meta],
      ],
      store(),
    );
  } catch (e) {
    throw new ImportError('unsupported', SAVE_FAILED, e instanceof Error ? e.message : String(e));
  }
  return meta;
}

export async function deleteImport(id: string): Promise<void> {
  await guarded(
    () => delMany([`${META_PREFIX}${id}`, `${BYTES_PREFIX}${id}`], store()),
    'The piece could not be removed from this browser’s storage.',
  );
}

/** Removes every imported piece. */
export async function clearImports(): Promise<void> {
  try {
    await guarded(() => clear(store()), 'Imported pieces could not be removed from this browser’s storage.');
  } catch (e) {
    if (!indexedDbMissing()) throw e;
  }
}
