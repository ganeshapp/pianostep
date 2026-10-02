/**
 * Navigation marks written in different parts of the same measure. Bar lines
 * (repeats, endings) are usually in every part, but words and signs such as
 * D.C., Fine, To Coda or a segno are often written under one part only, which
 * need not be the first one. A mark in any part counts.
 */
import { describe, expect, it } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { parseMusicXml } from '../src/core/musicxml/parse';

const note = (step: string, octave: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><voice>1</voice></note>`;
const attributes = (sign: string, line: number) =>
  `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${sign}</sign><line>${line}</line></clef></attributes>`;
const FORWARD = '<barline location="left"><repeat direction="forward"/></barline>';
const BACKWARD = '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>';
const DC = '<direction placement="below"><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>';
const FINE = '<direction placement="below"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>';
const SEGNO = '<direction><direction-type><segno/></direction-type><sound segno="segno"/></direction>';
const DS = '<direction><direction-type><words>D.S. al Fine</words></direction-type><sound dalsegno="segno"/></direction>';
const ENDING_1_START = '<barline location="left"><ending number="1" type="start"/></barline>';
const ENDING_1_STOP = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
const ENDING_2_START = '<barline location="left"><ending number="2" type="start"/></barline>';
const ENDING_2_STOP = '<barline location="right"><ending number="2" type="stop"/></barline>';

/** Two single-staff parts, "Right" (treble) and "Left" (bass), one measure string per measure. */
function twoParts(upper: string[], lower: string[]): string {
  const part = (id: string, measures: string[], sign: string, line: number) =>
    `<part id="${id}">${measures
      .map((m, i) => `<measure number="${i + 1}">${i === 0 ? attributes(sign, line) : ''}${m}</measure>`)
      .join('')}</part>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>' +
    '<score-part id="P1"><part-name>Right</part-name></score-part>' +
    '<score-part id="P2"><part-name>Left</part-name></score-part></part-list>' +
    part('P1', upper, 'G', 2) +
    part('P2', lower, 'F', 4) +
    '</score-partwise>'
  );
}

function order(xml: string): string[] {
  return prepareScore(parseMusicXml(xml)).measures.map((o) => o.label);
}

describe('navigation marks are merged over all parts of a measure', () => {
  it('Fine in the lower part of a measure whose upper part has a repeat sign stops the D.C.', () => {
    // ||: 1 | 2 (Fine, :||) | 3 | 4 (D.C. al Fine): Fine and D.C. are written under the lower part only.
    const xml = twoParts(
      [FORWARD + note('C', 5), note('D', 5) + BACKWARD, note('E', 5), note('F', 5)],
      [FORWARD + note('C', 3), note('D', 3) + FINE + BACKWARD, note('E', 3), note('F', 3) + DC],
    );
    const source = parseMusicXml(xml);
    expect(source.measures[1]).toMatchObject({ fine: true, repeatBackwardTimes: 2 });
    expect(source.measures[3].daCapo).toBe(true);
    expect(order(xml)).toEqual(['1', '2', '1 (2nd time)', '2 (2nd time)', '3', '4', '1 (3rd time)', '2 (3rd time)']);
  });

  it('D.C. al Fine in the lower part of a 2nd-ending bar whose upper part carries the ending is followed', () => {
    // ||: 1 (Fine) | [1. 2 :|| | [2. 3 (D.C. al Fine, lower part only) | 4
    const xml = twoParts(
      [FORWARD + note('C', 5) + FINE, ENDING_1_START + note('D', 5) + ENDING_1_STOP, ENDING_2_START + note('E', 5) + ENDING_2_STOP, note('F', 5)],
      [FORWARD + note('C', 3), ENDING_1_START + note('D', 3) + ENDING_1_STOP, ENDING_2_START + note('E', 3) + DC + ENDING_2_STOP, note('F', 3)],
    );
    const source = parseMusicXml(xml);
    expect(source.measures[2].daCapo).toBe(true);
    // The ending marks written in both parts are not doubled.
    expect(source.measures[2].endings).toEqual([
      { numbers: [2], type: 'start' },
      { numbers: [2], type: 'stop' },
    ]);
    expect(source.measures[1].endings).toEqual([
      { numbers: [1], type: 'start' },
      { numbers: [1], type: 'stop' },
    ]);
    expect(order(xml)).toEqual(['1', '2', '1 (2nd time)', '3', '1 (3rd time)']);
  });

  it('a segno in the lower part is found when the upper part of that measure has a forward repeat', () => {
    // 1 | ||: 2 (segno, lower part) | 3 :|| | 4 (Fine, upper) | 5 (D.S. al Fine, lower)
    const xml = twoParts(
      [note('C', 5), FORWARD + note('D', 5), note('E', 5) + BACKWARD, note('F', 5) + FINE, note('G', 5)],
      [note('C', 3), SEGNO + note('D', 3), note('E', 3) + BACKWARD, note('F', 3), note('G', 3) + DS],
    );
    const source = parseMusicXml(xml);
    expect(source.measures[1]).toMatchObject({ segno: true, repeatForward: true });
    expect(order(xml)).toEqual([
      '1',
      '2',
      '3',
      '2 (2nd time)',
      '3 (2nd time)',
      '4',
      '5',
      '2 (3rd time)',
      '3 (3rd time)',
      '4 (2nd time)',
    ]);
  });

  it('the first part with a backward repeat gives the repeat count', () => {
    const times3 = '<barline location="right"><repeat direction="backward" times="3"/></barline>';
    const xml = twoParts([note('C', 5), note('D', 5) + times3], [note('C', 3), note('D', 3) + BACKWARD]);
    expect(parseMusicXml(xml).measures[1].repeatBackwardTimes).toBe(3);
  });
});
