import { measureDisplayNumbers } from '../measures';
import type { Hand, HandMapping, ScoreOverrides, ScoreWarning, SourcePart, SourceScore, VoiceHandOverride } from '../types';
import { couldBeOneHand, type PartInstrument } from '../instruments';
import { WarningBag } from './performance';

export interface HandMappingResult {
  mapping: HandMapping;
  warnings: ScoreWarning[];
}

const ALTERNATIVE_RE = /ossia|alternat|voorslag|ornament/i;
/** A part with fewer than this share of the largest part's notes is treated as an alternative. */
const TINY_PART_SHARE = 0.03;

function quoted(p: SourcePart): string {
  const name = p.name.trim();
  return name ? `“${name}”` : 'an unnamed part';
}

function listNames(parts: readonly SourcePart[]): string {
  const names = parts.map(quoted);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function looksAlternativeByText(p: SourcePart): boolean {
  return ALTERNATIVE_RE.test(p.name) || p.words.some((w) => ALTERNATIVE_RE.test(w));
}

function instrumentOf(p: SourcePart): PartInstrument {
  return {
    name: p.name,
    instrumentNames: p.instrumentNames ?? [],
    sounds: p.instrumentSounds ?? [],
    midiPrograms: p.midiPrograms ?? [],
  };
}

function averagePitch(source: SourceScore, partId: string): number {
  let sum = 0;
  let count = 0;
  for (const n of source.notes) {
    if (n.partId === partId) {
      sum += n.midi;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Splits candidate parts into main and alternative parts (ossia, ornament
 * realisations). The largest part is never treated as an alternative, so
 * there is always something to play.
 */
function splitAlternatives(candidates: readonly SourcePart[]): { main: SourcePart[]; alternatives: SourcePart[] } {
  if (candidates.length <= 1) return { main: [...candidates], alternatives: [] };
  const largest = candidates.reduce((a, b) => (b.pitchedNoteCount > a.pitchedNoteCount ? b : a));
  const isAlternative = (p: SourcePart): boolean => {
    if (p === largest) return false;
    if (looksAlternativeByText(p)) return true;
    const tiny = p.pitchedNoteCount < TINY_PART_SHARE * largest.pitchedNoteCount;
    return tiny && candidates.some((q) => q !== p && q.staves >= 2);
  };
  return {
    main: candidates.filter((p) => !isAlternative(p)),
    alternatives: candidates.filter(isAlternative),
  };
}

/** Maps one part by its staff count (rule 4). */
function mapSinglePart(source: SourceScore, part: SourcePart, bag: WarningBag): Omit<HandMapping, 'excludedParts'> {
  const id = part.id;
  if (part.staves === 2) {
    return {
      staffHands: { [`${id}:1`]: 'R', [`${id}:2`]: 'L' },
      source: 'two-staff-part',
      description: `The upper staff of ${quoted(part)} is played by the right hand and the lower staff by the left hand.`,
    };
  }
  if (part.staves <= 1) {
    bag.add(
      'single-staff-part',
      'review',
      'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.',
    );
    return {
      staffHands: { [`${id}:1`]: 'R' },
      source: 'single-staff',
      description: `${capitalise(quoted(part))} has a single staff, so all of its notes are given to the right hand.`,
    };
  }
  return mapManyStaves(source, part, bag);
}

/** <staff-type> values that mark a staff as not part of the main music. */
const ALTERNATIVE_STAFF_TYPES = new Set(['ossia', 'alternate', 'cue', 'editorial']);
const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

function staffName(staff: number, staves: number): string {
  if (staff === 1) return 'the top staff';
  if (staff === staves) return 'the bottom staff';
  return `the ${ORDINAL_WORDS[staff] ?? `${staff}th`} staff from the top`;
}

function listStaves(staves: readonly number[], total: number): string {
  const names = staves.map((s) => staffName(s, total));
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Printed size of a staff in percent; a staff without a <staff-size> is full size. */
function staffSize(part: SourcePart, staff: number): number {
  return part.staffDetails?.[staff]?.size ?? 100;
}

/**
 * Why a staff of a 3+ staff part looks like an alternative (an ossia) rather
 * than main music, or null. The busiest staff never is one, and the lowest
 * staff with notes (the left hand's) is not one just for having few notes.
 * "Printed smaller" compares the staff with the largest staff that has notes
 * (`normalSize`), so staves that are all scaled down alike are not ossias.
 */
function alternativeStaffReason(
  part: SourcePart,
  staff: number,
  count: number,
  busiest: number,
  lowest: boolean,
  normalSize: number,
): string | null {
  const d = part.staffDetails?.[staff];
  if (part.hiddenStaves.includes(staff)) return 'it is hidden in the printed music';
  if ((d?.type !== undefined && ALTERNATIVE_STAFF_TYPES.has(d.type)) || d?.words?.some((w) => ALTERNATIVE_RE.test(w))) {
    return 'it is marked as an alternative';
  }
  if (staffSize(part, staff) < normalSize) return 'it is printed smaller than the others';
  if (!lowest && count < TINY_PART_SHARE * busiest) return 'it has very few notes';
  return null;
}

/**
 * A part on three or more staves. Staves that look like an alternative (an
 * ossia: hidden, marked as an alternative, printed smaller than the other
 * staves or nearly empty) are left out first, so they never replace the main
 * music. A staff next to such a staff whose notes all fall in the
 * alternative's measures belongs to the same ossia (an ossia for both hands
 * has two staves). Of the remaining staves with notes, the top one is the
 * right hand and the bottom one the left hand; any in between are left out.
 */
function mapManyStaves(source: SourceScore, part: SourcePart, bag: WarningBag): Omit<HandMapping, 'excludedParts'> {
  const id = part.id;
  const total = part.staves;
  // Sized by the staves that carry notes, never by the declared staff count
  // (a damaged file can declare millions of staves).
  const counts = new Map<number, number>();
  const measures = new Map<number, Set<number>>();
  for (const n of source.notes) {
    if (n.partId !== id || n.staff < 1 || n.staff > total) continue;
    counts.set(n.staff, (counts.get(n.staff) ?? 0) + 1);
    let set = measures.get(n.staff);
    if (!set) measures.set(n.staff, (set = new Set()));
    set.add(n.measureIndex);
  }
  const countOf = (s: number): number => counts.get(s) ?? 0;
  const measuresOf = (s: number): Set<number> => measures.get(s) ?? new Set();
  const withNotes = [...counts.keys()].sort((a, b) => a - b);
  let busiest = 0;
  for (const s of withNotes) if (busiest === 0 || countOf(s) > countOf(busiest)) busiest = s;
  const normalSize = Math.max(0, ...withNotes.map((s) => staffSize(part, s)));
  const alternatives = new Map<number, string>();
  for (const s of withNotes) {
    if (s === busiest) continue;
    const lowest = s === withNotes[withNotes.length - 1];
    const reason = alternativeStaffReason(part, s, countOf(s), countOf(busiest), lowest, normalSize);
    if (reason) alternatives.set(s, reason);
  }
  for (let grew = alternatives.size > 0; grew; ) {
    grew = false;
    const altMeasures = new Set([...alternatives.keys()].flatMap((s) => [...measuresOf(s)]));
    for (const s of withNotes) {
      if (s === busiest || alternatives.has(s) || withNotes.length - alternatives.size <= 2) continue;
      if (!alternatives.has(s - 1) && !alternatives.has(s + 1)) continue;
      if ([...measuresOf(s)].every((m) => altMeasures.has(m))) {
        alternatives.set(s, 'it only has notes in the measures where that alternative appears');
        grew = true;
      }
    }
  }
  const main = withNotes.filter((s) => !alternatives.has(s));

  if (withNotes.length === 0 || (alternatives.size === 0 && main.length === total)) {
    // Every staff carries main music (or nothing is known): top and bottom staff.
    const others = total - 2;
    const middle = others === 1 ? 'the middle staff is left out' : `the ${others} middle staves are left out`;
    bag.add(
      'unclear-hand-mapping',
      'review',
      `The piano music is written on ${total} staves. The top staff is given to the right hand and the bottom staff to the left hand; ${middle}.`,
    );
    return {
      staffHands: { [`${id}:1`]: 'R', [`${id}:${total}`]: 'L' },
      source: 'unclear',
      description: `The top staff of ${quoted(part)} is played by the right hand and the bottom staff by the left hand; ${middle}.`,
    };
  }

  if (alternatives.size > 0) {
    const alt = [...alternatives.keys()];
    const one = alt.length === 1;
    const reasons = alt.length === 1 ? alternatives.get(alt[0]) : alt.map((s) => `${staffName(s, total)}: ${alternatives.get(s)}`).join('; ');
    bag.add(
      'alternative-part-excluded',
      'review',
      `${capitalise(listStaves(alt, total))} of the piano music ${one ? 'looks' : 'look'} like an alternative version of some of the music, such as an ossia (${reasons}), so ${one ? 'it is' : 'they are'} left out and never played together with the main music.`,
    );
  }

  const right = main[0];
  const left = main.length > 1 ? main[main.length - 1] : null;
  const middle = main.slice(1, -1);
  const leftOut = [...alternatives.keys(), ...middle].sort((a, b) => a - b);
  const staffHands: Record<string, Hand> = { [`${id}:${right}`]: 'R' };
  if (left !== null) staffHands[`${id}:${left}`] = 'L';
  if (left === null) {
    bag.add(
      'unclear-hand-mapping',
      'review',
      `Only ${staffName(right, total)} of the piano music has the main music, so the app gives all of it to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead.`,
    );
  } else if (middle.length > 0) {
    bag.add(
      'unclear-hand-mapping',
      'review',
      `The piano music is written on ${total} staves. ${capitalise(staffName(right, total))} is given to the right hand and ${staffName(left, total)} to the left hand; ${listStaves(middle, total)} ${middle.length === 1 ? 'is' : 'are'} left out.`,
    );
  }
  const hands =
    left === null
      ? `${capitalise(staffName(right, total))} of ${quoted(part)} is played by the right hand`
      : `${capitalise(staffName(right, total))} of ${quoted(part)} is played by the right hand and ${staffName(left, total)} by the left hand`;
  return {
    staffHands,
    source: leftOut.length || left === null ? 'unclear' : 'two-staff-part',
    description: leftOut.length ? `${hands}; ${listStaves(leftOut, total)} ${leftOut.length === 1 ? 'is' : 'are'} left out.` : `${hands}.`,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function automaticMapping(
  source: SourceScore,
  candidates: readonly SourcePart[],
  bag: WarningBag,
): HandMapping {
  const { main, alternatives } = splitAlternatives(candidates);
  const excludedParts = alternatives.map((p) => p.id);
  if (alternatives.length) {
    // Detected automatically, so a person should confirm it (an override makes it info).
    bag.add(
      'alternative-part-excluded',
      'review',
      `${capitalise(listNames(alternatives))} ${alternatives.length === 1 ? 'looks' : 'look'} like an alternative version of the music, so ${alternatives.length === 1 ? 'it is' : 'they are'} left out and never played together with the main music.`,
    );
  }

  if (main.length === 0) {
    return { staffHands: {}, excludedParts, source: 'unclear', description: 'No part with notes to play was found.' };
  }
  if (main.length === 1) return { ...mapSinglePart(source, main[0], bag), excludedParts };

  if (main.length === 2 && main.every((p) => p.staves <= 1)) {
    const [a, b] = main;
    const avgA = averagePitch(source, a.id);
    const avgB = averagePitch(source, b.id);
    let upper = a;
    let lower = b;
    if (avgB > avgA) [upper, lower] = [b, a];
    else if (avgA === avgB && a.clefs[1] === 'F' && b.clefs[1] === 'G') [upper, lower] = [b, a];
    bag.add(
      'hands-from-separate-parts',
      'info',
      `The two hands come from two separate parts: ${quoted(upper)} for the right hand and ${quoted(lower)} for the left hand.`,
    );
    const others = [upper, lower].filter((p) => !couldBeOneHand(instrumentOf(p)));
    if (others.length > 0) {
      // Parts for other instruments (a violin and a cello, say) are not a
      // piano piece; the higher part as the right hand is only a best guess.
      const what =
        others.length === 1
          ? `${capitalise(quoted(others[0]))} does not look like a piano part, so this file may be for more than one instrument.`
          : `${capitalise(listNames(others))} do not look like piano parts, so this file may be for other instruments.`;
      bag.add(
        'multiple-instruments',
        'review',
        `${what} The higher part is given to the right hand and the lower part to the left hand as a best guess.`,
      );
    }
    return {
      staffHands: { [`${upper.id}:1`]: 'R', [`${lower.id}:1`]: 'L' },
      excludedParts,
      source: 'two-single-staff-parts',
      description: `${capitalise(quoted(upper))} is played by the right hand and ${quoted(lower)} by the left hand.`,
    };
  }

  // Several instruments or players: practise one piano part and leave the rest out.
  const twoStaff = main.find((p) => p.staves === 2);
  const chosen = twoStaff ?? main.reduce((x, y) => (y.pitchedNoteCount > x.pitchedNoteCount ? y : x));
  const rest = main.filter((p) => p !== chosen);
  bag.add(
    'multiple-instruments',
    'review',
    `This file contains more than one instrument or player. Only ${quoted(chosen)} is used for practice.`,
  );
  bag.add('extra-parts-excluded', 'review', `${capitalise(listNames(rest))} ${rest.length === 1 ? 'is' : 'are'} left out.`);
  const mapped = mapSinglePart(source, chosen, bag);
  if (!twoStaff) {
    bag.add(
      'unclear-hand-mapping',
      'review',
      'No part is written for two hands on two staves, so the hand assignment is a best guess.',
    );
    return { ...mapped, excludedParts: [...excludedParts, ...rest.map((p) => p.id)], source: 'unclear' };
  }
  return { ...mapped, excludedParts: [...excludedParts, ...rest.map((p) => p.id)] };
}

function overrideMapping(
  source: SourceScore,
  overrides: ScoreOverrides,
  bag: WarningBag,
): HandMapping {
  const reason = overrides.reason?.trim();
  bag.add(
    'other',
    'info',
    reason
      ? `The hands follow a checked setting for this arrangement: ${reason}`
      : 'The hands follow a checked setting for this arrangement.',
  );

  const known = new Map(source.parts.map((p) => [p.id, p]));
  const excluded = new Set((overrides.excludeParts ?? []).filter((id) => known.has(id)));
  const excludedList = [...excluded].map((id) => known.get(id)).filter((p): p is SourcePart => p !== undefined);
  const altLike = excludedList.filter(looksAlternativeByText);
  const extra = excludedList.filter((p) => !looksAlternativeByText(p));
  if (altLike.length) {
    bag.add('alternative-part-excluded', 'info', `${capitalise(listNames(altLike))} ${altLike.length === 1 ? 'is' : 'are'} an alternative version of the music and ${altLike.length === 1 ? 'is' : 'are'} left out.`);
  }
  if (extra.length) {
    bag.add('extra-parts-excluded', 'info', `${capitalise(listNames(extra))} ${extra.length === 1 ? 'is' : 'are'} left out.`);
  }

  const candidates = source.parts.filter((p) => p.pitchedNoteCount > 0 && !excluded.has(p.id));
  let unknown = false;
  const voiceHands: VoiceHandOverride[] = [];
  for (const rule of overrides.voiceHands ?? []) {
    const checked = checkedVoiceRule(rule);
    if (!checked) continue;
    if (!known.has(checked.part)) unknown = true;
    else if (!excluded.has(checked.part)) voiceHands.push(checked);
  }
  const staffHands = overrides.staffHands;
  let mapping: HandMapping;
  if (!staffHands || Object.keys(staffHands).length === 0) {
    const auto = automaticMapping(source, candidates, bag);
    mapping = { ...auto, excludedParts: [...excluded, ...auto.excludedParts] };
  } else {
    const map: Record<string, Hand> = {};
    for (const [key, hand] of Object.entries(staffHands)) {
      const partId = key.slice(0, key.lastIndexOf(':'));
      if (!known.has(partId)) unknown = true;
      else if (!excluded.has(partId)) map[key] = hand;
    }
    const used = new Set([...Object.keys(map).map((k) => k.slice(0, k.lastIndexOf(':'))), ...voiceHands.map((v) => v.part)]);
    const unused = candidates.filter((p) => !used.has(p.id)).map((p) => p.id);
    mapping = {
      staffHands: map,
      excludedParts: [...excluded, ...unused],
      source: 'override',
      description: reason
        ? `The hands follow a checked setting for this arrangement: ${reason}`
        : 'The hands follow a checked setting for this arrangement.',
    };
  }
  if (unknown) {
    bag.add(
      'unclear-hand-mapping',
      'review',
      'The checked hand setting for this arrangement refers to parts that are not in the file.',
    );
  }
  if (voiceHands.length === 0) return mapping;
  const display = measureDisplayNumbers(source.measures);
  const sentences = voiceHands.map((rule) => voiceHandSentence(rule, known.get(rule.part)!, display));
  return {
    ...mapping,
    voiceHands,
    description: [mapping.description, ...sentences].filter((t) => t !== '').join(' '),
  };
}

/** A copy of a voice rule with only well-formed measure ranges, or null when the rule itself is unusable. */
function checkedVoiceRule(rule: VoiceHandOverride): VoiceHandOverride | null {
  if (typeof rule?.part !== 'string' || typeof rule.voice !== 'string' || (rule.hand !== 'R' && rule.hand !== 'L')) return null;
  const out: VoiceHandOverride = { part: rule.part, voice: rule.voice.trim(), hand: rule.hand };
  if (rule.measures !== undefined) {
    out.measures = (Array.isArray(rule.measures) ? rule.measures : [])
      .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] <= r[1])
      .map(([a, b]) => [a, b] as [number, number]);
  }
  return out;
}

/** One sentence for the diagnostics view, naming the measures by their readable numbers ("In measures 1–36 and 40–44, ..."). */
function voiceHandSentence(rule: VoiceHandOverride, part: SourcePart, display: readonly string[]): string {
  const hand = rule.hand === 'R' ? 'right' : 'left';
  const what = `one voice of ${quoted(part)} is played by the ${hand} hand, whatever staff it is written on.`;
  if (!rule.measures) return capitalise(what);
  const last = display.length - 1;
  const spans = rule.measures.map(([a, b]) => [Math.max(0, a), Math.min(last, b)] as const).filter(([a, b]) => a <= b);
  if (spans.length === 0) return '';
  const names = spans.map(([a, b]) => (a === b ? display[a] : `${display[a]}–${display[b]}`));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const single = spans.length === 1 && spans[0][0] === spans[0][1];
  return `In ${single ? 'measure' : 'measures'} ${list}, ${what}`;
}

/**
 * Decides which part/staff is played by which hand. Hands are never derived
 * from a pitch split (such as middle C): only the score layout is used.
 */
export function detectHandMapping(source: SourceScore, overrides?: ScoreOverrides): HandMappingResult {
  const bag = new WarningBag();
  const hasOverride =
    overrides !== undefined &&
    ((overrides.excludeParts?.length ?? 0) > 0 ||
      Object.keys(overrides.staffHands ?? {}).length > 0 ||
      (overrides.voiceHands?.length ?? 0) > 0);
  const mapping = hasOverride
    ? overrideMapping(source, overrides, bag)
    : automaticMapping(source, source.parts.filter((p) => p.pitchedNoteCount > 0), bag);
  return { mapping, warnings: bag.list() };
}
