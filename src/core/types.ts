/**
 * Shared domain contracts. Every module codes against these types.
 *
 * Layering (each layer only depends on the ones above it):
 *   1. SourceScore      — what the MusicXML file says (written order, provenance)
 *   2. PreparedScore    — performance order (repeats unrolled), hands, tempo map,
 *                         physical key presses per hand
 *   3. StepSequence     — derived action steps + notation tokens for a hand
 *                         selection and passage
 *   4. Practice/MIDI    — runtime state (lives in engine/, midi/, practice/)
 *
 * Time is always an integer tick count. `ticksPerQuarter` is the LCM of every
 * <divisions> value in the file, so all MusicXML durations are exact integers.
 * Never group "nearby" events with a tolerance; equal ticks == simultaneous.
 */

export type Hand = 'R' | 'L';
export const HANDS: readonly Hand[] = ['R', 'L'];

export type HandSelection = 'both' | 'R' | 'L';

export function handsOf(sel: HandSelection): Hand[] {
  return sel === 'both' ? ['R', 'L'] : [sel];
}

/* ------------------------------------------------------------------------ */
/* Diagnostics                                                               */
/* ------------------------------------------------------------------------ */

export type WarningSeverity = 'info' | 'review' | 'error';

/**
 * A plain-language issue found while importing/preparing a score.
 * `code` is stable and machine-readable; `message` is shown to users (no
 * parser names or internal ids in it).
 */
export interface ScoreWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  /** Source measure numbers (display strings) affected, if known; at most 20. */
  measures?: string[];
  /** True when more measures were affected than `measures` lists (the list was cut at 20). */
  measuresTruncated?: boolean;
  /** Number of occurrences collapsed into this warning. */
  count?: number;
}

export type WarningCode =
  | 'grace-notes-approximated'
  | 'cue-notes-skipped'
  | 'ornament-not-played' // trills, mordents, turns: principal note only
  | 'tremolo-not-expanded'
  | 'arpeggio-not-rolled'
  | 'glissando-not-played' // glissando / slide: only its first and last notes are played
  | 'cross-staff-notes'
  | 'single-staff-part'
  | 'hands-from-separate-parts'
  | 'alternative-part-excluded' // ossia / alternative / ornament-realisation part
  | 'extra-parts-excluded'
  | 'multiple-instruments'
  | 'unclear-hand-mapping'
  | 'voice-overlap-same-key' // two voices hold/strike the same key in one hand
  | 'tie-unmatched'
  | 'repeats-unsupported' // structure we could not unroll; played straight
  | 'jump-unsupported' // D.C./D.S./coda constructs we could not follow
  | 'no-tempo-in-file' // default tempo chosen by the app
  | 'out-of-piano-range'
  | 'microtone-rounded'
  | 'measure-length-mismatch'
  | 'zero-length-note'
  | 'timewise-converted'
  | 'pedal-not-modelled'
  | 'octave-text-not-applied' // "8va"/"8vb" written as text: notes play at the written pitch
  | 'silent-notes-played' // printed notes with dynamics="0" are played at the surrounding loudness
  | 'hand-span-too-wide' // one hand strikes keys more than a tenth apart at once
  | 'other';

/* ------------------------------------------------------------------------ */
/* 1. Source score                                                           */
/* ------------------------------------------------------------------------ */

export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** The pitch exactly as spelled in the source (kept for provenance). */
export interface SpelledPitch {
  step: PitchStep;
  /** Chromatic alteration in semitones as written (may be fractional in the file; rounded for midi). */
  alter: number;
  octave: number;
}

export interface SourcePart {
  id: string;
  name: string;
  /** Number of staves declared (default 1). */
  staves: number;
  /** First clef sign seen per staff number (e.g. {1:'G', 2:'F'}). */
  clefs: Record<number, string>;
  /** Pitched, non-cue, non-rest notes in this part. */
  pitchedNoteCount: number;
  /** Plain text of <words> directions in this part (deduplicated, trimmed, max ~50). */
  words: string[];
  /** Staves hidden somewhere by <staff-details print-object="no">. */
  hiddenStaves: number[];
  /**
   * Per-staff hints that a staff is an alternative (ossia) rather than main
   * music, keyed by staff number. Absent or empty when the file gives none.
   */
  staffDetails?: Record<number, StaffDetails>;
  /** <score-instrument><instrument-name> values declared for this part. Absent when there are none. */
  instrumentNames?: string[];
  /** <score-instrument><instrument-sound> ids such as "keyboard.piano". Absent when there are none. */
  instrumentSounds?: string[];
  /** <midi-instrument><midi-program> numbers (General MIDI, 1-128). Absent when there are none. */
  midiPrograms?: number[];
}

export interface StaffDetails {
  /** <staff-type> other than "regular", lower case: "ossia", "alternate", "cue", "editorial". */
  type?: string;
  /** <staff-size> below 100 (percent of normal): a small staff, as ossias are drawn. */
  size?: number;
  /** Text of <words> directions placed on this staff (<direction><staff>). */
  words?: string[];
}

export interface EndingMark {
  /** Pass numbers this ending applies to, e.g. [1] or [1,2]. Empty when unparseable. */
  numbers: number[];
  type: 'start' | 'stop' | 'discontinue';
}

/** One measure column of the score (index-aligned across all parts). */
export interface SourceMeasure {
  /** 0-based index in written order. */
  index: number;
  /**
   * The MusicXML `number` attribute as written ("12", "12a", or an internal id
   * such as MuseScore's "X1"). Show measureDisplayNumbers() (measures.ts) to
   * people, never this raw value.
   */
  number: string;
  /** Absolute source tick (written order, no repeats). */
  startTick: number;
  /** Length in ticks (max content length across parts; time-signature length if empty). */
  durationTicks: number;
  /** Pickup / incomplete measure flagged implicit="yes". */
  implicit: boolean;
  timeSignature?: { beats: number; beatType: number };
  /** Navigation marks, merged over every part (a mark written in any part counts). */
  repeatForward: boolean;
  /** Backward repeat at the end of this measure; value = total times the section is played (default 2). */
  repeatBackwardTimes: number | null;
  endings: EndingMark[];
  segno: boolean;
  coda: boolean;
  /** <sound fine="yes"/> or a "Fine" word direction in this measure. */
  fine: boolean;
  /** <sound dacapo="yes"/> or "D.C." direction at the end of this measure. */
  daCapo: boolean;
  /** <sound dalsegno=.../> or "D.S." direction at the end of this measure. */
  dalSegno: boolean;
  /** <sound tocoda=.../> or "To Coda" direction in this measure. */
  toCoda: boolean;
}

export interface SourceNote {
  /** Stable id: `${partId}:${measureIndex}:${ordinal}` (ordinal = note order within the part measure). */
  id: string;
  partId: string;
  /** Staff number within the part (1-based). Cross-staff notes carry the staff they are drawn on. */
  staff: number;
  voice: string;
  measureIndex: number;
  /** Absolute source tick of the attack (grace-note adjustment already applied). */
  onsetTick: number;
  /** Sounding length in ticks (>0). */
  durationTicks: number;
  /** Sounding MIDI number, after <transpose> if any. 60 == C4. */
  midi: number;
  spelled: SpelledPitch;
  tieStart: boolean;
  tieStop: boolean;
  grace: boolean;
  /** Part of a <chord/> (same onset as the previous note in the voice). */
  chord: boolean;
  /** Inside a tuplet (<time-modification>). */
  tuplet: boolean;
  /** Notated <dynamics> velocity (0-127) if the file gives one via <sound dynamics> or note@dynamics. */
  velocity?: number;
  /**
   * Notes drawn with print-object="no" still sound but are flagged. The one
   * exception is made after hand assignment: a hidden note that repeats a key
   * the other hand is already holding is left out (see buildPerformanceNotes).
   */
  printed: boolean;
  /** Staff of the voice's home staff differs from this note's staff. */
  crossStaff: boolean;
}

/** A tempo mark in source (written-order) ticks. qpm = quarter notes per minute. */
export interface SourceTempo {
  tick: number;
  measureIndex: number;
  qpm: number;
}

export interface SourceScore {
  title: string | null;
  subtitle: string | null;
  composer: string | null;
  arranger: string | null;
  rights: string | null;
  software: string | null;
  /** Plain text of all <credit-words>, in order, whitespace-normalised. */
  credits: string[];
  ticksPerQuarter: number;
  parts: SourcePart[];
  measures: SourceMeasure[];
  /** Pitched notes only (rests omitted, cue notes omitted + warned). Sorted by onsetTick, then midi. */
  notes: SourceNote[];
  tempos: SourceTempo[];
  /** Pedal marks found (source ticks) — informational only, not modelled as key holds. */
  pedalMarks: number;
  warnings: ScoreWarning[];
}

/* ------------------------------------------------------------------------ */
/* 2. Prepared (performance-order) score                                     */
/* ------------------------------------------------------------------------ */

/** One playback occurrence of a source measure (repeats unrolled). */
export interface MeasureOccurrence {
  /** 0-based index in performance order — the unique position id. */
  occ: number;
  measureIndex: number;
  /** Readable measure number for display ("12", or "19a" for a measure the file leaves out of the count). */
  number: string;
  /** 1 on the first time through, 2 on the repeat, ... */
  pass: number;
  /** Performance tick at which this occurrence starts. */
  startTick: number;
  durationTicks: number;
  /** Short user-facing label, e.g. "12" or "12 (2nd time)". */
  label: string;
}

export interface TempoPoint {
  /** Performance tick. */
  tick: number;
  qpm: number;
}

export interface TempoMap {
  ticksPerQuarter: number;
  /** Sorted by tick; first point is always at tick 0. */
  points: TempoPoint[];
  /** True when the file had no usable tempo and the app chose `points[0].qpm`. */
  defaulted: boolean;
}

/** A note in performance order with its hand assignment. */
export interface PerformanceNote {
  /** `${sourceNoteId}@${occ}` of the first tied segment. */
  id: string;
  /** All source notes merged into this sounding note via ties, in order. */
  sourceNoteIds: string[];
  occ: number;
  partId: string;
  staff: number;
  voice: string;
  hand: Hand;
  midi: number;
  spelled: SpelledPitch;
  startTick: number;
  endTick: number;
  velocity?: number;
}

/**
 * One physical key-down interval for one hand: the key goes down at startTick
 * and comes up at endTick. Unison/overlapping notes from several voices in the
 * same hand have already been reconciled (see physical.ts).
 * A press ending at tick t and another press of the same key starting at t is
 * a rearticulation (release and strike again).
 */
export interface KeyPress {
  id: string;
  hand: Hand;
  midi: number;
  startTick: number;
  endTick: number;
  /** PerformanceNote ids that this press realises. */
  noteIds: string[];
  velocity?: number;
  /** Set on passage-clipped presses that were already held before the passage start. */
  carried?: boolean;
}

export type HandMapSource = 'two-staff-part' | 'two-single-staff-parts' | 'override' | 'single-staff' | 'unclear';

export interface HandMapping {
  /** `${partId}:${staff}` -> hand. Keys absent from the map are excluded from practice. */
  staffHands: Record<string, Hand>;
  /** Checked voice -> hand rules from the overrides; they win over `staffHands`. Absent when there are none. */
  voiceHands?: VoiceHandOverride[];
  /** Parts deliberately left out (ossia/alternative/extra instrument). */
  excludedParts: string[];
  source: HandMapSource;
  /** One-sentence plain-language explanation for the diagnostics view. */
  description: string;
}

export type Readiness = 'ready' | 'review' | 'unsupported';

export interface PreparedScore {
  meta: {
    title: string;
    composer: string | null;
    arranger: string | null;
  };
  source: SourceScore;
  handMapping: HandMapping;
  measures: MeasureOccurrence[];
  tempo: TempoMap;
  notes: PerformanceNote[];
  /** Physical presses for both hands, sorted by startTick, hand (R first), midi. */
  presses: KeyPress[];
  /** Performance tick at which the piece ends (end of last measure occurrence). */
  endTick: number;
  /** Lowest/highest midi across all presses (null when empty). */
  range: { min: number; max: number } | null;
  warnings: ScoreWarning[];
  readiness: Readiness;
  /** Plain-language reasons when readiness !== 'ready'. */
  readinessReasons: string[];
}

/* ------------------------------------------------------------------------ */
/* 3. Action steps and notation                                              */
/* ------------------------------------------------------------------------ */

/**
 * press   – normal foreground colour: part of a "replace" stack (release all, press these)
 * add     – red: press while keeping other held keys (re-press if already held)
 * release – blue: release only this key
 */
export type TokenAction = 'press' | 'add' | 'release';

export interface NoteToken {
  midi: number;
  /** Beginner address, sharps only: "C#4". */
  label: string;
  action: TokenAction;
  /** add-token for a key that was already held: release and strike again. */
  repress?: boolean;
  /** Press carried in from before the passage start (part of the starting setup). */
  carried?: boolean;
}

/**
 * replace – normal stack: release everything this hand holds, press tokens
 * change  – red/blue tokens: blue releases first, then red presses
 * hold    – "—": no change for this hand
 * rest    – ".": release everything, stay silent
 */
export type CellKind = 'replace' | 'change' | 'hold' | 'rest';

export interface HandCell {
  kind: CellKind;
  /** Display order: highest pitch first (top of the stack). Empty for hold/rest. */
  tokens: NoteToken[];
}

export interface ActionStep {
  /** 0-based index within its StepSequence. */
  index: number;
  /** Performance tick of the event. */
  tick: number;
  /** Measure occurrence containing this tick (the occurrence whose span includes it; final release belongs to the last occurrence). */
  occ: number;
  /** One cell per included hand. */
  cells: Partial<Record<Hand, HandCell>>;
  /** Keys struck at this step per included hand (re-presses included). */
  attacks: Partial<Record<Hand, number[]>>;
  /** Keys released at this step per included hand (re-pressed keys included). */
  releases: Partial<Record<Hand, number[]>>;
  /** Keys held per included hand just before / just after this step. Sorted ascending. */
  heldBefore: Partial<Record<Hand, number[]>>;
  heldAfter: Partial<Record<Hand, number[]>>;
  /** True when no included hand strikes a key (release-only / hold-only step). */
  releaseOnly: boolean;
}

export interface PassageRange {
  /** Inclusive first measure occurrence. */
  startOcc: number;
  /** Inclusive last measure occurrence. */
  endOcc: number;
}

export interface StepSequence {
  hands: Hand[];
  range: PassageRange;
  startTick: number;
  endTick: number;
  steps: ActionStep[];
  /** Presses for the included hands clipped to [startTick, endTick]; carried flag on clipped starts. */
  presses: KeyPress[];
  /** Union of all midi numbers used in this passage (incl. carried), ascending — keys to label. */
  usedKeys: number[];
  /** Per hand: which keys are used (for R/L colouring of labels). */
  usedKeysByHand: Partial<Record<Hand, number[]>>;
}

/* ------------------------------------------------------------------------ */
/* 4. Practice / runtime                                                     */
/* ------------------------------------------------------------------------ */

export type PracticeMode = 'listen' | 'steady' | 'follow';

export interface PracticeSettings {
  mode: PracticeMode;
  hands: HandSelection;
  /** Listen playback speed multiplier (1 = file tempo). */
  speed: number;
  /** Steady steps: seconds per step. */
  stepSeconds: number;
  /** null = full piece. */
  range: PassageRange | null;
  loop: boolean;
  /** Browser audio for Listen / Steady demonstrations. */
  sound: boolean;
  /** Short count-in clicks before Listen/Steady playback starts or loops. */
  countIn: boolean;
  /** Follow me: hear the connected piano's input through the browser sampler. */
  monitorInput: boolean;
  /** Optional MIDI output device for "Play through connected piano" (null = off). */
  midiOutputId: string | null;
  midiInputId: string | null;
}

export const DEFAULT_SETTINGS: PracticeSettings = {
  mode: 'listen',
  hands: 'both',
  speed: 1,
  stepSeconds: 1,
  range: null,
  loop: false,
  sound: true,
  countIn: false,
  monitorInput: false,
  midiOutputId: null,
  midiInputId: null,
};

/** Normalised MIDI input event (status bytes already decoded). */
export type MidiInputEvent =
  | { type: 'noteon'; midi: number; velocity: number; channel: number; time: number }
  | { type: 'noteoff'; midi: number; channel: number; time: number }
  | { type: 'sustain'; down: boolean; value: number; channel: number; time: number };

/** Follow-me matcher view of the current step. */
export interface FollowStatus {
  stepIndex: number;
  /** Keys that must be freshly struck for this step (union over included hands). */
  expected: number[];
  /** Expected keys already struck (fresh) and still down. */
  satisfied: number[];
  /** Keys physically down that are not expected and not part of the held score state. */
  wrong: number[];
  /**
   * Notes of this step beyond the 88 keys (below A0 or above C8). They cannot
   * be pressed, so they are not expected. Present only when there are some.
   */
  beyondPiano?: number[];
  /** True once every step has been completed. */
  finished: boolean;
}

/* ------------------------------------------------------------------------ */
/* Catalog                                                                   */
/* ------------------------------------------------------------------------ */

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced' | 'Unrated';

export interface DifficultyInfo {
  level: Difficulty;
  /**
   * source    – an identifiable external classification of this exact arrangement
   * in-file   – the arrangement's own score text states a level (e.g. credit "Intermediate")
   * estimated – app heuristic; must be shown as "Estimated"
   * none      – Unrated
   */
  basis: 'source' | 'in-file' | 'estimated' | 'none';
  /** Original label or grade text as published by the source. */
  originalLabel?: string;
  sourceName?: string;
  sourceUrl?: string;
  /** ISO date the source was checked. */
  checkedOn?: string;
  /** Plain-language note on how the label was obtained or why it is unrated. */
  note?: string;
}

export interface CatalogEntry {
  /** Stable slug derived from the file name. */
  id: string;
  title: string;
  composer: string | null;
  /** "Simplified arrangement by X", "Original (complete)", "Piano transcription by Liszt", ... */
  arrangement: string;
  /** Path relative to the site base, e.g. "scores/Fur_Elise.mxl". */
  file: string;
  /** Upstream URL of the file in the musetrainer library. */
  upstreamUrl: string;
  /** Original publication page (e.g. MuseScore) when known. */
  originalSourceUrl?: string;
  /** Rights text found in the file, verbatim (may be empty). */
  rightsInFile: string | null;
  attribution: string;
  /** Licensing/provenance caveat shown in the info panel, if any. */
  licenseNote?: string;
  difficulty: DifficultyInfo;
  readiness: Readiness;
  readinessReasons: string[];
  /** Hand/part overrides applied when preparing this file. */
  overrides?: ScoreOverrides;
  /** Summary numbers for the list view. */
  stats: {
    measures: number;
    performanceMeasures: number;
    notes: number;
    durationSec: number;
    lowest: string | null;
    highest: string | null;
    /** True when the file gives no tempo, so `durationSec` is at the app's default speed. Absent otherwise. */
    tempoDefaulted?: boolean;
  };
  /** Short user-facing notes (e.g. "Grace notes are approximated"). */
  notes: string[];
}

/** Per-arrangement verified exceptions. */
export interface ScoreOverrides {
  /** Parts to leave out entirely (ossia, ornament realisations, ...). */
  excludeParts?: string[];
  /** Explicit `${partId}:${staff}` -> hand map. */
  staffHands?: Record<string, Hand>;
  /**
   * Notes of one voice given to one hand, whatever staff they are drawn on
   * (for a file that writes a hand's notes in a voice of the other staff).
   * Checked before `staffHands` and the automatic map.
   */
  voiceHands?: VoiceHandOverride[];
  /** Short explanation shown in diagnostics. */
  reason?: string;
}

/** One `ScoreOverrides.voiceHands` rule. */
export interface VoiceHandOverride {
  /** MusicXML part id. */
  part: string;
  /** Voice as written in the file (`<voice>`, "1" when absent). */
  voice: string;
  hand: Hand;
  /**
   * 0-based written-measure index ranges [first, last], both inclusive (the
   * `SourceMeasure.index`, not the printed number). Absent = every measure.
   */
  measures?: [number, number][];
}

/** One row of the catalog inventory: every source file is accounted for. */
export interface InventoryRow {
  file: string;
  status: 'included' | 'duplicate' | 'non-solo-piano' | 'unsupported' | 'review';
  catalogId?: string;
  reason: string;
}
