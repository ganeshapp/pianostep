/**
 * What instrument a part is written for, from its <score-part> declaration
 * (§10: files with several instruments need review). Shared by the hand
 * assignment and the catalog build, so both decide alike.
 */

/** The instrument facts a part declares; every list may be empty. */
export interface PartInstrument {
  /** <part-name>. */
  name: string;
  /** <score-instrument><instrument-name>. */
  instrumentNames: readonly string[];
  /** <score-instrument><instrument-sound>, e.g. "keyboard.piano". */
  sounds: readonly string[];
  /** <midi-instrument><midi-program> (General MIDI, 1-128). */
  midiPrograms: readonly number[];
}

const KEYBOARD_NAME = /piano|klavier|clavier|keyboard|harpsichord|cembalo|clavecin/i;

/** Part names that name one hand of a keyboard player: "Right Hand", "LH", "R.H.", "Main gauche", ... */
const HAND_NAME =
  /(?:^|[^a-z])(?:rh|lh|r\.\s?h|l\.\s?h|right|left|droite|gauche|destra|sinistra|rechte|linke)(?![a-z])/i;

/** A part is a keyboard part by its name, its MusicXML sound id, or a General MIDI piano program (1–8). */
export function isKeyboardPart(p: PartInstrument): boolean {
  if ([p.name, ...p.instrumentNames].some((n) => KEYBOARD_NAME.test(n))) return true;
  if (p.sounds.some((s) => s.startsWith('keyboard.'))) return true;
  return p.midiPrograms.some((n) => n >= 1 && n <= 8);
}

/**
 * True when a single-staff part can be one hand of a piano piece: it is a
 * keyboard part, its name names a hand, or it says nothing about its
 * instrument at all (no name and no instrument data).
 */
export function couldBeOneHand(p: PartInstrument): boolean {
  if (isKeyboardPart(p) || HAND_NAME.test(p.name)) return true;
  return p.name.trim() === '' && p.instrumentNames.length === 0 && p.sounds.length === 0 && p.midiPrograms.length === 0;
}
