import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import type { SourceScore } from '../src/core/types';
import { ImportError } from '../src/core/xml';
import { INVALID_SAMPLES, VALID_SAMPLES } from './helpers/musicxmlSamples';

/**
 * The Node catalog script parses with @xmldom/xmldom installed as the global
 * DOMParser; the browser (and Vitest's jsdom) uses its own. Both must yield
 * the same SourceScore, and the same ImportError code for bad input.
 */

const FIXTURES = join(__dirname, 'fixtures');
const LIBRARY = join(__dirname, '..', 'public', 'scores');

const LIBRARY_FILES = [
  'Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl', // two parts, cue notes, cross-staff, 480 ticks
  'G_Minor_Bach.mxl', // ornament ("Voorslagen") part beside the piano
  'The_Entertainer_-_Scott_Joplin.mxl', // hands in two unnamed single-staff parts
  'Ave_Maria_D839_-_Schubert_-_Solo_Piano_Arrg..mxl', // mostly tuplets
  'Sonate_No._14_Moonlight_1st_Movement.mxl', // triplets drawn across staves
  'Clair_de_Lune__Debussy.mxl', // tempo changes placed with <offset>
];

let xmldomParses = 0;

/** xmldom's parser, counting calls so the test can prove it really ran. */
class CountingXmldomParser extends XmldomDOMParser {
  override parseFromString(source: string, mimeType: string): ReturnType<XmldomDOMParser['parseFromString']> {
    xmldomParses++;
    return super.parseFromString(source, mimeType as Parameters<XmldomDOMParser['parseFromString']>[1]);
  }
}

type Outcome = { score: SourceScore } | { error: string };

function outcome(run: () => SourceScore): Outcome {
  try {
    return { score: run() };
  } catch (e) {
    if (e instanceof ImportError) return { error: e.code };
    throw e;
  }
}

function withXmldom<T>(run: () => T): T {
  const g = globalThis as { DOMParser?: unknown };
  const saved = g.DOMParser;
  g.DOMParser = CountingXmldomParser;
  try {
    return run();
  } finally {
    g.DOMParser = saved;
  }
}

/** Runs the same import under jsdom and under xmldom and returns both outcomes. */
function both(run: () => SourceScore): { jsdom: Outcome; xmldom: Outcome } {
  const before = xmldomParses;
  const jsdom = outcome(run);
  expect(xmldomParses).toBe(before);
  const xmldom = withXmldom(() => outcome(run));
  return { jsdom, xmldom };
}

describe('jsdom and @xmldom/xmldom give identical results', () => {
  it('uses the real global DOMParser from jsdom by default', () => {
    expect(globalThis.DOMParser).toBeDefined();
    expect(globalThis.DOMParser).not.toBe(CountingXmldomParser);
  });

  const fixtures = readdirSync(FIXTURES).filter((f) => /\.(musicxml|xml)$/i.test(f));

  it.each(fixtures)('fixture %s', (file) => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, file)));
    const before = xmldomParses;
    const { jsdom, xmldom } = both(() => loadSourceScore(bytes, file));
    expect(xmldom).toStrictEqual(jsdom);
    if ('score' in jsdom) expect(xmldomParses).toBeGreaterThan(before);
  });

  it('raises the documented codes for the error fixtures under both', () => {
    for (const [file, code] of [
      ['f15-malformed.musicxml', 'malformed-xml'],
      ['f-entity.musicxml', 'unsafe-content'],
    ]) {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES, file)));
      const { jsdom, xmldom } = both(() => loadSourceScore(bytes, file));
      expect(jsdom, file).toEqual({ error: code });
      expect(xmldom, file).toEqual({ error: code });
    }
  });

  it.each(Object.keys(VALID_SAMPLES))('inline sample %s', (name) => {
    const { jsdom, xmldom } = both(() => parseMusicXml(VALID_SAMPLES[name]));
    expect('score' in jsdom).toBe(true);
    expect(xmldom).toStrictEqual(jsdom);
  });

  it.each(Object.keys(INVALID_SAMPLES))('rejected sample %s', (name) => {
    const { xml, code } = INVALID_SAMPLES[name];
    const { jsdom, xmldom } = both(() => parseMusicXml(xml));
    expect(jsdom).toEqual({ error: code });
    expect(xmldom).toEqual({ error: code });
  });

  it.each(LIBRARY_FILES)(
    'library file %s',
    async (file) => {
      // Let the test runner's worker messaging through between long synchronous parses.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const bytes = new Uint8Array(readFileSync(join(LIBRARY, file)));
      const before = xmldomParses;
      const { jsdom, xmldom } = both(() => loadSourceScore(bytes, file));
      expect('score' in jsdom && jsdom.score.notes.length > 0).toBe(true);
      expect(xmldomParses).toBeGreaterThan(before);
      expect(xmldom).toStrictEqual(jsdom);
    },
    60_000,
  );
});
