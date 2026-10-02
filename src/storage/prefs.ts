import { DEFAULT_SETTINGS } from '../core/types';
import type { HandSelection, PassageRange, PracticeMode, PracticeSettings } from '../core/types';
import { clearImports } from './imports';

/**
 * Small preferences in localStorage, under keys prefixed "pianosteps:v1:".
 *
 * Every read tolerates missing, corrupt or out-of-date values and every write
 * tolerates storage being unavailable (private browsing, disabled cookies,
 * full quota). When a write fails, the value is kept in memory so the rest of
 * this visit still behaves as if it had been saved.
 */

export const STORAGE_PREFIX = 'pianosteps:v1:';
const GLOBAL_KEY = `${STORAGE_PREFIX}global`;
const PIECE_KEY_PREFIX = `${STORAGE_PREFIX}piece:`;

export interface GlobalPrefs {
  lastPieceId: string | null;
  midiInputName: string | null;
  midiOutputName: string | null;
  fitWholePiece: boolean;
}

export const DEFAULT_GLOBAL_PREFS: Readonly<GlobalPrefs> = Object.freeze({
  lastPieceId: null,
  midiInputName: null,
  midiOutputName: null,
  fitWholePiece: false,
});

export interface PieceState {
  settings: PracticeSettings;
  /** Performance tick of the marker step when the piece was last left (null = start). */
  stepTick: number | null;
}

/** Slider limits from UI_SPEC; stored values outside them fall back to the default. */
export const SPEED_LIMITS = { min: 0.25, max: 2 } as const;
export const STEP_SECONDS_LIMITS = { min: 0.3, max: 4 } as const;

/* ------------------------------------------------------------------------ */
/* Raw access                                                                */
/* ------------------------------------------------------------------------ */

/** Values whose localStorage write failed; authoritative for this visit. */
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    // Merely reading `localStorage` throws a SecurityError when site data is blocked.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    const s = storage();
    if (s) {
      s.setItem(key, value);
      memory.delete(key);
      return;
    }
  } catch {
    // Fall through to the in-memory copy.
  }
  memory.set(key, value);
}

function readJson(key: string): unknown {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return;
  }
  writeRaw(key, text);
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown, fallback: string | null): string | null {
  if (v === null) return null;
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function numberIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function isOccurrenceIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function passageRange(v: unknown): PassageRange | null {
  if (!isRecord(v)) return null;
  const { startOcc, endOcc } = v;
  if (!isOccurrenceIndex(startOcc) || !isOccurrenceIndex(endOcc) || startOcc > endOcc) return null;
  return { startOcc, endOcc };
}

const MODES: readonly PracticeMode[] = ['listen', 'steady', 'follow'];
const HAND_SELECTIONS: readonly HandSelection[] = ['both', 'R', 'L'];

/**
 * Field-by-field validation of stored practice settings: anything missing or
 * invalid takes its value from DEFAULT_SETTINGS, the rest is kept.
 * The passage range is only checked for shape here; the practice page must
 * still clamp it to the piece's measure count.
 */
export function sanitizeSettings(raw: unknown): PracticeSettings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(raw)) return { ...d };
  return {
    mode: oneOf(raw.mode, MODES, d.mode),
    hands: oneOf(raw.hands, HAND_SELECTIONS, d.hands),
    speed: numberIn(raw.speed, SPEED_LIMITS.min, SPEED_LIMITS.max, d.speed),
    stepSeconds: numberIn(raw.stepSeconds, STEP_SECONDS_LIMITS.min, STEP_SECONDS_LIMITS.max, d.stepSeconds),
    range: raw.range === null ? null : passageRange(raw.range),
    loop: bool(raw.loop, d.loop),
    sound: bool(raw.sound, d.sound),
    countIn: bool(raw.countIn, d.countIn),
    monitorInput: bool(raw.monitorInput, d.monitorInput),
    midiOutputId: stringOrNull(raw.midiOutputId, d.midiOutputId),
    midiInputId: stringOrNull(raw.midiInputId, d.midiInputId),
  };
}

function sanitizeGlobalPrefs(raw: unknown): GlobalPrefs {
  const d = DEFAULT_GLOBAL_PREFS;
  if (!isRecord(raw)) return { ...d };
  const lastPieceId = stringOrNull(raw.lastPieceId, d.lastPieceId);
  return {
    lastPieceId: lastPieceId === '' ? null : lastPieceId,
    midiInputName: stringOrNull(raw.midiInputName, d.midiInputName),
    midiOutputName: stringOrNull(raw.midiOutputName, d.midiOutputName),
    fitWholePiece: bool(raw.fitWholePiece, d.fitWholePiece),
  };
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export function loadGlobalPrefs(): GlobalPrefs {
  return sanitizeGlobalPrefs(readJson(GLOBAL_KEY));
}

export function saveGlobalPrefs(patch: Partial<GlobalPrefs>): void {
  writeJson(GLOBAL_KEY, sanitizeGlobalPrefs({ ...loadGlobalPrefs(), ...patch }));
}

function pieceKey(pieceId: string): string {
  return `${PIECE_KEY_PREFIX}${pieceId}`;
}

export function loadPieceState(pieceId: string): PieceState | null {
  const raw = readJson(pieceKey(pieceId));
  if (!isRecord(raw)) return null;
  const tick = raw.stepTick;
  return {
    settings: sanitizeSettings(raw.settings),
    stepTick: typeof tick === 'number' && Number.isInteger(tick) && tick >= 0 ? tick : null,
  };
}

export function savePieceState(pieceId: string, state: PieceState): void {
  writeJson(pieceKey(pieceId), {
    settings: sanitizeSettings(state.settings),
    stepTick: state.stepTick,
  });
}

/** Forgets the saved settings of one piece (e.g. after its import is deleted). */
export function removePieceState(pieceId: string): void {
  const key = pieceKey(pieceId);
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing more can be done; the value is unreadable anyway.
  }
}

function clearPrefs(): void {
  memory.clear();
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  } catch {
    // Storage became unavailable; there is nothing readable left to clear.
  }
}

/** Removes settings and imported pieces. Rejects with a plain-language Error if imports can't be removed. */
export async function clearAllLocalData(): Promise<void> {
  clearPrefs();
  await clearImports();
}
