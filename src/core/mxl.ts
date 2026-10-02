import { Inflate, unzipSync } from 'fflate';
import { ImportError, decodeXmlBytes, looksLikeXml, parseXmlSafely } from './xml';

/**
 * Compressed MusicXML (.mxl) handling. A zip is recognised by its magic bytes,
 * never by the file extension; anything else is treated as XML text.
 */

export interface MxlLimits {
  /** Largest accepted archive, in bytes. */
  maxArchiveBytes: number;
  /** Largest accepted sum of the archive's declared uncompressed sizes; also caps plain XML files. */
  maxUncompressedBytes: number;
  /** Most entries an archive may contain. */
  maxEntries: number;
}

export const MXL_LIMITS: Readonly<MxlLimits> = Object.freeze({
  maxArchiveBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 60 * 1024 * 1024,
  maxEntries: 200,
});

const CONTAINER_PATH = 'META-INF/container.xml';

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** An entry as fflate lists it (the directory its size limits are checked against). */
interface EntryInfo {
  name: string;
  /** Declared uncompressed size. */
  originalSize: number;
  /** Declared compressed size. */
  size: number;
  /** Compression method. */
  compression: number;
}

function describe(fileName: string | undefined): string {
  return fileName ? `"${fileName}"` : 'The file';
}

/** Runs an fflate call, turning its exceptions into `bad-archive`. */
function guardZip<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('bad-archive', undefined, e instanceof Error ? e.message : String(e));
  }
}

/** Lists entries without inflating anything, enforcing count and size limits. */
function listEntries(bytes: Uint8Array, limits: MxlLimits): EntryInfo[] {
  const entries: EntryInfo[] = [];
  let total = 0;
  guardZip(() =>
    unzipSync(bytes, {
      filter: (f) => {
        entries.push({ name: f.name, originalSize: f.originalSize, size: f.size, compression: f.compression });
        total += f.originalSize;
        if (entries.length > limits.maxEntries) {
          throw new ImportError('too-large', `The compressed file contains more than ${limits.maxEntries} files.`);
        }
        if (total > limits.maxUncompressedBytes) {
          throw new ImportError('too-large', 'The compressed file expands to more data than the app can safely open.');
        }
        return false;
      },
    }),
  );
  return entries;
}

/* ------------------------------------------------------------------------ */
/* Reading entries (unzipSync trusts header sizes and skips checksums)      */
/* ------------------------------------------------------------------------ */

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One central-directory record, with where its data starts in the archive. */
interface DirectoryEntry {
  name: string;
  crc: number;
  method: number;
  compressedSize: number;
  originalSize: number;
  dataStart: number;
}

const ZIP64 = 0xffffffff;

/** Name bytes decoded the way fflate decodes them: UTF-8 when flagged, otherwise one byte per character. */
function entryName(bytes: Uint8Array, flags: number): string {
  if (flags & 0x800) return new TextDecoder().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * The central directory, read without inflating anything, in the order fflate
 * lists the entries. Zip64 sizes and offsets are read from their extra field,
 * and the entry count and directory offset from the zip64 end record when the
 * classic end record holds marker values there.
 * Returns null when the directory cannot be read or points outside the file,
 * or when the archive's end records describe more than one directory.
 */
function centralDirectory(bytes: Uint8Array): DirectoryEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let e = bytes.length - 22; e >= 0 && bytes.length - e <= 65558; e--) {
    if (view.getUint32(e, true) === 0x06054b50) {
      eocd = e;
      break;
    }
  }
  if (eocd < 0) return null;
  let count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 8, true) !== count) return null;
  // A writer that always uses zip64 (or a very large archive) leaves the
  // marker values 0xFFFF / 0xFFFFFFFF in the classic end record and gives the
  // real ones in the zip64 end record, which fflate then reads.
  const countMarker = count === 0xffff;
  const offsetMarker = p === ZIP64;
  let zip64 = false;
  // fflate lists the entries of the directory named by a zip64 end record
  // whenever one sits in front of the classic end record, and the size limits
  // are checked on that listing. A hostile archive can point the two records
  // at different directories (one declaring a small size, the other a huge
  // one), so wherever the classic record holds a real value, both must name
  // this same directory.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
    const z = view.getUint32(eocd - 12, true);
    if (z + 4 <= bytes.length && view.getUint32(z, true) === 0x06064b50) {
      if (z + 56 > bytes.length) return null;
      // fflate reads the low 32 bits of these 64-bit fields; anything larger is not a real .mxl.
      const count64 = view.getBigUint64(z + 32, true);
      const offset64 = view.getBigUint64(z + 48, true);
      if (count64 > BigInt(ZIP64) || offset64 > BigInt(ZIP64)) return null;
      if (!countMarker && Number(count64) !== count) return null;
      if (!offsetMarker && Number(offset64) !== p) return null;
      count = Number(count64);
      p = Number(offset64);
      zip64 = true;
    }
  }
  if (!zip64 && (countMarker || offsetMarker)) return null;
  const out: DirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return null;
    const flags = view.getUint16(p + 8, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    if (p + 46 + nameLength + extraLength > bytes.length) return null;
    let compressedSize = view.getUint32(p + 20, true);
    let originalSize = view.getUint32(p + 24, true);
    let local = view.getUint32(p + 42, true);
    if (compressedSize === ZIP64 || originalSize === ZIP64 || local === ZIP64) {
      // The 64-bit values follow in the zip64 extra field, in this order, for the fields that need them.
      let x = p + 46 + nameLength;
      const xEnd = x + extraLength;
      let found = false;
      while (x + 4 <= xEnd) {
        const id = view.getUint16(x, true);
        const size = view.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          const next = (): number | null => {
            if (q + 8 > x + 4 + size) return null;
            const v = view.getBigUint64(q, true);
            q += 8;
            return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
          };
          const u = originalSize === ZIP64 ? next() : originalSize;
          const c = compressedSize === ZIP64 ? next() : compressedSize;
          const o = local === ZIP64 ? next() : local;
          if (u === null || c === null || o === null) return null;
          [originalSize, compressedSize, local] = [u, c, o];
          found = true;
          break;
        }
        x += 4 + size;
      }
      if (!found) return null;
    }
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return null;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + compressedSize > bytes.length) return null;
    out.push({
      name: entryName(bytes.subarray(p + 46, p + 46 + nameLength), flags),
      crc: view.getUint32(p + 16, true),
      method: view.getUint16(p + 10, true),
      compressedSize,
      originalSize,
      dataStart,
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/** Compressed bytes fed to the inflater at a time; also bounds the work done past a lying size. */
const INFLATE_SLICE = 16 * 1024;

/**
 * Inflates raw DEFLATE data, stopping as soon as the output would pass
 * `limit` bytes. The sizes in a zip header are claims: a damaged or hostile
 * archive can declare a few bytes for data that inflates to gigabytes, and
 * inflating all of it first would freeze the page for minutes.
 */
function inflateBounded(data: Uint8Array, limit: number, name: string): Uint8Array {
  const out = new Uint8Array(limit);
  let n = 0;
  const inflater = new Inflate((chunk) => {
    if (n + chunk.length > limit) {
      throw new ImportError('bad-archive', undefined, `entry ${name} inflates past its stated size`);
    }
    out.set(chunk, n);
    n += chunk.length;
  });
  if (data.length === 0) inflater.push(data, true);
  for (let p = 0; p < data.length; p += INFLATE_SLICE) {
    inflater.push(data.subarray(p, p + INFLATE_SLICE), p + INFLATE_SLICE >= data.length);
  }
  return out.subarray(0, n);
}

/**
 * Reads one entry by name, never producing more than its declared size, and
 * verifies its length and checksum. The directory used here must agree with
 * fflate's listing (names, sizes and methods), because the size limits were
 * checked on that listing: a second directory could otherwise declare a far
 * larger size and have it allocated.
 */
function readEntry(bytes: Uint8Array, entries: EntryInfo[], name: string, limits: MxlLimits): Uint8Array {
  const dir = centralDirectory(bytes);
  const agrees = (e: DirectoryEntry, i: number): boolean =>
    e.name === entries[i].name &&
    e.originalSize === entries[i].originalSize &&
    e.compressedSize === entries[i].size &&
    e.method === entries[i].compression;
  if (!dir || dir.length !== entries.length || !dir.every(agrees)) {
    throw new ImportError('bad-archive', undefined, 'the list of files in the archive could not be read');
  }
  let index = -1;
  for (let i = 0; i < entries.length; i++) if (entries[i].name === name) index = i;
  if (index < 0) throw new ImportError('bad-archive', undefined, `entry ${name} could not be read`);
  const entry = dir[index];
  const raw = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) {
    if (entry.originalSize > limits.maxUncompressedBytes) {
      throw new ImportError('too-large', 'The compressed file expands to more data than the app can safely open.');
    }
    data = guardZip(() => inflateBounded(raw, entry.originalSize, name));
  }
  else throw new ImportError('bad-archive', undefined, `entry ${name} uses an unsupported compression method`);
  if (data.length !== entry.originalSize) {
    throw new ImportError('bad-archive', undefined, `entry ${name} has the wrong length`);
  }
  if (crc32(data) !== entry.crc) {
    throw new ImportError('bad-archive', undefined, `entry ${name} failed its checksum`);
  }
  return data;
}

function normalisePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

function isScoreCandidate(name: string): boolean {
  return (
    !name.endsWith('/') &&
    !name.startsWith('META-INF/') &&
    !name.startsWith('__MACOSX/') &&
    /\.(xml|musicxml)$/i.test(name)
  );
}

/** First `rootfile@full-path` from META-INF/container.xml, or null if unusable. */
function rootfileFromContainer(data: Uint8Array): string | null {
  try {
    const doc = parseXmlSafely(decodeXmlBytes(data));
    const rootfile = doc.getElementsByTagName('rootfile').item(0);
    const path = rootfile?.getAttribute('full-path');
    return path ? normalisePath(path) : null;
  } catch {
    return null;
  }
}

function findScorePath(bytes: Uint8Array, entries: EntryInfo[], limits: MxlLimits): string {
  const names = new Set(entries.map((e) => e.name));
  if (names.has(CONTAINER_PATH)) {
    const path = rootfileFromContainer(readEntry(bytes, entries, CONTAINER_PATH, limits));
    if (path && names.has(path)) return path;
  }
  const fallback = entries.find((e) => isScoreCandidate(e.name));
  if (!fallback) throw new ImportError('no-score-in-archive');
  return fallback.name;
}

/**
 * Returns the MusicXML text of an uploaded file: the root score of an MXL
 * archive, or the decoded text of an uncompressed MusicXML file.
 * `limits` exists so tests can inject small values.
 */
export function extractMusicXmlText(
  bytes: Uint8Array,
  fileName?: string,
  limits: MxlLimits = MXL_LIMITS,
): string {
  if (!isZipArchive(bytes)) {
    if (bytes.length > limits.maxUncompressedBytes) {
      throw new ImportError('too-large', `${describe(fileName)} is too large to open safely.`);
    }
    const text = decodeXmlBytes(bytes);
    if (!looksLikeXml(text)) {
      throw new ImportError('not-musicxml', `${describe(fileName)} is not a MusicXML score (.musicxml, .xml or .mxl).`);
    }
    return text;
  }

  if (bytes.length > limits.maxArchiveBytes) {
    throw new ImportError('too-large', `${describe(fileName)} is too large to open safely.`);
  }
  const entries = listEntries(bytes, limits);
  const scorePath = findScorePath(bytes, entries, limits);
  const text = decodeXmlBytes(readEntry(bytes, entries, scorePath, limits));
  if (!looksLikeXml(text)) throw new ImportError('no-score-in-archive');
  return text;
}
