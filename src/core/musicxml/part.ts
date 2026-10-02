import { isPitchStep } from '../pitch';
import type { EndingMark, PitchStep, SpelledPitch, StaffDetails } from '../types';
import { attr, childElements, childNumber, childText, firstChild, nameOf, normalizeSpace, textOf, toNumber } from './dom';
import {
  dynamicsToVelocity,
  isUsableTempo,
  metronomeQpm,
  parseEndingNumbers,
  readJumpWords,
  readTimeSignature,
} from './notation';
import type { WarningSink } from './warnings';

/** A note whose final onset depends on measure start ticks known only after all parts are read. */
export interface DraftNote {
  partId: string;
  staff: number;
  voice: string;
  measureIndex: number;
  /** Position of the <note> element among the measure's <note> elements in this part. */
  ordinal: number;
  /** Measure whose start `local` is relative to (differs from measureIndex only for borrowed grace time). */
  refMeasure: number;
  local: number;
  duration: number;
  spelled: SpelledPitch;
  /** Semitones added by <transpose>. */
  transpose: number;
  tieStart: boolean;
  tieStop: boolean;
  grace: boolean;
  chord: boolean;
  tuplet: boolean;
  velocity?: number;
  printed: boolean;
  /**
   * The note asks for zero loudness (`dynamics="0"`): the file's own playback
   * keeps it silent. Its `velocity` is the loudness around it instead.
   */
  muted: boolean;
  /** Carries a trill, mordent or turn sign. */
  ornament: boolean;
}

export interface NavMarks {
  repeatForward: boolean;
  repeatBackwardTimes: number | null;
  endings: EndingMark[];
  segno: boolean;
  coda: boolean;
  fine: boolean;
  daCapo: boolean;
  dalSegno: boolean;
  toCoda: boolean;
}

export type TimeSignature = { beats: number; beatType: number };

export interface PartMeasure {
  present: boolean;
  number: string | null;
  implicit: boolean;
  /** Furthest cursor position reached in this measure (notes, backup, forward). */
  length: number;
  time: TimeSignature | null;
  marks: NavMarks;
  hasMarks: boolean;
}

export interface DraftTempo {
  measureIndex: number;
  local: number;
  qpm: number;
}

export interface PartResult {
  staves: number;
  clefs: Record<number, string>;
  hiddenStaves: number[];
  /** Per-staff ossia hints (staff type, size, words placed on the staff); empty when the file gives none. */
  staffDetails: Record<number, StaffDetails>;
  words: string[];
  measures: PartMeasure[];
  notes: DraftNote[];
  tempos: DraftTempo[];
  pedalMarks: number;
}

/** Where a measure's attributes (number, implicit) and its music content live. */
export interface MeasureSource {
  attrs: Element;
  content: Element;
}

interface ChordGroup {
  notes: DraftNote[];
  refMeasure: number;
  local: number;
  /** Ticks taken from the start of this chord by preceding grace notes. */
  steal: number;
}

interface VoiceState {
  /** Grace slots waiting for their principal; a grace chord is one slot. */
  pending: DraftNote[][];
  /** Last sounding non-grace chord in this voice. */
  last: ChordGroup | null;
}

interface NoteFields {
  grace: boolean;
  cue: boolean;
  chord: boolean;
  rest: boolean;
  unpitched: boolean;
  pitch: SpelledPitch | null;
  badPitch: boolean;
  /** The pitch names an octave outside MusicXML's 0-9: beyond every keyboard. */
  pitchBeyondKeys: boolean;
  duration: number | null;
  tieStart: boolean;
  tieStop: boolean;
  hasTie: boolean;
  tiedStart: boolean;
  tiedStop: boolean;
  voice: string;
  staff: number;
  tuplet: boolean;
  ornament: boolean;
  tremolo: boolean;
  arpeggiate: boolean;
  /** Starts a <glissando> or <slide> line to a later note. */
  glissando: boolean;
}

const MAX_WORDS = 50;
/**
 * Words asking for a passage an octave (or two) higher or lower: "8va",
 * "8va bassa", "8vb", "8ve", "15ma", "15mb", "ottava". Unlike an
 * <octave-shift> line, whose notes are already stored at the pitch they sound,
 * such text leaves the notes at the written pitch.
 */
const OCTAVE_TEXT = /(?:^|[^\w])(?:8va|8vb|8ve|15ma|15mb|ottava)(?![a-z])/i;
/** Words kept per staff for the ossia check. */
const MAX_STAFF_WORDS = 10;
/** Most staves one part may declare; larger <staves> values are ignored. */
export const MAX_STAVES = 64;

const ORNAMENTS = new Set([
  'trill-mark',
  'mordent',
  'inverted-mordent',
  'turn',
  'inverted-turn',
  'delayed-turn',
  'delayed-inverted-turn',
  'vertical-turn',
  'inverted-vertical-turn',
  'shake',
  'haydn',
]);

function emptyMarks(): NavMarks {
  return {
    repeatForward: false,
    repeatBackwardTimes: null,
    endings: [],
    segno: false,
    coda: false,
    fine: false,
    daCapo: false,
    dalSegno: false,
    toCoda: false,
  };
}

function hasAnyMark(m: NavMarks): boolean {
  return (
    m.repeatForward ||
    m.repeatBackwardTimes !== null ||
    m.endings.length > 0 ||
    m.segno ||
    m.coda ||
    m.fine ||
    m.daCapo ||
    m.dalSegno ||
    m.toCoda
  );
}

/** Positive integer divisions value, as used for the tick LCM. */
export function divisionsValue(text: string | null): number | null {
  const n = toNumber(text);
  return n !== null && n > 0 ? Math.max(1, Math.round(n)) : null;
}

/**
 * Grace slot length: g = min(floor(D / (k + 1)), ticksPerQuarter / 8), at least
 * one tick, so k graces take at most k/(k+1) of the note they borrow from.
 */
export function graceSlotTicks(principalTicks: number, slots: number, ticksPerQuarter: number): number {
  return Math.max(1, Math.min(Math.floor(principalTicks / (slots + 1)), Math.floor(ticksPerQuarter / 8)));
}

/** Note on a note left out because no keyboard (and no MIDI sound) has its pitch. */
export const PITCH_BEYOND_KEYS = 'Some notes are pitched beyond the range of any keyboard and were left out.';
/** MusicXML octaves run from 0 to 9 (middle C is in octave 4). */
const MAX_OCTAVE = 9;
/** Largest transposition, in semitones, taken from a file: four octaves either way. */
export const MAX_TRANSPOSE = 48;

function readPitch(el: Element): { pitch: SpelledPitch | null; bad: boolean; beyondKeys: boolean } {
  const step = (childText(el, 'step') ?? '').toUpperCase();
  const octave = childNumber(el, 'octave');
  const alter = childNumber(el, 'alter') ?? 0;
  if (!isPitchStep(step) || octave === null || !Number.isInteger(octave)) return { pitch: null, bad: true, beyondKeys: false };
  // A damaged or hostile file can ask for octave 100000: no key, and no sound, has that pitch.
  // Any alteration is valid MusicXML (a library file spells D4 as F3 with nine sharps), so a
  // huge one is caught by the note's MIDI range instead (see buildNotes).
  if (octave < 0 || octave > MAX_OCTAVE) return { pitch: null, bad: false, beyondKeys: true };
  return { pitch: { step: step as PitchStep, alter, octave }, bad: false, beyondKeys: false };
}

function scanNotations(el: Element, f: NoteFields): void {
  for (const c of childElements(el)) {
    const name = nameOf(c);
    if (name === 'tied') {
      const type = attr(c, 'type');
      if (type === 'start' || type === 'continue') f.tiedStart = true;
      if (type === 'stop' || type === 'continue') f.tiedStop = true;
    } else if (name === 'ornaments') {
      for (const o of childElements(c)) {
        const on = nameOf(o);
        if (on === 'tremolo') f.tremolo = true;
        else if (ORNAMENTS.has(on)) f.ornament = true;
      }
    } else if (name === 'arpeggiate') {
      f.arpeggiate = true;
    } else if ((name === 'glissando' || name === 'slide') && attr(c, 'type') === 'start') {
      // A sweep (wavy line) or slide (straight line) from this note to the next.
      f.glissando = true;
    }
  }
}

function scanNote(el: Element): NoteFields {
  const f: NoteFields = {
    grace: false,
    cue: false,
    chord: false,
    rest: false,
    unpitched: false,
    pitch: null,
    badPitch: false,
    pitchBeyondKeys: false,
    duration: null,
    tieStart: false,
    tieStop: false,
    hasTie: false,
    tiedStart: false,
    tiedStop: false,
    voice: '1',
    staff: 1,
    tuplet: false,
    ornament: false,
    tremolo: false,
    arpeggiate: false,
    glissando: false,
  };
  for (const c of childElements(el)) {
    switch (nameOf(c)) {
      case 'grace':
        f.grace = true;
        break;
      case 'cue':
        f.cue = true;
        break;
      case 'chord':
        f.chord = true;
        break;
      case 'rest':
        f.rest = true;
        break;
      case 'unpitched':
        f.unpitched = true;
        break;
      case 'pitch': {
        const p = readPitch(c);
        f.pitch = p.pitch;
        f.badPitch = p.bad;
        f.pitchBeyondKeys = p.beyondKeys;
        break;
      }
      case 'duration':
        f.duration = toNumber(textOf(c));
        break;
      case 'tie': {
        f.hasTie = true;
        const type = attr(c, 'type');
        if (type === 'start') f.tieStart = true;
        else if (type === 'stop') f.tieStop = true;
        break;
      }
      case 'voice': {
        const v = normalizeSpace(textOf(c));
        if (v) f.voice = v;
        break;
      }
      case 'staff': {
        const s = toNumber(textOf(c));
        if (s !== null && Number.isInteger(s) && s >= 1) f.staff = s;
        break;
      }
      case 'time-modification':
        f.tuplet = true;
        break;
      case 'notations':
        scanNotations(c, f);
        break;
    }
  }
  if (!f.hasTie) {
    f.tieStart = f.tiedStart;
    f.tieStop = f.tiedStop;
  }
  return f;
}

/** Reads one part, measure by measure, in document order. */
export class PartReader {
  private divisions = 1;
  private staves = 1;
  /** A <staves> value above MAX_STAVES was seen (and ignored). */
  private implausibleStaves = false;
  private clefs: Record<number, string> = {};
  private hidden = new Set<number>();
  private staffDetails: Record<number, StaffDetails> = {};
  /** Semitone shift per staff number; key 0 applies to every staff. */
  private transpose = new Map<number, number>();
  private time: TimeSignature | null = null;
  private velocity: number | undefined;
  private words: string[] = [];
  private voices = new Map<string, VoiceState>();
  private notes: DraftNote[] = [];
  private tempos: DraftTempo[] = [];
  private pedalMarks = 0;
  private measures: PartMeasure[] = [];
  /** Within the current measure: an <octave-shift> was read / octave words were read. */
  private octaveShift = false;
  private octaveWords = false;

  private m = 0;
  private cursor = 0;
  private maxCursor = 0;
  private ordinal = 0;
  private marks: NavMarks = emptyMarks();
  private lastGroup: ChordGroup | null = null;
  private lastGraceSlot: DraftNote[] | null = null;
  private lastGraceVoice: string | null = null;

  constructor(
    private readonly partId: string,
    private readonly tpq: number,
    private readonly warnings: WarningSink,
  ) {}

  readMeasure(index: number, src: MeasureSource | undefined): void {
    this.m = index;
    this.cursor = 0;
    this.maxCursor = 0;
    this.ordinal = 0;
    this.marks = emptyMarks();
    this.lastGroup = null;
    this.lastGraceSlot = null;
    this.lastGraceVoice = null;
    this.octaveShift = false;
    this.octaveWords = false;

    if (src) {
      for (const el of childElements(src.content)) {
        switch (nameOf(el)) {
          case 'attributes':
            this.readAttributes(el);
            break;
          case 'note':
            this.readNote(el);
            break;
          case 'backup':
            this.cursor = Math.max(0, this.cursor - this.ticksOf(el));
            break;
          case 'forward':
            this.advance(this.ticksOf(el));
            break;
          case 'direction':
            this.readDirection(el);
            break;
          case 'sound':
            this.readSound(el, this.cursor, null);
            break;
          case 'barline':
            this.readBarline(el);
            break;
        }
      }
      for (const vs of this.voices.values()) this.resolveWithoutPrincipal(vs);
      // Octave words next to an <octave-shift> line label that line, which the pitches already follow.
      if (this.octaveWords && !this.octaveShift) this.warnings.add('octave-text-not-applied', index);
    }

    this.measures[index] = {
      present: src !== undefined,
      number: src ? attr(src.attrs, 'number') : null,
      implicit: src ? attr(src.attrs, 'implicit') === 'yes' : false,
      length: this.maxCursor,
      time: this.time,
      marks: this.marks,
      hasMarks: hasAnyMark(this.marks),
    };
  }

  finish(): PartResult {
    if (this.implausibleStaves) {
      for (const n of this.notes) if (n.staff > this.staves && n.staff <= MAX_STAVES) this.staves = n.staff;
    }
    return {
      staves: this.staves,
      clefs: this.clefs,
      hiddenStaves: [...this.hidden].sort((a, b) => a - b),
      staffDetails: this.staffDetails,
      words: this.words,
      measures: this.measures,
      notes: this.notes,
      tempos: this.tempos,
      pedalMarks: this.pedalMarks,
    };
  }

  /* -------------------------------------------------------------------- */

  private toTicks(divs: number | null): number {
    if (divs === null || divs <= 0) return 0;
    const exact = (divs * this.tpq) / this.divisions;
    const ticks = Math.round(exact);
    if (Math.abs(exact - ticks) > 1e-9) {
      this.warnings.add('other', this.m, 1, 'Some note lengths in the file were not exact and were rounded.');
    }
    return ticks;
  }

  private ticksOf(el: Element): number {
    return this.toTicks(childNumber(el, 'duration'));
  }

  private advance(ticks: number): void {
    this.cursor += ticks;
    if (this.cursor > this.maxCursor) this.maxCursor = this.cursor;
  }

  private voice(id: string): VoiceState {
    let vs = this.voices.get(id);
    if (!vs) {
      vs = { pending: [], last: null };
      this.voices.set(id, vs);
    }
    return vs;
  }

  private addWords(text: string): void {
    if (text && this.words.length < MAX_WORDS && !this.words.includes(text)) this.words.push(text);
  }

  private readAttributes(el: Element): void {
    for (const c of childElements(el)) {
      switch (nameOf(c)) {
        case 'divisions': {
          const d = divisionsValue(textOf(c));
          if (d !== null) this.divisions = d;
          break;
        }
        case 'staves': {
          const n = toNumber(textOf(c));
          if (n === null || !Number.isInteger(n) || n <= this.staves) break;
          // No real score has dozens of staves in one part; an absurd count
          // (a damaged file) is ignored and the staves that carry notes are
          // counted instead when the part is finished.
          if (n <= MAX_STAVES) this.staves = n;
          else this.implausibleStaves = true;
          break;
        }
        case 'clef': {
          const staff = toNumber(attr(c, 'number')) ?? 1;
          const sign = childText(c, 'sign');
          if (sign && !(staff in this.clefs)) this.clefs[staff] = sign;
          break;
        }
        case 'time':
          this.time = firstChild(c, 'senza-misura') ? null : (readTimeSignature(c) ?? this.time);
          break;
        case 'transpose': {
          const shift = Math.round((childNumber(c, 'chromatic') ?? 0) + 12 * (childNumber(c, 'octave-change') ?? 0));
          if (Math.abs(shift) > MAX_TRANSPOSE) {
            // No instrument transposes by more than a few octaves: a damaged value.
            this.warnings.add('other', this.m, 1, 'A transposition in the file is too large to be real, so it was ignored.');
            break;
          }
          this.transpose.set(toNumber(attr(c, 'number')) ?? 0, shift);
          break;
        }
        case 'staff-details':
          this.readStaffDetails(c);
          break;
      }
    }
  }

  private details(staff: number): StaffDetails {
    return (this.staffDetails[staff] ??= {});
  }

  private readStaffDetails(el: Element): void {
    const staff = toNumber(attr(el, 'number')) ?? 1;
    if (attr(el, 'print-object') === 'no') this.hidden.add(staff);
    const type = normalizeSpace(childText(el, 'staff-type') ?? '').toLowerCase();
    if (type && type !== 'regular') this.details(staff).type ??= type;
    const size = childNumber(el, 'staff-size');
    if (size !== null && size > 0 && size < 100) this.details(staff).size ??= size;
  }

  private transposeFor(staff: number): number {
    return this.transpose.get(staff) ?? this.transpose.get(0) ?? 0;
  }

  private makeDraft(el: Element, f: NoteFields, pitch: SpelledPitch, ordinal: number, local: number, duration: number): DraftNote {
    const muted = toNumber(attr(el, 'dynamics')) === 0;
    const draft: DraftNote = {
      partId: this.partId,
      staff: f.staff,
      voice: f.voice,
      measureIndex: this.m,
      ordinal,
      refMeasure: this.m,
      local,
      duration,
      spelled: pitch,
      transpose: this.transposeFor(f.staff),
      tieStart: f.tieStart,
      tieStop: f.tieStop,
      grace: f.grace,
      chord: f.chord,
      tuplet: f.tuplet,
      printed: attr(el, 'print-object') !== 'no',
      muted,
      ornament: f.ornament,
    };
    // A silenced note that stays in the music (see buildNotes) is shown and
    // practised, so it sounds at the loudness around it, never at velocity 1.
    const velocity = muted ? this.velocity : (dynamicsToVelocity(attr(el, 'dynamics')) ?? this.velocity);
    if (velocity !== undefined) draft.velocity = velocity;
    if (f.tremolo) this.warnings.add('tremolo-not-expanded', this.m);
    if (f.arpeggiate) this.warnings.add('arpeggio-not-rolled', this.m);
    if (f.glissando) this.warnings.add('glissando-not-played', this.m);
    return draft;
  }

  private readNote(el: Element): void {
    const ordinal = this.ordinal++;
    const f = scanNote(el);
    const ticks = this.toTicks(f.duration);
    const sounding = f.pitch !== null && !f.cue && !f.rest;

    if (f.cue && f.pitch) this.warnings.add('cue-notes-skipped', this.m);
    if (f.unpitched && !f.cue) {
      this.warnings.add('other', this.m, 1, 'Unpitched (percussion) notes are not played.');
    }
    if (f.badPitch && !f.cue) {
      this.warnings.add('other', this.m, 1, 'Some notes with an unreadable pitch were left out.');
    }
    if (f.pitchBeyondKeys && !f.cue) {
      this.warnings.add('out-of-piano-range', this.m);
      this.warnings.add('other', this.m, 1, PITCH_BEYOND_KEYS);
    }

    if (f.grace) {
      if (!sounding || !f.pitch) return;
      this.warnings.add('grace-notes-approximated', this.m);
      const draft = this.makeDraft(el, f, f.pitch, ordinal, 0, 0);
      if (f.chord && this.lastGraceSlot && this.lastGraceVoice === f.voice) {
        this.lastGraceSlot.push(draft);
      } else {
        const slot = [draft];
        this.voice(f.voice).pending.push(slot);
        this.lastGraceSlot = slot;
        this.lastGraceVoice = f.voice;
      }
      return;
    }
    this.lastGraceSlot = null;
    this.lastGraceVoice = null;

    if (f.chord) {
      if (!sounding || !f.pitch) return;
      if (ticks <= 0) {
        this.warnings.add('zero-length-note', this.m);
        return;
      }
      const group = this.lastGroup;
      const draft = this.makeDraft(el, f, f.pitch, ordinal, group ? group.local : this.cursor, ticks);
      if (group) {
        draft.refMeasure = group.refMeasure;
        draft.duration = Math.max(1, ticks - group.steal);
        group.notes.push(draft);
      }
      this.notes.push(draft);
      return;
    }

    // A cue note is silent but still occupies its written time in the voice.
    const onset = this.cursor;
    this.advance(ticks);
    const vs = this.voice(f.voice);
    if (!sounding || !f.pitch || ticks <= 0) {
      if (sounding && ticks <= 0) this.warnings.add('zero-length-note', this.m);
      this.resolveWithoutPrincipal(vs);
      this.lastGroup = { notes: [], refMeasure: this.m, local: onset, steal: 0 };
      return;
    }

    const draft = this.makeDraft(el, f, f.pitch, ordinal, onset, ticks);
    const group: ChordGroup = { notes: [draft], refMeasure: this.m, local: onset, steal: 0 };
    if (vs.pending.length > 0) {
      this.applyPrincipal(group, vs.pending);
      vs.pending = [];
    }
    vs.last = group;
    this.lastGroup = group;
    this.notes.push(draft);
  }

  /** Graces steal time from the start of the principal that follows them. */
  private applyPrincipal(group: ChordGroup, slots: DraftNote[][]): void {
    const k = slots.length;
    const d = group.notes[0].duration;
    const g = graceSlotTicks(d, k, this.tpq);
    slots.forEach((slot, j) => {
      for (const n of slot) {
        n.refMeasure = group.refMeasure;
        n.local = group.local + j * g;
        n.duration = g;
        this.notes.push(n);
      }
    });
    group.steal = k * g;
    group.local += k * g;
    for (const n of group.notes) {
      n.local = group.local;
      n.duration = Math.max(1, n.duration - k * g);
    }
  }

  /**
   * Graces with no following principal steal from the end of the previous
   * note in their voice; with no previous note they are dropped (they were
   * already counted in the grace warning).
   */
  private resolveWithoutPrincipal(vs: VoiceState): void {
    if (vs.pending.length === 0) return;
    const slots = vs.pending;
    vs.pending = [];
    const prev = vs.last;
    if (!prev || prev.notes.length === 0) return;
    const first = prev.notes[0];
    const d = first.duration;
    const end = first.local + d;
    const k = slots.length;
    const g = graceSlotTicks(d, k, this.tpq);
    const kept = Math.max(1, d - k * g);
    for (const n of prev.notes) if (n.local + n.duration === end) n.duration = kept;
    slots.forEach((slot, j) => {
      for (const n of slot) {
        n.refMeasure = prev.refMeasure;
        n.local = first.local + kept + j * g;
        n.duration = g;
        this.notes.push(n);
      }
    });
  }

  private pushTempo(local: number, qpm: number): void {
    this.tempos.push({ measureIndex: this.m, local, qpm });
  }

  private readSound(sound: Element, local: number, metronome: Element | null): void {
    const tempo = toNumber(attr(sound, 'tempo'));
    if (isUsableTempo(tempo)) this.pushTempo(local, tempo);
    else if (metronome) this.readMetronome(metronome, local);

    const velocity = dynamicsToVelocity(attr(sound, 'dynamics'));
    if (velocity !== undefined) this.velocity = velocity;

    const yes = (name: string) => {
      const v = attr(sound, name);
      return v !== null && v.trim() !== '' && v.trim() !== 'no';
    };
    if (yes('dacapo')) this.marks.daCapo = true;
    if (yes('dalsegno')) this.marks.dalSegno = true;
    if (yes('fine')) this.marks.fine = true;
    if (yes('tocoda')) this.marks.toCoda = true;
    if (yes('segno')) this.marks.segno = true;
    if (yes('coda')) this.marks.coda = true;
  }

  private readMetronome(metronome: Element, local: number): void {
    const qpm = metronomeQpm(metronome);
    if (isUsableTempo(qpm)) this.pushTempo(local, qpm);
  }

  private readDirection(el: Element): void {
    let offset = 0;
    let staff: number | null = null;
    let sound: Element | null = null;
    let metronome: Element | null = null;
    let segnoSign = false;
    let codaSign = false;
    const texts: string[] = [];

    for (const c of childElements(el)) {
      const name = nameOf(c);
      if (name === 'direction-type') {
        for (const d of childElements(c)) {
          switch (nameOf(d)) {
            case 'words':
              texts.push(textOf(d));
              break;
            case 'segno':
              segnoSign = true;
              break;
            case 'coda':
              codaSign = true;
              break;
            case 'metronome':
              metronome ??= d;
              break;
            case 'octave-shift':
              this.octaveShift = true;
              break;
            case 'pedal': {
              const type = attr(d, 'type');
              if (type !== 'stop' && type !== 'continue' && type !== 'discontinue') {
                this.pedalMarks++;
                this.warnings.add('pedal-not-modelled', this.m);
              }
              break;
            }
          }
        }
      } else if (name === 'offset') {
        const n = toNumber(textOf(c));
        if (n !== null) offset = Math.sign(n) * this.toTicks(Math.abs(n));
      } else if (name === 'sound') {
        sound = c;
      } else if (name === 'staff') {
        const n = toNumber(textOf(c));
        if (n !== null && Number.isInteger(n) && n >= 1) staff = n;
      }
    }

    const local = Math.max(0, this.cursor + offset);
    if (sound) this.readSound(sound, local, metronome);
    else if (metronome) this.readMetronome(metronome, local);

    const text = normalizeSpace(texts.join(' '));
    this.addWords(text);
    if (OCTAVE_TEXT.test(text)) this.octaveWords = true;
    if (text && staff !== null) {
      const words = (this.details(staff).words ??= []);
      if (words.length < MAX_STAFF_WORDS && !words.includes(text)) words.push(text);
    }
    const words = readJumpWords(text);
    const soundHas = (name: string) => sound !== null && sound.hasAttribute(name);
    if (words.daCapo && !soundHas('dacapo')) this.marks.daCapo = true;
    if (words.dalSegno && !soundHas('dalsegno')) this.marks.dalSegno = true;
    if (words.fine && !soundHas('fine')) this.marks.fine = true;
    if (words.toCoda && !soundHas('tocoda')) this.marks.toCoda = true;
    // A coda/segno sign printed as part of "To Coda" / "D.S." marks the jump, not the target.
    if (codaSign && !words.toCoda && !soundHas('tocoda')) this.marks.coda = true;
    if (segnoSign && !words.dalSegno && !soundHas('dalsegno')) this.marks.segno = true;
  }

  private readBarline(el: Element): void {
    for (const c of childElements(el)) {
      switch (nameOf(c)) {
        case 'repeat': {
          const direction = attr(c, 'direction');
          if (direction === 'forward') this.marks.repeatForward = true;
          else if (direction === 'backward') {
            const times = toNumber(attr(c, 'times'));
            this.marks.repeatBackwardTimes = times !== null && times >= 1 ? Math.round(times) : 2;
          }
          break;
        }
        case 'ending': {
          const type = attr(c, 'type');
          if (type === 'start' || type === 'stop' || type === 'discontinue') {
            let numbers = parseEndingNumbers(attr(c, 'number'));
            if (numbers.length === 0) numbers = parseEndingNumbers(textOf(c));
            this.marks.endings.push({ numbers, type });
          }
          break;
        }
        case 'segno':
          this.marks.segno = true;
          break;
        case 'coda':
          this.marks.coda = true;
          break;
      }
    }
  }
}
