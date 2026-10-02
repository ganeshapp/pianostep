# Personal Piano Practice App — Requirements and Implementation Brief

Version: 1.0  
Prepared: 2026-10-02  
Purpose: A self-contained handoff to independent AI implementation agents, including Cursor, Claude, and Codex.

## 1. Read this first

Build a desktop-browser piano practice application, deployable to GitHub Pages, by adapting the open-source MuseTrainer application where useful.

The user is a beginner who finds traditional staff notation intimidating. They can follow instructions such as “right hand C4; left hand C3 and G3; keep the left hand held while the right hand changes.” The application replaces the visible sheet music with a horizontally scrolling, two-row representation of those actions, using note names and a small set of color/symbol rules.

The application must also provide a large, labeled virtual piano, audio playback, a browsable built-in music library with arrangement-specific difficulty labels, and practice using a real digital piano connected to the laptop by MIDI.

The user owns a digital piano that can connect to their laptop. Its model and the laptop/browser combination have not yet been supplied. Do not assume a particular manufacturer or promise compatibility without testing or checking capabilities.

This document is the implementation handoff. Earlier conversation was brainstorming; the final direction here supersedes discarded ideas.

### Final product in one sentence

Choose a piano piece and practice one or both hands by following scrolling key-name instructions and a synchronized keyboard, optionally allowing the app to wait for correct presses on a connected digital piano.

### Explicitly abandoned

- Playing-card decks, printing, double-sided cards, and print/PDF export.
- Shuffling independent musical miniatures.
- Splitting every piece into mandatory 32-step cards.
- Card numbering such as 1-1 or 1a.
- A native mobile application or desktop installer.
- Building a new sheet-music recognition engine.

The earlier 32-step layout informed the notation but is not a constraint on the scrolling application.

## 2. Scope and decision authority

### Confirmed direction

- A personal solo-piano tutor; not a vocal accompaniment, chord-chart, or comping app.
- MusicXML input, including a built-in catalog and local file import.
- Reuse MuseTrainer as the starting point where practical.
- GitHub Pages hosting; no native app needed.
- RH and LH notation rows scrolling horizontally.
- Taller virtual piano; only relevant keys receive full note-address labels.
- Stable keyboard framing during a selected passage.
- Purple for right-hand keyboard highlights; green for left-hand highlights.
- Preserve red and blue for notation action meanings.
- A complete browsable catalog of the eligible piano pieces in the supplied library, rather than only two demos.
- Difficulty filtering using external classifications where a reliable arrangement match exists.
- Support a connected MIDI piano.
- The user must not need to read sheet music to use or validate the app.

### Implementation defaults adopted in this brief

The conversation did not settle every interaction. The detailed defaults below are reasonable implementation decisions, not claims that the user explicitly specified every parameter.

- Three modes: Follow me, Steady steps, Listen.
- Manual previous/next-step navigation.
- Beginner, Intermediate, Advanced, and Unrated difficulty categories.
- Follow me initially checks new presses rather than enforcing every hold and release.
- Strict hold/release checking is optional later work.
- Defaults: both hands; browser audio for demonstrations; MIDI output off; original playback speed 1×; steady-step duration 1 second.
- Browser-local persistence; no account or backend.
- Optional original-score reference, never the primary interface or a prerequisite.

An implementer may change an internal technical choice when evidence supports it, but must preserve the user-facing behavior and explain material deviations. Do not replace the project with a generic falling-note game or ordinary sheet-music reader.

## 3. Starting repositories and evidence

### Application

- Running example: https://musetrainer.github.io/#/index/home
- Editable application source: https://github.com/musetrainer/source
- Deployed-site repository: https://github.com/musetrainer/musetrainer.github.io
- Help: https://musetrainer.github.io/help/

The source repository was inspected during planning. Its README marks it unmaintained and invites forks. It has an MIT license. It is an Angular/Ionic application with OpenSheetMusicDisplay, Tone-related piano playback, and MIDI integration. The inspected package reports version 1.8.0, while the user's live screenshot shows 1.8.1. Do not assume the archived source exactly matches the current deployed assets.

Useful inspected files:

- `src/app/play/play.page.ts`: playback, MIDI handling, cursor advancement.
- `src/app/play/play.page.html`: controls and staff toggles.
- `src/app/notes.service.ts`: active/required notes, note timing, and press checks.
- `src/app/piano-keyboard/piano-keyboard.component.ts`: virtual keyboard state.
- `src/app/help/help.page.html`: intended behavior of existing controls.
- `LICENSE`, `package.json`, and `README.md`.

These are discovery pointers, not a requirement to preserve every original architecture choice.

### Library

- Repository: https://github.com/musetrainer/library
- Browsable list: https://musetrainer.github.io/library/

The application and music library are separate repositories. Importing the app alone will not create the requested full home-screen catalog.

Examples listed in the library include easy arrangements of Ode to Joy, Für Elise, and Carol of the Bells, alongside substantially harder repertoire. Names containing “easy” are useful discovery hints, not proof of suitability or validated difficulty.

### Reuse strategy

1. Inspect the source and reproduce its browser build.
2. Identify reusable parsing, playback, keyboard, looping, and MIDI functionality.
3. Add a shared musical-event model and our action notation.
4. Replace the main sheet-music presentation with the new practice view.
5. Integrate the library catalog and difficulty metadata.

A web-only refactor is allowed. Remove or isolate native/mobile integrations that obstruct a reliable browser build. Do not blindly upgrade every dependency before obtaining a working baseline.

Existing playback is not automatically a correctness oracle. In particular, verify exact releases, ties, repeats, and sustained notes rather than inheriting bugs from cursor-based logic.

## 4. User experience

### Main journey

1. Open the site.
2. See the built-in library immediately.
3. Optionally filter Beginner or another difficulty.
4. Select a particular arrangement.
5. Select both hands, right hand, or left hand.
6. Select a practice passage or the full piece.
7. Listen, practice steady steps, manually inspect steps, or connect MIDI and use Follow me.
8. Return later and resume the piece and saved settings.

No login, subscription, server account, or musical-theory knowledge is required.

### Home/library screen

Include:

- Search by title/composer.
- Difficulty filters: All, Beginner, Intermediate, Advanced, Unrated.
- Arrangement titles that distinguish simplified versions from originals.
- Composer when available.
- Difficulty label and a discreet way to inspect its source or estimated status.
- Clear readiness state for files with unresolved import problems.
- MusicXML import control.
- Locally imported pieces alongside, or clearly separated from, built-in pieces.

Avoid invented scores, irrelevant dashboards, social features, leaderboards, or a landing page before the usable library.

### Practice screen

The main elements, in order:

1. Piece title, back-to-library navigation, and concise playback/practice controls.
2. Two aligned horizontal instruction rows: RH above LH.
3. A large virtual keyboard underneath.
4. Small contextual state, such as MIDI connection and the current step/passage.

Retain useful controls from MuseTrainer: speed, range, repeat, sound, and keyboard visibility if appropriate. Replace ambiguous everyday labels such as “Staff 1” with “Right hand” when that mapping is established.

## 5. Key addresses

Use scientific pitch numbering consistently:

- A0: lowest key on a standard 88-key piano.
- C4: middle C.
- C8: highest key on that piano.
- The octave changes at C: A3, B3, C4, D4.
- Sharps follow the letter: C#4, F#3.

For the beginner display, normalize black keys to sharp names so each physical key has one familiar address. For example, a source D-flat 4 displays as C#4. Preserve the original spelling internally for source references. Resolve unusual spellings by sounding pitch, not string substitution: B#3 is C4 and Cb4 is B3.

Do not inherit a MIDI manufacturer's octave-label convention. MIDI note 60 must display as C4 in this app.

Do not silently clamp out-of-range notes onto A0 or C8. Explain an unsupported range or provide an explicitly documented extended-keyboard treatment.

## 6. Our action notation

### Five basic instructions

All instructions apply only to their own hand.

| Display | Meaning |
| --- | --- |
| Normal foreground-colored note or stack | Release all keys currently held by this hand, then press the listed keys. |
| Red note or stack | Press these keys while preserving other held keys in this hand. |
| Blue note or stack | Release only the listed keys in this hand. |
| `—` | No change. Keep the current hand state, including remaining silent if nothing is held. |
| `.` | Release all keys held by this hand and remain silent until another instruction. |

Notes stacked in the same step happen at the same moment. RH and LH cells in the same column also happen at the same moment.

Do not print explanatory words such as “change to” or “keep holding” in every cell. Provide a small reference/help panel for learning the rules.

### Red repeated notes

A red note always represents a fresh press. If the named key is already held by that hand, release and press that key again while preserving other held keys.

This means a repeat is visibly different from `—`. Never erase repeated-note attacks by comparing only before/after held-key sets.

### Mixed selective changes

A cell may contain blue releases and red presses together. Apply releases before presses at that event time. This permits a moving line above a sustained note within one hand.

Example:

| Step | RH instruction | RH keys held afterward |
| --- | --- | --- |
| 1 | Normal C4 | C4 |
| 2 | Red E4 | C4, E4 |
| 3 | Blue E4 + red G4 | C4, G4 |
| 4 | Blue G4 + red F4 | C4, F4 |
| 5 | `.` | None |

On screen, use actual colors and stacked labels, not the words “red” and “blue.”

### Color-independent support

Support a compact secondary mark attached beneath the individual note token:

- Filled dot beneath: red/add-or-repress action.
- Hollow circle beneath: blue/selective-release action.
- No attached mark: normal replace action.

A standalone rest dot sits in the main cell, not underneath a note. These positions must be visually distinct. Give tokens accessible action descriptions; color alone must not be the only available explanation.

### Canonical generation rules

For each hand and event time, determine actual note attacks, endings, and continuing note identities.

1. No changes: emit `—` if the other hand creates a column.
2. Everything ends and nothing starts: emit `.`.
3. New notes start and no previous note continues: emit the normal-colored new-note stack. It implicitly releases the old hand state.
4. Some old notes continue: emit blue tokens for ending notes and red tokens for starting notes.
5. Selective endings without attacks: emit blue tokens if other notes remain held.
6. An ending and new attack of the same pitch at the same instant is a rearticulation, not a continuation. Represent it once as a red re-press when other notes continue, or as a normal replacement when none continue.

Never mix a normal replace stack with red/blue changes in the same hand cell; normalize it to one unambiguous form.

If multiple independent source voices overlap the same physical pitch in the same hand, preserve the voices internally. Coalesce redundant physical holds only when safe. If the intended physical action is ambiguous, report that ambiguity instead of silently deleting attacks or releasing another still-active note.

## 7. Steps, rhythm, and scrolling

### Step definition

A step is a moment when at least one included hand must press or release a key. Simultaneous events form one step. Include release-only events, including the final release.

Do not create a step per individual chord note. Do not divide recordings into fixed-length seconds. Do not assume a step is a beat.

Preserve exact source timing separately from the display sequence. A long hold has an elapsed duration even if it introduces no additional action columns.

### Timeline display

- Equal-width action columns are the default, with enough width for compact chord stacks.
- Both hand rows share the same step boundaries.
- A fixed play marker identifies the current action; upcoming actions remain visible to its right.
- In Listen mode, original timestamps determine when the marker reaches each action. Equal column widths do not imply equal duration; scroll speed may vary or dwell.
- In Steady steps mode, columns advance at equal practice intervals.
- In Follow me and manual mode, scrolling follows step advancement.
- A shared playback clock drives sound, key highlighting, and the notation position.
- Honor reduced-motion preferences with stepped scrolling or another readable alternative.

Provide a visible held-key state through the virtual keyboard, especially after scrolling past the instruction that started a long hold.

## 8. Playback and practice modes

### Listen

- Play the selected hand(s) at the imported musical timing.
- Start at 1× tempo with a slower/faster control.
- Use source tempo changes where supported.
- If no usable tempo exists, choose and label a default rather than pretending it came from the file.
- Provide play, pause, stop/restart, seek, selected range, and repeat.
- Highlight the active keys until their modeled release, independent of the currently visible attack cell.
- Retain meaningful rests and the correct duration after the final attack.

### Steady steps

- Present the same ordered press/release events at equal intervals.
- Default to 1 second per step, adjustable.
- Clearly identify this as movement practice, not the piece's original rhythm.
- Preserve hand state across steps.
- Offer audio on/off.
- If hand filtering removes all actions at a timestamp, omit that empty practice step. Preserve original timing in Listen mode.

### Follow me

- Requires an available MIDI input device.
- Wait for the expected new key presses before advancing.
- Support RH only, LH only, or both hands.
- A chord may be assembled with slightly staggered presses; do not require mathematically simultaneous MIDI messages.
- Require all newly expected chord keys to be down together at completion.
- Highlight unexpected presses without advancing; once corrected, the user can continue without restarting.
- Wrong-key feedback must use an explicit marker/outline or label rather than confusing it with red “add” notation.
- Recognize a repeated note only after a new physical note-on, with a release where needed. An already-held key must not satisfy a later required repeated attack.
- Input events already used to complete one step cannot automatically complete a later attack step.

#### Default forgiving hold/release behavior

The first implementation should focus on correct new presses. It need not block because a previously correct sustained note was released early or a previously played note was held a little long. It must still distinguish unexpected new pitches and repeated attacks.

Release-only steps should update the displayed instructions/state and advance automatically in this forgiving mode, so a learner is not stuck waiting for an action that the mode does not enforce. Do not require a hidden timeout or impossible note press. Document this behavior in mode help.

State visibly that this mode checks notes, not complete timing or pedaling accuracy. Do not report a perfect musical performance merely because note checks pass.

#### Optional later strict mode

Strict hold/release checking may be added as a separate setting. It is not required to complete the initial app. It must distinguish physical key releases from sound sustained by a pedal.

### Manual stepping

- Previous and next action buttons; keyboard shortcuts such as arrow keys when focus is not inside an input.
- Clicking an instruction seeks to that step.
- Reconstruct the correct held-key state when seeking in either direction.
- Seeking while stopped must not leave audible keys ringing unexpectedly.

## 9. MIDI behavior

### Input

- Offer an explicit Connect piano control and device selection if multiple inputs exist.
- Handle permission denial, unsupported browser, no devices, connection, disconnection, and reconnection gracefully.
- Note-on with velocity zero must be handled as note-off.
- Track physical pressed keys separately from expected score keys and app-generated playback events.
- Do not let generated audio/playback events satisfy Follow me checks.
- Avoid assuming all devices use one MIDI channel; handle input channels consistently.
- MIDI does not identify the player's physical hand. Assign expectations from the score; never claim the app can detect which hand pressed a key.
- CC64 sustain state is separate from physical key-down state.

### Audio routing

- Listen mode uses browser-generated piano sound by default.
- In Follow me, avoid automatically doubling the sound of a digital piano that already produces its own audio. Provide a clearly named option to hear input through the browser.
- Optional “Play through connected piano” MIDI output is off by default and requires explicit output-device selection.
- Input and output are different device roles; do not infer output capability from an input connection.
- Prevent MIDI echo/feedback loops.
- On stop, loop reset, mode switch, disconnect, navigation, or error, release app-generated notes and cancel stale scheduled events.

Web MIDI browser support varies. Runtime capability detection and useful fallbacks are required. Listening, manual stepping, and Steady steps must remain usable without MIDI. Document the browsers actually tested.

## 10. Hands and staff assignment

A staff is a written row of music, not an infallible hand label. Ordinary piano scores usually provide a convenient two-staff starting point, but cross-staff writing, multiple parts, alternative passages, and extra staves require care.

Requirements:

- For straightforward two-staff piano scores, establish a sensible upper/RH and lower/LH mapping.
- Preserve source part, staff, and voice information internally.
- Support per-arrangement overrides for verified exceptions.
- Do not assign hands solely by splitting at middle C.
- Do not map every odd staff to RH and every even staff to LH without inspecting the structure.
- Do not play optional alternative passages simultaneously with the primary passage.
- Files containing multiple instruments, multiple pianists, or unclear alternatives need review or an explicit unsupported state.

The user's screenshot has four staves and an “Ossia” label. An ossia is an alternative passage. This is a concrete test case for avoiding duplicate/alternative playback, not a requirement for the beginner to resolve the notation.

Routine practice controls should be Both hands / Right hand / Left hand. Any advanced staff mapping belongs in an optional diagnostics/editor view. The user must not have to read staff notation to practice a ready piece.

## 11. Virtual keyboard

- Significantly taller and easier to read than the original thin keyboard strip.
- Correct black/white key geometry and note positions.
- Purple = RH; green = LH. Include an R/L legend or equivalent label.
- Normal/red/blue instruction colors are not reused as keyboard hand identities.
- Label every key relevant to the selected passage with its full app address, including octave and sharp.
- Unused keys may remain unlabeled.
- Mark C4 as middle C when it is within the visible range.
- Fit the selected passage's pitch range, including notes already held at its start, plus modest context on each side.
- Do not change scale or pan automatically while that passage is running.
- For full-piece playback, fit the full piece or provide a user-selected fixed zoom. Do not let the keyboard chase every note.
- If both hands are assigned the same key, use a combined/split indication rather than overwriting one hand's state.
- Distinguish expected highlights from physical input feedback. For example, expected outlines versus pressed fills, with a legend if necessary.
- Physically held keys and pedal-sustained sound must not be conflated.

## 12. Import and musical correctness

### Supported input

- Uncompressed MusicXML: `.musicxml` and valid score `.xml` files.
- Compressed MusicXML: `.mxl`.
- Local import processed in the browser; no server upload required.

Validate content, not just extension. Handle corrupt ZIPs, missing score roots, malformed XML, unsupported constructs, and excessive archive sizes with a readable error. Do not resolve arbitrary external XML entities or remote references from imported files. Do not render titles or metadata as executable HTML.

### Shared musical model

Keep these concepts separate:

1. Source score structure and provenance.
2. Per-note sounding pitch, hand assignment, onset, and notated duration.
3. Tie/voice identities and musical timing.
4. Tempo map and performance traversal, including repeats when supported.
5. Derived action steps and notation tokens.
6. Practice mode state and physical MIDI input.

Cards are no longer a domain object.

Suggested note-event fields include source ID, MIDI pitch, display address, part/staff/voice, hand, onset in musical units, duration, tie identity, velocity/dynamic data if available, and source measure position. Use exact fractions or a sufficiently precise musical tick representation rather than grouping near events with an arbitrary large time tolerance.

### Baseline correctness

- Chords and simultaneous events.
- Multiple voices with independent note durations.
- Selective note releases and held notes across other attacks.
- Repeated notes and ties without accidental retriggering.
- Rests, dotted durations, and ordinary tuplets.
- Key signatures, accidentals, octave changes, and enharmonic display normalization.
- Tempo changes supported by the parser.
- Common repeats and endings, or a clearly reported limitation before practice.
- Measure and passage boundaries.

Grace notes, trills, complex jumps, unusual pedal notation, cross-staff voices, and other advanced constructs must be inspected against the chosen parser. Support them correctly or label affected pieces/passages as needing review. Never silently flatten away important information and present the result as faithful.

Notated durations do not encode every physical finger movement of an expert performance. The app gives a practical score-derived key-action interpretation, not guaranteed professional fingering or expressive performance.

## 13. Range selection, looping, and seeking

- Retain passage selection comparable to MuseTrainer's measure range control.
- Explain “measure” briefly as a numbered section of the piece if the word appears.
- Allow selecting loop boundaries from the notation when practical.
- Starting mid-piece must reconstruct the notes held at that location.
- In Listen mode, start the necessary sounding state at the loop entry; do not silently omit sustained notes from before it.
- In Follow me, show a starting setup and allow the learner to establish the needed initial keys before continuing.
- At loop restart, clear stale scheduled notes, reconstruct the starting state, and optionally provide a short count-in.
- Do not leave keys stuck on after a loop, stop, seek, or navigation.
- Use performance occurrence IDs where a repeated measure appears more than once in playback; a source measure number alone is not always a unique position.

## 14. Built-in library and difficulty

### Catalog

Create a reproducible catalog from the eligible piano files in `musetrainer/library`. Do not make the user upload each built-in score manually. Load score contents on demand rather than parsing the entire library on every visit.

Each entry should have a stable ID, title, composer if known, arrangement/version description, source file path, original source URL when known, attribution/license metadata, difficulty, difficulty basis/source, import readiness, and any required hand/staff overrides.

Keep different arrangements of the same composition distinct. A full original and a simplified arrangement are different practice choices. Avoid title-only deduplication.

Account for every source file considered: included, duplicate, non-solo-piano, unsupported, or awaiting review, with a reason. Do not silently reduce the requested library to two demonstrations.

### Difficulty labels

- Categories: Beginner, Intermediate, Advanced, Unrated.
- Prefer an explicit classification for the exact arrangement from MuseScore or another identifiable source.
- Retain the source URL and original label/grade.
- Document any mapping from external grades to the app's broad categories.
- Never transfer difficulty from a composition title to every arrangement of that composition.
- Missing or inaccessible classification means Unrated, not Beginner.
- If a heuristic is used, visibly label it Estimated and keep it distinguishable from source-backed classification.
- Do not invent source citations or claim an expert graded a piece when they did not.
- Classification research happens while preparing the catalog. Opening the library should not require live scraping of external websites.

Beginner labels are selection aids, not guarantees that a piece is immediately playable by every beginner. Avoid fabricated precise difficulty scores.

### Licensing and attribution

The user says they checked MIT licensing and intends personal self-tutoring, not a commercial product. Do not repeatedly ask for generic permission to use the project. Preserve the application MIT notice and the notices that apply to included assets.

Keep code licensing separate from score, arrangement, and audio-asset provenance. A GitHub Pages site is normally publicly reachable even when built for one person's use. If a specific file has contradictory or missing redistribution information, report that concrete case and keep the rest of the work moving; do not claim the app license automatically licenses every musical arrangement.

No paywall bypasses or unapproved copyrighted-score scraping are part of this project.

## 15. Persistence and hosting

- Deploy as a static site on GitHub Pages.
- Support a project subpath such as `https://username.github.io/repository/`, not just a root domain.
- Hash routing or an equivalent Pages-compatible approach is acceptable.
- Keep score/audio/worker asset paths compatible with the configured base path.
- No server, database service, API key, or paid hosting dependency for core functionality.
- Store preferences, last selected piece/passage, and imported pieces locally in the browser as appropriate.
- Explain that browser storage is local to that browser and clearing it removes local imports/settings.
- Store larger imported content in suitable browser storage; do not force it into a small preferences store.
- Do not introduce analytics or transmit MIDI performance data to third parties by default.
- Browser audio must initialize through an appropriate user interaction rather than failing silently because of autoplay restrictions.

Provide a documented build and a GitHub Pages deployment workflow. Actual publication depends on available repository access. If deployment credentials are unavailable, deliver a working local build and exact deployment instructions without claiming it is live.

## 16. Quality and presentation

- Desktop/laptop first. A usable smaller-window fallback is enough; native mobile parity is out of scope.
- Prioritize legible note names, stable alignment, and an uncluttered keyboard.
- Chord stacks must not overlap, truncate octave numbers, or collapse into illegible text.
- Focused controls have keyboard access and accessible labels.
- Colors have readable contrast in the chosen appearance.
- Do not put developer terminology, parser names, or internal IDs into normal practice flows.
- Long pieces should not render every token as a massive unbounded DOM tree if that causes visible lag. Window/virtualize the timeline if needed.
- Audio timing must not drift materially because visual rendering is busy.
- Playback and MIDI listeners must be cleaned up when changing pieces or leaving the screen.
- Display understandable loading, empty, disconnected, unsupported, and failed-import states.

## 17. Verification strategy

Use focused tests of musical behavior, not only snapshots of components.

### Independent round-trip check

Derive instructions from the musical model, then interpret those instructions with a separate small interpreter. Compare the resulting per-hand attacks and releases against the normalized source events.

Comparing only final held-key sets is insufficient: it would miss repeated attacks. This check validates the translation, not the musical correctness of an already incorrect source file or an inferred hand assignment.

### Required fixtures

1. Single-hand melody with replacements and repeated notes.
2. Simultaneous RH melody note and LH chord.
3. A long LH hold while RH changes several times.
4. One RH held note with a moving RH line: normal C4; red E4; blue E4/red G4; blue G4/red F4; release.
5. A repeated note while another note remains held.
6. A note ending between other attacks: ensure a release-only step is generated.
7. Tied notes across a measure: no unwanted new press.
8. Different rhythms in the two hands, including ordinary tuplets.
9. Rest followed by entry, and a final note with its full duration before release.
10. A passage starting with notes already held from earlier music.
11. Loop and seek behavior without stuck notes.
12. Sharp/flat enharmonic labeling and octave-boundary edge cases.
13. RH-only and LH-only filtering with appropriate practice steps.
14. Multiple staves/alternative passage: no accidental duplicate playback.
15. Malformed XML and broken MXL archive.

### MIDI tests

Use synthetic input events for automated checks and a real device when available:

- Note-on and note-off, including velocity-zero note-on.
- Staggered chord presses.
- Wrong note, correction, and continuation.
- Held key cannot satisfy a later repeated attack.
- Release-only steps do not deadlock forgiving Follow me.
- Pedal state does not masquerade as a physically held key.
- Disconnect/reconnect and multiple inputs.
- App-generated playback does not advance input practice.
- Stop/seek/switch cancels pending playback and releases generated sound.

Do not claim physical MIDI hardware was tested if only simulated events were used.

### Browser/manual checks

- The library opens with built-in choices, search, and working difficulty filters.
- Choosing any ready catalog entry loads its actual file.
- Local MusicXML and MXL import work.
- Two-row notation remains readable with chords and selective releases.
- Keyboard labels and colors agree with the notation and selected hand(s).
- Original timing and steady-step timing are observably different on an uneven-rhythm fixture.
- The keyboard framing does not shift during a selected passage.
- Pause, resume, seek, loop, and navigation do not leave notes sounding.
- Refreshing a nested route works under a GitHub Pages project path.
- Unsupported MIDI environments retain all non-MIDI practice functions.

## 18. Completion criteria

The first implementation is complete when:

1. A documented local setup and production build work.
2. GitHub Pages deployment is prepared and base-path handling is verified.
3. The eligible built-in library is available from the home screen, with an inclusion/exclusion inventory.
4. Difficulty filters work and labels have honest provenance or are Unrated.
5. MusicXML/MXL import creates playable custom-notation sequences.
6. RH/LH actions are generated according to the formal rules above.
7. The scrolling notation, virtual keyboard, and audio share coherent timing/state.
8. Listen, Steady steps, manual stepping, and MIDI Follow me work within the documented support limits.
9. Hand filtering, range selection, and repeat work.
10. Appropriate correctness tests pass, and remaining source/format limitations are documented plainly.

Do not substitute a visual mockup for a working player. Do not call a two-piece demo a complete integrated catalog. Do not call an untested deployment live.

## 19. Deliverables expected from the implementing agent

- Working application source.
- A README with setup, build, usage, tested browsers, and deployment instructions.
- Built-in catalog and reproducible catalog-generation process.
- Difficulty/provenance metadata and catalog inclusion report.
- Musical fixtures and targeted tests.
- Retained third-party notices and applicable attribution.
- A concise implementation report: what works, what was tested, what remains unsupported, and any deviations from this brief.
- A deployed GitHub Pages URL if authorized repository access is available; otherwise the build and deployment workflow.

## 20. Non-goals for the first version

- Cards, print layouts, or PDF output.
- Audio-to-score transcription or sheet-music OCR.
- MIDI-file import as a second source format; MusicXML is the initial input. MIDI hardware input is required and is a different feature.
- Automatic expert fingering.
- Automatic simplification or arrangement of difficult pieces.
- Guaranteed interpretation of every historical notation or advanced score construct.
- Microphone-based recognition of an acoustic piano.
- Mandatory strict performance grading, timing scores, or gamification.
- Accounts, cloud sync, subscriptions, social features, native mobile apps.

## 21. Implementation guidance

Work toward an end-to-end vertical slice early: load one small verified piano score, produce correct action steps, play them, show the keyboard, and accept MIDI or simulated input. Then integrate the catalog and broaden format coverage.

Keep the musical model and action conversion independent of the visual rendering. Reuse the same model across all modes, but keep physical input state separate. Preserve enough provenance to diagnose a bad arrangement without asking the beginner to decipher sheet music.

The central design principle is that the app should make piano practice approachable through explicit key actions. Its simplicity should come from a clear interface and reliable translation, not from silently discarding notes, rhythm, or releases.
