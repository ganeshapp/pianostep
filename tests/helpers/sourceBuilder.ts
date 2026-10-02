/**
 * Small builder for synthetic SourceScore objects used by the model tests.
 * Positions are given in quarter notes (beat offset within a measure and
 * duration) and converted to exact ticks with `ticksPerQuarter`.
 */
import type {
  EndingMark,
  MeasureOccurrence,
  PitchStep,
  ScoreWarning,
  SourceMeasure,
  SourceNote,
  SourcePart,
  SourceScore,
  SourceTempo,
  SpelledPitch,
} from '../../src/core/types';

export interface PartSpec {
  id: string;
  name?: string;
  staves?: number;
  clefs?: Record<number, string>;
  words?: string[];
  hiddenStaves?: number[];
  /** Overrides the count derived from the notes. */
  pitchedNoteCount?: number;
}

export interface MeasureSpec {
  number?: string;
  /** Time signature [beats, beatType]; inherited from the previous measure when absent. */
  time?: [number, number];
  /** Explicit length in ticks (e.g. for a pickup). */
  durationTicks?: number;
  implicit?: boolean;
  forward?: boolean;
  /** Backward repeat at the end of the measure: total times played (true = 2). */
  backward?: number | true;
  /** Ending that starts at this measure (left barline). */
  endingStart?: number[];
  /** Ending that closes at this measure (right barline). */
  endingStop?: 'stop' | 'discontinue';
  segno?: boolean;
  coda?: boolean;
  fine?: boolean;
  daCapo?: boolean;
  dalSegno?: boolean;
  toCoda?: boolean;
}

export interface NoteSpec {
  part?: string;
  staff?: number;
  voice?: string;
  /** 0-based measure index. */
  measure: number;
  /** Offset from the measure start, in quarter notes. */
  beat?: number;
  /** Duration in quarter notes (0 allowed to build degenerate input). */
  dur: number;
  midi: number;
  tieStart?: boolean;
  tieStop?: boolean;
  chord?: boolean;
  grace?: boolean;
  velocity?: number;
  crossStaff?: boolean;
}

const SHARP_SPELLING: [PitchStep, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

export function spellSharp(midi: number): SpelledPitch {
  const pc = ((midi % 12) + 12) % 12;
  const [step, alter] = SHARP_SPELLING[pc];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

export class ScoreBuilder {
  readonly tpq: number;
  private title: string | null = null;
  private credits: string[] = [];
  private composer: string | null = null;
  private arranger: string | null = null;
  private partSpecs: PartSpec[] = [];
  private measureSpecs: MeasureSpec[] = [];
  private noteSpecs: NoteSpec[] = [];
  private tempoSpecs: { measure: number; beat: number; qpm: number }[] = [];
  private extraWarnings: ScoreWarning[] = [];

  constructor(ticksPerQuarter = 4) {
    this.tpq = ticksPerQuarter;
  }

  meta(m: { title?: string | null; credits?: string[]; composer?: string | null; arranger?: string | null }): this {
    if (m.title !== undefined) this.title = m.title;
    if (m.credits) this.credits = m.credits;
    if (m.composer !== undefined) this.composer = m.composer;
    if (m.arranger !== undefined) this.arranger = m.arranger;
    return this;
  }

  part(spec: PartSpec): this {
    this.partSpecs.push(spec);
    return this;
  }

  measure(spec: MeasureSpec = {}): this {
    this.measureSpecs.push(spec);
    return this;
  }

  measures(count: number, spec: MeasureSpec = {}): this {
    for (let i = 0; i < count; i++) this.measureSpecs.push({ ...spec });
    return this;
  }

  note(spec: NoteSpec): this {
    this.noteSpecs.push(spec);
    return this;
  }

  notes(...specs: NoteSpec[]): this {
    this.noteSpecs.push(...specs);
    return this;
  }

  /** One note per midi at the same onset; later ones are flagged `chord`. */
  chord(spec: Omit<NoteSpec, 'midi'> & { midis: number[] }): this {
    const { midis, ...rest } = spec;
    midis.forEach((midi, k) => this.noteSpecs.push({ ...rest, midi, chord: k > 0 }));
    return this;
  }

  tempo(measure: number, beat: number, qpm: number): this {
    this.tempoSpecs.push({ measure, beat, qpm });
    return this;
  }

  warning(w: ScoreWarning): this {
    this.extraWarnings.push(w);
    return this;
  }

  private ticks(quarters: number): number {
    const t = quarters * this.tpq;
    if (!Number.isInteger(t)) throw new Error(`${quarters} quarters is not a whole number of ticks at ${this.tpq} per quarter`);
    return t;
  }

  build(): SourceScore {
    const partSpecs = this.partSpecs.length
      ? this.partSpecs
      : [{ id: 'P1', name: 'Piano', staves: 2, clefs: { 1: 'G', 2: 'F' } }];

    const measures: SourceMeasure[] = [];
    let tick = 0;
    let time: [number, number] = [4, 4];
    this.measureSpecs.forEach((spec, index) => {
      if (spec.time) time = spec.time;
      const tsLength = this.ticks((time[0] * 4) / time[1]);
      const durationTicks = spec.durationTicks ?? tsLength;
      const endings: EndingMark[] = [];
      if (spec.endingStart) endings.push({ numbers: spec.endingStart, type: 'start' });
      if (spec.endingStop) endings.push({ numbers: spec.endingStart ?? [], type: spec.endingStop });
      measures.push({
        index,
        number: spec.number ?? String(index + 1),
        startTick: tick,
        durationTicks,
        implicit: spec.implicit ?? false,
        timeSignature: spec.time ? { beats: spec.time[0], beatType: spec.time[1] } : undefined,
        repeatForward: spec.forward ?? false,
        repeatBackwardTimes: spec.backward === undefined ? null : spec.backward === true ? 2 : spec.backward,
        endings,
        segno: spec.segno ?? false,
        coda: spec.coda ?? false,
        fine: spec.fine ?? false,
        daCapo: spec.daCapo ?? false,
        dalSegno: spec.dalSegno ?? false,
        toCoda: spec.toCoda ?? false,
      });
      tick += durationTicks;
    });

    const ordinals = new Map<string, number>();
    const notes: SourceNote[] = this.noteSpecs.map((s) => {
      const partId = s.part ?? partSpecs[0].id;
      const m = measures[s.measure];
      if (!m) throw new Error(`note refers to missing measure ${s.measure}`);
      const ordKey = `${partId}:${s.measure}`;
      const ordinal = ordinals.get(ordKey) ?? 0;
      ordinals.set(ordKey, ordinal + 1);
      return {
        id: `${partId}:${s.measure}:${ordinal}`,
        partId,
        staff: s.staff ?? 1,
        voice: s.voice ?? '1',
        measureIndex: s.measure,
        onsetTick: m.startTick + this.ticks(s.beat ?? 0),
        durationTicks: this.ticks(s.dur),
        midi: s.midi,
        spelled: spellSharp(s.midi),
        tieStart: s.tieStart ?? false,
        tieStop: s.tieStop ?? false,
        grace: s.grace ?? false,
        chord: s.chord ?? false,
        tuplet: false,
        velocity: s.velocity,
        printed: true,
        crossStaff: s.crossStaff ?? false,
      };
    });
    // Contract: sorted by onsetTick, then midi (stable otherwise).
    notes.sort((a, b) => a.onsetTick - b.onsetTick || a.midi - b.midi);

    const parts: SourcePart[] = partSpecs.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      staves: p.staves ?? 1,
      clefs: p.clefs ?? {},
      pitchedNoteCount: p.pitchedNoteCount ?? notes.filter((n) => n.partId === p.id).length,
      words: p.words ?? [],
      hiddenStaves: p.hiddenStaves ?? [],
    }));

    const tempos: SourceTempo[] = this.tempoSpecs.map((t) => ({
      tick: measures[t.measure].startTick + this.ticks(t.beat),
      measureIndex: t.measure,
      qpm: t.qpm,
    }));
    tempos.sort((a, b) => a.tick - b.tick);

    return {
      title: this.title,
      subtitle: null,
      composer: this.composer,
      arranger: this.arranger,
      rights: null,
      software: null,
      credits: this.credits,
      ticksPerQuarter: this.tpq,
      parts,
      measures,
      notes,
      tempos,
      pedalMarks: 0,
      warnings: this.extraWarnings,
    };
  }
}

/** Compact view of an unrolled sequence for exact assertions. */
export function occSummary(occs: MeasureOccurrence[]): [number, number, string][] {
  return occs.map((o) => [o.measureIndex, o.pass, o.label]);
}

export function measureIndexes(occs: MeasureOccurrence[]): number[] {
  return occs.map((o) => o.measureIndex);
}
