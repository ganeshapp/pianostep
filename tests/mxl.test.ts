import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MXL_LIMITS, extractMusicXmlText, isZipArchive, type MxlLimits } from '../src/core/mxl';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { ImportError, type ImportErrorCode, decodeXmlBytes } from '../src/core/xml';
import { DIVISIONS_MID_MEASURE } from './helpers/musicxmlSamples';

/**
 * Bytes fflate has inflated (streaming or all at once) since the last reset:
 * the work a damaged or hostile archive costs the reader, measured without a
 * clock, so a busy machine cannot make these checks fail.
 */
const inflateWork = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('fflate', async (importOriginal) => {
  const real = await importOriginal<typeof import('fflate')>();
  class CountingInflate extends real.Inflate {
    constructor(...args: ConstructorParameters<typeof real.Inflate>) {
      super(...args);
      const deliver = this.ondata;
      this.ondata = (chunk, final) => {
        inflateWork.bytes += chunk.length;
        deliver(chunk, final);
      };
    }
  }
  const inflateSync = (data: Uint8Array, opts?: import('fflate').InflateOptions): Uint8Array => {
    const out = real.inflateSync(data, opts);
    inflateWork.bytes += out.length;
    return out;
  };
  const unzipSync = (data: Uint8Array, opts?: import('fflate').UnzipOptions): import('fflate').Unzipped => {
    const out = real.unzipSync(data, opts);
    for (const entry of Object.values(out)) inflateWork.bytes += entry.length;
    return out;
  };
  return { ...real, Inflate: CountingInflate, inflateSync, unzipSync };
});
beforeEach(() => {
  inflateWork.bytes = 0;
});
const MIB = 1024 * 1024;
/** One 16 KiB slice of compressed input can inflate to about 16 MiB (deflate's ratio is at most ~1032:1). */
const ONE_SLICE_OF_BOMB = 17 * MIB;

const FIXTURES = join(__dirname, 'fixtures');
const F01_TEXT = readFileSync(join(FIXTURES, 'f01-melody-repeated.musicxml'), 'utf8');
const SINGLE_STAFF_TEXT = readFileSync(join(FIXTURES, 'f-single-staff.musicxml'), 'utf8');
const F01_TITLE = 'Melody with repeated notes';
const SINGLE_STAFF_TITLE = 'Single staff tune';

/** A score whose title needs real Unicode decoding (two-byte, three-byte and astral characters). */
const UNICODE_TITLE = 'Für Elise – 𝄞';
const UNICODE_SCORE = DIVISIONS_MID_MEASURE.replace(
  '<score-partwise version="4.0">',
  `<score-partwise version="4.0">\n  <work><work-title>${UNICODE_TITLE}</work-title></work>`,
);

function container(...paths: string[]): Uint8Array {
  const rootfiles = paths
    .map((p) => `<rootfile full-path="${p}" media-type="application/vnd.recordare.musicxml+xml"/>`)
    .join('');
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles>${rootfiles}</rootfiles></container>`,
  );
}

function zip(files: Zippable, level: 0 | 6 = 6): Uint8Array {
  return zipSync(files, { level, mtime: new Date('2024-01-01T00:00:00Z') });
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

function expectCode(fn: () => unknown, code: ImportErrorCode): ImportError {
  const err = importErrorOf(fn);
  expect(err.code).toBe(code);
  expect(err.message.trim().length).toBeGreaterThan(10);
  expect(err.message).not.toMatch(/fflate|DOMParser|undefined|Error:|\bzip\b/);
  return err;
}

function utf16(text: string, order: 'le' | 'be', bom: boolean): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let o = 0;
  if (bom) {
    out[o++] = order === 'le' ? 0xff : 0xfe;
    out[o++] = order === 'le' ? 0xfe : 0xff;
  }
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const hi = unit >> 8;
    const lo = unit & 0xff;
    out[o++] = order === 'le' ? lo : hi;
    out[o++] = order === 'le' ? hi : lo;
  }
  return out;
}

function withBom(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(bytes, 3);
  return out;
}

/** Deterministic pseudo-random bytes (LCG). */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Offset and length of an entry's compressed data, read from its local file header. */
function entryData(archive: Uint8Array, name: string): { start: number; length: number } {
  const header = indexOfBytes(archive, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let p = header; p >= 0; p = indexOfBytes(archive, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), p + 4)) {
    const nameLength = view.getUint16(p + 26, true);
    const extraLength = view.getUint16(p + 28, true);
    const entryName = new TextDecoder().decode(archive.subarray(p + 30, p + 30 + nameLength));
    if (entryName === name) {
      return { start: p + 30 + nameLength + extraLength, length: view.getUint32(p + 18, true) };
    }
  }
  throw new Error(`entry ${name} not found`);
}

/* ------------------------------------------------------------------------ */

describe('valid .mxl archives', () => {
  it('reads the rootfile named in META-INF/container.xml', () => {
    const archive = zip({
      'META-INF/container.xml': container('scores/piece.musicxml'),
      'decoy.xml': strToU8(SINGLE_STAFF_TEXT),
      'scores/piece.musicxml': strToU8(F01_TEXT),
    });
    expect(isZipArchive(archive)).toBe(true);
    expect(extractMusicXmlText(archive, 'piece.mxl')).toBe(F01_TEXT);
    const score = loadSourceScore(archive, 'piece.mxl');
    expect(score.title).toBe(F01_TITLE);
    expect(score).toStrictEqual(parseMusicXml(F01_TEXT));
  });

  it('uses the first rootfile when several are listed, and tolerates "./" or "/" prefixes', () => {
    const archive = zip({
      'META-INF/container.xml': container('/b.xml', 'a.xml'),
      'a.xml': strToU8(F01_TEXT),
      'b.xml': strToU8(SINGLE_STAFF_TEXT),
    });
    expect(loadSourceScore(archive).title).toBe(SINGLE_STAFF_TITLE);
    const dotted = zip({ 'META-INF/container.xml': container('./a.xml'), 'a.xml': strToU8(F01_TEXT) });
    expect(loadSourceScore(dotted).title).toBe(F01_TITLE);
  });

  it('reads stored (uncompressed) entries', () => {
    const archive = zip({ 'META-INF/container.xml': container('s.xml'), 's.xml': strToU8(F01_TEXT) }, 0);
    expect(loadSourceScore(archive).title).toBe(F01_TITLE);
  });

  it('detects a zip by its content, whatever the file name says', () => {
    const archive = zip({ 'META-INF/container.xml': container('s.xml'), 's.xml': strToU8(F01_TEXT) });
    expect(loadSourceScore(archive, 'looks-like-plain.xml').title).toBe(F01_TITLE);
    expect(loadSourceScore(strToU8(F01_TEXT), 'looks-compressed.mxl').title).toBe(F01_TITLE);
  });

  it('decodes a UTF-16 score inside the archive', () => {
    const text = UNICODE_SCORE.replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const archive = zip({ 'META-INF/container.xml': container('s.xml'), 's.xml': utf16(text, 'le', true) });
    expect(loadSourceScore(archive).title).toBe(UNICODE_TITLE);
  });

  it('opens a vendored library file within the default limits', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', 'Fur_Elise.mxl')));
    expect(bytes.length).toBeLessThan(MXL_LIMITS.maxArchiveBytes);
    expect(extractMusicXmlText(bytes, 'Fur_Elise.mxl')).toContain('<score-partwise');
  });
});

describe('finding the score inside an archive', () => {
  it('falls back to the first .xml/.musicxml outside META-INF when container.xml is missing', () => {
    const archive = zip({
      'readme.txt': strToU8('hello'),
      '__MACOSX/._song.xml': strToU8('\u0000\u0005junk'),
      'META-INF/other.xml': strToU8('<other/>'),
      'music/song.musicxml': strToU8(F01_TEXT),
      'later.xml': strToU8(SINGLE_STAFF_TEXT),
    });
    expect(loadSourceScore(archive).title).toBe(F01_TITLE);
  });

  it('falls back when container.xml is malformed or names no rootfile', () => {
    const broken = zip({ 'META-INF/container.xml': strToU8('<container><rootfiles>'), 'a.xml': strToU8(F01_TEXT) });
    expect(loadSourceScore(broken).title).toBe(F01_TITLE);
    const empty = zip({ 'META-INF/container.xml': container(), 'a.xml': strToU8(F01_TEXT) });
    expect(loadSourceScore(empty).title).toBe(F01_TITLE);
  });

  // Documented behaviour: a rootfile path that names a missing entry is treated
  // like a missing container — the first score-like entry is used if there is
  // one, otherwise the archive has no score.
  it('falls back to another score entry when the rootfile path names a missing entry', () => {
    const archive = zip({ 'META-INF/container.xml': container('missing/score.xml'), 'present.xml': strToU8(F01_TEXT) });
    expect(loadSourceScore(archive).title).toBe(F01_TITLE);
  });

  it('raises no-score-in-archive when the rootfile is missing and nothing else looks like a score', () => {
    const archive = zip({
      'META-INF/container.xml': container('missing/score.xml'),
      'cover.png': noise(64, 1),
      'notes.txt': strToU8('not a score'),
    });
    expectCode(() => loadSourceScore(archive, 'x.mxl'), 'no-score-in-archive');
  });

  it('raises no-score-in-archive when the score entry is empty or not text', () => {
    const empty = zip({ 'META-INF/container.xml': container('s.xml'), 's.xml': new Uint8Array(0) });
    expectCode(() => loadSourceScore(empty), 'no-score-in-archive');
    const binary = noise(256, 7);
    binary[0] = 0x8f;
    const garbage = zip({ 'META-INF/container.xml': container('s.xml'), 's.xml': binary });
    expectCode(() => loadSourceScore(garbage), 'no-score-in-archive');
  });

  it('raises not-musicxml for an archive of some other XML document (e.g. a Word file)', () => {
    const docx = zip({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': strToU8('<?xml version="1.0"?><document><body/></document>'),
    });
    expectCode(() => loadSourceScore(docx, 'letter.docx'), 'not-musicxml');
  });
});

describe('damaged archives', () => {
  const archive = zip({ 'META-INF/container.xml': container('score.xml'), 'score.xml': strToU8(F01_TEXT) });

  it.each([
    ['cut short', archive.subarray(0, Math.floor(archive.length * 0.6))],
    ['missing its last bytes', archive.subarray(0, archive.length - 5)],
    ['only a zip signature', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])],
    ['a zip signature followed by noise', (() => {
      const b = noise(4096, 3);
      b.set([0x50, 0x4b, 0x03, 0x04]);
      return b;
    })()],
  ])('raises bad-archive when %s', (_label, bytes) => {
    expectCode(() => loadSourceScore(bytes, 'broken.mxl'), 'bad-archive');
  });

  it('raises bad-archive when compressed data is corrupted', () => {
    const { start, length } = entryData(archive, 'score.xml');
    const corrupt = archive.slice();
    for (let i = start + Math.floor(length / 3); i < start + Math.floor(length / 3) + 8; i++) corrupt[i] ^= 0xa5;
    expectCode(() => loadSourceScore(corrupt), 'bad-archive');
  });

  it('raises bad-archive when a stored entry fails its checksum', () => {
    const stored = zip({ 'META-INF/container.xml': container('score.xml'), 'score.xml': strToU8(F01_TEXT) }, 0);
    const at = indexOfBytes(stored, strToU8(F01_TITLE));
    expect(at).toBeGreaterThan(0);
    const corrupt = stored.slice();
    corrupt[at] = 0x4e; // "Melody" -> "Nelody": still valid XML, so only the checksum can catch it
    expectCode(() => loadSourceScore(corrupt), 'bad-archive');
  });
});

/**
 * Raw DEFLATE data for `bytes` zeros or more: one fixed-Huffman block holding
 * a literal 0 followed by back-references of 258 bytes at distance 1 (13 bits
 * each), the way a "zip bomb" is built.
 */
function zeroBomb(bytes: number): Uint8Array {
  const matches = Math.ceil(Math.max(0, bytes - 1) / 258);
  const out = new Uint8Array(Math.ceil((3 + 8 + 13 * matches + 7) / 8) + 1);
  let bit = 0;
  const put = (value: number, n: number) => {
    for (let k = 0; k < n; k++, bit++) if ((value >> k) & 1) out[bit >> 3] |= 1 << (bit & 7);
  };
  /** Huffman codes are sent most significant bit first. */
  const code = (value: number, n: number) => {
    for (let k = n - 1; k >= 0; k--, bit++) if ((value >> k) & 1) out[bit >> 3] |= 1 << (bit & 7);
  };
  put(1, 1); // final block
  put(1, 2); // fixed Huffman codes
  code(0x30, 8); // literal 0
  for (let k = 0; k < matches; k++) {
    code(0xc5, 8); // length 258
    code(0, 5); // distance 1
  }
  code(0, 7); // end of block
  return out.subarray(0, Math.ceil(bit / 8));
}

/**
 * A single-entry archive whose header lies about its size: `realMiB` MiB of
 * zeros declared as `declaredSize` bytes.
 */
function lyingArchive(realMiB: number, declaredSize: number): Uint8Array {
  const data = zeroBomb(realMiB * 1024 * 1024);
  const name = strToU8('score.musicxml');
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true); // deflate
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, declaredSize, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, declaredSize, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true); // local header offset
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  let o = 0;
  for (const part of [local, data, central, end]) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

describe('archives whose header lies about the size of their contents', () => {
  it('(the test bomb really is one)', () => {
    expect(inflateRawSync(zeroBomb(5_000_000)).length).toBe(1 + 258 * Math.ceil(4_999_999 / 258));
  });

  it('stops inflating at the stated size: a 1 GiB bomb declared as 1000 bytes fails at once', () => {
    const bomb = lyingArchive(1024, 1000);
    expect(bomb.length).toBeLessThan(MXL_LIMITS.maxArchiveBytes);
    expectCode(() => extractMusicXmlText(bomb, 'bomb.mxl'), 'bad-archive');
    // At most one slice past the stated size, never the whole gigabyte (as the reader once did, for seconds).
    expect(inflateWork.bytes).toBeLessThan(ONE_SLICE_OF_BOMB);
  });

  it('the same when the stated size is just under the uncompressed limit', () => {
    const bomb = lyingArchive(1024, MXL_LIMITS.maxUncompressedBytes - 1);
    expectCode(() => extractMusicXmlText(bomb, 'bomb.mxl'), 'bad-archive');
    expect(inflateWork.bytes).toBeGreaterThan(0);
    expect(inflateWork.bytes).toBeLessThan(MXL_LIMITS.maxUncompressedBytes + ONE_SLICE_OF_BOMB);
  });

  it('an entry that inflates to less than its stated size is damaged too', () => {
    expectCode(() => extractMusicXmlText(lyingArchive(1, 2 * 1024 * 1024), 'short.mxl'), 'bad-archive');
  });

  it('a compression method other than store or deflate is refused', () => {
    const archive = lyingArchive(1, 1000);
    const dir = archive.length - 22 - 46 - 'score.musicxml'.length;
    archive[8] = 12; // bzip2, in the local header...
    archive[dir + 10] = 12; // ...and in the central directory
    expectCode(() => extractMusicXmlText(archive, 'bzip2.mxl'), 'bad-archive');
  });
});

/** One central-directory record for a deflated `score.musicxml` whose local header is at offset 0. */
function centralRecord(compressedSize: number, declaredSize: number): Uint8Array {
  const name = strToU8('score.musicxml');
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 45, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, compressedSize, true);
  cv.setUint32(24, declaredSize, true);
  cv.setUint16(28, name.length, true);
  central.set(name, 46);
  return central;
}

/**
 * An archive with two central directories for the same entry: a zip64 end
 * record names directory A (declaring `smallSize`), and the classic end
 * record names directory B (declaring `hugeSize`). The data is `realMiB` MiB
 * of zeros.
 */
function twoDirectoryArchive(realMiB: number, smallSize: number, hugeSize: number): Uint8Array {
  const data = zeroBomb(realMiB * 1024 * 1024);
  const name = strToU8('score.musicxml');
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, hugeSize, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const a = centralRecord(data.length, smallSize);
  const b = centralRecord(data.length, hugeSize);
  const aOffset = local.length + data.length;
  const bOffset = aOffset + a.length;
  const zip64Offset = bOffset + b.length;
  const zip64End = new Uint8Array(56);
  const zv = new DataView(zip64End.buffer);
  zv.setUint32(0, 0x06064b50, true);
  zv.setBigUint64(4, 44n, true);
  zv.setUint16(12, 45, true);
  zv.setUint16(14, 45, true);
  zv.setBigUint64(24, 1n, true);
  zv.setBigUint64(32, 1n, true);
  zv.setBigUint64(40, BigInt(a.length), true);
  zv.setBigUint64(48, BigInt(aOffset), true);
  const locator = new Uint8Array(20);
  const lov = new DataView(locator.buffer);
  lov.setUint32(0, 0x07064b50, true);
  lov.setBigUint64(8, BigInt(zip64Offset), true);
  lov.setUint32(16, 1, true);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, b.length, true);
  ev.setUint32(16, bOffset, true);
  const parts = [local, data, a, b, zip64End, locator, end];
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

describe('archives with two central directories', () => {
  it('a directory hidden behind a zip64 end record cannot declare a larger size than the one checked', () => {
    // The limits are checked on directory A (1000 bytes); directory B declares 200 MiB.
    const archive = twoDirectoryArchive(200, 1000, 200 * 1024 * 1024);
    expect(archive.length).toBeLessThan(MXL_LIMITS.maxArchiveBytes);
    const e = expectCode(() => extractMusicXmlText(archive, 'two.mxl'), 'bad-archive');
    expect(e.detail).toBe('the list of files in the archive could not be read');
    // Nothing is inflated, let alone the 200 MiB the second directory declares (as the reader once did).
    expect(inflateWork.bytes).toBeLessThan(MIB);
  });

  it('an archive with a zip64 end record that names the same directory is read normally', () => {
    // A writer may add zip64 end records to a small archive; both records then name one directory.
    const plain = zip({ 'score.musicxml': strToU8(F01_TEXT) });
    const eocd = plain.length - 22;
    const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const count = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    const zip64End = new Uint8Array(56);
    const zv = new DataView(zip64End.buffer);
    zv.setUint32(0, 0x06064b50, true);
    zv.setBigUint64(4, 44n, true);
    zv.setBigUint64(24, BigInt(count), true);
    zv.setBigUint64(32, BigInt(count), true);
    zv.setBigUint64(40, BigInt(cdSize), true);
    zv.setBigUint64(48, BigInt(cdOffset), true);
    const locator = new Uint8Array(20);
    const lov = new DataView(locator.buffer);
    lov.setUint32(0, 0x07064b50, true);
    lov.setBigUint64(8, BigInt(eocd), true);
    lov.setUint32(16, 1, true);
    const out = new Uint8Array(plain.length + 76);
    out.set(plain.subarray(0, eocd), 0);
    out.set(zip64End, eocd);
    out.set(locator, eocd + 56);
    out.set(plain.subarray(eocd), eocd + 76);
    expect(parseMusicXml(extractMusicXmlText(out, 'zip64.mxl')).title).toBe(F01_TITLE);
  });

  /**
   * F01 zipped with zip64 end records, as written by `zip -fz` and other
   * writers that always use zip64: the classic end record may hold the marker
   * values (0xFFFF entries, 0xFFFFFFFF directory offset) instead of real ones.
   */
  function zip64Archive(opts: { countMarker?: boolean; offsetMarker?: boolean; classicOffsetShift?: number }): Uint8Array {
    const plain = zip({ 'META-INF/container.xml': container('score.musicxml'), 'score.musicxml': strToU8(F01_TEXT) });
    const eocd = plain.length - 22;
    const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const count = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    const zip64End = new Uint8Array(56);
    const zv = new DataView(zip64End.buffer);
    zv.setUint32(0, 0x06064b50, true);
    zv.setBigUint64(4, 44n, true);
    zv.setUint16(12, 45, true);
    zv.setUint16(14, 45, true);
    zv.setBigUint64(24, BigInt(count), true);
    zv.setBigUint64(32, BigInt(count), true);
    zv.setBigUint64(40, BigInt(cdSize), true);
    zv.setBigUint64(48, BigInt(cdOffset), true);
    const locator = new Uint8Array(20);
    const lov = new DataView(locator.buffer);
    lov.setUint32(0, 0x07064b50, true);
    lov.setBigUint64(8, BigInt(eocd), true);
    lov.setUint32(16, 1, true);
    const out = new Uint8Array(plain.length + 76);
    out.set(plain.subarray(0, eocd), 0);
    out.set(zip64End, eocd);
    out.set(locator, eocd + 56);
    out.set(plain.subarray(eocd), eocd + 76);
    const ov = new DataView(out.buffer);
    const end = eocd + 76;
    if (opts.countMarker) {
      ov.setUint16(end + 8, 0xffff, true);
      ov.setUint16(end + 10, 0xffff, true);
    }
    if (opts.offsetMarker) ov.setUint32(end + 16, 0xffffffff, true);
    else if (opts.classicOffsetShift) ov.setUint32(end + 16, cdOffset + opts.classicOffsetShift, true);
    return out;
  }

  it('a zip64 archive whose classic end record holds marker values is read from the zip64 record (zip -fz)', () => {
    for (const opts of [{ offsetMarker: true }, { countMarker: true }, { countMarker: true, offsetMarker: true }]) {
      const archive = zip64Archive(opts);
      // fflate itself lists this archive through the zip64 end record.
      expect(Object.keys(unzipSync(archive)).sort()).toEqual(['META-INF/container.xml', 'score.musicxml']);
      expect(parseMusicXml(extractMusicXmlText(archive, 'z64.mxl')).title).toBe(F01_TITLE);
    }
  });

  it('marker values with no zip64 end record, or a zip64 record naming another directory, are still damaged', () => {
    const plain = zip({ 'score.musicxml': strToU8(F01_TEXT) });
    const markers = plain.slice();
    new DataView(markers.buffer).setUint32(markers.length - 22 + 16, 0xffffffff, true);
    expect(['bad-archive', 'no-score-in-archive']).toContain(importErrorOf(() => extractMusicXmlText(markers, 'm.mxl')).code);
    // The classic offset is a real value here, so the zip64 record (which fflate lists) must agree with it.
    const disagreeing = zip64Archive({ countMarker: true, classicOffsetShift: 1 });
    expect(Object.keys(unzipSync(disagreeing)).length).toBe(2);
    const e = expectCode(() => extractMusicXmlText(disagreeing, 'z.mxl'), 'bad-archive');
    expect(e.detail).toBe('the list of files in the archive could not be read');
  });
});

describe('size limits', () => {
  const files: Zippable = {
    'META-INF/container.xml': container('score.xml'),
    'score.xml': strToU8(F01_TEXT),
    'a.txt': strToU8('a'),
    'b.txt': strToU8('b'),
    'c.txt': strToU8('c'),
  };
  const archive = zip(files);
  const uncompressed = Object.values(files).reduce((sum, f) => sum + (f as Uint8Array).length, 0);
  const limits = (patch: Partial<MxlLimits>): MxlLimits => ({ ...MXL_LIMITS, ...patch });

  it('accepts an archive exactly at every limit', () => {
    const exact = limits({ maxArchiveBytes: archive.length, maxUncompressedBytes: uncompressed, maxEntries: 5 });
    expect(extractMusicXmlText(archive, 'ok.mxl', exact)).toBe(F01_TEXT);
  });

  it('raises too-large for an archive over the archive-size limit', () => {
    const err = expectCode(() => extractMusicXmlText(archive, 'big.mxl', limits({ maxArchiveBytes: archive.length - 1 })), 'too-large');
    expect(err.message).toContain('"big.mxl"');
  });

  it('raises too-large when the declared uncompressed total is over the limit', () => {
    expectCode(() => extractMusicXmlText(archive, 'x.mxl', limits({ maxUncompressedBytes: uncompressed - 1 })), 'too-large');
  });

  it('raises too-large for too many entries', () => {
    expectCode(() => extractMusicXmlText(archive, 'x.mxl', limits({ maxEntries: 4 })), 'too-large');
  });

  it('raises too-large for an uncompressed file over the limit', () => {
    const bytes = strToU8(F01_TEXT);
    expectCode(() => extractMusicXmlText(bytes, 'x.musicxml', limits({ maxUncompressedBytes: bytes.length - 1 })), 'too-large');
    expect(extractMusicXmlText(bytes, 'x.musicxml', limits({ maxUncompressedBytes: bytes.length }))).toBe(F01_TEXT);
  });

  it('has the documented defaults', () => {
    expect(MXL_LIMITS).toEqual({ maxArchiveBytes: 20 * 1024 * 1024, maxUncompressedBytes: 60 * 1024 * 1024, maxEntries: 200 });
  });
});

describe('uncompressed files and text encodings', () => {
  it('decodes UTF-8 with and without a byte order mark', () => {
    const expected = parseMusicXml(UNICODE_SCORE);
    expect(expected.title).toBe(UNICODE_TITLE);
    expect(loadSourceScore(strToU8(UNICODE_SCORE))).toStrictEqual(expected);
    expect(loadSourceScore(withBom(strToU8(UNICODE_SCORE)))).toStrictEqual(expected);
  });

  it.each([
    ['UTF-16LE with BOM', 'le', true],
    ['UTF-16BE with BOM', 'be', true],
    ['UTF-16LE without BOM', 'le', false],
    ['UTF-16BE without BOM', 'be', false],
  ] as const)('decodes %s', (_label, order, bom) => {
    const text = UNICODE_SCORE.replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const bytes = utf16(text, order, bom);
    expect(decodeXmlBytes(bytes)).toBe(text);
    const score = loadSourceScore(bytes, 'utf16.musicxml');
    expect(score.title).toBe(UNICODE_TITLE);
    expect(score).toStrictEqual(parseMusicXml(UNICODE_SCORE));
  });

  it('decodes a declared single-byte encoding', () => {
    const text = UNICODE_SCORE.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"').replace(UNICODE_TITLE, 'Für Elise');
    expect(loadSourceScore(strToU8(text, true)).title).toBe('Für Elise');
  });

  it('raises not-musicxml for random bytes and other binary files', () => {
    const random = noise(2048, 42);
    random[0] = 0x8f;
    expectCode(() => loadSourceScore(random, 'random.mxl'), 'not-musicxml');
    expectCode(() => loadSourceScore(strToU8('%PDF-1.7\n%âãÏÓ\n1 0 obj'), 'score.pdf'), 'not-musicxml');
    expectCode(() => loadSourceScore(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]), 'song.mid'), 'not-musicxml');
  });

  it('raises not-musicxml for an .xml file that is not MusicXML', () => {
    expectCode(() => loadSourceScore(strToU8('<html><body><p>Hello</p></body></html>'), 'page.xml'), 'not-musicxml');
    expectCode(() => loadSourceScore(strToU8('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.xml'), 'not-musicxml');
  });

  it('raises not-musicxml for an empty or blank file', () => {
    expectCode(() => loadSourceScore(new Uint8Array(0), 'empty.musicxml'), 'not-musicxml');
    expectCode(() => extractMusicXmlText(new Uint8Array(0)), 'not-musicxml');
    expectCode(() => loadSourceScore(strToU8('  \n\t '), 'blank.xml'), 'not-musicxml');
  });

  it('names the file in the message when the name is known', () => {
    const err = expectCode(() => loadSourceScore(strToU8('hello'), 'notes.txt'), 'not-musicxml');
    expect(err.message).toContain('"notes.txt"');
  });
});
