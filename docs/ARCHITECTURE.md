# Architecture and module contracts

This is the implementation contract shared by everyone working on the code.
Requirements live in `piano-practice-app-requirements.md` (the "brief"); section
numbers below (§) refer to it. Shared types live in `src/core/types.ts` — do not
change their meaning; additive optional fields are fine if you note them here.

Stack: Vite + React 19 + TypeScript (strict), Vitest (jsdom env) for tests,
`fflate` for `.mxl` unzip, `idb-keyval` for IndexedDB. No Tone.js, no OSMD, no
router library, no state library. Build output is a static site with
`base: './'` and hash routing (`#/`, `#/piece/<id>`), so it works under a GitHub
Pages project subpath.

MuseTrainer (MIT) informed the design (feature set, Salamander samples, MIDI
flow, range/loop controls), but its Angular/Ionic/OSMD cursor architecture is
not reused: the brief replaces sheet music with an action timeline and warns
against inheriting cursor-based timing bugs (§3). This is a documented
deviation.

## Directory layout

```
src/core/            pure TypeScript, no React, no Web Audio, no Web MIDI
  types.ts           shared contracts (do not break)
  pitch.ts           midi <-> labels, black keys, piano range
  xml.ts             safe XML decode/parse, ImportError
  mxl.ts             MusicXML / MXL container handling + size limits
  musicxml/parse.ts  MusicXML text -> SourceScore
  measures.ts        readable measure numbers (measureDisplayNumbers)
  voices.ts          voice home staves (cross-staff notes)
  instruments.ts     keyboard-part test shared by hands.ts and the catalog build
  model/hands.ts     staff/part -> hand mapping (+ overrides)
  model/performance.ts repeats/endings/jumps unrolling, tempo map, tie merge
  model/physical.ts  PerformanceNote[] -> KeyPress[] per hand
  model/prepare.ts   SourceScore (+overrides) -> PreparedScore, readiness
  actions/derive.ts  PreparedScore + hands + range -> StepSequence
  actions/interpret.ts  INDEPENDENT interpreter + round-trip checker
  actions/timing.ts  step times for Listen (tempo map) and Steady (equal)
  practice/follow.ts FollowMatcher (pure state machine, synthetic-event tested)
src/midi/            Web MIDI wrapper + message decoding
src/audio/           Web Audio sampler (Salamander samples) + fallback synth
src/engine/          PracticeSession: shared clock, scheduling, modes
src/storage/         localStorage prefs, IndexedDB imports
src/catalog/         generated catalog.json + loader
src/ui/              React components and pages
scripts/             build-catalog.ts (Node, uses src/core)
catalog/             hand-curated metadata.json (credits, notes, hand overrides), difficulty.json (provenance)
tests/               *.test.ts, fixtures/*.musicxml
public/scores/       69 .mxl files vendored from musetrainer/library
public/audio/piano/  Salamander Grand Piano samples (CC-BY 3.0)
```

`src/core` must run in both the browser and Node. XML parsing uses the global
`DOMParser`; Node scripts install `@xmldom/xmldom`'s DOMParser on `globalThis`
first (see `scripts/build-catalog.ts`), and Vitest uses the jsdom environment.
Only use DOM APIs supported by both jsdom and xmldom: `childNodes`, `nodeType`,
`nodeName`/`localName`, `getAttribute`, `hasAttribute`, `textContent`,
`getElementsByTagName`. Do not use `children`, `querySelector`, or
`firstElementChild`; xmldom does not reliably support them.

## Time and pitch

- Ticks: `ticksPerQuarter = lcm(all <divisions> values in the file, 48)`. Every
  MusicXML duration is converted to these exact integers. The extra factor of
  48 leaves room to subdivide grace-note time.
- Equal ticks are simultaneous. Never merge events with a tolerance.
- MIDI number = `(octave + 1) * 12 + semitone(step) + round(alter)`. MIDI 60 is
  C4. B#3 → 60 → "C4"; Cb4 → 59 → "B3". Labels are always sharp-only
  (`C#4`, never `Db4`). The spelling is kept in `SpelledPitch` for provenance.
- Piano range: A0 = 21 through C8 = 108. Notes outside it are kept (not clamped)
  and produce an `out-of-piano-range` warning (review). The keyboard
  shows an explicit notice for them. A note no MIDI device or sound can carry
  (a MIDI number outside 0–127, or an `<octave>` outside MusicXML's 0–9, as
  only a damaged or hostile file has) is left out instead, with the same
  review warning and an info note. Large `<alter>` values that still give a
  MIDI number in range are kept (one library file spells D4 as F3 with nine
  sharps). The sampler and the MIDI output also ignore anything that is not a
  MIDI number 0–127, and the engine's scheduler moves past each event before
  handing it to the sampler, so one bad event can never stall playback.

## 1. MusicXML → SourceScore (`musicxml/parse.ts`)

`parseMusicXml(xmlText: string): SourceScore` and
`loadSourceScore(bytes: Uint8Array, fileName?: string): SourceScore`.

- Security (§12): reject documents containing `<!ENTITY`; strip `<!DOCTYPE …>`
  (including any internal subset) before parsing, so no external DTD or entity
  is ever resolved. Detect parse errors (a `parsererror` element in the browser
  or jsdom; thrown errors in xmldom) and raise
  `ImportError('malformed-xml', …)`. Root must be `score-partwise`;
  `score-timewise` is converted to partwise, with an info warning. Anything else
  raises `ImportError('not-musicxml')`.
- Size: a file with more than 200 parts, or more than 200,000 parts ×
  measure columns, raises `ImportError('too-large')` before any per-measure
  work ("This score has too many parts and measures to open safely."). Each
  part reads only the measures it has, so a tiny hostile file cannot make the
  parser allocate parts × columns of work. A `<staves>` value above 64 in a
  part is ignored; the staves that carry notes (up to 64) are counted
  instead (see Hands, rule 4).
- All metadata is plain text. Never treat it as HTML.
- Encoding: decode bytes by BOM (UTF-8 / UTF-16LE / UTF-16BE), else UTF-8.
- Measures are index-aligned across parts. Measure *i* of every part is the same
  column. Measure `durationTicks` is the largest cursor position reached in
  any part, counting `<backup>`/`<forward>` and notes. If that is 0, use the
  time-signature length. If a non-implicit measure's content differs from its
  time signature, add an info warning `measure-length-mismatch` but still use
  the content length.
- Notes:
  - `<chord/>` means same onset as the previous non-chord note.
  - `<rest>` advances the cursor but is not emitted.
  - `<cue>` (small "cue") notes take their written time in the voice, like
    any other note: the cursor advances by their `<duration>`, so the notes
    after them land where written. Every note of a chord whose first note
    is a cue note is a cue note too (MuseScore writes `<cue/>` on the
    chord's first note only). MusicXML does not play cue notes, and most of
    them only repeat or decorate notes already played (a written-out trill
    over its main note, a grace note spelled out, a chord restated for
    playback, another reading of a passage), so playing them would double
    the music; small notes over a part's rests are usually another
    instrument's line, shown only to help the player come in. A cue note is
    played only when the file clearly means it as a cadenza; all of these
    must hold (`cueNotesToPlay` in `musicxml/parse.ts`):
    - it is printed: a hidden cue note is neither shown nor heard;
    - its measure is written longer than its time signature (not a
      pickup), as a cadenza in free time is. Small notes in a measure of
      ordinary length are taken for another part's cue and stay silent,
      even over the piano's rests. The trade-off: a cadenza written in a
      measure whose time signature was changed to fit it is not played (as
      before this rule), and the info warning says so;
    - no regular note sounds on its staff at any moment of its written
      time (it does not sit beside the regular music);
    - its staff has no hidden regular notes in that measure: those are the
      file's own playback of that spot, and the small notes only show it.
    A played cue note keeps its written start and length (`SourceNote.cue`
    is `true`) and is reported with the info warning `cue-notes-played`;
    every other cue note is left out with the info warning
    `cue-notes-skipped`. A cue grace note is always left out. In the
    library this plays only the cadenza of the Moonlight Sonata's 3rd
    movement (`Sonate_No._14…`, measure 188: 30 notes for the right hand,
    the same notes the other edition writes as grace notes). The written-out
    trills there (measures 30, 32, 36, 126, 128, 132), the hidden chords and
    mordent of Prelude No. 2 (m34), the hidden trills of Rondo alla Turca
    (m24, m94) and of the Minuet in G (m8), the alternative turn ending of
    the Chopin Ballade (m25) and the small B6/G#6 over La Campanella's
    hidden G#6 (m105) all stay silent.
  - `<grace>` handling is below.
  - `<unpitched>` is skipped.
  - Pitch comes from `<pitch>` and is already the *sounding* octave.
    `<octave-shift>` is visual only, so ignore it.
  - Words asking for an octave shift ("8va", "8vb", "8ve", "15ma", "15mb",
    "ottava") with no `<octave-shift>` in the same measure are not applied:
    those notes play at their written pitch. Such a measure gets the review
    warning `octave-text-not-applied` (both Entertainer editions have one), so
    the piece is marked for review instead of silently ignoring the
    instruction.
  - Apply `<transpose>` (`chromatic` + 12 × `octave-change`) if present. A
    transposition of more than 48 semitones (four octaves) either way is a
    damaged value: it is ignored, with an info note.
  - Ties use `<tie type="start|stop">`. Fall back to
    `<notations><tied>` only when a note has no `<tie>`.
  - `voice` defaults to "1" and `staff` defaults to 1.
  - Velocity comes from `<sound dynamics>` (a percentage of 90) or the note's
    `dynamics` attribute, clamped to 1–127. It is optional.
  - A note with `dynamics="0"` is silent in the file's own playback. If it is
    printed and no hidden notes play in its place (a written-out ornament,
    see below), it is shown in the music, so it is played at the loudness
    around it and expected in Follow me, with the info warning
    `silent-notes-played` (The Entertainer and the fingered Turkish March have
    some). A note that is both hidden (`print-object="no"`) and silent is
    left out, with an info note.
  - A printed note whose sound the file gives to hidden notes on the same
    staff during its time (it is silenced, or it carries an ornament sign and
    the hidden notes include its pitch) is how a written-out ornament is
    stored: the hidden notes are played in its place from where the first of
    them starts. Any part of the printed note before that is kept (a turn
    written after the beat, as in the Pathétique 2nd movement m20–21), and
    the same holds for a tied continuation. Such a note gets no
    `ornament-not-played` warning; the info note says the hidden notes are
    played "in place of the main note shown, from where they start".
  - A note made only of hidden notes (after ties are joined) that would
    strike a key the other hand is holding for a printed note at its start is
    left out, with an info note (`other`) listing the measures: no pianist
    could play it without letting go of that key. It is matched on the key
    alone, since both hands share one keyboard. Doublings within one hand are
    left to `physical.ts`.
- Grace notes are an approximation, reported with the info warning
  `grace-notes-approximated` and its measure list:
  - Collect a voice's run of grace notes (a grace chord counts as one slot)
    before the next non-grace note (the principal) in the same voice and
    measure.
  - With *k* slots and principal duration *D*,
    `g = min(floor(D / (k + 1)), ticksPerQuarter / 8)`, and at least 1.
  - Slot *j* starts at `principalOnset + j·g` and lasts `g`. The principal
    starts at `principalOnset + k·g` and lasts `D − k·g`, so the graces steal
    time from the start of the principal.
  - If no principal follows, the graces steal from the end of the previous
    non-grace note in that voice. If there is no such note, drop them and
    include them in the warning count.
- Cross-staff: every note's voice has a home staff, worked out by
  `voiceHomeStaves()` in `src/core/voices.ts`. The parser (which sets
  `crossStaff`) and the hand assignment in `performance.ts` both call it, so
  they always agree.
  - Voices numbered in blocks of four per staff belong to their block's
    staff: voices 1–4 to staff 1, 5–8 to staff 2, and so on. MuseScore files
    always use this numbering. Files from other programs are read this way
    only when the part clearly uses it: every voice number fits a staff, a
    lower staff has its own block, and each block's notes are mostly drawn on
    that block's staff.
  - A part that numbers its voices separately on each staff keeps every
    note on the staff it is drawn on: there a voice number does not name a
    hand. A part counts as numbered per staff when some voice id sounds on two
    staves at the same time (for example when `<voice>` is left out and every
    note reads as voice 1), or when voice 1, for every staff with notes, has a
    measure in which it is drawn on that staff alone, with no other voice
    sounding on that staff meanwhile (the hands take turns in voice 1). A
    measure where voice 1 is the right hand and voice 2 the left hand on the
    same staff therefore does not count.
  - Otherwise a voice's home is the staff holding most of its notes. A note
    of that voice drawn on the other staff is cross-staff only while the
    voice is also on its home staff in the same or a neighbouring measure; a
    passage on the other staff away from that is the other hand's (the file
    reused the voice number at a different time). Only an exact tie is
    decided measure by measure (ties there go to the upper staff).
  - A staff is never left without a voice of its own: if every note drawn on
    it would belong to another staff's voice, those notes stay on it. So a
    reused voice id can never move a whole staff to the other hand.

  A note drawn on a staff other than its voice's home gets
  `crossStaff = true`, plus a `cross-staff-notes` warning (review) listing
  measures. Its message says the app guesses which hand plays these notes
  from the musical line they belong to and, if a hand feels wrong, that the
  measures are listed under More → About this arrangement (no message points
  at measures it does not name). Hand assignment gives a cross-staff note the hand of its
  voice's home staff, not the staff it is drawn on. This was verified on the
  library: the Moonlight Sonata's right-hand triplets are drawn in the bass
  staff when they dip low, Mariage d'Amour's left-hand voice climbs into the
  treble staff, and the upper chords in the Chopin E-minor Prelude (m24–25)
  stay with the right hand.
- Repeat and navigation marks go on `SourceMeasure`, merged over every part
  of the measure: a mark written in any part counts (flags are combined,
  endings are combined without duplicates, and the first repeat count found
  wins). Read `<barline>`
  `<repeat direction times>`, `<ending number type>`, `<segno>`, `<coda>`,
  `<sound dacapo|dalsegno|fine|tocoda|coda|segno>`, and words "D.C.",
  "D.S.", "Fine", "To Coda" (case-insensitive) when the matching `<sound>`
  attribute is missing.
  - Ending numbers are parsed from strings like `"1"`, `"1, 2"`, `"1."`, or
    `"1-3"`.
- Tempo: use `<sound tempo>` (quarter-notes per minute) at its position in the
  measure. If a direction has `<metronome>` but no sound tempo, convert
  `beat-unit` (+ dots) × `per-minute` to quarter-notes per minute. Ignore
  values that are ≤ 0 or > 1000.
- Ornaments: `trill-mark`, `mordent`, `inverted-mordent`, and `turn` play only
  the principal note. This gets the review warning `ornament-not-played`
  (the quick extra notes the music asks for are missing, so the piece is not
  marked ready). `<tremolo>` is not expanded
  (review `tremolo-not-expanded`). A `<glissando>` or `<slide>` with
  `type="start"` plays only its first and last notes (review
  `glissando-not-played`). `<arpeggiate>` is played as a block chord
  (info). `<pedal>` is counted in `pedalMarks` and produces an info
  `pedal-not-modelled` warning.
- Warnings are aggregated per code. Keep one entry per code with `count` and up
  to 20 measure numbers. `count` counts occurrences (usually notes), not
  measures; `measuresTruncated: true` marks a list that was cut at 20 (a
  further distinct measure did not fit), and only then does the app add
  "and others" after the list. Measure numbers in warnings are the readable display
  numbers described under "Performance order" below, never internal ids such
  as "X1".
- Ossia hints are recorded per staff in the optional `SourcePart.staffDetails`
  (`StaffDetails`): `<staff-type>`, a reduced `<staff-size>`, and words placed
  on a staff with `<direction><staff>`. Hand assignment uses them (see Hands,
  rule 4).

`ImportError` (in `xml.ts`) has
`code: 'not-musicxml' | 'malformed-xml' | 'bad-archive' | 'too-large' | 'no-score-in-archive' | 'unsafe-content' | 'empty-score' | 'unsupported'`
and a plain-language `message`.

### MXL (`mxl.ts`)

`extractMusicXmlText(bytes: Uint8Array, fileName?: string): string`

- A zip is detected by its magic bytes (`PK\x03\x04`), not by the file
  extension.
- Limits: archive ≤ 20 MB, total uncompressed ≤ 60 MB, at most 200 entries.
  The declared sizes are checked before anything is inflated; over the limit
  raises `too-large`. A corrupt zip raises `bad-archive`.
- Reading an entry is bounded by its declared size, so a zip whose stated
  sizes are false cannot use extra memory or keep the CPU busy. Entries are
  located through the zip's central directory (zip64 sizes are supported).
  Stored entries are copied; deflated entries go through a streaming inflater
  in 16 KB slices that stops as soon as the output passes the declared size,
  and never inflates more than the total uncompressed limit.
  Any other compression method, an unreadable directory, a wrong length or a
  failed CRC-32 checksum raises `bad-archive`.
- The archive has one directory. The directory the reader uses must agree
  with the zip library's own listing on every entry's name, both sizes and
  compression method, and a zip64 end record, if present, must point to the
  same directory as the classic end record. Otherwise (for example an archive
  with a second directory that hides large entries from the size check) it
  raises `bad-archive`. Where the classic end record holds the zip64 marker
  values (0xFFFF for the entry count, 0xFFFFFFFF for the directory offset),
  as `zip -fz` and some writers always do, the real values come from the
  zip64 end record; every field of the classic record that holds a real
  value must still match it.
- Read `META-INF/container.xml` and use the first `rootfile@full-path`. If it is
  missing, fall back to the first `*.xml` or `*.musicxml` outside `META-INF/`.
  If there is none, raise `no-score-in-archive`.
- Non-zip input is decoded as XML text.
- Anything that is not a zip and doesn't look like XML raises `not-musicxml`.

## 2. PreparedScore (`model/*`)

`prepareScore(source: SourceScore, overrides?: ScoreOverrides): PreparedScore`

### Hands (`hands.ts`) — §10

`detectHandMapping(source, overrides?) → { mapping: HandMapping; warnings }`

1. Overrides win. `excludeParts` removes those parts, and
   `staffHands` replaces the automatic map. `voiceHands` rules
   (`{ part, voice, hand, measures?: [first, last][] }`, with 0-based written
   measure indexes, both inclusive) give one voice of a part to one hand
   whatever staff it is drawn on, for a file that writes a hand's notes in a
   voice of the other staff (the Erik Satie Gymnopédie copy). They are checked
   before `staffHands` and the automatic map, are carried on
   `HandMapping.voiceHands`, and are described in the hand-mapping
   description with readable measure numbers. The result has an info warning
   quoting `overrides.reason`. The reason is shown to the player, so it is
   plain language with no part ids (P1, P2) or file names; `npm run catalog`
   reports any that slip in. The curator's technical record goes in
   `overrides.evidence` in `catalog/metadata.json`, which is listed in
   `docs/CATALOG_REPORT.md` and never copied into `catalog.json`.
2. Candidate parts are those with `pitchedNoteCount > 0`.
3. Alternative-part detection marks a part as an alternative when its name or
   words match `/ossia|alternat|voorslag|ornament/i`, *or* it has fewer than
   3% of the largest part's pitched notes while another part has two staves.
   Alternatives are excluded with an `alternative-part-excluded` warning (review
   unless confirmed by an override). Alternatives are never played together
   with the main passage.
4. With exactly one remaining part:
   - Two staves: staff 1 → R and staff 2 → L (`two-staff-part`).
   - One staff: everything → R (`single-staff`, review warning
     `single-staff-part`).
   - Three or more staves: first leave out staves that look like an
     alternative (an ossia): hidden in the printed music, marked as an
     alternative (`<staff-type>` such as ossia or cue, or words such as
     "ossia" placed on that staff), printed smaller than the largest staff
     that has notes (a staff without `<staff-size>` counts as 100, so a part
     printed at 75% throughout leaves nothing out), or with very few notes.
     The busiest staff is never left out, and the lowest staff with notes is
     never left out just for having few notes. A staff next to a left-out
     ossia whose notes all fall in that ossia's measures is left out too (an
     ossia for both hands has two staves). Of the remaining staves, the top
     one → R and the bottom one → L, any in between are left out, and a
     review `alternative-part-excluded` warning says in plain words which
     staves were left out and why. When no staff looks like an alternative,
     the rule is unchanged: `unclear` (review), staff 1 → R and the lowest
     staff → L, the others unmapped, and say so. Only staves that carry notes
     are considered, and a `<staves>` value above 64 is ignored (the highest
     staff that carries notes is used instead), so a file declaring absurd
     staff counts cannot exhaust memory.
5. With exactly two remaining single-staff parts: the part with the higher
   average pitch (with the first clef G vs F as a tie-break) → R, the other → L
   (`two-single-staff-parts`, info `hands-from-separate-parts`). Unless both
   parts could be one hand of a piano piece (a keyboard part by name, sound id
   or General MIDI program 1–8, see `isKeyboardPart` in `src/core/instruments.ts`;
   a part named after a hand; or an unnamed part that declares no instrument),
   a review `multiple-instruments` warning says the file may be for other
   instruments and the split is a best guess. The catalog build uses the same
   `isKeyboardPart` test.
6. Otherwise, choose the first two-staff part, exclude the rest with
   `extra-parts-excluded` and `multiple-instruments` (review), and use
   `unclear` when even that is not possible.
7. Never assign hands by splitting at middle C.

### Performance order (`performance.ts`) — §12, §13

`unrollMeasures(source) → { occurrences: MeasureOccurrence[]; warnings }`

- Supports forward and backward repeats (`times`), first and second endings
  (including `"1, 2"` and endings without a closing repeat), D.C., D.S., Fine,
  To Coda, and Coda. After a D.C. or D.S. jump, inner repeats are *not* taken
  again (the conventional reading).
- A backward repeat with no earlier forward repeat goes back to the start of
  the piece, or to just after the previous backward repeat or final ending.
- Guard: if the unrolled length exceeds 8× the measure count, or a jump target
  is missing, fall back to written order. In that case add a review warning
  `repeats-unsupported` / `jump-unsupported`, which says the piece is played
  straight through.
- `pass` counts how many times that measure has sounded so far, so after a
  D.C. it can read 3. `label` is `"12"` the first time, then `"12 (2nd time)"`,
  `"12 (3rd time)"`, and so on. `occ` is the unique performance position (§13
  occurrence ids).
- `number` and `label` use readable measure numbers from
  `measureDisplayNumbers()` (`src/core/measures.ts`). Every label is
  different. A number from the file that starts with a digit ("12", "12a") is
  shown as written, unless an earlier measure already has it: then it gets a
  letter ("12", then "12a"; numbering that restarts reads "1a", "2a", …).
  When every measure carries the same number (an unmetered piece exported
  with "0" on each measure, such as Gnossienne No. 1), the measures are
  counted by position instead ("1", "2", "3", …). An internal id
  such as MuseScore's "X1" (a measure left out of the count) becomes the
  previous numbered measure plus a letter ("20a", "20b", …), or "0", "0a", …
  before the first numbered measure, and never repeats a number already in
  the file. A measure with no number gets its 1-based position. If one
  number would need more than 52 letter suffixes (past "12zz", only in a
  damaged file), the whole score is counted by position instead. The letter
  search resumes where it stopped for each number, so labelling stays linear
  in the number of measures. The parser's
  and the model's warnings list measures the same way.
- `simulate()` checks an ending before a `||:` on the same measure starts a
  new section. A measure reached by going back to its own `||:` is played
  without the ending check only when its bracket closes an earlier section
  (a 2nd ending that also opens the next repeated section). A 1st ending that
  itself carries the `||:` ("||: [1. … :|| [2. …") belongs to the section it
  opens, so on the way back it is still checked and skipped in favour of the
  2nd ending. A final ending does not close a section that a `||:` inside it
  has just opened.

`buildTempoMap(source, occurrences) → TempoMap`

- Follows the tempo in performance order: each source tempo is placed in every
  occurrence of its measure, and the tempo in force carries on from one
  occurrence to the next.
- Going back to a measure already played (a repeat, D.C. or D.S.) resumes the
  tempo that measure had when it was first played. Skipping forward past
  measures (a later ending, To Coda) keeps the tempo in force, because the
  marks in the skipped measures never sounded. A D.C. back to a pickup before
  the first mark uses the first tempo.
- If the file has no tempo, use `{ tick: 0, qpm: 120 }` with
  `defaulted: true` and an info warning `no-tempo-in-file`. The message says
  120 quarter-notes per minute was chosen by the app.
- The first tempo mark (in written order) also applies from tick 0 when it
  is near the start: in the first measure, or in the first full measure
  after a pickup (a first measure marked implicit, or shorter than its time
  signature). Beethoven 5 marks its tempo a beat into measure 1, so it still
  plays at that tempo from the start.
- A first mark further in leaves the opening unmarked: the opening plays at
  the app's default (120 quarter-notes per minute, the same constant as for
  a file with no tempo) until the first mark, and `prepareScore` adds the
  info warning `opening-tempo-defaulted` ("The opening has no tempo mark,
  so the app plays it at 120 quarter notes per minute until the first
  marked tempo (measure 28)."). `defaulted` stays `false`: the file does
  give a tempo. A repeat or D.C. back to the opening resumes at 120. In the
  library only Prelude No. 2 (BWV 847) has this: 120 until the Presto
  (145) at measure 28.

`tickToSeconds(map, tick)` / `secondsToTick(map, seconds)` are piecewise-linear
and exact at tempo points.

`buildPerformanceNotes(source, occurrences, mapping) → { notes; warnings }`

- Unmapped part/staff combinations are dropped.
- Tie merging happens *after* unrolling, in performance order. A `tieStop`
  note extends an open tied note in the same part with the same midi whose
  `endTick` equals its start. Prefer the same voice, then the same staff, then
  any staff in the part. Otherwise it is a new attack (info `tie-unmatched`).
  This correctly re-attacks a tied note that was entered through a repeat jump.

### Physical presses (`physical.ts`) — §6 voices

`buildKeyPresses(notes) → { presses: KeyPress[]; warnings }`, per hand per midi:

- Notes with the same start become one press ending at the max end (safe
  unison coalescing; `noteIds` lists them all).
- When a press starts while an earlier press of the same key is still down in
  the same hand, the earlier press ends at the new start (rearticulation) and
  the new press lasts until `max(both ends)`. This keeps the attack and never
  releases early. The case gets an info warning `voice-overlap-same-key` with
  measures.
- Zero-length results are dropped (info `zero-length-note`).
- Sort by startTick, then hand (R before L), then midi.

### Readiness

- `unsupported`: there are no presses after mapping, or there is an
  `error`-severity warning.
- `review`: there is any warning with severity `review`. Besides the parser
  and hand warnings, `prepareScore` adds `hand-span-too-wide` (review) when
  one hand strikes keys more than 16 semitones apart at the same moment
  (wider than a tenth): some of those notes may belong to the other hand, or
  the chord may be meant to be rolled. Its measure list names the places.
- `ready`: anything else. Info warnings (such as `silent-notes-played`) do not
  change readiness.

`readinessReasons` lists the plain-language messages.

## 3. Actions (`actions/derive.ts`) — §6, §7

`rangeTicks(measures, range|null) → { startTick, endTick }`

`clipPresses(presses, hands, startTick, endTick) → KeyPress[]`

- A press intersecting `[start, end)` is clipped to `[max(s, start), min(e, end)]`.
- `carried = true` when the press started before `start`.
- Empty results are dropped.

`deriveSteps(score: Pick<PreparedScore,'presses'|'measures'|'endTick'>, hands: Hand[], range: PassageRange|null) → StepSequence`

1. Use the clipped presses for the included hands.
2. The step ticks are the sorted unique set of every press start and end. That
   includes release-only events and the final release. A tick where only an
   excluded hand acts does not exist in this sequence (§8 hand filtering).
3. For each step tick *t* and included hand *h*, compute:
   - `S` = keys starting at *t*
   - `E` = keys ending at *t*
   - `B` = keys held just before *t* (`start < t ≤ end`)
   - `C` = `B − E` (keys that continue)
4. Map these sets to a cell (canonical rules, §6):
   - `S = ∅, E = ∅` → `hold` (`—`).
   - `S = ∅, E ≠ ∅, C = ∅` → `rest` (`.`).
   - `S ≠ ∅, C = ∅` → `replace`, tokens `S` with action `press`. This covers
     rearticulation when nothing continues.
   - `C ≠ ∅` with any change → `change`: blue `release` tokens for `E − S`,
     red `add` tokens for `S`. `repress = true` when the key is in `E ∩ S`.
5. Never mix `press` tokens with add/release tokens in one cell.
6. Tokens are ordered highest midi first. Carried presses produce tokens with
   `carried = true`; these presses always start at `startTick`.
7. `attacks[h] = S`, `releases[h] = E`, and `heldBefore` / `heldAfter` are
   sorted ascending.
8. `releaseOnly` is true when no included hand has an attack.
9. `occ` is the occurrence whose `[startTick, startTick + durationTicks)`
   contains *t*. A *t* equal to the passage end belongs to `range.endOcc`.
10. `usedKeys` and `usedKeysByHand` come from the clipped presses.

### Independent interpreter (`actions/interpret.ts`) — §17

This module must not import `derive.ts`. It must also not consult
`attacks`/`releases`/`heldBefore`/`heldAfter`: it reads only `tick` and
`cells` (kind + tokens).

`interpretCells(steps, hands)` keeps a held set per hand and produces per-hand
`{ tick, attacks[], releases[] }[]`:

- `replace`: release everything held, then press the tokens.
- `change`: apply blue releases (error if the key isn't held), then red
  presses. A red token on a held key means release it and press again. A red
  token flagged repress on an unheld key is an error.
- `hold`: nothing.
- `rest`: release everything (error if nothing was held? No — `.` on an empty
  hand is a no-op and allowed).

`eventsFromPresses(presses, hands)` builds the same structure directly from
`KeyPress[]`.

`roundTrip(seq) → { ok, mismatches: string[] }` compares the two. It must
catch dropped repeated attacks, since it compares attack lists rather than held
sets.

### Timing (`actions/timing.ts`)

- `listenStepTimes(seq, tempo, speed)` gives seconds from the passage start
  using the tempo map, divided by `speed`.
- `steadyStepTimes(seq, stepSeconds)` gives `i * stepSeconds`.
- `passageDurationListen(seq, tempo, speed)` runs to `endTick`, so trailing
  rests are kept (§8).
- `passageDurationSteady(seq, stepSeconds)` is `steps.length * stepSeconds`.

## 4. Follow me (`practice/follow.ts`) — §8, §9

`class FollowMatcher` (pure, no timers):

- `constructor(seq: StepSequence)`
- `start(stepIndex)` makes that step current, clears fresh presses, then
  auto-advances through release-only steps. Physical down-state is kept.
- `handle(ev: MidiInputEvent) → { advanced: boolean; status: FollowStatus }`
  - Note-on with velocity 0 is a note-off. The MIDI layer decodes this, but
    the matcher must tolerate it too.
  - Physical keys down are tracked separately from sustain. CC64 changes only
    `pedal` and never makes a key count as held or pressed.
  - Every note-on adds the key to `fresh`. A note-on for a key that is already
    down (no note-off in between) is ignored.
  - The current step's `expected` is the union over included hands of
    `attacks[h]`, limited to the piano's keys (A0–C8). Notes beyond the 88
    keys are never waited for: a step whose only notes lie beyond them is
    skipped like a release-only step, and a device that can send such a note
    is not marked wrong for it. `FollowStatus.beyondPiano` lists the step's
    notes that can't be asked for.
  - The step is complete when every expected key is in `fresh` and currently
    down, and no `wrong` key is down. Staggered chord presses are fine; there
    is no simultaneity window.
  - On completion, clear `fresh` entirely, so the same events cannot complete
    a later step. Then advance and auto-skip release-only steps.
  - A key is wrong when it is down, was pressed after the step began, is not
    in `expected`, and is not allowed by the score's held state. On a step
    entered by `start()` (passage start, seek, loop restart) every key the
    score already holds (`heldBefore[h]`) is allowed, so the learner can set
    up a passage that begins mid-hold. After an advance only keys the score
    keeps holding through the step (`heldAfter[h]`) are allowed, so
    re-striking the previous note or chord is marked wrong and blocks the
    step. Releasing a wrong key clears the mark, so the learner corrects and
    continues without restarting.
  - A held key never satisfies a later repeated attack, because `fresh` was
    cleared and no new note-on arrived.
  - Holds and releases are forgiving: early releases and late holds are not
    checked.
- `status(): FollowStatus`, `get pedal(): boolean`, `get physicalDown(): number[]`.
- Only real MIDI input may be fed to the matcher, never app playback.

## 5. MIDI (`src/midi`)

- `decodeMidiMessage(data, time) → MidiInputEvent | null` handles note-on and
  note-off on all 16 channels, velocity-0 note-ons, and CC64. Ignore
  everything else, including clock and active-sensing.
- `MidiManager`:
  - `isSupported()` checks for `navigator.requestMIDIAccess`.
  - `connect()` requests access with `{ sysex: false }` from a user gesture.
    Its state is one of `unsupported | idle | requesting | denied | ready | error`.
  - Lists inputs and outputs with id, name, and manufacturer.
  - `selectInput(id|null, rememberedName?)` chooses the input. It may be
    called before `connect()` with the id saved on an earlier visit;
    `rememberedName` is the name the device had then, so it is found again
    if it comes back under another id. `null` means "no input" and stops
    automatic choices until the next explicit one.
  - `onstatechange` handles disconnects and reconnects; the selected device is
    re-attached when it reappears with the same id or name.
  - `inputSeen` is true once the selected input has been connected during
    this session. False means a piano remembered from an earlier visit that
    has not turned up yet (it was off at Connect): it was not found, rather
    than disconnected.
  - While the selected input is not connected, an input may be attached in
    its place (`autoPick`):
    - Nothing selected: the only connected input, or, beside loopback
      ports, the only one that turned up after Connect (the piano switched
      on). Several devices wait for a choice.
    - A remembered input that has not been seen this session: it is never
      replaced by a device that was already connected at Connect (Linux's
      "Midi Through Port-0", an IAC or loopMIDI port, an audio interface's
      MIDI In, a second keyboard). It is attached when it is switched on, by
      its id or remembered name; failing that, the only device that turns up
      after Connect stands in for it (the piano under a new id and name). If
      the remembered piano turns up later after all, it takes over from that
      stand-in; an explicit choice ends this.
    - A selected input that has been seen: none. It is kept, and waited for
      when it goes missing.
  - Loopback ports: `isLoopbackPort(name)` (exported) matches ALSA's "Midi
    Through" port, which Chrome on Linux always lists and which never carries
    a piano's keys. It is never picked automatically and never keeps a piano
    switched on later from being picked; it can still be chosen from the
    list.
  - The practice page (`src/ui/practice/midiConnection.ts`) pre-selects the
    piece's saved input with the globally remembered name
    (`selectInput(savedInputId, savedInputName)`) before `connect()`. Once
    access is granted, a missing piano may be re-picked from the connected
    inputs: one with the remembered name, else the only other connected input
    that is not a loopback port and was not seen connected beside the piano.
    While the selected piano has not been seen at all this session, only a
    remembered-name match may be picked. Its phase is `no-devices` when the
    only connected inputs are loopback ports. So a device that was there
    beside the switched-off piano is never attached, reported as connected or
    saved in its place. The page reports a selected input that was never seen
    as "No piano found" (or asks for a choice), not as disconnected, in the
    notice and in the transport bar (`SessionSnapshot.midiInputNotFound`).
  - Delivers events to subscribers.
  - Output: `selectOutput(id|null, rememberedName?)`,
    `send noteOn/noteOff/allNotesOff`. The session passes the output name
    remembered with the global preferences (`midiOutputName`), so a saved
    output the browser now lists under another id is found by name; the
    selection then takes the new id. An id the browser still knows keeps its
    own name, so the remembered name never redirects playback away from a
    known device. When the manager re-finds the selected output under a new
    id (a USB re-plug), the session's `settings.midiOutputId` follows it, so
    the output menu shows it and the piece saves it.
    `allNotesOff` clears the output's queue where `MIDIOutput.clear()`
    exists, then sends an explicit note-off for every note the app has not
    already released (a note-off still queued for later counts as not yet
    released), All Notes Off (CC123) and sustain off on channel 1, the only
    channel the app uses. Where `clear()` is missing (Chrome, Edge), each note-on still
    queued for the future gets its own note-off 1 ms after it, and All Notes
    Off is sent once more 1 ms after the last queued message, so the device
    is silent once the queue drains.
  - Echo guard: an input note-on that matches a note-on the app sent to an
    output within the last 80 ms is dropped and never reaches Follow me. The
    80 ms count from when the message actually goes out: a timestamp already
    in the past (a message sent late after a busy main thread) is sent at
    once, so it is recorded at `max(atMs, now)`. A
    note-off is treated as an echo only when it pairs with such a dropped
    echoed note-on, so the player's own release (whose note-on was delivered)
    always gets through, even right after the app released the same key. The
    count of dropped note-ons is reset when the input changes.
  - The All Notes Off and sustain off that `allNotesOff` sends are recorded
    too. An input All Notes Off that echoes one within 80 ms is dropped (an
    All Notes Off is never delivered anyway), and a sustain off matching the
    app's arriving within 80 ms after that echo is dropped as well, so a
    piano that echoes cannot lift the learner's pedal in Follow me. A piano
    that does not echo sends no All Notes Off, so a real pedal release right
    after Pause or a loop restart still gets through.
  - Input is never forwarded to an output.

## 6. Audio (`src/audio`)

`PianoSampler`:

- Uses Web Audio directly with the Salamander samples in `public/audio/piano`
  (A, C, D#, F# per octave). The URL base is `import.meta.env.BASE_URL + 'audio/piano/'`.
- `ensureStarted()` must be called inside a user-gesture handler. It
  creates or resumes the `AudioContext` and starts loading samples. Until the
  samples are loaded, a quiet triangle-wave fallback voice sounds, so audio
  never fails silently.
- State is one of `not-started | loading | ready | error`. `error` means
  the AudioContext could not be created, or some samples failed to load; in
  the second case the loaded samples and the fallback voice still play, and
  the next `ensureStarted()` retries the load.
- `noteOn(midi, velocity, when?, owner?)` / `noteOff(midi, when?, owner?)`
  use the nearest sample with `playbackRate = 2^(Δ/12)`, and a gain envelope
  with a ~0.25 s release. Anything that is not a MIDI number 0–127 is
  ignored.
- `owner` is `'app'` (the default: playback and previews), `'input'` (the
  learner's notes heard through "Hear my playing") or `'audition'` (a key
  clicked on the on-screen keyboard to hear it; the UI's `KeyAudition`
  plays it directly, never through the session, so it is never MIDI input,
  never reaches Follow me or the MIDI output, and sounds whether or not
  Sound is on). A strike fades an earlier voice of the same key only if it
  has the same owner, and a note-off releases only voices of its own owner,
  so the learner holding a key past the app's release, or tapping a key the
  app is playing, never cuts the other's sound. `allNotesOff` silences every
  voice, whoever started it.
- `allNotesOff(fadeSec = 0.05)` stops every active *and* future-scheduled
  voice. This prevents stuck notes.
- `currentTime` gives the shared clock.
- `click(when, accent)` produces the count-in sound.

## 7. Engine (`src/engine/session.ts`)

`PracticeSession` owns the single shared clock, which is the AudioContext time
(or `performance.now()` when audio is off). It also owns mode logic and
scheduling. React reads it through `subscribe`/`getSnapshot` (for
`useSyncExternalStore`) and calls `getVisualPosition()` every animation frame
for smooth scrolling.

- Lookahead scheduler: every 25 ms it hands the browser sampler the note-ons,
  note-offs and count-in clicks due within the next 150 ms. MIDI output has
  its own cursor and only a 40 ms lookahead (`MIDI_LOOKAHEAD_SEC`, below the
  50 ms start lead), because a message queued with a future timestamp can only
  be withdrawn with `MIDIOutput.clear()`, which Chrome and Edge lack. A new
  run starts after anything still queued on the output. Without a count-in,
  the first strike of a run (and the keys held at the start point) is handed
  to the MIDI output as soon as the run starts, timed for the end of the
  start lead, so it is on time even if the main thread is then busy. Later
  MIDI messages tolerate about 15–40 ms of main-thread stall (browser sound,
  with its 150 ms lookahead, about 125 ms). Visual work is kept light so it
  does not delay either.
- Clock switch: when browser audio starts while silent playback runs (Sound
  or Count-in switched on, or the learner's first monitored note), the run
  moves onto the AudioContext clock in place once `ensureStarted()` has
  resolved (before that the context clock is frozen). Nothing is released,
  nothing waits for the start lead, and nothing is struck again on the MIDI
  output; the browser queue and count-in clicks restart from now, and with
  Sound on the keys held at that moment start sounding then.
- The sampler is shared by every page, so it may be in `error` from an
  earlier page. The learner's gestures (a manual-step preview with Sound on,
  "Hear my playing" switched on, Sound or Count-in switched on during
  playback) start browser audio from `not-started` or `error` alike, so a
  failed sample load is retried while the fallback voice plays. A run
  already on the audio clock stays there when the sampler goes to `error`
  (a failed load does not stop the AudioContext).
- The scheduler moves each cursor past an event before handing it to the
  sampler, and skips an event the sampler throws on, so one bad event can
  never stall a run or strand the notes already started.
- Loop restart: with count-in off, the next pass is scheduled inside the
  lookahead, anchored exactly at the passage end, with no release-all and no
  start lead, so the loop has no gap. With count-in on, everything is
  released and the count-in plays before the next pass.
- Count-in: four clicks. In Steady steps they are one step length apart. In
  Listen they are one beat apart at the tempo where playback starts, divided
  by the speed, where the beat comes from the time signature in force at the
  start: a dotted quarter in compound meters (6/8, 9/8, 12/8; a dotted eighth
  in 6/16), an eighth in other x/8 meters such as 3/8, a half note in x/2,
  and a quarter note in x/4 or when the score has no time signature. A pause
  or page hide during a count-in (the music has not begun) is remembered:
  the next Play counts in again from the same step. Seeking or changing the
  speed during a count-in starts it again.
- Listen: step *k* is reached at `listenStepTimes[k]`. The scroll position
  interpolates between columns by time, so long holds dwell. After the last
  step, it waits until the passage end.
- Steady: steps are evenly spaced. Sound plays each press from its start step
  to its end step.
- Follow: a FollowMatcher drives the step index. It needs MIDI input. By
  default the browser plays no sound for input; `monitorInput` turns it on.
  Monitored notes (in every mode) are sent to the sampler as owner
  `'input'`, separate from the app's own voices (§6); key-up, pedal-up and
  turning monitoring off release only those.
- Manual: `next`/`prev`/`seek` work in every mode. Seeking while stopped never
  sounds notes. Seeking during Listen restarts scheduling from that step, and
  the keys held at that point sound again from the seek point.
- `play()` from a marker where nothing is left to sound (after the passage
  finished, on the closing release-only step, or in the trailing rest)
  starts from step 0, with the count-in if it is on. A marker on a
  release-only step while a key is still held resumes there.
- A speed, step-length, sound, output or input change while playing
  re-anchors at the current position. Held keys are struck again from there,
  except those that end within 30 ms. The Speed and Seconds-per-step sliders
  hand the session a new value only once a drag rests for 150 ms or ends
  (pointer up, focus leaves the slider), so a drag makes one re-anchor, not
  one per input event.
- A loop restart with count-in, stop, pause, seek, mode switch, settings
  change, MIDI disconnect, page hide (`pagehide`), or `dispose` calls
  `sampler.allNotesOff()`, clears every scheduled event, and sends MIDI-out
  all-notes-off. In Follow me, which plays no app sound, the loop restart,
  pause and settings changes other than the mode leave the learner's own
  monitored notes sounding until their note-off; stop, mode change,
  disconnect, page hide and `dispose` still release everything.
- A manual-step preview sends only its note-on to the MIDI output; the
  note-off is sent by the timer when due, never queued ahead.
- The keyboard shows `heldAfter` of the marker step, for every mode.
- `getPassageTime()` gives the transport's "elapsed / total" in Listen and
  Steady steps, from the same step times and passage length that playback
  uses (so it follows the speed or step length); while playing it reads the
  clock like `getVisualPosition()`. Follow me has no clock and returns null.

## 8. UI

The UI rules are in `docs/UI_SPEC.md`. The look comes from
`src/ui/theme.css`: custom properties for the notation, hand and warning
colours, the warm neutrals (cream page, paper surfaces, warm greys) and the
one brand colour (`--ink`), the three font stacks (a system book serif for
headings, the system sans, the monospace for note labels; no web fonts), and
the shared buttons, chips, badges, popovers and dialogs. Component CSS sits
next to its components and reads those properties. The logo is
`src/ui/common/Logo.tsx` (`LogoMark`, `Wordmark`); `index.html` inlines the
same mark as its favicon.

In outline, the practice page
(`src/ui/practice/PracticePage.tsx`) is:

- `SetupPanel` holding `ControlsBar`: the settings, folding into a summary
  line (`setupSummary` in `text.ts`) when Play really starts playback or
  Follow me (`playWillStart` in `practiceFocus.ts`: steps to play and, in
  Follow me, a piano; otherwise the settings stay open for the message to
  point at); open or folded is `GlobalPrefs.setupCollapsed`. The same start
  scrolls the page down just enough to show the keyboard, never past the top
  of the notes card and never up (`revealScroll`, run in a layout effect
  after the fold is committed).
- The notes card: `NotationLegend`, the starting-setup line (`startingSetup`
  in `text.ts`, from the carried tokens of the first step of the
  **both-hands** passage, so the line stays whichever hand is practised; a
  hand not practised is muted, and read out as "not practising") and
  `Timeline`. The timeline's scrubber row is always rendered (an empty,
  inert track when the chosen hand has nothing to play).
- `TransportBar`: the transport, `getPassageTime()` as "0:07 / 4:22", the
  step count, the MIDI fact and one message / mode-note line.
- `Keyboard`, with click-to-hear through `KeyAudition`
  (`src/ui/keyboard/audition.ts`). Its keys sit in a dark body
  (`.kb__body`); the SVG gets the stage width less `BODY_PAD_X` on each side,
  so the body never overflows.

The page also derives the passage with **both** hands
(`deriveSteps(prepared, ['R', 'L'], range)`, the session's own sequence when
both are selected). The keyboard is framed and labelled from it and the
timeline's rows are sized from it, and the starting-setup line is read from
it, so choosing a hand changes the steps, the columns and the highlighted
keys, but not the size or place of the rows, the starting-setup line, the
scrubber, the transport or the keyboard. The columns themselves do re-flow:
they are the practised hands' steps, which Steady steps and Follow me step
through.

`Timeline` keeps a pan offset (in columns) next to the marker position its
animation loop reads: the strip, the marker band, the rendered window and the
scrubber are all drawn at `position + offset`. The offset is clamped by
`clampPan` (`timelineWindow.ts`, with the other pure window math) and reset
to 0 by any step change, a new sequence, playback starting or a transport
action (`recenterKey`).
