/**
 * Builds ActionStep[] / StepSequence directly from compact per-step specs, so
 * practice tests do not depend on actions/derive.ts.
 *
 * Each step gives a cell string per hand (omitted hand = no change):
 *   'C4 E4'     replace: release everything this hand holds, press these
 *   '+G4'       add (a held key named here is re-pressed)
 *   '-E4'       release only this key
 *   '*C4'       carried press (already held before the passage; step 0 only)
 *   '.'         release everything
 *   ''          no change
 * '+' / '-' / '*' tokens can be combined in one cell: '-E4 +G4'.
 * Bare (replace) labels may be combined with '*' but not with '+' / '-'.
 */
import { labelToMidi, midiToLabel } from '../../src/core/pitch';
import type {
  ActionStep,
  Hand,
  HandCell,
  KeyPress,
  NoteToken,
  StepSequence,
} from '../../src/core/types';

export type StepSpec = Partial<Record<Hand, string>> & { tick?: number; occ?: number };

export interface SequenceSpec {
  hands?: Hand[];
  steps: StepSpec[];
  /** Tick distance between steps without an explicit tick (default 48). */
  ticksPerStep?: number;
}

export function m(label: string): number {
  const midi = labelToMidi(label);
  if (midi === null) throw new Error(`bad key label: ${label}`);
  return midi;
}

export function keys(labels: string): number[] {
  return labels
    .split(/\s+/)
    .filter(Boolean)
    .map(m)
    .sort((a, b) => a - b);
}

interface ParsedCell {
  attacks: number[];
  releases: number[];
  carried: Set<number>;
}

const asc = (a: number, b: number): number => a - b;

function parseCell(text: string, held: ReadonlySet<number>): ParsedCell {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const carried = new Set<number>();
  if (tokens.length === 0) return { attacks: [], releases: [], carried };
  if (tokens.length === 1 && tokens[0] === '.') {
    return { attacks: [], releases: [...held].sort(asc), carried };
  }

  const bare = tokens.filter((t) => /^[A-Ga-g]/.test(t));
  const plus = tokens.filter((t) => t.startsWith('+')).map((t) => m(t.slice(1)));
  const minus = tokens.filter((t) => t.startsWith('-')).map((t) => m(t.slice(1)));
  const star = tokens.filter((t) => t.startsWith('*')).map((t) => m(t.slice(1)));
  if (bare.length + plus.length + minus.length + star.length !== tokens.length) {
    throw new Error(`bad cell: "${text}"`);
  }
  if (bare.length > 0 && plus.length + minus.length > 0) {
    throw new Error(`cell mixes replace and add/release: "${text}"`);
  }
  for (const k of star) carried.add(k);

  const attacks = new Set<number>([...bare.map(m), ...plus, ...star]);
  const releases = new Set<number>(bare.length > 0 ? held : minus);
  for (const k of releases) {
    if (!held.has(k)) throw new Error(`cell "${text}" releases ${midiToLabel(k)}, which is not held`);
  }
  // A fresh strike of a key that is already down is a release and re-press.
  for (const k of attacks) if (held.has(k)) releases.add(k);
  return { attacks: [...attacks].sort(asc), releases: [...releases].sort(asc), carried };
}

function token(midi: number, action: NoteToken['action'], extra: Partial<NoteToken> = {}): NoteToken {
  return { midi, label: midiToLabel(midi), action, ...extra };
}

/** Same cell rules as ARCHITECTURE.md §3 step 4, from S (starts), E (ends), B (held before). */
function cellFor(S: number[], E: number[], B: number[], carried: Set<number>): HandCell {
  const ends = new Set(E);
  const starts = new Set(S);
  const continuing = B.filter((k) => !ends.has(k));
  const desc = (a: number, b: number): number => b - a;
  if (S.length === 0 && E.length === 0) return { kind: 'hold', tokens: [] };
  if (S.length === 0 && continuing.length === 0) return { kind: 'rest', tokens: [] };
  if (continuing.length === 0) {
    const tokens = [...S]
      .sort(desc)
      .map((k) => token(k, 'press', carried.has(k) ? { carried: true } : {}));
    return { kind: 'replace', tokens };
  }
  const releaseTokens = E.filter((k) => !starts.has(k)).map((k) => token(k, 'release'));
  const addTokens = S.map((k) =>
    token(k, 'add', { ...(ends.has(k) ? { repress: true } : {}), ...(carried.has(k) ? { carried: true } : {}) }),
  );
  return { kind: 'change', tokens: [...releaseTokens, ...addTokens].sort((a, b) => b.midi - a.midi) };
}

export function buildSequence(spec: SequenceSpec): StepSequence {
  const hands: Hand[] = spec.hands ?? (['R', 'L'] as Hand[]).filter((h) => spec.steps.some((s) => s[h] !== undefined));
  const perStep = spec.ticksPerStep ?? 48;
  const held: Record<Hand, Set<number>> = { R: new Set(), L: new Set() };
  const open = new Map<string, { hand: Hand; midi: number; start: number; carried: boolean }>();
  const presses: KeyPress[] = [];
  const steps: ActionStep[] = [];

  spec.steps.forEach((s, index) => {
    const tick = s.tick ?? index * perStep;
    const step: ActionStep = {
      index,
      tick,
      occ: s.occ ?? 0,
      cells: {},
      attacks: {},
      releases: {},
      heldBefore: {},
      heldAfter: {},
      releaseOnly: true,
    };
    for (const h of hands) {
      const before = [...held[h]].sort(asc);
      const cell = parseCell(s[h] ?? '', held[h]);
      for (const k of cell.releases) {
        held[h].delete(k);
        const p = open.get(`${h}:${k}`);
        if (p) {
          presses.push({
            id: `${h}${k}@${p.start}`,
            hand: h,
            midi: k,
            startTick: p.start,
            endTick: tick,
            noteIds: [],
            ...(p.carried ? { carried: true } : {}),
          });
          open.delete(`${h}:${k}`);
        }
      }
      for (const k of cell.attacks) {
        held[h].add(k);
        open.set(`${h}:${k}`, { hand: h, midi: k, start: tick, carried: cell.carried.has(k) });
      }
      step.cells[h] = cellFor(cell.attacks, cell.releases, before, cell.carried);
      step.attacks[h] = cell.attacks;
      step.releases[h] = cell.releases;
      step.heldBefore[h] = before;
      step.heldAfter[h] = [...held[h]].sort(asc);
      if (cell.attacks.length > 0) step.releaseOnly = false;
    }
    steps.push(step);
  });

  const startTick = steps.length > 0 ? steps[0].tick : 0;
  const endTick = steps.length > 0 ? steps[steps.length - 1].tick : 0;
  for (const p of open.values()) {
    presses.push({
      id: `${p.hand}${p.midi}@${p.start}`,
      hand: p.hand,
      midi: p.midi,
      startTick: p.start,
      endTick,
      noteIds: [],
      ...(p.carried ? { carried: true } : {}),
    });
  }
  presses.sort((a, b) => a.startTick - b.startTick || (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) || a.midi - b.midi);

  const usedKeysByHand: Partial<Record<Hand, number[]>> = {};
  for (const h of hands) {
    usedKeysByHand[h] = [...new Set(presses.filter((p) => p.hand === h).map((p) => p.midi))].sort(asc);
  }
  const usedKeys = [...new Set(presses.map((p) => p.midi))].sort(asc);
  const lastOcc = steps.length > 0 ? steps[steps.length - 1].occ : 0;

  return {
    hands,
    range: { startOcc: steps.length > 0 ? steps[0].occ : 0, endOcc: lastOcc },
    startTick,
    endTick,
    steps,
    presses,
    usedKeys,
    usedKeysByHand,
  };
}

export function buildSteps(spec: SequenceSpec): ActionStep[] {
  return buildSequence(spec).steps;
}
