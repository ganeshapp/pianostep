/**
 * The §17 action fixtures as press-level specs (default grid: ticksPerQuarter
 * 4, 16-tick measures unless stated). Shared by the derive and round-trip tests.
 */
import { L, R, buildMeasures, buildScore } from './pressBuilder';
import type { ScoreInput } from './pressBuilder';

/** 1. Single-hand melody: replacements, a repeated note, a repeated chord. */
export const melodyWithRepeats = (): ScoreInput =>
  buildScore(
    [
      R('C4', 0, 4),
      R('D4', 4, 8),
      R('D4', 8, 12),
      R('C4', 12, 14),
      R('E4', 12, 14),
      R('C4', 14, 16),
      R('E4', 14, 16),
      R('G4', 16, 24),
    ],
    buildMeasures(2),
  );

/** 2. RH note and LH chord struck together. */
export const rhNoteLhChord = (): ScoreInput =>
  buildScore([R('E4', 0, 8), L('C3', 0, 8), L('G3', 0, 8)], buildMeasures(1));

/** 3. LH holds a whole measure while the RH moves every beat. */
export const longLhHold = (): ScoreInput =>
  buildScore(
    [L('C3', 0, 16), R('C4', 0, 4), R('D4', 4, 8), R('E4', 8, 12), R('F4', 12, 16)],
    buildMeasures(1),
  );

/** 4. The §6 worked example: held C4 under a moving line. */
export const workedExample = (): ScoreInput =>
  buildScore([R('C4', 0, 16), R('E4', 4, 8), R('G4', 8, 12), R('F4', 12, 16)], buildMeasures(1));

/** 5. A repeated E4 while C4 stays held. */
export const repeatWhileHeld = (): ScoreInput =>
  buildScore([R('C4', 0, 16), R('E4', 4, 8), R('E4', 8, 12)], buildMeasures(1));

/** 5b. Repeated E4 inside a changing chord over a held C4. */
export const repeatInsideChord = (): ScoreInput =>
  buildScore(
    [R('C4', 0, 16), R('E4', 4, 8), R('G4', 4, 8), R('E4', 8, 12), R('A4', 8, 12)],
    buildMeasures(1),
  );

/** 6a. E4 ends between attacks while C4 continues: blue release-only step. */
export const releaseBetweenBlue = (): ScoreInput =>
  buildScore([R('C4', 0, 16), R('E4', 0, 6), R('G4', 8, 16)], buildMeasures(1));

/** 6b. The only note ends between attacks: '.' release-only step. */
export const releaseBetweenRest = (): ScoreInput =>
  buildScore([R('C4', 0, 6), R('D4', 8, 12)], buildMeasures(1));

/** 6c. The LH lets go between attacks while the RH holds on. */
export const releaseBetweenOtherHand = (): ScoreInput =>
  buildScore([R('E4', 0, 16), L('C3', 0, 6), L('G3', 8, 16)], buildMeasures(1));

/** 8. Triplet eighths (RH) against straight eighths (LH); ticksPerQuarter 12, one 48-tick measure. */
export const tripletsVsEighths = (): ScoreInput =>
  buildScore(
    [R('C5', 0, 4), R('D5', 4, 8), R('E5', 8, 12), L('C3', 0, 6), L('G3', 6, 12)],
    buildMeasures(1, 48),
  );

/** 9a. A rest, then an entry; the last note lasts to the bar line. */
export const restThenEntry = (): ScoreInput =>
  buildScore([R('C4', 4, 8), R('E4', 12, 16)], buildMeasures(1));

/** 9b. Same, but the last note stops early: the bar ends in a trailing rest. */
export const trailingRest = (): ScoreInput =>
  buildScore([R('C4', 4, 8), R('E4', 12, 14)], buildMeasures(1));

/**
 * 10. Three measures (0-16, 16-32, 32-48). LH C3 and RH E4 are already down
 * when measure 2 starts; D4 is released exactly at its start; A4 crosses its
 * end; B4 starts exactly at its end.
 */
export const heldIntoPassage = (): ScoreInput =>
  buildScore(
    [
      L('C3', 0, 40),
      R('D4', 4, 16),
      R('E4', 12, 20),
      R('G4', 20, 24),
      R('A4', 28, 36),
      R('B4', 32, 34),
    ],
    buildMeasures(3),
  );

export const ALL_FIXTURES: Record<string, () => ScoreInput> = {
  melodyWithRepeats,
  rhNoteLhChord,
  longLhHold,
  workedExample,
  repeatWhileHeld,
  repeatInsideChord,
  releaseBetweenBlue,
  releaseBetweenRest,
  releaseBetweenOtherHand,
  tripletsVsEighths,
  restThenEntry,
  trailingRest,
  heldIntoPassage,
};
