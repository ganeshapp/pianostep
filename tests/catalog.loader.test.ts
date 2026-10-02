import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../src/core/types';
import { ImportError } from '../src/core/xml';

const idb = vi.hoisted(() => ({ db: new Map<string, unknown>() }));

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => () => Promise.resolve()),
  get: vi.fn(async (key: string) => idb.db.get(key)),
  getMany: vi.fn(async (keys: string[]) => keys.map((k) => idb.db.get(k))),
  keys: vi.fn(async () => [...idb.db.keys()]),
  setMany: vi.fn(async (entries: [string, unknown][]) => {
    for (const [k, v] of entries) idb.db.set(k, v);
  }),
  delMany: vi.fn(async (keys: string[]) => {
    for (const k of keys) idb.db.delete(k);
  }),
  clear: vi.fn(async () => idb.db.clear()),
}));

const catalogFixture = vi.hoisted(() => {
  const base = {
    composer: 'Anon.',
    arrangement: 'Original piano work',
    upstreamUrl: 'https://example.org/x.mxl',
    rightsInFile: null,
    attribution: '',
    difficulty: { level: 'Beginner', basis: 'source' },
    readiness: 'ready',
    readinessReasons: [],
    stats: { measures: 2, performanceMeasures: 2, notes: 8, durationSec: 4, lowest: 'C4', highest: 'G4' },
    notes: [],
  };
  return [
    { ...base, id: 'chord-piece', title: 'Melody and Chord', file: 'scores/f02-melody-and-chord.musicxml', overrides: null },
    {
      ...base,
      id: 'swapped',
      title: 'Swapped Hands',
      file: 'scores/f02-melody-and-chord.musicxml',
      overrides: { staffHands: { 'P1:1': 'L', 'P1:2': 'R' }, reason: 'Test swap' },
    },
    {
      ...base,
      id: 'broken',
      title: 'Broken',
      file: 'scores/f15-malformed.musicxml',
    },
    {
      ...base,
      id: 'unusable',
      title: 'Unusable',
      file: 'scores/nothing.mxl',
      readiness: 'unsupported',
      readinessReasons: ['There are no notes to play for either hand.'],
    },
    { id: 42, title: 'Not an entry' },
  ];
});

vi.mock('../src/catalog/catalog.json', () => ({ default: catalogFixture }));

import { builtinFileUrl, getCatalog, getCatalogEntry, isAbortError, loadPiece } from '../src/catalog/loader';
import { importFile } from '../src/storage/imports';

const FIXTURES = join(__dirname, 'fixtures');

function fixtureBytes(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

interface FakeResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function respond(bytes: Uint8Array<ArrayBuffer>, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

/** fetch stub serving test fixtures for "scores/<fixture name>". */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const name = decodeURIComponent(url.split('/').pop() ?? '');
    try {
      return respond(fixtureBytes(name));
    } catch {
      return respond(new Uint8Array(), 404);
    }
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  idb.db.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog', () => {
  it('keeps valid entries in file order and normalises null overrides', () => {
    const list = getCatalog();
    expect(list.map((e) => e.id)).toEqual(['chord-piece', 'swapped', 'broken', 'unusable']);
    expect(getCatalogEntry('chord-piece')?.overrides).toBeUndefined();
    expect(getCatalogEntry('swapped')?.overrides?.reason).toBe('Test swap');
    expect(getCatalogEntry('missing')).toBeUndefined();
  });

  it('resolves score URLs against BASE_URL and the document', () => {
    const url = builtinFileUrl({ file: 'scores/Für Elise.mxl' } as CatalogEntry);
    const expected = new URL(`${import.meta.env.BASE_URL}scores/Für Elise.mxl`, document.baseURI).href;
    expect(url).toBe(expected);
    expect(url).toContain('F%C3%BCr%20Elise.mxl');
  });
});

describe('loadPiece: built-in pieces', () => {
  it('fetches, parses and prepares the score', async () => {
    const fetchFn = stubFetch();
    const piece = await loadPiece('chord-piece');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(builtinFileUrl(getCatalogEntry('chord-piece')!));
    expect(piece.kind).toBe('builtin');
    expect(piece.title).toBe('Melody and Chord');
    expect(piece.arrangement).toBe('Original piano work');
    expect(piece.composer).toBe('Anon.');
    expect(piece.entry?.id).toBe('chord-piece');
    expect(piece.fileUrl).toBe(fetchFn.mock.calls[0][0]);
    expect(piece.prepared.presses.length).toBeGreaterThan(0);
  });

  it('applies the entry’s hand overrides', async () => {
    stubFetch();
    const normal = await loadPiece('chord-piece');
    const swapped = await loadPiece('swapped');
    const handsAt = (p: typeof normal) => p.prepared.presses.map((x) => `${x.midi}:${x.hand}`).sort();
    const flip = (s: string) => s.replace(/:R$/, ':x').replace(/:L$/, ':R').replace(/:x$/, ':L');
    expect(handsAt(swapped)).toEqual(handsAt(normal).map(flip).sort());
    expect(swapped.prepared.handMapping.source).toBe('override');
  });

  it('reports a missing file in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(new Uint8Array(), 404)));
    await expect(loadPiece('chord-piece')).rejects.toThrow('The piece’s file was not found on this site. It may have been removed.');
  });

  it('reports a network failure in plain language', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(loadPiece('chord-piece')).rejects.toThrow(/could not be downloaded\. Check your internet connection/);
  });

  it('passes ImportError through for a damaged score', async () => {
    stubFetch();
    const err = await loadPiece('broken').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
  });

  it('refuses unknown and unusable pieces without fetching', async () => {
    const fetchFn = stubFetch();
    await expect(loadPiece('no-such-piece')).rejects.toThrow(/not in the library/);
    await expect(loadPiece('unusable')).rejects.toThrow(/can’t be used for practice\. There are no notes/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('supports cancelling', async () => {
    const fetchFn = stubFetch();
    const already = new AbortController();
    already.abort();
    const e1 = await loadPiece('chord-piece', already.signal).catch((e: unknown) => e);
    expect(isAbortError(e1)).toBe(true);

    const soon = new AbortController();
    const pending = loadPiece('chord-piece', soon.signal);
    soon.abort();
    const e2 = await pending.catch((e: unknown) => e);
    expect(isAbortError(e2)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('loadPiece: imported pieces', () => {
  it('reads the stored bytes and prepares them', async () => {
    const meta = await importFile(new File([fixtureBytes('f01-melody-repeated.musicxml')], 'melody.musicxml'));
    const fetchFn = stubFetch();
    const piece = await loadPiece(meta.id);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(piece.kind).toBe('import');
    expect(piece.id).toBe(meta.id);
    expect(piece.title).toBe(meta.title);
    expect(piece.importMeta).toEqual(meta);
    expect(piece.fileUrl).toBeUndefined();
    expect(piece.prepared.presses.length).toBeGreaterThan(0);
  });

  it('explains when an imported piece is gone', async () => {
    await expect(loadPiece('local-00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /no longer saved in this browser/,
    );
  });
});
