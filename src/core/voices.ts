import type { SourceNote } from './types';

/**
 * Home staves of voices (§10, §12). A voice belongs to the hand of its home
 * staff; a note drawn on another staff is a cross-staff note and keeps the
 * hand of its voice. Shared by the parser (which flags `crossStaff`) and the
 * hand assignment in `model/performance.ts`, so both always agree.
 */

/** Voices per staff in the numbering MuseScore (and other notation programs) export: 1-4 on staff 1, 5-8 on staff 2, ... */
const VOICES_PER_STAFF = 4;
const MUSESCORE = /musescore/i;

/** Staff a voice number belongs to under the 4-voices-per-staff numbering, or null when it has none. */
function blockStaff(voice: string, staves: number): number | null {
  const t = voice.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = Number(t);
  if (v < 1) return null;
  const staff = Math.ceil(v / VOICES_PER_STAFF);
  return staff <= staves ? staff : null;
}

/**
 * True when a part numbers its voices in blocks of four per staff. MuseScore
 * always does, and keeps a cross-staff note in the voice of the staff it
 * belongs to, so the voice number names the hand. For other programs the
 * numbering is trusted only when the part clearly uses it: every voice number
 * fits a staff, a lower staff has its own block (voice 5 or above), and each
 * block's notes are mostly drawn on that block's staff.
 */
function usesBlockNumbering(byVoice: Map<string, SourceNote[]>, staves: number, software: string | null): boolean {
  if (software !== null && MUSESCORE.test(software)) return true;
  if (staves < 2) return false;
  const perBlock = new Map<number, { on: number; total: number }>();
  for (const [voice, list] of byVoice) {
    const staff = blockStaff(voice, staves);
    if (staff === null) return false;
    const b = perBlock.get(staff) ?? { on: 0, total: 0 };
    b.total += list.length;
    for (const n of list) if (n.staff === staff) b.on++;
    perBlock.set(staff, b);
  }
  if (![...perBlock.keys()].some((s) => s > 1)) return false;
  return [...perBlock.values()].every((b) => b.on * 2 > b.total);
}

/**
 * True when one voice id sounds on two staves at once: two notes that each
 * start a new event in the voice (not grace notes, not added chord notes)
 * overlap in time while drawn on different staves. A voice is a single line,
 * so this means the file reuses the voice id on each staff (for example when
 * the optional <voice> element is left out and every note reads as voice 1).
 * A chord split across the staves has only one such starting note.
 */
function reusedAcrossStaves(list: readonly SourceNote[]): boolean {
  const heads = list.filter((n) => !n.grace && !n.chord).sort((a, b) => a.onsetTick - b.onsetTick);
  const endByStaff = new Map<number, number>();
  for (const h of heads) {
    for (const [staff, end] of endByStaff) if (staff !== h.staff && end > h.onsetTick) return true;
    endByStaff.set(h.staff, Math.max(endByStaff.get(h.staff) ?? 0, h.onsetTick + h.durationTicks));
  }
  return false;
}

/** Staves holding the most of these notes, lowest staff number first. */
function busiestStaves(list: readonly SourceNote[]): number[] {
  const counts = new Map<number, number>();
  for (const n of list) counts.set(n.staff, (counts.get(n.staff) ?? 0) + 1);
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return [...counts]
    .filter(([, c]) => c === max)
    .map(([s]) => s)
    .sort((a, b) => a - b);
}

/** Notes in onset order with, at each position, the latest end of any note up to there. */
interface Timeline {
  onsets: number[];
  reach: number[];
}

function timeline(notes: readonly SourceNote[]): Timeline {
  const sorted = [...notes].sort((a, b) => a.onsetTick - b.onsetTick);
  const reach: number[] = [];
  let max = -Infinity;
  for (const n of sorted) reach.push((max = Math.max(max, n.onsetTick + n.durationTicks)));
  return { onsets: sorted.map((n) => n.onsetTick), reach };
}

/** True when some note of the timeline sounds during `n` (starts before it ends and ends after it starts). */
function soundsDuring(t: Timeline, n: SourceNote): boolean {
  // Last note starting before `n` ends (binary search); all earlier ones start before it too.
  let lo = 0;
  let hi = t.onsets.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t.onsets[mid] < n.onsetTick + n.durationTicks) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return last >= 0 && t.reach[last] > n.onsetTick;
}

/**
 * True when the part numbers its voices separately on each staff, so that a
 * voice number names a line on one staff only and the same number on the
 * other staff is a different line: some voice id sounds on two staves at
 * once, or voice 1 has, for every staff with notes, a measure in which it is
 * drawn on that staff alone, with no other voice sounding on that staff
 * meanwhile (the hands take turns in voice 1). When another voice does sound
 * there, that staff's own line is present, so voice 1 is only visiting it (a
 * cross-staff passage in a file that numbers voices for the whole part).
 */
function numberedPerStaff(byVoice: ReadonlyMap<string, SourceNote[]>, partNotes: readonly SourceNote[]): boolean {
  const staves = new Set(partNotes.map((n) => n.staff));
  if (staves.size < 2) return false;
  for (const list of byVoice.values()) if (reusedAcrossStaves(list)) return true;
  const first = byVoice.get('1');
  if (!first) return false;
  /** Voice 1's notes per measure. */
  const byMeasure = new Map<number, SourceNote[]>();
  for (const n of first) {
    const list = byMeasure.get(n.measureIndex) ?? [];
    list.push(n);
    byMeasure.set(n.measureIndex, list);
  }
  /** Notes of the other voices per staff. */
  const othersOn = new Map<number, SourceNote[]>();
  for (const n of partNotes) {
    if (n.voice === '1') continue;
    const list = othersOn.get(n.staff) ?? [];
    list.push(n);
    othersOn.set(n.staff, list);
  }
  const timelines = new Map([...othersOn].map(([st, list]) => [st, timeline(list)]));
  const alone = new Set<number>();
  for (const list of byMeasure.values()) {
    const st = list[0].staff;
    if (alone.has(st) || list.some((n) => n.staff !== st)) continue;
    const others = timelines.get(st);
    if (!others || !list.some((n) => soundsDuring(others, n))) alone.add(st);
  }
  return [...staves].every((st) => alone.has(st));
}

/**
 * Home staff of one voice in a file whose voice numbers do not name the
 * staff: the staff with most of the voice's notes. A note drawn on another
 * staff counts as cross-staff only while the voice is also on its home staff
 * in the same or a neighbouring measure; a passage on the other staff away
 * from that is the other hand's (the file reused the voice number). When two
 * staves hold exactly as many notes, each measure is decided on its own (ties
 * there go to the upper staff).
 */
function inferHomes(list: readonly SourceNote[], home: Map<SourceNote, number>): void {
  const staves = new Set(list.map((n) => n.staff));
  if (staves.size === 1 || reusedAcrossStaves(list)) {
    for (const n of list) home.set(n, n.staff);
    return;
  }
  const busiest = busiestStaves(list);
  if (busiest.length === 1) {
    const h = busiest[0];
    const onHome = new Set(list.filter((n) => n.staff === h).map((n) => n.measureIndex));
    for (const n of list) {
      const near = onHome.has(n.measureIndex - 1) || onHome.has(n.measureIndex) || onHome.has(n.measureIndex + 1);
      home.set(n, n.staff === h || near ? h : n.staff);
    }
    return;
  }
  const byMeasure = new Map<number, SourceNote[]>();
  for (const n of list) {
    const m = byMeasure.get(n.measureIndex) ?? [];
    m.push(n);
    byMeasure.set(n.measureIndex, m);
  }
  for (const group of byMeasure.values()) {
    const staff = busiestStaves(group)[0];
    for (const n of group) home.set(n, staff);
  }
}

/**
 * The home staff of every note's voice, keyed by note.
 *
 * - Voices numbered in blocks of four per staff (always so in MuseScore
 *   exports) belong to their block's staff: voice 1-4 to staff 1, 5-8 to
 *   staff 2, and so on.
 * - A part that numbers its voices separately on each staff (some voice id
 *   sounds on two staves at once, or the hands take turns in voice 1: for
 *   every staff, voice 1 has a measure drawn on that staff alone, with no
 *   other voice sounding on that staff meanwhile) keeps every note on the
 *   staff it is drawn on: there, a voice number does not name a hand.
 * - Otherwise a voice's home is the staff holding most of its notes, and a
 *   note drawn on the other staff is cross-staff only while the voice is
 *   also on its home staff in the same or a neighbouring measure.
 * - A staff is never left without a voice of its own: when every note drawn
 *   on it would belong to another staff's voice, those notes stay on it. So a
 *   reused voice id can never move a whole staff to the other hand.
 */
export function voiceHomeStaves(
  notes: readonly SourceNote[],
  stavesOf: (partId: string) => number,
  software: string | null,
): Map<SourceNote, number> {
  const home = new Map<SourceNote, number>();
  const byPart = new Map<string, SourceNote[]>();
  for (const n of notes) {
    const list = byPart.get(n.partId) ?? [];
    list.push(n);
    byPart.set(n.partId, list);
  }
  for (const [partId, partNotes] of byPart) {
    let staves = Math.max(1, stavesOf(partId));
    for (const n of partNotes) if (n.staff > staves) staves = n.staff;
    const byVoice = new Map<string, SourceNote[]>();
    for (const n of partNotes) {
      const list = byVoice.get(n.voice) ?? [];
      list.push(n);
      byVoice.set(n.voice, list);
    }
    const blocks = usesBlockNumbering(byVoice, staves, software);
    const perStaff = !blocks && numberedPerStaff(byVoice, partNotes);
    const inferred: SourceNote[] = [];
    for (const [voice, list] of byVoice) {
      const staff = blocks ? blockStaff(voice, staves) : null;
      if (staff !== null) {
        for (const n of list) home.set(n, staff);
      } else if (perStaff) {
        for (const n of list) home.set(n, n.staff);
      } else {
        inferHomes(list, home);
        for (const n of list) inferred.push(n);
      }
    }
    const drawnOn = new Map<number, SourceNote[]>();
    for (const n of inferred) {
      const list = drawnOn.get(n.staff) ?? [];
      list.push(n);
      drawnOn.set(n.staff, list);
    }
    for (const [staff, list] of drawnOn) {
      const owned = partNotes.some((n) => n.staff === staff && home.get(n) === staff);
      if (!owned) for (const n of list) home.set(n, staff);
    }
  }
  return home;
}
