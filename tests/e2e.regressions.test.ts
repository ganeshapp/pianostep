/**
 * Regression tests for problems found by running the whole library through
 * the core pipeline. Each case is a small MusicXML document run end to end
 * (parse -> prepare -> derive -> round trip), plus the library file that
 * exposed it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../src/core/actions/derive';
import { roundTrip } from '../src/core/actions/interpret';
import { tickToSeconds } from '../src/core/model/performance';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore, parseMusicXml } from '../src/core/musicxml/parse';
import { midiToLabel } from '../src/core/pitch';
import type { Hand, PreparedScore, StepSequence } from '../src/core/types';
import { CUE_NOTES } from './helpers/musicxmlSamples';
import { REST, add, change, press, replace } from './helpers/pressBuilder';

/* ------------------------------------------------------------------------ */
/* A tiny MusicXML writer: one part "Piano" with two staves                  */
/* ------------------------------------------------------------------------ */

interface NoteSpec {
  /** "C#4", "Bb3"; omit for a rest. */
  key?: string;
  dur: number;
  voice?: number;
  staff?: number;
  chord?: boolean;
  tie?: ('start' | 'stop')[];
  hidden?: boolean;
  muted?: boolean;
  trill?: boolean;
}

function pitchXml(key: string): string {
  const m = /^([A-G])(#|b)?(\d)$/.exec(key);
  if (!m) throw new Error(`bad key ${key}`);
  const alter = m[2] === '#' ? '<alter>1</alter>' : m[2] === 'b' ? '<alter>-1</alter>' : '';
  return `<pitch><step>${m[1]}</step>${alter}<octave>${m[3]}</octave></pitch>`;
}

function note(n: NoteSpec): string {
  const attrs = `${n.hidden ? ' print-object="no"' : ''}${n.muted ? ' dynamics="0.00"' : ''}`;
  const body = n.key ? pitchXml(n.key) : '<rest/>';
  const ties = (n.tie ?? []).map((t) => `<tie type="${t}"/>`).join('');
  const notations = n.trill ? '<notations><ornaments><trill-mark/></ornaments></notations>' : '';
  return (
    `<note${attrs}>${n.chord ? '<chord/>' : ''}${body}<duration>${n.dur}</duration>${ties}` +
    `<voice>${n.voice ?? 1}</voice><staff>${n.staff ?? 1}</staff>${notations}</note>`
  );
}

const notes = (...specs: NoteSpec[]): string => specs.map(note).join('');
const backup = (dur: number): string => `<backup><duration>${dur}</duration></backup>`;
const forward = (dur: number, voice = 1, staff = 1): string =>
  `<forward><duration>${dur}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`;

interface MeasureSpec {
  content: string;
  forwardRepeat?: boolean;
  backwardRepeat?: boolean;
  /** Ending bracket on this measure: number and which ends are marked. */
  ending?: { number: string; start?: boolean; stop?: 'stop' | 'discontinue' };
}

function scoreXml(divisions: number, measures: MeasureSpec[]): string {
  const body = measures
    .map((m, i) => {
      const left: string[] = [];
      const right: string[] = [];
      if (m.forwardRepeat) left.push('<repeat direction="forward"/>');
      if (m.ending?.start) left.push(`<ending number="${m.ending.number}" type="start"/>`);
      if (m.ending?.stop) right.push(`<ending number="${m.ending.number}" type="${m.ending.stop}"/>`);
      if (m.backwardRepeat) right.push('<repeat direction="backward"/>');
      const attributes =
        i === 0
          ? `<attributes><divisions>${divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time>` +
            '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>' +
            '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
          : '';
      return (
        `<measure number="${i + 1}">` +
        (left.length ? `<barline location="left">${left.join('')}</barline>` : '') +
        attributes +
        m.content +
        (right.length ? `<barline location="right">${right.join('')}</barline>` : '') +
        '</measure>'
      );
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${body}</part></score-partwise>`
  );
}

function prepareXml(xml: string): PreparedScore {
  return prepareScore(parseMusicXml(xml));
}

/** "R C4 0-144": hand, key and tick span of every press. */
function pressList(p: PreparedScore, hand?: Hand): string[] {
  return p.presses
    .filter((x) => hand === undefined || x.hand === hand)
    .map((x) => `${x.hand} ${midiToLabel(x.midi)} ${x.startTick}-${x.endTick}`);
}

function checkedSteps(p: PreparedScore, hands: Hand[]): StepSequence {
  const seq = deriveSteps(p, hands, null);
  expect(roundTrip(seq).mismatches).toEqual([]);
  return seq;
}

const codes = (p: PreparedScore): string[] => p.warnings.map((w) => w.code);
const labels = (p: PreparedScore): string[] => p.measures.map((o) => o.label);

/** A whole note on the right hand: one measure of 4/4 at divisions 1. */
const whole = (key: string): string => notes({ key, dur: 4 });

const LIBRARY = join(__dirname, '..', 'public', 'scores');
function prepareLibrary(file: string): PreparedScore {
  return prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(LIBRARY, file))), file));
}

/* ------------------------------------------------------------------------ */

describe('volta brackets whose end the file never marks', () => {
  it('a 2nd ending left open does not swallow the next repeated section (Für Elise)', () => {
    // 1 |[1. 2 :| [2. 3 (never closed) |: 4 [1. 5 :| [2. 6
    const p = prepareXml(
      scoreXml(1, [
        { content: whole('C4') },
        { content: whole('D4'), ending: { number: '1', start: true, stop: 'stop' }, backwardRepeat: true },
        { content: whole('E4'), ending: { number: '2', start: true } },
        { content: whole('F4'), forwardRepeat: true },
        { content: whole('G4'), ending: { number: '1', start: true, stop: 'stop' }, backwardRepeat: true },
        { content: whole('A4'), ending: { number: '2', start: true, stop: 'discontinue' } },
      ]),
    );
    expect(labels(p)).toEqual(['1', '2', '1 (2nd time)', '3', '4', '5', '4 (2nd time)', '6']);
    expect(codes(p)).not.toContain('repeats-unsupported');
  });

  it('a 1st ending left open ends at its repeat sign, so the music after it is still played', () => {
    // 1 [1. 2 :| (no ending stop, no 2nd ending) 3 4
    const p = prepareXml(
      scoreXml(1, [
        { content: whole('C4') },
        { content: whole('D4'), ending: { number: '1', start: true }, backwardRepeat: true },
        { content: whole('E4') },
        { content: whole('F4') },
      ]),
    );
    expect(labels(p)).toEqual(['1', '2', '1 (2nd time)', '3', '4']);
  });

  it('a 1st ending that starts on the ||: plays once, then the 2nd ending is played', () => {
    // 1 | ||:[1. 2 :|| | [2. 3 | 4
    const p = prepareXml(
      scoreXml(1, [
        { content: whole('C4') },
        { content: whole('D4'), forwardRepeat: true, ending: { number: '1', start: true, stop: 'stop' }, backwardRepeat: true },
        { content: whole('E4'), ending: { number: '2', start: true, stop: 'discontinue' } },
        { content: whole('F4') },
      ]),
    );
    expect(labels(p)).toEqual(['1', '2', '3', '4']);
    expect(p.readiness).toBe('ready');
    const seq = checkedSteps(p, ['R']);
    expect(seq.steps.flatMap((s) => (s.attacks.R ?? []).map(midiToLabel))).toEqual(['C4', 'D4', 'E4', 'F4']);
  });

  it('Für Elise.mxl now plays its second repeated section like the fingered edition', () => {
    const a = prepareLibrary('Fur_Elise.mxl');
    const b = prepareLibrary('Fur_Elise_fingered.mxl');
    expect(a.measures.length).toBe(127);
    expect(a.measures.map((o) => o.label)).toEqual(b.measures.map((o) => o.label));
  });
});

describe('ties that bridge a short silence', () => {
  it('a broken chord tied into the chord that follows is held, not struck again', () => {
    // C4, E4, G4 played one after another and tied into the C4-E4-G4 chord ("let ring").
    const p = prepareXml(
      scoreXml(4, [
        {
          content:
            notes(
              { key: 'C4', dur: 1, tie: ['start'] },
              { key: 'E4', dur: 1, tie: ['start'] },
              { key: 'G4', dur: 2, tie: ['start'] },
              { key: 'C4', dur: 8, tie: ['stop'] },
              { key: 'E4', dur: 8, tie: ['stop'], chord: true },
              { key: 'G4', dur: 8, tie: ['stop'], chord: true },
              { dur: 4 },
            ) +
            backup(16) +
            notes({ dur: 16, voice: 5, staff: 2 }),
        },
      ]),
    );
    expect(pressList(p)).toEqual(['R C4 0-144', 'R E4 12-144', 'R G4 24-144']);
    expect(codes(p)).not.toContain('tie-unmatched');
    const seq = checkedSteps(p, ['R']);
    expect(seq.steps.map((s) => s.cells.R)).toStrictEqual([
      replace(press('C4')),
      change(add('E4')),
      change(add('G4')),
      REST,
    ]);
  });

  it('a tie across a short gap left by <forward> is held', () => {
    const p = prepareXml(
      scoreXml(4, [
        {
          content:
            notes({ dur: 16 }) +
            backup(16) +
            notes({ key: 'B3', dur: 2, voice: 5, staff: 2, tie: ['start'] }) +
            forward(2, 5, 2) +
            notes({ key: 'B3', dur: 12, voice: 5, staff: 2, tie: ['stop'] }),
        },
      ]),
    );
    expect(pressList(p)).toEqual(['L B3 0-192']);
    expect(codes(p)).not.toContain('tie-unmatched');
  });

  it('a tie whose partner is more than one beat away is played as a new note and reported', () => {
    const p = prepareXml(
      scoreXml(4, [
        {
          content:
            notes({ dur: 16 }) +
            backup(16) +
            notes({ key: 'B3', dur: 2, voice: 5, staff: 2, tie: ['start'] }) +
            forward(6, 5, 2) +
            notes({ key: 'B3', dur: 8, voice: 5, staff: 2, tie: ['stop'] }),
        },
      ]),
    );
    expect(pressList(p)).toEqual(['L B3 0-24', 'L B3 96-192']);
    expect(p.warnings.find((w) => w.code === 'tie-unmatched')).toMatchObject({ severity: 'info', count: 1, measures: ['1'] });
  });

  it('a key struck again inside the gap ends the tie for good', () => {
    const p = prepareXml(
      scoreXml(4, [
        {
          content:
            notes(
              { key: 'C5', dur: 2, tie: ['start'] },
              { key: 'D5', dur: 1 },
              { key: 'C5', dur: 1 },
              { key: 'C5', dur: 4, tie: ['stop'] },
              { dur: 8 },
            ) +
            backup(16) +
            notes({ dur: 16, voice: 5, staff: 2 }),
        },
      ]),
    );
    expect(pressList(p)).toEqual(['R C5 0-24', 'R D5 24-36', 'R C5 36-48', 'R C5 48-96']);
    expect(codes(p)).toContain('tie-unmatched');
  });

  it('a gap is never bridged across a repeat jump', () => {
    // |: C5 tie-stop ... | ... C5 eighth tie-start, eighth rest :|
    const p = prepareXml(
      scoreXml(2, [
        {
          forwardRepeat: true,
          content: notes({ key: 'C5', dur: 2, tie: ['stop'] }, { key: 'E5', dur: 6 }) + backup(8) + notes({ dur: 8, voice: 5, staff: 2 }),
        },
        {
          backwardRepeat: true,
          content:
            notes({ key: 'D5', dur: 6 }, { key: 'C5', dur: 1, tie: ['start'] }, { dur: 1 }) +
            backup(8) +
            notes({ dur: 8, voice: 5, staff: 2 }),
        },
      ]),
    );
    expect(labels(p)).toEqual(['1', '2', '1 (2nd time)', '2 (2nd time)']);
    expect(pressList(p).filter((x) => x.startsWith('R C5'))).toEqual(['R C5 0-48', 'R C5 336-360', 'R C5 384-432', 'R C5 720-744']);
    expect(p.warnings.find((w) => w.code === 'tie-unmatched')?.count).toBe(2);
  });

  it('the Moonlight Sonata (3rd mvt) arpeggios tied into chords are held through the chord', () => {
    const p = prepareLibrary('moonlight_sonata_3rd_movement.mxl');
    expect(codes(p)).not.toContain('tie-unmatched');
    const m164 = p.measures.find((o) => o.label === '164')!;
    const tpq = p.source.ticksPerQuarter;
    const rh = p.presses.filter((x) => x.hand === 'R' && x.startTick >= m164.startTick && x.startTick < m164.startTick + tpq * 2);
    expect(rh.map((x) => `${midiToLabel(x.midi)}@${(x.startTick - m164.startTick) / tpq}+${(x.endTick - x.startTick) / tpq}`)).toEqual([
      'C#3@0.5+2',
      'E3@0.625+1.875',
      'G3@0.75+1.75',
      'A#3@0.875+1.625',
      'C#4@1+1.5',
    ]);
  });
});

describe('ornaments written out with hidden notes', () => {
  // 4/4 at divisions 8: quarter = 8, 32nd = 1; ticksPerQuarter 48, so one division = 6 ticks.
  const lhRest = backup(32) + notes({ dur: 32, voice: 5, staff: 2 });

  it('a silenced trill note is replaced by the hidden trill (Mozart K. 545)', () => {
    const p = prepareXml(
      scoreXml(8, [
        {
          content:
            notes({ key: 'G5', dur: 8 }, { key: 'F5', dur: 8, muted: true, trill: true }, { key: 'E5', dur: 16 }) +
            backup(24) +
            notes(
              { key: 'G5', dur: 2, voice: 2, hidden: true },
              { key: 'F5', dur: 2, voice: 2, hidden: true },
              { key: 'G5', dur: 2, voice: 2, hidden: true },
              { key: 'F5', dur: 2, voice: 2, hidden: true },
            ) +
            forward(16, 2) +
            lhRest,
        },
      ]),
    );
    expect(pressList(p, 'R')).toEqual(['R G5 0-48', 'R G5 48-60', 'R F5 60-72', 'R G5 72-84', 'R F5 84-96', 'R E5 96-192']);
    const other = p.warnings.find((w) => w.code === 'other');
    expect(other).toMatchObject({ severity: 'info', count: 1, measures: ['1'] });
    expect(other!.message).toBe(
      'Where the file spells out a trill or other ornament with hidden notes, those notes are played in place of the main note shown, from where they start.',
    );
    expect(codes(p)).not.toContain('ornament-not-played');
    expect(codes(p)).not.toContain('voice-overlap-same-key');
    expect(p.readiness).toBe('ready');
    checkedSteps(p, ['R', 'L']);
  });

  it('a trill note with a hidden realisation of its own pitch is replaced, tied continuation included', () => {
    // Visible B4 half (trill) tied to B4 quarter; hidden B4/C5 32nds over all three beats; then C5.
    const realisation: NoteSpec[] = Array.from({ length: 12 }, (_, i) => ({
      key: i % 2 === 0 ? 'B4' : 'C5',
      dur: 2,
      voice: 2,
      hidden: true,
    }));
    const p = prepareXml(
      scoreXml(8, [
        {
          content:
            notes(
              { key: 'B4', dur: 16, tie: ['start'], trill: true },
              { key: 'B4', dur: 8, tie: ['stop'] },
              { key: 'C5', dur: 8 },
            ) +
            backup(32) +
            notes(...realisation) +
            forward(8, 2) +
            lhRest,
        },
      ]),
    );
    const expected = realisation.map((r, i) => `R ${r.key} ${i * 12}-${i * 12 + 12}`);
    expect(pressList(p, 'R')).toEqual([...expected, 'R C5 144-192']);
    expect(p.warnings.find((w) => w.code === 'other')?.count).toBe(2);
    for (const code of ['ornament-not-played', 'tie-unmatched', 'voice-overlap-same-key']) expect(codes(p)).not.toContain(code);
    checkedSteps(p, ['R']);
  });

  it('a trill with no hidden notes keeps its main note and marks the piece for review (§12)', () => {
    const p = prepareXml(
      scoreXml(8, [{ content: notes({ key: 'F5', dur: 16, trill: true }, { key: 'E5', dur: 16 }) + lhRest }]),
    );
    expect(pressList(p, 'R')).toEqual(['R F5 0-96', 'R E5 96-192']);
    expect(p.warnings.find((w) => w.code === 'ornament-not-played')).toMatchObject({ severity: 'review', count: 1 });
    expect(p.readiness).toBe('review');
    expect(codes(p)).not.toContain('other');
  });

  it('a silenced note with no hidden notes sounding over it is kept (it is still shown in the score)', () => {
    const p = prepareXml(
      scoreXml(8, [
        {
          content:
            notes({ key: 'E5', dur: 8, muted: true }, { key: 'C5', dur: 8 }, { key: 'D5', dur: 16 }) +
            backup(16) +
            notes({ key: 'G4', dur: 2, voice: 2, hidden: true }) +
            forward(14, 2) +
            lhRest,
        },
      ]),
    );
    expect(pressList(p, 'R')).toEqual(['R E5 0-48', 'R C5 48-96', 'R G4 96-108', 'R D5 96-192']);
    expect(codes(p)).not.toContain('other');
  });

  it('a silenced note that stays in the music is played at the loudness around it, and that is reported', () => {
    // <sound dynamics="80"/> sets velocity 72 for the measure; E5 has dynamics="0" and no hidden notes over it.
    const p = prepareXml(
      scoreXml(8, [
        {
          content:
            '<sound dynamics="80"/>' +
            notes({ key: 'E5', dur: 8, muted: true }, { key: 'C5', dur: 8 }, { key: 'D5', dur: 16 }) +
            lhRest,
        },
      ]),
    );
    expect(pressList(p, 'R')).toEqual(['R E5 0-48', 'R C5 48-96', 'R D5 96-192']);
    expect(p.presses.filter((x) => x.hand === 'R').map((x) => x.velocity)).toEqual([72, 72, 72]);
    expect(p.warnings.find((w) => w.code === 'silent-notes-played')).toMatchObject({ severity: 'info', measures: ['1'], count: 1 });
    expect(p.readiness).toBe('ready');
  });

  it('a note the file both hides and silences is left out', () => {
    const p = prepareXml(
      scoreXml(8, [
        { content: notes({ key: 'C5', dur: 32 }) + backup(32) + notes({ key: 'G4', dur: 32, voice: 2, hidden: true, muted: true }) + lhRest },
      ]),
    );
    expect(pressList(p, 'R')).toEqual(['R C5 0-192']);
    expect(codes(p)).not.toContain('silent-notes-played');
    expect(p.warnings.find((w) => w.code === 'other')?.message).toContain('both hides and silences');
  });

  it('The Entertainer: the silenced 2nd-ending chords are heard at the loudness around them', () => {
    const p = prepareLibrary('The_Entertainer_-_Scott_Joplin.mxl');
    const silenced = p.source.notes.filter((n) => n.measureIndex === 37 && n.partId === 'P1' && (n.midi === 76 || n.midi === 84));
    expect(silenced.length).toBe(2);
    for (const n of silenced) expect(n.velocity ?? 80).toBeGreaterThan(1);
    expect(p.warnings.find((w) => w.code === 'silent-notes-played')?.measures).toEqual(['38', '92']);
  });

  it('a visible trill whose hidden notes do not include its pitch is kept', () => {
    const p = prepareXml(
      scoreXml(8, [
        {
          content:
            notes({ key: 'F5', dur: 16, trill: true }, { key: 'E5', dur: 16 }) +
            backup(32) +
            notes({ key: 'A3', dur: 16, voice: 2, hidden: true }) +
            forward(16, 2) +
            lhRest,
        },
      ]),
    );
    expect(pressList(p, 'R')).toEqual(['R A3 0-96', 'R F5 0-96', 'R E5 96-192']);
    expect(codes(p)).toContain('ornament-not-played');
  });

  it('Mozart K. 545 m4: the trill is played as written out, never as F5 and G5 together', () => {
    const p = prepareLibrary('Sonata_No._16_1st_Movement_K._545.mxl');
    expect(codes(p)).not.toContain('voice-overlap-same-key');
    const seq = deriveSteps(p, ['R'], { startOcc: 3, endOcc: 3 });
    expect(seq.steps.map((s) => s.cells.R)).toStrictEqual([
      replace(press('G5')),
      replace(press('G5')),
      replace(press('F5')),
      replace(press('G5')),
      replace(press('F5')),
      replace(press('E5')),
      replace(press('F5')),
      replace(press('E5')),
      REST,
    ]);
  });
});

describe('warning measure lists', () => {
  it('lists measures with overlapping same-key voices in playing order', () => {
    // m1: E4 struck by two voices that overlap; m2: C4 likewise. C4 is first seen in m1.
    const twoVoices = (key: string) =>
      notes({ key, dur: 4 }, { key: 'D4', dur: 4 }) + backup(8) + notes({ key, dur: 2, voice: 2 }, { key, dur: 2, voice: 2 }, { dur: 4, voice: 2 });
    const p = prepareXml(
      scoreXml(2, [
        { content: notes({ key: 'C4', dur: 8, voice: 3 }) + backup(8) + twoVoices('E4') },
        { content: twoVoices('C4') },
      ]),
    );
    const w = p.warnings.find((x) => x.code === 'voice-overlap-same-key');
    expect(w?.measures).toEqual(['1', '2']);
    checkedSteps(p, ['R']);
  });
});

describe('Gymnopédie No. 1 (Erik Satie edition): left-hand chords written in the treble staff', () => {
  /** The checked override for this file: voice 1 of the treble staff is the left hand's chords, except in measures 19–21 and 37–39 and 45–47. */
  const OVERRIDE = {
    voiceHands: [{ part: 'P1', voice: '1', hand: 'L' as const, measures: [[0, 17], [31, 35], [39, 43]] as [number, number][] }],
    reason: 'The left-hand chords are written in the upper staff.',
  };
  const prepareWith = (file: string, overrides?: Parameters<typeof prepareScore>[1]) =>
    prepareScore(loadSourceScore(new Uint8Array(readFileSync(join(LIBRARY, file))), file), overrides);

  /** Per measure occurrence: hand, key and beat of every attack. */
  function attacksByOccurrence(p: PreparedScore): string[] {
    const tpq = p.tempo.ticksPerQuarter;
    return p.measures.map((o) =>
      p.presses
        .filter((k) => k.startTick >= o.startTick && k.startTick < o.startTick + o.durationTicks)
        .map((k) => `${k.hand}${midiToLabel(k.midi)}@${(k.startTick - o.startTick) / tpq}`)
        .sort()
        .join(' '),
    );
  }

  it('without a checked setting, the right hand would have to reach B3 to F#5 at once, so it needs review', () => {
    const p = prepareWith('Erik_Satie_-_Gymnopedie_No.1.mxl');
    expect(p.readiness).toBe('review');
    expect(p.warnings.find((w) => w.code === 'hand-span-too-wide')?.measures).toEqual(['5', '6', '13', '14', '36', '44']);
  });

  it('with the voice rule, it plays exactly like the other edition, which writes those chords in the bass staff', () => {
    const a = prepareWith('Erik_Satie_-_Gymnopedie_No.1.mxl', OVERRIDE);
    const b = prepareWith('Gymnopdie_No._1__Satie.mxl');
    expect(a.warnings.map((w) => w.code)).not.toContain('hand-span-too-wide');
    expect(a.readiness).toBe('ready');
    expect(b.readiness).toBe('ready');
    expect(a.tempo.ticksPerQuarter).toBe(b.tempo.ticksPerQuarter);
    expect(attacksByOccurrence(a)).toEqual(attacksByOccurrence(b));
    checkedSteps(a, ['R', 'L']);
  });
});

/** Presses starting in a measure: "R G#5@4+0.5" = hand, key, start and length in quarter notes from the measure start. */
function pressesInMeasure(p: PreparedScore, label: string): string[] {
  const o = p.measures.find((m) => m.label === label)!;
  const tpq = p.tempo.ticksPerQuarter;
  return p.presses
    .filter((x) => x.startTick >= o.startTick && x.startTick < o.startTick + o.durationTicks)
    .map((x) => `${x.hand} ${midiToLabel(x.midi)}@${(x.startTick - o.startTick) / tpq}+${(x.endTick - x.startTick) / tpq}`);
}

/** Keys held down by both hands at the same moment (no pianist can do that), in one measure. */
function keysHeldByBothHands(p: PreparedScore, label: string): string[] {
  const o = p.measures.find((m) => m.label === label)!;
  const during = p.presses.filter((x) => x.startTick < o.startTick + o.durationTicks && x.endTick > o.startTick);
  const out: string[] = [];
  const right = during.filter((x) => x.hand === 'R');
  for (const l of during.filter((x) => x.hand === 'L')) {
    for (const r of right) {
      if (r.midi === l.midi && r.startTick < l.endTick && l.startTick < r.endTick) out.push(`${midiToLabel(l.midi)}@${l.startTick}`);
    }
  }
  return out;
}

describe('small cue notes', () => {
  it('a written-out cadenza in cue notes is played by its hand at its written times; other small notes stay silent', () => {
    const p = prepareXml(CUE_NOTES);
    // m1: the cadenza after A4, crossing into the bass staff; the left hand lets go after its half notes.
    expect(pressesInMeasure(p, '1')).toEqual([
      'R A4@0+2',
      'L C3@0+2',
      'L G3@0+2',
      'R G4@2+0.5',
      'R F4@2.5+0.5',
      'R E4@3+0.5',
      'R D4@3.5+0.5',
      'R C4@4+2',
      'R E4@4+2',
    ]);
    // m2: the written-out trill and the cue note beside B4 are silent; G4 still comes on beat 2.
    expect(pressesInMeasure(p, '2')).toEqual(['R B4@0+2', 'L C3@0+4', 'R G4@1+1', 'R C5@2+2']);
    // m3: the hidden G5 is the file's own playback of that spot, so the printed cue G5 is not struck again.
    expect(pressesInMeasure(p, '3')).toEqual(['R G5@0+0.5', 'L C3@0+4']);
    expect(p.warnings.find((w) => w.code === 'cue-notes-played')).toMatchObject({ severity: 'info', count: 6, measures: ['1'] });
    expect(p.warnings.find((w) => w.code === 'cue-notes-skipped')).toMatchObject({ severity: 'info', count: 6, measures: ['1', '2', '3'] });
    checkedSteps(p, ['R', 'L']);
    checkedSteps(p, ['R']);
  });

  it('Moonlight Sonata, 3rd mvt: the cadenza of measure 188 is played as written, at the tempo marks inside it', () => {
    const p = prepareLibrary('Sonate_No._14_Moonlight_3rd_Movement.mxl');
    // 27 eighths from beat 5, then three quarters (B# is shown as C).
    const eighths = 'G#5 F#5 E5 D#5 F#5 C#5 C5 D#5 A4 G#4 F#4 A4 E4 D#4 F#4 C#4 C4 D#4 A3 G#3 F#3 A3 E3 D#3 F#3 C#3 C3';
    expect(pressesInMeasure(p, '188')).toEqual([
      'R A5@0+4',
      'L G#3@0+4',
      'L C4@0+4',
      'L F#4@0+4',
      ...eighths.split(' ').map((key, i) => `R ${key}@${4 + i / 2}+0.5`),
      'R D#3@17.5+1',
      'R A2@18.5+1',
      'R G#2@19.5+1',
    ]);
    expect(p.warnings.find((w) => w.code === 'cue-notes-played')).toMatchObject({ count: 30, measures: ['188'] });
    // 144 qpm for 4.5 quarters, 134 for 2.5, 124 for 3.5, 114 for the last 6.
    const o = p.measures.find((m) => m.label === '188')!;
    const tpq = p.tempo.ticksPerQuarter;
    const cadenzaSeconds = tickToSeconds(p.tempo, o.startTick + o.durationTicks) - tickToSeconds(p.tempo, o.startTick + 4 * tpq);
    expect(cadenzaSeconds).toBeCloseTo((4.5 * 60) / 144 + (2.5 * 60) / 134 + (3.5 * 60) / 124 + (6 * 60) / 114, 9);
    expect(keysHeldByBothHands(p, '188')).toEqual([]);
    checkedSteps(p, ['R', 'L']);
  });

  it('both Moonlight 3rd-movement editions now play the same notes in measure 188 (the other writes the cadenza as grace notes)', () => {
    const rightKeys = (file: string): string[] => {
      const p = prepareLibrary(file);
      const o = p.measures.find((m) => m.label === '188')!;
      return p.presses
        .filter((x) => x.hand === 'R' && x.startTick >= o.startTick && x.startTick < o.startTick + o.durationTicks)
        .map((x) => midiToLabel(x.midi));
    };
    const keys = rightKeys('Sonate_No._14_Moonlight_3rd_Movement.mxl');
    expect(keys).toHaveLength(31);
    expect(keys).toEqual(rightKeys('moonlight_sonata_3rd_movement.mxl'));
  });

  it('cue notes beside the regular notes stay silent, so nothing is doubled (Moonlight trills, Prelude No. 2, La Campanella)', () => {
    const moonlight = prepareLibrary('Sonate_No._14_Moonlight_3rd_Movement.mxl');
    // Measure 30: a trill written out in small notes over A#5 and B5; only the written notes are struck.
    expect(pressesInMeasure(moonlight, '30').filter((x) => x.startsWith('R'))).toEqual(['R A#4@0+1', 'R A#5@0+1', 'R B4@1+3', 'R B5@1+3']);
    expect(moonlight.warnings.find((w) => w.code === 'cue-notes-skipped')).toMatchObject({
      count: 58,
      measures: ['30', '32', '36', '126', '128', '132', '188'],
    });

    // Prelude No. 2, measure 34: hidden small chords restate the regular chords, with <cue/> on their
    // first note only. None of them sounds, so the mordent F4 is held for its written length instead
    // of being cut to a 64th by a hidden F4 taken for its ornament.
    const prelude = prepareLibrary('Prelude_No._2_BWV_847_in_C_Minor.mxl');
    expect(prelude.source.notes.filter((n) => n.measureIndex === 33 && !n.printed)).toEqual([]);
    const m34 = pressesInMeasure(prelude, '34');
    expect(m34.slice(0, 5)).toEqual(['R C4@0+0.625', 'R E4@0+0.625', 'L C3@0+1', 'L G3@0+1', 'L A#3@0+1']);
    expect(m34).toContain('R F4@2+0.625');
    expect(prelude.warnings.find((w) => w.code === 'cue-notes-skipped')).toMatchObject({ count: 20, measures: ['34'] });
    expect(prelude.warnings.find((w) => w.code === 'ornament-not-played')?.measures).toEqual(['34']);
    expect(prelude.warnings.map((w) => w.code)).not.toContain('cue-notes-played');

    // La Campanella, measure 105: the arpeggio ends on the file's hidden G#6; the printed small B6 and
    // G#6 above it only show that ending, so G#6 is struck once.
    const campanella = prepareLibrary('La_Campanella_-_Grandes_Etudes_de_Paganini_No._3_-_Franz_Liszt.mxl');
    const m105 = pressesInMeasure(campanella, '105');
    expect(m105.filter((x) => x.startsWith('R G#6'))).toEqual(['R G#6@1.375+0.125']);
    expect(m105).toHaveLength(12);
    expect(campanella.warnings.map((w) => w.code)).not.toContain('cue-notes-played');

    expect(keysHeldByBothHands(moonlight, '30')).toEqual([]);
    expect(keysHeldByBothHands(prelude, '34')).toEqual([]);
    expect(keysHeldByBothHands(campanella, '105')).toEqual([]);
  });
});

describe('the catalog card notes about hidden notes', () => {
  it('"Has N hidden playback-only notes" counts the hidden notes the app keeps (hidden cue notes are not among them)', () => {
    const metadata = JSON.parse(readFileSync(join(__dirname, '..', 'catalog', 'metadata.json'), 'utf8')) as {
      file: string;
      notes?: string[];
    }[];
    const claims = metadata.flatMap((m) =>
      (m.notes ?? []).flatMap((note) => {
        const n = /^Has (\d+) hidden playback-only notes\b/.exec(note)?.[1];
        return n === undefined ? [] : [{ file: m.file, count: Number(n) }];
      }),
    );
    expect(claims.map((c) => c.file)).toEqual(
      expect.arrayContaining(['Prelude_No._2_BWV_847_in_C_Minor.mxl', 'Sonate_No._14_Moonlight_3rd_Movement.mxl']),
    );
    for (const { file, count } of claims) {
      const source = loadSourceScore(new Uint8Array(readFileSync(join(LIBRARY, file))), file);
      expect(source.notes.filter((n) => !n.printed).length, file).toBe(count);
    }
  });
});

describe('a first tempo mark after the opening', () => {
  it('Prelude No. 2 (BWV 847): the unmarked opening plays at 120 until the Presto (145) in measure 28', () => {
    const p = prepareLibrary('Prelude_No._2_BWV_847_in_C_Minor.mxl');
    const m28 = p.measures.find((o) => o.label === '28')!;
    expect(p.tempo.defaulted).toBe(false);
    expect(p.tempo.points.slice(0, 3)).toEqual([
      { tick: 0, qpm: 120 },
      { tick: m28.startTick, qpm: 145 },
      { tick: p.measures.find((o) => o.label === '34')!.startTick, qpm: 20 },
    ]);
    // 27 measures of 4/4 at 120 quarter notes per minute: 54 s.
    expect(tickToSeconds(p.tempo, m28.startTick)).toBeCloseTo(54, 9);
    expect(p.warnings.find((w) => w.code === 'opening-tempo-defaulted')).toEqual({
      code: 'opening-tempo-defaulted',
      severity: 'info',
      message:
        'The opening has no tempo mark, so the app plays it at 120 quarter notes per minute until the first marked tempo (measure 28).',
      count: 1,
    });
  });

  it('Beethoven 5: a first mark a beat into measure 1 still applies from the very start', () => {
    const p = prepareLibrary('Beethoven_Symphony_No._5_1st_movement_Piano_solo.mxl');
    expect(p.source.tempos[0]).toMatchObject({ measureIndex: 0, qpm: 164 });
    expect(p.source.tempos[0].tick).toBeGreaterThan(0);
    expect(p.tempo.points[0]).toEqual({ tick: 0, qpm: 164 });
    expect(p.warnings.map((w) => w.code)).not.toContain('opening-tempo-defaulted');
  });
});
