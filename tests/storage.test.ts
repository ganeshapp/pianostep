import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/types';
import type { PracticeSettings } from '../src/core/types';
import { ImportError } from '../src/core/xml';
import * as imports from '../src/storage/imports';

/* ------------------------------------------------------------------------ */
/* idb-keyval mock: an in-memory key/value store                             */
/* ------------------------------------------------------------------------ */

const idb = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  failWrites: false,
  failReads: false,
}));

vi.mock('idb-keyval', () => {
  const check = (fail: boolean) => {
    if (fail) throw new DOMException('The operation failed for reasons unrelated to the database itself.', 'UnknownError');
  };
  return {
    createStore: vi.fn(() => () => Promise.resolve()),
    get: vi.fn(async (key: string) => {
      check(idb.failReads);
      return idb.db.get(key);
    }),
    getMany: vi.fn(async (keys: string[]) => {
      check(idb.failReads);
      return keys.map((k) => idb.db.get(k));
    }),
    keys: vi.fn(async () => {
      check(idb.failReads);
      return [...idb.db.keys()];
    }),
    setMany: vi.fn(async (entries: [string, unknown][]) => {
      check(idb.failWrites);
      for (const [k, v] of entries) idb.db.set(k, v);
    }),
    delMany: vi.fn(async (keys: string[]) => {
      check(idb.failWrites);
      for (const k of keys) idb.db.delete(k);
    }),
    clear: vi.fn(async () => {
      check(idb.failWrites);
      idb.db.clear();
    }),
  };
});

/* ------------------------------------------------------------------------ */
/* localStorage fakes                                                        */
/* ------------------------------------------------------------------------ */

class FakeStorage implements Storage {
  readonly data = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    if (this.throwOnGet) throw new DOMException('The operation is insecure.', 'SecurityError');
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.data.set(key, String(value));
  }
}

let fake: FakeStorage;

function installStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function installThrowingStorageGetter(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access to storage is denied.', 'SecurityError');
    },
  });
}

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Fresh module state (the in-memory fallback lives in the module). */
async function freshPrefs() {
  vi.resetModules();
  return import('../src/storage/prefs');
}


beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
  idb.db.clear();
  idb.failReads = false;
  idb.failWrites = false;
});

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------------ */
/* prefs                                                                     */
/* ------------------------------------------------------------------------ */

describe('prefs: global preferences', () => {
  it('returns defaults when nothing is stored', async () => {
    const prefs = await freshPrefs();
    expect(prefs.loadGlobalPrefs()).toEqual({
      lastPieceId: null,
      midiInputName: null,
      midiOutputName: null,
      fitWholePiece: false,
      setupCollapsed: false,
    });
  });

  it('saves under the "pianosteps:v1:" prefix and merges patches', async () => {
    const prefs = await freshPrefs();
    prefs.saveGlobalPrefs({ lastPieceId: 'fur-elise' });
    prefs.saveGlobalPrefs({ fitWholePiece: true, midiInputName: 'Yamaha P-125' });
    prefs.saveGlobalPrefs({ setupCollapsed: true });
    expect(prefs.loadGlobalPrefs()).toEqual({
      lastPieceId: 'fur-elise',
      midiInputName: 'Yamaha P-125',
      midiOutputName: null,
      fitWholePiece: true,
      setupCollapsed: true,
    });
    expect([...fake.data.keys()].every((k) => k.startsWith('pianosteps:v1:'))).toBe(true);
    expect(fake.data.size).toBe(1);
  });

  it('falls back to defaults on corrupt JSON', async () => {
    fake.data.set('pianosteps:v1:global', '{"lastPieceId": "abc", oops');
    const prefs = await freshPrefs();
    expect(prefs.loadGlobalPrefs()).toEqual(prefs.DEFAULT_GLOBAL_PREFS);
    // A later save repairs the stored value.
    prefs.saveGlobalPrefs({ lastPieceId: 'abc' });
    expect(JSON.parse(fake.data.get('pianosteps:v1:global')!)).toMatchObject({ lastPieceId: 'abc' });
  });

  it('validates each field separately', async () => {
    fake.data.set(
      'pianosteps:v1:global',
      JSON.stringify({
        lastPieceId: 42,
        midiInputName: 'Piano',
        midiOutputName: ['x'],
        fitWholePiece: 'yes',
        setupCollapsed: 1,
      }),
    );
    const prefs = await freshPrefs();
    expect(prefs.loadGlobalPrefs()).toEqual({
      lastPieceId: null,
      midiInputName: 'Piano',
      midiOutputName: null,
      fitWholePiece: false,
      setupCollapsed: false,
    });
  });

  it('treats non-object JSON (arrays, numbers, null) as missing', async () => {
    const prefs = await freshPrefs();
    for (const raw of ['[]', '7', 'null', '"text"']) {
      fake.data.set('pianosteps:v1:global', raw);
      expect(prefs.loadGlobalPrefs()).toEqual(prefs.DEFAULT_GLOBAL_PREFS);
    }
  });
});

describe('prefs: per-piece state', () => {
  const custom: PracticeSettings = {
    mode: 'steady',
    hands: 'L',
    speed: 0.75,
    stepSeconds: 2.5,
    range: { startOcc: 2, endOcc: 9 },
    loop: true,
    sound: false,
    countIn: true,
    monitorInput: true,
    midiOutputId: 'out-1',
    midiInputId: 'in-1',
  };

  it('returns null for a piece never saved', async () => {
    const prefs = await freshPrefs();
    expect(prefs.loadPieceState('fur-elise')).toBeNull();
  });

  it('round-trips settings and step position', async () => {
    const prefs = await freshPrefs();
    prefs.savePieceState('fur-elise', { settings: custom, stepTick: 960 });
    expect(prefs.loadPieceState('fur-elise')).toEqual({ settings: custom, stepTick: 960 });
    expect(fake.data.has('pianosteps:v1:piece:fur-elise')).toBe(true);
    expect(prefs.loadPieceState('other')).toBeNull();
  });

  it('returns null on corrupt JSON', async () => {
    fake.data.set('pianosteps:v1:piece:fur-elise', '{not json');
    const prefs = await freshPrefs();
    expect(prefs.loadPieceState('fur-elise')).toBeNull();
  });

  it('falls back to DEFAULT_SETTINGS field by field', async () => {
    fake.data.set(
      'pianosteps:v1:piece:x',
      JSON.stringify({
        settings: {
          mode: 'dance',
          hands: 'R',
          speed: 5,
          stepSeconds: 2,
          range: { startOcc: 3, endOcc: 1 },
          loop: 'yes',
          sound: false,
          countIn: true,
          monitorInput: 1,
          midiOutputId: 7,
          midiInputId: 'abc',
        },
        stepTick: -4,
      }),
    );
    const prefs = await freshPrefs();
    expect(prefs.loadPieceState('x')).toEqual({
      settings: {
        mode: 'listen',
        hands: 'R',
        speed: 1,
        stepSeconds: 2,
        range: null,
        loop: false,
        sound: false,
        countIn: true,
        monitorInput: false,
        midiOutputId: null,
        midiInputId: 'abc',
      },
      stepTick: null,
    });
  });

  it('rejects out-of-range numbers and malformed passage ranges', async () => {
    const prefs = await freshPrefs();
    const s = (patch: Record<string, unknown>) => prefs.sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch });
    expect(s({ speed: 0.1 }).speed).toBe(1);
    expect(s({ speed: Number.NaN }).speed).toBe(1);
    expect(s({ speed: 0.25 }).speed).toBe(0.25);
    expect(s({ speed: 2 }).speed).toBe(2);
    expect(s({ stepSeconds: 4.5 }).stepSeconds).toBe(1);
    expect(s({ stepSeconds: 0.3 }).stepSeconds).toBe(0.3);
    expect(s({ range: { startOcc: 1.5, endOcc: 3 } }).range).toBeNull();
    expect(s({ range: { startOcc: -1, endOcc: 3 } }).range).toBeNull();
    expect(s({ range: [1, 2] }).range).toBeNull();
    expect(s({ range: { startOcc: 4, endOcc: 4, extra: true } }).range).toEqual({ startOcc: 4, endOcc: 4 });
    expect(prefs.sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(prefs.sanitizeSettings('listen')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a missing settings object as defaults but still reads the step', async () => {
    fake.data.set('pianosteps:v1:piece:y', JSON.stringify({ stepTick: 48 }));
    const prefs = await freshPrefs();
    expect(prefs.loadPieceState('y')).toEqual({ settings: DEFAULT_SETTINGS, stepTick: 48 });
  });

  it('removes one piece state', async () => {
    const prefs = await freshPrefs();
    prefs.savePieceState('a', { settings: custom, stepTick: null });
    prefs.savePieceState('b', { settings: custom, stepTick: null });
    prefs.removePieceState('a');
    expect(prefs.loadPieceState('a')).toBeNull();
    expect(prefs.loadPieceState('b')).not.toBeNull();
  });
});

describe('prefs: storage failures never throw', () => {
  it('reads defaults when getItem throws', async () => {
    fake.data.set('pianosteps:v1:global', JSON.stringify({ lastPieceId: 'x' }));
    fake.throwOnGet = true;
    const prefs = await freshPrefs();
    expect(() => prefs.loadGlobalPrefs()).not.toThrow();
    expect(prefs.loadGlobalPrefs()).toEqual(prefs.DEFAULT_GLOBAL_PREFS);
    expect(prefs.loadPieceState('x')).toBeNull();
  });

  it('keeps values in memory for this visit when setItem throws (quota, private mode)', async () => {
    fake.throwOnSet = true;
    const prefs = await freshPrefs();
    expect(() => prefs.saveGlobalPrefs({ lastPieceId: 'canon-in-d' })).not.toThrow();
    expect(() => prefs.savePieceState('canon-in-d', { settings: DEFAULT_SETTINGS, stepTick: 12 })).not.toThrow();
    expect(fake.data.size).toBe(0);
    expect(prefs.loadGlobalPrefs().lastPieceId).toBe('canon-in-d');
    expect(prefs.loadPieceState('canon-in-d')).toEqual({ settings: DEFAULT_SETTINGS, stepTick: 12 });
  });

  it('works when merely touching localStorage throws a SecurityError', async () => {
    installThrowingStorageGetter();
    const prefs = await freshPrefs();
    expect(prefs.loadGlobalPrefs()).toEqual(prefs.DEFAULT_GLOBAL_PREFS);
    expect(() => prefs.saveGlobalPrefs({ fitWholePiece: true })).not.toThrow();
    expect(prefs.loadGlobalPrefs().fitWholePiece).toBe(true);
    expect(() => prefs.removePieceState('x')).not.toThrow();
    await expect(prefs.clearAllLocalData()).resolves.toBeUndefined();
    expect(prefs.loadGlobalPrefs().fitWholePiece).toBe(false);
  });

  it('works when localStorage does not exist', async () => {
    installStorage(undefined);
    const prefs = await freshPrefs();
    expect(prefs.loadPieceState('x')).toBeNull();
    prefs.savePieceState('x', { settings: DEFAULT_SETTINGS, stepTick: 0 });
    expect(prefs.loadPieceState('x')).toEqual({ settings: DEFAULT_SETTINGS, stepTick: 0 });
  });
});

describe('prefs: clearAllLocalData', () => {
  it('removes only this app’s keys and every imported piece', async () => {
    fake.data.set('someone-else', 'keep me');
    idb.db.set('meta:local-1', { id: 'local-1' });
    idb.db.set('bytes:local-1', new Uint8Array([1]));
    const prefs = await freshPrefs();
    prefs.saveGlobalPrefs({ lastPieceId: 'a' });
    prefs.savePieceState('a', { settings: DEFAULT_SETTINGS, stepTick: 3 });
    await prefs.clearAllLocalData();
    expect([...fake.data.keys()]).toEqual(['someone-else']);
    expect(idb.db.size).toBe(0);
    expect(prefs.loadGlobalPrefs().lastPieceId).toBeNull();
  });

  it('rejects with a plain message when imports cannot be removed', async () => {
    vi.stubGlobal('indexedDB', {});
    idb.failWrites = true;
    const prefs = await freshPrefs();
    prefs.saveGlobalPrefs({ lastPieceId: 'a' });
    await expect(prefs.clearAllLocalData()).rejects.toThrow(/could not be removed/);
    // Settings were still cleared.
    expect(fake.data.size).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* imports                                                                   */
/* ------------------------------------------------------------------------ */

const FIXTURES = join(__dirname, 'fixtures');
const SCORES = join(__dirname, '..', 'public', 'scores');

function fixtureFile(name: string, fileName = name): File {
  return new File([readFileSync(join(FIXTURES, name))], fileName);
}

function textFile(text: string, fileName: string): File {
  return new File([text], fileName);
}

const RESTS_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest measure="yes"/><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

const UNTITLED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

async function expectImportError(promise: Promise<unknown>): Promise<ImportError> {
  const err = await promise.then(
    () => {
      throw new Error('expected the import to fail');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ImportError);
  const ie = err as ImportError;
  expect(ie.message.length).toBeGreaterThan(10);
  // Plain language: no stack-ish or parser vocabulary in what the user sees.
  expect(ie.message).not.toMatch(/undefined|null|TypeError|DOMParser|xmldom|fflate|IndexedDB|idb/i);
  return ie;
}

describe('imports: validation before storage', () => {
  it('surfaces a parse failure as ImportError and stores nothing', async () => {
    const err = await expectImportError(imports.importFile(fixtureFile('f15-malformed.musicxml')));
    expect(err.code).toBe('malformed-xml');
    expect(idb.db.size).toBe(0);
  });

  it('rejects files that are not MusicXML', async () => {
    const err = await expectImportError(imports.importFile(textFile('Just some notes about practice.', 'notes.xml')));
    expect(err.code).toBe('not-musicxml');
    expect(idb.db.size).toBe(0);
  });

  it('rejects entity declarations as unsafe', async () => {
    const err = await expectImportError(imports.importFile(fixtureFile('f-entity.musicxml')));
    expect(err.code).toBe('unsafe-content');
  });

  it('rejects a corrupt .mxl archive', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const err = await expectImportError(imports.importFile(new File([bytes], 'broken.mxl')));
    expect(err.code).toBe('bad-archive');
  });

  it('rejects an empty file', async () => {
    await expectImportError(imports.importFile(new File([], 'empty.musicxml')));
  });

  it('rejects a score with nothing to play, quoting the reason', async () => {
    const err = await expectImportError(imports.importFile(textFile(RESTS_ONLY, 'rests.musicxml')));
    expect(err.message).toMatch(/can’t be used for practice/);
    expect(err.message).toMatch(/no notes to play/i);
    expect(idb.db.size).toBe(0);
  });

  it('turns a storage failure into a plain ImportError', async () => {
    idb.failWrites = true;
    const err = await expectImportError(imports.importFile(fixtureFile('f02-melody-and-chord.musicxml')));
    expect(err.message).toMatch(/could not be saved in this browser/);
  });
});

describe('imports: storing and listing', () => {
  it('stores metadata and bytes under separate keys', async () => {
    const stages: string[] = [];
    const file = fixtureFile('f02-melody-and-chord.musicxml');
    const meta = await imports.importFile(file, { onProgress: (s) => stages.push(s) });

    expect(stages).toEqual(['reading', 'checking', 'saving']);
    expect(meta.id).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(meta.fileName).toBe('f02-melody-and-chord.musicxml');
    expect(meta.sizeBytes).toBe(file.size);
    expect(meta.measures).toBeGreaterThan(0);
    expect(meta.durationSec).toBeGreaterThan(0);
    expect(meta.readiness).not.toBe('unsupported');
    expect(Number.isNaN(Date.parse(meta.addedAt))).toBe(false);
    expect(meta.lowest).toMatch(/^[A-G]#?\d$/);

    expect(idb.db.get(`meta:${meta.id}`)).toEqual(meta);
    const stored = idb.db.get(`bytes:${meta.id}`);
    expect(stored).toBeInstanceOf(Uint8Array);
    expect((stored as Uint8Array).byteLength).toBe(file.size);

    expect(await imports.getImportMeta(meta.id)).toEqual(meta);
    expect(await imports.getImportBytes(meta.id)).toEqual(stored);
    expect(await imports.listImports()).toEqual([meta]);
  });

  it('accepts a compressed .mxl score', async () => {
    const bytes = readFileSync(join(SCORES, 'Ode_to_Joy_Easy_variation.mxl'));
    const meta = await imports.importFile(new File([bytes], 'Ode_to_Joy_Easy_variation.mxl'));
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.measures).toBeGreaterThan(4);
  });

  it('uses the file name when the score has no title', async () => {
    const meta = await imports.importFile(textFile(UNTITLED, 'My_Little_Tune.musicxml'));
    expect(meta.title).toBe('My Little Tune');
    expect(meta.composer).toBeNull();
    expect(meta.lowest).toBe('C4');
    expect(meta.highest).toBe('C4');
  });

  it('lists newest first and skips damaged records', async () => {
    const a = await imports.importFile(fixtureFile('f01-melody-repeated.musicxml'));
    idb.db.set(`meta:${a.id}`, { ...a, addedAt: '2026-01-01T00:00:00.000Z' });
    const b = await imports.importFile(fixtureFile('f02-melody-and-chord.musicxml'));
    idb.db.set('meta:local-broken', { id: 'local-broken', title: 3 });
    idb.db.set('unrelated', 'x');
    const list = await imports.listImports();
    expect(list.map((m) => m.id)).toEqual([b.id, a.id]);
  });

  it('deletes both keys of a piece', async () => {
    const meta = await imports.importFile(fixtureFile('f01-melody-repeated.musicxml'));
    await imports.deleteImport(meta.id);
    expect(idb.db.size).toBe(0);
    expect(await imports.getImportMeta(meta.id)).toBeNull();
    expect(await imports.getImportBytes(meta.id)).toBeNull();
    expect(await imports.listImports()).toEqual([]);
  });

  it('lists nothing when this browser has no IndexedDB', async () => {
    idb.failReads = true;
    vi.stubGlobal('indexedDB', undefined);
    await expect(imports.listImports()).resolves.toEqual([]);
  });

  it('reports unreadable storage in plain language', async () => {
    idb.failReads = true;
    vi.stubGlobal('indexedDB', {});
    await expect(imports.listImports()).rejects.toThrow(/could not be read from this browser’s storage/);
  });

  it('recognises import ids', async () => {
    expect(imports.isImportId('local-123')).toBe(true);
    expect(imports.isImportId('local-')).toBe(false);
    expect(imports.isImportId('fur-elise')).toBe(false);
    expect(imports.newImportId()).toMatch(/^local-/);
  });
});
