import type { ActionStep, Hand, HandCell, KeyPress, StepSequence } from '../types';

/**
 * Independent reader of the action notation (§17).
 *
 * It deliberately knows nothing about how the notation was produced: it does
 * not import derive.ts and only ever sees each step's `tick` and `cells`.
 * It replays the notation the way a learner would and compares the resulting
 * attacks and releases with the presses taken straight from the model.
 */

/** What one hand physically does at one instant. Both lists are ascending. */
export interface HandEvent {
  tick: number;
  attacks: number[];
  releases: number[];
}

export type HandEvents = Partial<Record<Hand, HandEvent[]>>;

/** The only part of a step the interpreter may read: what is shown on screen. */
export type NotationStep = Pick<ActionStep, 'tick' | 'cells'>;

export interface Interpretation {
  /** Per included hand, only instants where something happens, ascending by tick. */
  events: HandEvents;
  /** Keys still held per hand after the last step (ascending). */
  finalHeld: Partial<Record<Hand, number[]>>;
  /** Notation the reader could not apply or that breaks the §6 canonical form. */
  errors: string[];
}

export interface RoundTripResult {
  ok: boolean;
  mismatches: string[];
}

const ascending = (a: number, b: number): number => a - b;

function list(keys: Iterable<number>): string {
  return `[${[...keys].sort(ascending).join(', ')}]`;
}

/** Problems visible from the cell alone, independent of the held state. */
function shapeErrors(cell: HandCell, where: string): string[] {
  const errors: string[] = [];
  const { kind, tokens } = cell;
  if ((kind === 'hold' || kind === 'rest') && tokens.length > 0) {
    errors.push(`${where}: '${kind}' cell must not carry tokens`);
  }
  if ((kind === 'replace' || kind === 'change') && tokens.length === 0) {
    errors.push(`${where}: '${kind}' cell has no tokens`);
  }
  if (kind === 'replace' && tokens.some((t) => t.action !== 'press')) {
    errors.push(`${where}: normal stack mixed with red/blue tokens`);
  }
  if (kind === 'change' && tokens.some((t) => t.action === 'press')) {
    errors.push(`${where}: red/blue change mixed with normal-stack tokens`);
  }
  const seen = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (seen.has(tokens[i].midi)) errors.push(`${where}: key ${tokens[i].midi} appears twice`);
    seen.add(tokens[i].midi);
    if (i > 0 && tokens[i - 1].midi <= tokens[i].midi) {
      errors.push(`${where}: tokens are not ordered highest first`);
    }
  }
  return errors;
}

/**
 * Applies one cell to a hand's held set (mutated in place) following the §6
 * table, and returns what the hand strikes and lets go at that instant.
 */
function applyCell(
  cell: HandCell,
  held: Set<number>,
  where: string,
  errors: string[],
): { attacks: number[]; releases: number[] } {
  const attacks: number[] = [];
  const releases: number[] = [];
  switch (cell.kind) {
    case 'hold':
      break;
    case 'rest':
      // '.' on a silent hand is a harmless no-op.
      releases.push(...held);
      held.clear();
      break;
    case 'replace':
      // Release everything, then strike the stack; a key that was down is struck again.
      releases.push(...held);
      held.clear();
      for (const t of cell.tokens) {
        attacks.push(t.midi);
        held.add(t.midi);
      }
      break;
    case 'change': {
      const mentioned = new Set(cell.tokens.map((t) => t.midi));
      if (![...held].some((k) => !mentioned.has(k))) {
        errors.push(`${where}: red/blue change where no key keeps sounding (should be a normal stack or '.')`);
      }
      for (const t of cell.tokens) {
        if (t.action !== 'release') continue;
        if (!held.has(t.midi)) {
          errors.push(`${where}: blue release of ${t.midi}, which is not held`);
          continue;
        }
        held.delete(t.midi);
        releases.push(t.midi);
      }
      for (const t of cell.tokens) {
        if (t.action === 'release') continue;
        if (held.has(t.midi)) {
          // A red key that is already down is released and struck again.
          if (!t.repress) errors.push(`${where}: red ${t.midi} is already held but not marked as a re-press`);
          releases.push(t.midi);
        } else if (t.repress) {
          errors.push(`${where}: red re-press of ${t.midi}, which is not held`);
        }
        attacks.push(t.midi);
        held.add(t.midi);
      }
      break;
    }
  }
  return { attacks: attacks.sort(ascending), releases: releases.sort(ascending) };
}

/** Replays the notation of `steps` for `hands`, reading only `tick` and `cells`. */
export function interpretCells(steps: readonly NotationStep[], hands: readonly Hand[]): Interpretation {
  const errors: string[] = [];
  const events: HandEvents = {};
  const finalHeld: Partial<Record<Hand, number[]>> = {};
  const heldByHand = new Map<Hand, Set<number>>(hands.map((h) => [h, new Set<number>()]));
  for (const h of hands) events[h] = [];

  steps.forEach((step, i) => {
    if (i > 0 && step.tick <= steps[i - 1].tick) {
      errors.push(`step ${i} (tick ${step.tick}) is not after the previous step (tick ${steps[i - 1].tick})`);
    }
    for (const h of Object.keys(step.cells) as Hand[]) {
      if (!hands.includes(h)) errors.push(`step ${i} (tick ${step.tick}): cell for excluded hand ${h}`);
    }
    let anyAction = false;
    for (const h of hands) {
      const where = `step ${i} (tick ${step.tick}) ${h}`;
      const cell = step.cells[h];
      if (!cell) {
        errors.push(`${where}: missing cell`);
        continue;
      }
      errors.push(...shapeErrors(cell, where));
      const { attacks, releases } = applyCell(cell, heldByHand.get(h)!, where, errors);
      if (attacks.length > 0 || releases.length > 0) {
        events[h]!.push({ tick: step.tick, attacks, releases });
        anyAction = true;
      }
    }
    if (!anyAction) errors.push(`step ${i} (tick ${step.tick}): no hand presses or releases anything`);
  });

  for (const h of hands) finalHeld[h] = [...heldByHand.get(h)!].sort(ascending);
  return { events, finalHeld, errors };
}

/** The same per-hand event lists, built directly from key presses. */
export function eventsFromPresses(presses: readonly KeyPress[], hands: readonly Hand[]): HandEvents {
  const events: HandEvents = {};
  for (const h of hands) {
    const byTick = new Map<number, HandEvent>();
    const at = (tick: number): HandEvent => {
      let ev = byTick.get(tick);
      if (!ev) {
        ev = { tick, attacks: [], releases: [] };
        byTick.set(tick, ev);
      }
      return ev;
    };
    for (const p of presses) {
      if (p.hand !== h || p.endTick <= p.startTick) continue;
      at(p.startTick).attacks.push(p.midi);
      at(p.endTick).releases.push(p.midi);
    }
    events[h] = [...byTick.values()]
      .sort((a, b) => a.tick - b.tick)
      .map((ev) => ({ tick: ev.tick, attacks: ev.attacks.sort(ascending), releases: ev.releases.sort(ascending) }));
  }
  return events;
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function describe(ev: HandEvent | undefined): string {
  return ev ? `attacks ${list(ev.attacks)} releases ${list(ev.releases)}` : 'nothing';
}

function compareHand(hand: Hand, expected: readonly HandEvent[], actual: readonly HandEvent[]): string[] {
  const out: string[] = [];
  const exp = new Map(expected.map((e) => [e.tick, e]));
  const act = new Map(actual.map((e) => [e.tick, e]));
  const ticks = [...new Set([...exp.keys(), ...act.keys()])].sort(ascending);
  for (const tick of ticks) {
    const e = exp.get(tick);
    const a = act.get(tick);
    if (e && a && sameList(e.attacks, a.attacks) && sameList(e.releases, a.releases)) continue;
    out.push(`${hand} @ tick ${tick}: source has ${describe(e)}, notation gives ${describe(a)}`);
  }
  return out;
}

/**
 * Interprets the notation independently and compares per-hand attack and
 * release lists with the sequence's clipped presses. Because attacks are
 * compared (not just held sets), a dropped repeated note is caught.
 */
export function roundTrip(seq: Pick<StepSequence, 'hands' | 'steps' | 'presses'>): RoundTripResult {
  const notation: NotationStep[] = seq.steps.map((s) => ({ tick: s.tick, cells: s.cells }));
  const interpreted = interpretCells(notation, seq.hands);
  const expected = eventsFromPresses(seq.presses, seq.hands);
  const mismatches = [...interpreted.errors];
  for (const h of seq.hands) {
    mismatches.push(...compareHand(h, expected[h] ?? [], interpreted.events[h] ?? []));
    const stuck = interpreted.finalHeld[h] ?? [];
    if (stuck.length > 0) mismatches.push(`${h} still holds ${list(stuck)} after the last step`);
  }
  return { ok: mismatches.length === 0, mismatches };
}
