/**
 * Readable measure numbers (§13, §16): internal ids such as MuseScore's "X1"
 * for a measure left out of the count are never shown.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureDisplayNumbers } from '../src/core/measures';
import { prepareScore } from '../src/core/model/prepare';
import { unrollMeasures } from '../src/core/model/performance';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { withCpuMs } from './helpers/cpuTime';
import { ScoreBuilder, occSummary } from './helpers/sourceBuilder';

const numbers = (...written: string[]) => measureDisplayNumbers(written.map((number, index) => ({ number, index })));

describe('measureDisplayNumbers', () => {
  it('keeps numbers that start with a digit, as written', () => {
    expect(numbers('0', '1', '2', '2a', '3', ' 4 ')).toEqual(['0', '1', '2', '2a', '3', '4']);
  });

  it('names an uncounted measure after the numbered measure before it', () => {
    expect(numbers('19', '20', 'X1', '21', 'X2', 'X3', '22')).toEqual(['19', '20', '20a', '21', '21a', '21b', '22']);
  });

  it('never repeats a number the file already uses', () => {
    expect(numbers('12', 'X1', '12a', '13')).toEqual(['12', '12b', '12a', '13']);
  });

  it('an uncounted measure before the first numbered one is measure 0', () => {
    expect(numbers('X1', '1', '2')).toEqual(['0', '1', '2']);
    expect(numbers('X1', 'X2', '1')).toEqual(['0', '0a', '1']);
  });

  it('a measure without a number gets its position', () => {
    expect(numbers('1', '', '3')).toEqual(['1', '2', '3']);
  });

  it('a number the file gives to two measures gets a letter the second time', () => {
    expect(numbers('11', '12', '12', '13')).toEqual(['11', '12', '12a', '13']);
    expect(numbers('12', '12', '12', '12a')).toEqual(['12', '12b', '12c', '12a']);
    expect(numbers('12', 'X1', '12', '13')).toEqual(['12', '12a', '12b', '13']);
    // Numbering that starts again (a second movement) stays readable.
    expect(numbers('1', '2', '3', '1', '2')).toEqual(['1', '2', '3', '1a', '2a']);
  });

  it('when every measure has the same number, the measures are counted instead', () => {
    expect(numbers('0', '0', '0', '0')).toEqual(['1', '2', '3', '4']);
    expect(numbers('1', '', '1')).toEqual(['1', '2', '3']);
    expect(numbers('5')).toEqual(['5']);
  });

  it('a damaged file repeating a few numbers thousands of times is labelled at once, with short distinct labels', () => {
    // Numbers 1, 2, 1, 2, ...: each repeat once searched past every earlier label of its number (cubic time).
    const measures = Array.from({ length: 20_000 }, (_, index) => ({ number: String((index % 2) + 1), index }));
    // CPU time, not wall time, so a busy machine cannot fail it (it took 65 s before).
    const { result: shown, ms } = withCpuMs(() => measureDisplayNumbers(measures));
    expect(ms).toBeLessThan(100);
    expect(new Set(shown).size).toBe(shown.length);
    // Far more repeats than letters: the measures are counted instead of being named "1zzzz...".
    expect(shown.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(Math.max(...shown.map((l) => l.length))).toBeLessThanOrEqual(5);
  });

  it('resuming the letter search gives the same labels as searching from "a" each time', () => {
    expect(numbers('1', '2', '1', '2', '1', '2', '1a')).toEqual(['1', '2', '1b', '2a', '1c', '2b', '1a']);
    expect(numbers('3', 'X1', '3', 'X2', '3a', '3')).toEqual(['3', '3b', '3c', '3d', '3a', '3e']);
    expect(numbers('X1', '0', 'X2', '0a', 'X3')).toEqual(['0b', '0', '0c', '0a', '0aa']);
    // Up to "zz" the letters stay; a number needing more is counted instead.
    const many = (n: number) => numbers(...Array.from({ length: n }, () => ['5', '6']).flat());
    expect(many(53).slice(-2)).toEqual(['5zz', '6zz']);
    expect(many(54).slice(-2)).toEqual(['107', '108']);
  });

  it('labels are always distinct', () => {
    const cases = [
      ['0', '0', '1', '1', 'X1', '1a', ''],
      ['3', '2', '3', '2', '3'],
      ['X1', 'X1', '0', '0a'],
    ];
    for (const c of cases) {
      const shown = numbers(...c);
      expect(new Set(shown).size).toBe(shown.length);
    }
  });
});

describe('uncounted measures in labels and warnings', () => {
  it('occurrence labels and numbers use the readable number', () => {
    const s = new ScoreBuilder()
      .measure({ number: '1', forward: true })
      .measure({ number: 'X1', implicit: true, backward: true })
      .measure({ number: '2' })
      .build();
    const { occurrences } = unrollMeasures(s);
    expect(occSummary(occurrences)).toEqual([
      [0, 1, '1'],
      [1, 1, '1a'],
      [0, 2, '1 (2nd time)'],
      [1, 2, '1a (2nd time)'],
      [2, 1, '2'],
    ]);
    expect(occurrences.map((o) => o.number)).toEqual(['1', '1a', '1', '1a', '2']);
  });

  it('import warnings name the readable number', () => {
    const s = parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
      <measure number="X1"><note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note></measure>
    </part></score-partwise>`);
    expect(s.measures[1].number).toBe('X1');
    expect(s.warnings.find((w) => w.code === 'measure-length-mismatch')?.measures).toEqual(['1a']);
  });

  it('Gnossienne No. 1 (every measure numbered "0") is labelled 1 to 11', () => {
    const file = 'Gnossienne_No._1.mxl';
    const p = prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', file))), file));
    expect(p.source.measures.every((m) => m.number === '0' && m.implicit)).toBe(true);
    expect(p.measures.map((o) => o.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });

  it('The Entertainer (1902 edition) never shows "X1".."X4"', () => {
    const file = 'The_Entertainer_-_Scott_Joplin_-_1902.mxl';
    const p = prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', file))), file));
    expect(p.source.measures.filter((m) => m.number.startsWith('X')).length).toBe(4);
    for (const o of p.measures) {
      expect(o.label).not.toMatch(/X/);
      expect(o.number).not.toMatch(/X/);
    }
    for (const w of p.warnings) for (const m of w.measures ?? []) expect(m).not.toMatch(/X/);
    const i = p.source.measures.findIndex((m) => m.number === 'X1');
    expect(p.measures.find((o) => o.measureIndex === i)?.label).toBe(`${p.source.measures[i - 1].number}a`);
  });
});
