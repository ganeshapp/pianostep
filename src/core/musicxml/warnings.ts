import type { ScoreWarning, WarningCode, WarningSeverity } from '../types';

/** Severity and user-facing text per code emitted by the MusicXML importer. */
const IMPORT_WARNINGS: Partial<Record<WarningCode, { severity: WarningSeverity; message: string }>> = {
  'grace-notes-approximated': {
    severity: 'info',
    message: 'Grace notes are played as very short notes taken from the start of the main note (an approximation).',
  },
  'cue-notes-skipped': { severity: 'info', message: 'Small cue notes are shown in the score only and are not played.' },
  'ornament-not-played': {
    severity: 'review',
    message: 'Trills, mordents and turns are played as the main note only, without the quick extra notes the music asks for.',
  },
  'silent-notes-played': {
    severity: 'info',
    message:
      'Some notes are marked in the file to make no sound. They are shown in the music, so they are played at the loudness around them.',
  },
  'tremolo-not-expanded': {
    severity: 'review',
    message: 'Tremolos are played as one held note instead of fast repeated notes.',
  },
  'arpeggio-not-rolled': { severity: 'info', message: 'Rolled (arpeggiated) chords are played as plain chords.' },
  'glissando-not-played': {
    severity: 'review',
    message:
      'A glissando (a quick slide across the keys from one note to another) is written here; only its first and last notes are played.',
  },
  'cross-staff-notes': {
    severity: 'review',
    message:
      "Some notes are written on the other hand's staff. The app guesses which hand plays them from the musical line they belong to. If a hand feels wrong, the measures are listed under More → About this arrangement.",
  },
  'out-of-piano-range': {
    severity: 'review',
    message: 'Some notes are outside the 88 keys of a piano (A0 to C8).',
  },
  'microtone-rounded': { severity: 'info', message: 'Some in-between (microtonal) pitches were rounded to the nearest key.' },
  'measure-length-mismatch': {
    severity: 'info',
    message: 'Some measures are longer or shorter than their time signature; the written notes were followed.',
  },
  'zero-length-note': { severity: 'info', message: 'Some notes with no length were left out.' },
  'timewise-converted': {
    severity: 'info',
    message: 'The file stores the music measure by measure (timewise) and was converted.',
  },
  'octave-text-not-applied': {
    severity: 'review',
    message:
      'The music asks in words (such as "8va") for some notes to be played an octave higher or lower. This is not applied: those notes are played as written.',
  },
  'pedal-not-modelled': {
    severity: 'info',
    message: 'Pedal markings are not turned into held keys; only written note lengths are used.',
  },
};

const MAX_MEASURES = 20;

interface Entry {
  code: WarningCode;
  severity: WarningSeverity;
  messages: string[];
  count: number;
  measures: Set<number>;
}

/**
 * Aggregates warnings: one entry per code with a total count and up to 20
 * affected measures (sorted, as display numbers). `count` counts notes (or
 * other occurrences), not measures; `measuresTruncated` says whether more
 * measures were affected than are listed.
 */
export class WarningSink {
  private entries = new Map<WarningCode, Entry>();

  /**
   * @param measureIndex 0-based source measure index, if known.
   * @param message Required for code 'other' (distinct messages are joined).
   */
  add(code: WarningCode, measureIndex?: number, count = 1, message?: string): void {
    let e = this.entries.get(code);
    if (!e) {
      const def = IMPORT_WARNINGS[code];
      e = {
        code,
        severity: def?.severity ?? 'info',
        messages: def ? [def.message] : [],
        count: 0,
        measures: new Set(),
      };
      this.entries.set(code, e);
    }
    e.count += count;
    if (measureIndex !== undefined) e.measures.add(measureIndex);
    if (message && !e.messages.includes(message) && !IMPORT_WARNINGS[code]) e.messages.push(message);
  }

  has(code: WarningCode): boolean {
    return this.entries.has(code);
  }

  toList(measureNumber: (index: number) => string): ScoreWarning[] {
    return [...this.entries.values()].map((e) => {
      const w: ScoreWarning = {
        code: e.code,
        severity: e.severity,
        message: e.messages.join(' '),
        count: e.count,
      };
      if (e.measures.size > 0) {
        w.measures = [...e.measures]
          .sort((a, b) => a - b)
          .slice(0, MAX_MEASURES)
          .map(measureNumber);
        if (e.measures.size > MAX_MEASURES) w.measuresTruncated = true;
      }
      return w;
    });
  }
}
