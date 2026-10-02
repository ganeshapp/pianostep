

===== review:traceability =====
{
 "findings": [
  {
   "id": "difficulty-title-word-shown-as-rating",
   "title": "7 of 19 difficulty labels rest only on the word \"easy\" in a title or file name, but the app presents them as a published rating or as stated in the score",
   "severity": "major",
   "briefRef": "§3 (\"Names containing 'easy' are useful discovery hints, not proof of suitability or validated difficulty\"); §14 difficulty labels (no invented citations; prefer an explicit classification of the exact arrangement); §18.4 (honest provenance)",
   "files": [
    "catalog/difficulty.json",
    "src/ui/common/DifficultyBadge.tsx",
    "scripts/build-catalog.ts",
    "docs/CATALOG_REPORT.md",
    "src/catalog/catalog.json",
    "catalog/inventory.json"
   ],
   "evidence": "Policy: docs/CATALOG_REPORT.md:49 says a MuseScore arrangement with an \"easy\" suffix in its title \"maps to **Beginner** with basis `source`\".\n\nFour basis:\"source\" records have originalLabel \"easy\" and sourceName \"MuseScore score page (title marked “easy”)\":\n- catalog/difficulty.json:70 Fur_Elise_-_Beethoven_-_for_beginner_piano. Its sourceUrl is a dundeepiano upload, but the file's own <source> is musescore.com/classicman/scores/33816, a different upload.\n- :115 Happy_Birthday_To_You_Piano\n- :142 Minuet_in_G_Major_Bach\n- :167 Prelude_I_in_C_major_BWV_846. Its own note says \"This is the original Bach prelude; many teachers grade it early intermediate\", yet it is shown as Beginner.\nFor basis 'source', the UI says \"Based on: Published rating\" and \"Taken from a published rating of this exact arrangement.\" (src/ui/common/DifficultyBadge.tsx:12,19). The badge has no qualifier (difficultyText, line ~34).\n\nThree basis:\"in-file\" records are shown as \"Beginner · per score\", and the popover says \"The arrangement’s own sheet music names this level.\" (DifficultyBadge.tsx:20). The score files do not contain the word. I unzipped each .mxl and grepped case-insensitively for easy|beginner|intermediate:\n- Carol_of_the_Bells_easy_piano: 0 matches (credits: \"Carol of the Bells / Traditional Ukranian Carol / Arr. Orlia Amaral\")\n- Greensleeves_for_Piano_easy_and_beautiful: 0\n- Nocturne_in_E-flat_Major_Op._9_No._2_Easy: 0\nBy contrast, Ode_to_Joy, Hungarian_Dance and Fur_Elise_Easy_Piano each match once.\nThe Carol note even says \"(file name)\". The Greensleeves note claims \"A sheet-music listing of the same arrangement also says Beginner\" but cites no source.\n\nThe overclaim also drives catalog choices. build-catalog.ts:425 keeps the copy with \"a verified difficulty label\". So Bach_Minuet_in_G_Major_BWV_Anh._114 (rights \"Public Domain\", file tempo, no warnings) is dropped as a duplicate, and Minuet_in_G_Major_Bach (no tempo in file, ornaments flattened) is kept (CATALOG_REPORT.md:93, inventory.json).",
   "failureScenario": "A user filters to Beginner and opens the ⓘ for \"Prelude I in C major\". It says \"Published rating – Taken from a published rating of this exact arrangement\", but the only basis is the uploader's title containing \"easy\". For Carol of the Bells (easy piano) the popover says the sheet music names the level, and it does not. 11 pieces are labelled Beginner; 7 of the 19 labels behind these counts are title or file-name hints shown as stronger evidence.",
   "suggestedFix": "Treat title or file-name wording that is not inside the score as a hint, not a rating. Either make these 7 records Unrated (basis none), or add a distinct visibly-qualified basis (e.g. \"title says easy\") that the badge marks the same way as Estimated. Change the three in-file records whose files lack the wording. Remove the uncited Greensleeves claim and the \"(file name)\" wording. Stop calling these labels \"verified\" in comparePreference/inventory. Re-run the Minuet duplicate choice without the label preference. In build-catalog, check that basis 'in-file' labels actually occur in the file's credits."
  },
  {
   "id": "entertainer-8va-repeat-silently-ignored",
   "title": "Curated catalog notes are never shown, so The Entertainer (ready) silently plays its \"Repeat 8va\" section at the written octave",
   "severity": "major",
   "briefRef": "§12 baseline correctness: \"Support them correctly or label affected pieces/passages as needing review. Never silently flatten away important information and present the result as faithful.\"",
   "files": [
    "src/ui/practice/DiagnosticsDialog.tsx",
    "src/ui/library/LibraryCard.tsx",
    "src/core/types.ts",
    "catalog/metadata.json"
   ],
   "evidence": "src/core/types.ts:498-499 declares CatalogEntry.notes as \"Short user-facing notes\". `grep -rn notes src/ui` finds no use of entry.notes: DiagnosticsDialog renders only prepared.warnings, and LibraryCard renders no notes.\n\nThe catalog entry the-entertainer-scott-joplin is readiness 'ready'. Its notes include 'Includes a \"Repeat 8va\" text instruction (play the repeat an octave higher)'. The score has <words>Repeat 8va</words> at measure 22, together with a forward repeat.\n\nI ran the real pipeline (loadSourceScore → prepareScore with entry.overrides). Its only warning is the info hand-override note, so nothing about 8va appears. Comparing the two passes:\n  22 RH: E5 G5 A5 E5 G5 E5 F5 F#5\n  22 (2nd time) RH: E5 G5 A5 E5 G5 E5 F5 F#5\nOther curated caveats are also invisible, e.g. 'Shortened to the main theme (24 measures)' for the ready Beginner Für Elise.",
   "failureScenario": "A learner practises The Entertainer, shown as ready with no review chip. The second pass of section C should be an octave higher, but it is played and taught at the same octave. Nothing on the library card, practice page or 'About this arrangement' says so.",
   "suggestedFix": "Show CatalogEntry.notes in the 'About this arrangement' dialog, and on the card or popover where relevant. Detect '8va'/'8vb' words directions in the parser and emit a review warning (or apply them to the repeat pass). Alternatively, mark The Entertainer editions as needing review with a plain reason."
  },
  {
   "id": "in-part-ossia-staff-replaces-rh",
   "title": "An ossia staff inside the piano part is mapped to the right hand and the real right-hand staff is dropped; fixture 14 covers only an ossia in a separate part",
   "severity": "major",
   "briefRef": "§10 (the user's 4-staff 'Ossia' screenshot; avoid alternative playback; do not map staves without inspecting structure); §17 fixture 14 (multiple staves/alternative passage)",
   "files": [
    "src/core/model/hands.ts",
    "tests/e2e.fixtures.test.ts",
    "tests/fixtures/f14-ossia-parts.musicxml"
   ],
   "evidence": "src/core/model/hands.ts:82-92 handles a part with 3 or more staves by mapping staff 1 to R and the last staff to L, and leaves out the middle staves. 'Ossia' words are checked only at part level (looksAlternativeByText, used in splitAlternatives), never per staff. tests/e2e.fixtures.test.ts:330 (f14) tests only a separate P2 part.\n\nRepro (/tmp/rv/ossia3.mts): one Piano part with 3 staves. Staff 1 is a small ossia staff with words \"Ossia:\" and notes only in m2 (A4 B4 C5). Staff 2 is the real RH (m1 C5 B4, m2 A4 G4 F4). Staff 3 is the LH. Output:\n  mapping {\"staffHands\":{\"P1:1\":\"R\",\"P1:3\":\"L\"},\"source\":\"unclear\"}\n  0 R  | L C3\n  192 R A4 | L F2\n  240 R B4 | L\n  288 R C5 | L\nThe real RH (C5 B4 A4 G4 F4) is gone. The ossia line is played as the right hand, and measure 1 has no RH at all.",
   "failureScenario": "The user imports a score like their screenshot: one piano part with an extra ossia staff above. It opens as 'Needs review' with the reason 'the middle staff is left out'. The beginner cannot judge that. Practising it gives them the ossia alternative instead of the main right hand and drops every other RH note.",
   "suggestedFix": "When a part has more than 2 staves, check per-staff alternative text (direction words or staff-details on that staff) and per-staff note counts. Exclude a sparse or 'ossia' staff and map the two main staves R/L. Add a same-part ossia fixture (3- and 4-staff variants) to the f14 tests."
  },
  {
   "id": "follow-me-deadlock-out-of-range",
   "title": "Follow me waits forever at steps that need keys outside A0–C8, which no 88-key piano can play",
   "severity": "major",
   "briefRef": "§8 Follow me (\"Do not require a hidden timeout or impossible note press\"); §5 (explain an unsupported range)",
   "files": [
    "src/core/practice/follow.ts"
   ],
   "evidence": "src/core/practice/follow.ts:142-144 expectedKeys() is the union of attacks with no range handling, and tryComplete requires every expected key to be freshly down. Repro (/tmp/rv/oor.mts): real catalog files through prepare and derive, then a FollowMatcher fed a perfect player who presses every in-range expected key:\n  bach-toccata-and-fugue-in-d-minor-piano-solo steps needing an out-of-range key: [ '#591 occ 29: G#0 G#1' ]\n    STUCK at step 591 expects [ 'G#0', 'G#1' ] measure 29\n  mariage-damour steps needing an out-of-range key: [ '#609 occ 45: D7 D8', '#1090 occ 81: D7 D8 D4' ]\n    STUCK at step 609 expects [ 'D7', 'D8' ] measure 45",
   "failureScenario": "In Follow me on the Toccata, the learner reaches measure 29. The status says \"Waiting for: G#0 G#1\" for ever, because G#0 does not exist on their piano, and nothing explains the stall. Only pressing Next gets past it. Mariage d'Amour stalls the same way at measure 45 (D8), and so would any imported piece with such notes.",
   "suggestedFix": "In FollowMatcher, leave keys outside 21–108 out of the expected set. If a step's only attacks are out of range, treat it like a release-only step and auto-advance. Show a short note such as \"D8 is beyond the piano – skipped\". Add a test."
  },
  {
   "id": "default-tempo-not-labelled-in-practice",
   "title": "When a file has no tempo, the app-chosen 120 qpm is labelled only inside 'About this arrangement'; the practice controls call it \"the written speed\"",
   "severity": "minor",
   "briefRef": "§8 Listen: \"If no usable tempo exists, choose and label a default rather than pretending it came from the file.\"",
   "files": [
    "src/ui/practice/ControlsBar.tsx",
    "src/ui/practice/DiagnosticsDialog.tsx",
    "src/ui/practice/text.ts",
    "src/ui/library/LibraryCard.tsx"
   ],
   "evidence": "prepared.tempo.defaulted is read in only one place: src/ui/practice/diagnostics.ts:32 (tempoDescription), shown in the optional diagnostics dialog. Elsewhere:\n- The Listen speed slider announces `${speed} of the written speed` (ControlsBar.tsx:203).\n- The diagnostics dialog itself says \"About m:ss at the written speed\" (DiagnosticsDialog.tsx:90), even when the tempo is defaulted.\n- The library card length is computed at the default tempo with no qualifier (LibraryCard.tsx CardStats).\n- The catalog note 'No tempo is written in the file, so a default speed is used' is never rendered.\nAffected catalog pieces: Bella Ciao, Carol of the Bells (easy), Für Elise Easy Piano, both Happy Birthday files, and the Minuet. Four of these are labelled Beginner.",
   "failureScenario": "A beginner opens Happy Birthday (Beginner) in Listen. The UI presents 1× as the piece's written speed and the card shows a length. Neither says the 120 quarter-notes-per-minute tempo was chosen by the app.",
   "suggestedFix": "When tempo.defaulted is true, show a short label in the Listen controls (e.g. \"1× = 120 beats/min (no tempo in file)\"). Use it in the slider valuetext and on the library card length. Fix the diagnostics 'Length' wording."
  },
  {
   "id": "stale-preview-noteoff-midi-out",
   "title": "Play shortly after Next/Previous leaves the preview's scheduled MIDI note-off live, which cuts the playback note on the connected piano",
   "severity": "minor",
   "briefRef": "§9 audio routing (cancel stale scheduled events; prevent stray output); §8 manual stepping",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "src/engine/session.ts:796-821 preview() sends midi.sendNoteOn(key, …, ms) and midi.sendNoteOff(key, ms + 500) to the output. play() (402-431) calls startRun without endPreview() or releaseAll(), so the queued note-off is never cancelled.\n\nRepro (/tmp/rv/preview.mts) with the project's FakeMidi/FakeClock. Score: RH C4 0-4, then E4 4-16 at 120 qpm, midiOutputId set. Steps: next(), then 100 ms later play(). MIDI sends (ms relative to the Next click):\n  on 64 at 0\n  off 64 at 500\n  on 64 at 150\n  off 64 at 1650\nThe piano receives the preview's note-off at 500 ms, so the playback E4 struck at 150 ms is released about 1.15 s early. The browser sampler is not affected, because its noteOff only touches existing voices.",
   "failureScenario": "With 'Play through connected piano' on, the learner presses → to preview a step and then Play within half a second. The first held note on the digital piano stops early, so the demonstration differs from the score.",
   "suggestedFix": "In play() (and startRun), call endPreview() before scheduling, or send midi.allNotesOff() when a preview is pending, so queued preview note-offs are cancelled. Add an engine test with MIDI output for next→play."
  },
  {
   "id": "cross-staff-reason-asks-beginner-to-read-score",
   "title": "The 'Needs review' reason on 16 built-in pieces tells the beginner to \"Check which hand should play them\", which needs sheet-music reading and misstates what the app does",
   "severity": "minor",
   "briefRef": "§10 (the user must not have to read staff notation; review cases are not a requirement for the beginner to resolve the notation); §16 plain-language states",
   "files": [
    "src/core/musicxml/warnings.ts",
    "src/catalog/catalog.json"
   ],
   "evidence": "src/core/musicxml/warnings.ts:21 has the message: \"Some notes are written on the other hand's staff. Check which hand should play them.\" It is the readinessReasons text for 16 catalog entries, including Arabesque, both Clair de lune files, both Moonlight 3rd editions, Mozart K.545 Allegro and The Entertainer 1902 (catalog.json:52, 118, …). It appears in the readiness chip popover on library cards and the practice header. Per ARCHITECTURE and performance.ts, the app already gives these notes to the hand of their voice's home staff. The builder report also flags this message as reworkable.",
   "failureScenario": "The beginner sees \"Needs review\" on Clair de lune, opens the reason and is told to check which hand plays some notes. They cannot do that without reading the staff, and they are not told the app has already made a sensible choice.",
   "suggestedFix": "Reword it to describe the app's behaviour plainly, e.g. \"Some notes cross between the hands' staves; the app gives them to the hand whose melody they belong to, which may occasionally differ from the printed fingering.\" Update the asserting tests and regenerate the catalog."
  }
 ]
}


===== review:follow-midi =====
{
 "findings": [
  {
   "id": "follow-wrongkey-exempts-released-keys",
   "title": "Follow me never flags a re-struck key that the current step releases, so previous-note and previous-chord mistakes go unflagged and extra keys still complete the step",
   "severity": "major",
   "files": [
    "src/core/practice/follow.ts"
   ],
   "evidence": "src/core/practice/follow.ts:151-160, wrongKeys(): `for (const k of this.unionOver(this.seq.steps[this.index].heldBefore)) ok.add(k);`. heldBefore includes every key that this step releases: in a 'replace' cell that is all previously held keys, and in a 'change' cell it is the blue-released keys. The code comment and ARCHITECTURE §4 justify the exemption as \"re-pressing a key the score holds is fine\", but the score does not hold these keys through the step; it lets go of them.\nRepro (/tmp/pianorev/r10.mts, FollowMatcher + buildSequence):\n```\nstep 1 (expects D4), C4 struck again: 1 wrong = []\nthen D4 with C4 held: advanced = true now step 2\ncluster C4..G4 before A4: wrong = []\ncluster C4-A4 completes D-F-A step: true finished true\nunrelated B4 at D4 step: wrong = [ 71 ]\n```\nThe exemption also carries forward: the re-struck C4 is no longer 'fresh' after the step completes, so it is never flagged at later steps either.",
   "failureScenario": "Melody C4 -> D4. At the D4 step the learner repeats C4 (the most common beginner slip). No 'Not expected' mark appears. If they then add D4 while still holding C4, the step advances. For a chord change from C-E-G to D-F-A, a six-key cluster C4..A4 completes the D-F-A step with no wrong-key feedback. This breaks brief §8: \"Highlight unexpected presses without advancing\" and \"must still distinguish unexpected new pitches and repeated attacks\".",
   "suggestedFix": "Exempt only the keys the score keeps holding through this step (heldBefore minus releases, i.e. heldAfter minus attacks, per included hand). Do not exempt all of heldBefore. Add matcher tests: a previous-note re-strike in a melody, and a previous-chord re-strike on a chord change. Update the ARCHITECTURE §4 wording to match."
  },
  {
   "id": "follow-prev-stuck-on-release-only",
   "title": "Previous step / Left arrow does nothing in Follow me when the step before is release-only",
   "severity": "major",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "src/engine/session.ts:520-531: step(-1) targets stepIndex-1. At :542-544, while 'waiting', it calls matcher.start(k). FollowMatcher.start() (follow.ts:43-49, 131-136) skips forward over release-only steps, so the marker lands back on the current step. The Prev button stays enabled (ControlsBar.tsx:158, only `stepIndex <= 0` disables it).\nRepro with a synthetic score (/tmp/pianorev/r1.mts): R C4 0-4, D4 8-12. After playing C4 the marker is on step 2: `after prev {stepIndex: 2}`, `after prev again {stepIndex: 2}`, `after seek(1) {stepIndex: 2}`.\nRepro on the real catalog piece 12_Variations_of_Twinkle_Twinkle_Little_Star.mxl, RH only (/tmp/pianorev/r8.mts): `step 15..18 releaseOnly: [ false, true, false, false ]`, `at 17`, `after Prev -> 17 (expected 15, the previous attack step)`. That piece has 332 release-only steps for RH (r7.mts).",
   "failureScenario": "A learner in Follow me wants to go back one step to retry the previous note, which was followed by a rest or a staccato release. Prev and the Left arrow silently do nothing, every time. Brief §8 Manual stepping, the help text (\"In any mode you can step through by hand with the arrow buttons\") and APP_CONTRACTS (\"In Follow me, seek/next/prev restart the matcher at the new step\") are not met.",
   "suggestedFix": "In PracticeSession.step() while following (status 'waiting', or 'finished' with a pending restart), for delta < 0 search backwards for the nearest step that has attacks for the included hands, then call matcher.start on it. Alternatively give FollowMatcher a direction-aware start. Add an engine test for Prev across a release-only step."
  },
  {
   "id": "midi-reconnect-dead-end",
   "title": "After the selected input vanishes, the UI cannot switch to the one remaining or returning device; 'Try again' does nothing and Follow me stays disabled until a page reload",
   "severity": "major",
   "files": [
    "src/ui/practice/ConnectPiano.tsx",
    "src/ui/practice/midiConnection.ts",
    "src/midi/manager.ts"
   ],
   "evidence": "ConnectPiano.tsx:11-18 shows the input <select> only when `live.length > 1 || phase === 'choose'`. In phase 'disconnected' with exactly one live input it renders a chip with no control. manager.ts:346 `mayAutoSelect = this.inputSel.id === null || firstConnect`, so a kept stale selection is never replaced by a sole new device. midiConnection.ts:111-116: 'Try again' calls midi.connect(), which returns 'ready' at once, and the savedInputName match does not fit a renamed device.\nRepro (/tmp/pianorev/r4.mts, real MidiManager + midiPhase):\nA) The piano is replugged and comes back as id in-2, name \"2- Digital Piano\" (Windows-style re-enumeration): `phase: 'disconnected', liveCount: 1, showsSelect: false`; `A connect() again -> ready false`.\nB) Piano plus a USB MIDI interface, and the piano is unplugged: `{ phase: 'disconnected', live: [ 'USB MIDI Interface' ], showsSelect: false }`.\nRepro (/tmp/pianorev/r9.mts): the piece remembers midiInputId 'saved-id', the piano is off at Connect, then it is switched on with a different id. The notice says \"Your piano was disconnected...\" although it never connected, and then `{ phase: 'disconnected', inputConnected: false, live: [ 'Digital Piano' ], selectShown: false }`.",
   "failureScenario": "A user reconnects the piano on another USB port, or switches from USB to Bluetooth, or uses a different piano than the one saved for this piece. The device is listed by the browser, but the app keeps waiting for the old id. There is no selector, and 'Try again' is a no-op. Follow me stays disabled (canFollow = midiInputConnected) until the page is reloaded. This breaks brief §9: handle disconnection and reconnection gracefully, and offer device selection.",
   "suggestedFix": "In ConnectPiano, render the select whenever phase is 'disconnected' and at least one live input exists, or whenever the live inputs differ from the selection. In the manager, when the selected input is missing and exactly one input is connected, allow auto-selecting it on statechange as well. Alternatively, have the 'Try again' path in useMidiConnection fall back to the sole live input. Do not pre-select a saved id that is absent, or show the 'no devices' text instead of 'disconnected' in that case."
  },
  {
   "id": "echo-guard-drops-real-noteoff",
   "title": "Echo guard discards the player's real note-off when it falls within 80 ms of the app's own note-off on the same key, leaving a phantom held key",
   "severity": "major",
   "files": [
    "src/midi/manager.ts",
    "src/engine/session.ts"
   ],
   "evidence": "manager.ts:365-379: every input note event with the same key and type within 0-80 ms after any app-sent message is dropped, whether or not the device ever echoes. session.ts:921/929 then never sees the release. startFollow (session.ts:881) re-feeds `physical` as down keys. FollowMatcher.press ignores a note-on for a key already down (follow.ts:106-111).\nRepro (/tmp/pianorev/r5.mts, real MidiManager + PracticeSession): Listen with \"Play through connected piano\" on the same piano. The learner plays along and releases C4 20 ms after the app's C4 note-off:\n```\napp note-off for C4 scheduled at 11050 now 11010\nafter user released C4: physicalDown = [ 60 ]\nfollow start waiting waitingFor [ 60 ] physicalDown [ 60 ]\nafter pressing C4 once: 0 [ 60 ]\n```\nWith Sound off (r5b.mts) the monitored browser voice for C4 gets a noteOn and no noteOff: `sound off: sampler C4 calls [ 'noteOn' ]`.",
   "failureScenario": "Output to the piano is enabled, and the learner plays along in Listen; their releases naturally coincide with the app's releases. The release is swallowed. A phantom C4 dot stays on the keyboard. With monitor on and Sound off, the browser C4 keeps ringing until the next C4 or Stop. After switching to Follow me, the learner's first C4 press is ignored and they must press it twice. Brief §9: keep physical keys separate from app playback events; note-off handling.",
   "suggestedFix": "Make the echo guard consume one matching record per echo, so at most one input event is dropped per app-sent message. Do not drop note-offs for keys the app never sounded on that device. Alternatively, apply the guard only after an echo has actually been observed (adaptive detection), or only while the output port is the same device as the input. As a safety net, keep a key physically down only while a note-on that was not echo-filtered is outstanding."
  },
  {
   "id": "follow-loop-delay-swallows-press",
   "title": "With Repeat on, a key struck during the 1 s Follow me restart gap is ignored, and the next correct note is flagged wrong",
   "severity": "minor",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "session.ts:894 sets followRestartAt = now + 1000 when finished. During the gap status is 'finished', so onMidiEvent does not feed the matcher (:934). At restart, startFollow (:877-885) re-feeds every held key as already down, so it is not fresh.\nRepro (/tmp/pianorev/r6.mts): passage C4, D4 with loop on. The learner finishes, then strikes C4 400 ms later in tempo:\n```\nafter restart (C4 still held) { status: 'waiting', stepIndex: 0, waitingFor: [ 60 ], physicalDown: [ 60 ] }\npresses D4 next { stepIndex: 0, waitingFor: [ 60 ], wrong: [ 62 ] }\n```",
   "failureScenario": "A learner looping a passage keeps playing straight into the next repetition. Their genuine new C4 strike is discarded, the status says \"Waiting for: C4\" while they hold C4, and their D4 is marked \"Not expected\". Brief §8: wait for expected new key presses; a real new note-on must count.",
   "suggestedFix": "Track keys struck after the passage finished, for example by feeding events to the matcher during the restart gap or by remembering note-ons since `finished`. When restarting, mark those keys as fresh for step 0 instead of treating every held key as stale. Alternatively, restart immediately and let the matcher wait."
  },
  {
   "id": "follow-loop-gap-transport",
   "title": "During the Follow me loop gap, the play button says 'Start Follow me' but pauses; the next Start resumes on the last step and immediately 'finishes' again",
   "severity": "minor",
   "files": [
    "src/ui/practice/ControlsBar.tsx",
    "src/engine/session.ts"
   ],
   "evidence": "ControlsBar.tsx:125 `running` excludes 'finished', so the label at :144 is 'Start Follow me'. session.ts:461/515-517: isRunning() is true while followRestartAt is set, so togglePlay() calls pause(). pauseInternal (:566-572) leaves stepIndex on the last step. beginFollow (:870) then starts from that last (release-only) step, which is skipped to finished.\nRepro (/tmp/pianorev/r2.mts): `after togglePlay during loop delay { status: 'paused', stepIndex: 3 }`, then `after second togglePlay { status: 'finished', stepIndex: 3 }`, and it loops again only after another 1 s.",
   "failureScenario": "A learner sees 'Finished' and the Start button and clicks Start (or presses Space) to go again. The session pauses instead. Clicking Start again shows 'Finished — passage complete' once more before restarting. The same happens when the piano disconnects during the gap.",
   "suggestedFix": "Treat the loop gap as running in the UI (expose it in the snapshot), or have pause during the gap reset stepIndex to 0. Also make beginFollow restart from 0 when the paused marker is past the last attack step."
  },
  {
   "id": "releaseall-cuts-monitored-input",
   "title": "Follow me loop restart, pause, and Sound/hands toggles cut the learner's own monitored (browser) notes and pedal sustain",
   "severity": "minor",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "session.ts:837-848 releaseAll() calls sampler.allNotesOff() and clears `sustained`/`monitorOnAt`. That also kills voices started by monitorInput for keys the player is still holding. It runs at the Follow loop restart (:724-729), on pause, and on any Sound/hands/range/mode change (:378), even though Follow me plays no app audio.\nRepro (/tmp/pianorev/r6.mts, monitorInput on): the learner holds C4 through the loop restart; sampler calls for C4 are `[ 'noteOn:60', 'noteOff:60', 'noteOn:60', 'allNotesOff' ]`, so the held, monitored C4 is silenced while physicalDown still shows [60].",
   "failureScenario": "With \"Hear my playing through the browser\" on, the learner holds the final chord with the pedal. One second later (loop restart), or when they toggle the Sound switch (which does nothing else in Follow me), their sound is cut off mid-note. Brief §9 asks to release app-generated notes on loop reset or mode switch and to keep physical input separate from app playback.",
   "suggestedFix": "Separate monitor voices from playback voices. For example, have releaseAll release only app-scheduled voices, and leave monitored keys that are still physically down (or pedal-sustained) sounding. Alternatively, call releaseAll in Follow me only when app audio was actually produced."
  }
 ]
}


===== review:engine =====
{
 "findings": [
  {
   "id": "midi-out-stale-queue-no-clear",
   "title": "MIDI output: messages already queued with future timestamps survive pause, stop, seek, restart, speed change and leaving the page. They re-strike keys after Stop and cut freshly re-struck notes.",
   "severity": "major",
   "briefRef": "§9 Audio routing ('On stop, loop reset, mode switch, disconnect, navigation... release app-generated notes and cancel stale scheduled events'); §13; APP_CONTRACTS 'No stuck notes ... clear every queued event'",
   "files": [
    "src/engine/session.ts",
    "src/midi/manager.ts"
   ],
   "evidence": "session.ts:789-791 sends every Listen/Steady event to Web MIDI up to LOOKAHEAD_SEC (150 ms, session.ts:93) ahead, using atMs timestamps. releaseAll (session.ts:837-847) relies on midi.allNotesOff() (manager.ts:261-285). That only cancels queued messages when MIDIOutput.clear() exists (manager.ts:265-266), and Chrome/Edge do not implement clear(). The fallback only appends a note-off at (latest queued note-on + 1 ms). Already-queued note-offs and note-ons still fire. The new run starts START_LEAD_SEC (50 ms) after now (session.ts:672), which is inside the old queue window.\n\nI reproduced this with the real MidiManager and a fake output port without clear(): /tmp/ps/t_midi_variants.mts and /tmp/ps/t_midi_seek.mts. Score: C4 0-0.5 s, C4 0.5-1 s, LH C3. The action is taken 400 ms after play; the device timeline after the action:\n pause:   off48@+0 off60@+0 CC123@+0 CC64@+0 off60@+150 on60@+150 off60@+151   (piano is struck after Pause)\n stop / dispose: identical stray strike at +150\n restart: on48@+50 on60@+50 off60@+150(q) on60@+150 off60@+151 ... off60@+550\n          -> the restarted C4 sounds 50..150 ms instead of 50..550 ms\n speed 1->0.9: re-struck C4 cut at +150 instead of +216\nThe browser sampler path is correct; only MIDI out is affected.",
   "failureScenario": "Chrome with 'Play through connected piano' selected, playing Listen with repeated notes. The user presses Pause or Stop, or leaves to the library: the digital piano still plays a note about 150 ms later. The user clicks a column, presses Restart, or drags the speed slider while playing: notes the engine just re-struck are cut short by note-offs from the previous run, which garbles the output while the slider is dragged.",
   "suggestedFix": "Do not hand Web MIDI messages far into the future when they cannot be cancelled. For MIDI output use a separate, very short horizon (send each message only when due, or at most one scheduler tick ahead), or send without timestamps from the tick. Alternatively, track the latest queued MIDI timestamp and, after releaseAll, start the new run (or at least its MIDI events) no earlier than that time plus a margin, and send all-notes-off again at that time. Add a test using a MidiManager whose port has no clear()."
  },
  {
   "id": "midi-preview-noteoff-cuts-playback",
   "title": "Step preview's scheduled MIDI note-off (+0.5 s) is never cancelled. It cuts the same keys when Play or another preview follows within 0.5 s.",
   "severity": "major",
   "briefRef": "§8 Manual stepping, §9 Audio routing (cancel stale scheduled events); APP_CONTRACTS Manual stepping (preview 0.5 s, then release)",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "preview() (session.ts:815-819) sends note-on now and a timestamped note-off at nowMs + 500 to the MIDI output. Neither endPreview() (session.ts:823-834, which only adds an immediate off) nor play()/startRun() (session.ts:402-432, 665-701, which do not call releaseAll or midi.allNotesOff) withdraws that queued off. Playing from the previewed step re-strikes exactly the previewed keys (startRelFor(k) then buildEvents).\n\nRepro /tmp/ps/t_preview_midi.mts (FakeMidi, any browser, clear() irrelevant). Score: C4 for 1 s, then E4 and C3. Steps: next(), prev() (preview C4), then play() 100 ms later. Device timeline: 'key 60: 50..400 ms rel. to play()', where the expected span is 50..1050. The FakeSampler voices for the same run are correct ([0.050, 1.050]), so only MIDI out is wrong.",
   "failureScenario": "With MIDI output on, the user presses → / ← to hear a step and then presses Space to play from it. On the digital piano the first chord stops after about 0.4 s instead of being held. Quickly stepping through repeated notes also cuts each preview short with the previous preview's queued note-off.",
   "suggestedFix": "Do not send the preview's note-off with a future timestamp. Keep a preview timer (or let the scheduler tick release preview keys when due), and cancel it in endPreview(), releaseAll(), play() and seek. Alternatively call releaseAll()/midi.allNotesOff() before startRun when a preview is active, and make the release independent of queued timestamps (see the stale-queue finding)."
  },
  {
   "id": "no-release-on-page-unload",
   "title": "Notes sent to the MIDI output are not released when the page is reloaded, closed or navigated away from (only in-app route changes dispose the session).",
   "severity": "minor",
   "briefRef": "§9 ('release app-generated notes ... on navigation'), §13 ('Do not leave keys stuck on after ... navigation'), §16 cleanup on leaving",
   "files": [
    "src/ui/practice/PracticePage.tsx",
    "src/engine/session.ts"
   ],
   "evidence": "The only page-lifecycle hook is PracticePage.tsx:65-71, and window 'pagehide' only flushes saved settings. SessionHost disposes the session only from the React effect cleanup (PracticePage.tsx:233), which does not run on unload or reload. The scheduler dispatches note-offs only 150 ms ahead (session.ts:747-753). A note held longer than that has had its note-on sent but its note-off not yet sent, and grep finds no pagehide, beforeunload or visibility handler that calls dispose() or midi.allNotesOff(). Web MIDI does not send note-offs when a page's MIDI session closes.",
   "failureScenario": "In Listen with 'Play through connected piano', a long left-hand chord is sounding when the user reloads the tab or closes it. The digital piano keeps those keys on (damper up) because no note-off or CC123 is ever sent. With a sustaining voice selected on the instrument, the notes ring indefinitely.",
   "suggestedFix": "On 'pagehide' (and optionally 'visibilitychange' to hidden while running), call session.dispose(), or at least session.pause() / midi.allNotesOff(), before flushing preferences."
  },
  {
   "id": "loop-seam-gap",
   "title": "Loop restart is detected after the passage end by the timer tick and re-anchored at now + 50 ms, so every repeat is lengthened by 50-75 ms plus any main-thread delay.",
   "severity": "minor",
   "briefRef": "§13 loop restart; §16 ('Audio timing must not drift materially because visual rendering is busy'); ARCHITECTURE §7 ('Visual work never blocks audio timing')",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "advanceRun (session.ts:767-773) restarts only when a tick finds rel >= duration. It then calls startRun(0, …), which anchors at clockNow + START_LEAD_SEC (session.ts:669-675). The next pass is not scheduled ahead on the audio clock, so the seam depends on when setInterval fires.\n\nRepro /tmp/ps/t_loop.mts, a 2.0 s passage with loop on and count-in off. Note-ons: '48@0.050 60@0.050 … 48@2.100 60@2.100 … 48@4.150 … 48@6.200'. Each repeat takes 2.05 s instead of 2.0 s, even with the fake timer firing exactly on time. With real 25 ms interval jitter the gap is 50-75 ms, and a busy main thread at the seam delays it further.",
   "failureScenario": "A learner loops a two-measure passage with count-in off to hear it continuously. Every repeat has an audible rhythmic hiccup: the last beat is held 50-75 ms or more too long.",
   "suggestedFix": "When looping without count-in, schedule the next pass inside the lookahead: once horizon >= anchor + duration, build the next run's events with anchor' = anchor + duration and release only stale future events. Do not wait for the end to pass and add START_LEAD_SEC."
  },
  {
   "id": "late-ticks-burst",
   "title": "Events dispatched late (throttled or blocked timer) are all played at once, not in rhythm.",
   "severity": "minor",
   "briefRef": "§16 ('Audio timing must not drift materially...'); ARCHITECTURE §7 ('Visual work never blocks audio timing')",
   "files": [
    "src/engine/session.ts",
    "src/audio/sampler.ts"
   ],
   "evidence": "advanceRun (session.ts:747-753) dispatches every event whose time is before the horizon, even when that time is already in the past. The sampler clamps a past start to now (sampler.ts:229, 'const at = Math.max(t, now)'), and MIDI sends past timestamps immediately. Nothing re-anchors or skips when a tick is late.\n\nRepro /tmp/ps/t_throttle.mts runs the scheduler at 1 Hz, as Chrome does for a hidden tab that is not producing sound. Eighth notes 0.25 s apart:\n'62 want 0.30s, dispatched at 1.00s LATE 700ms / 64 want 0.55s … LATE 450ms / 65 want 0.80s … LATE 200ms'.\nD4, E4 and F4 sound together as a cluster at 1.0 s. The builder report lists background-tab lateness as a known gap. This is not only lateness: the musical result is a wrong chord.",
   "failureScenario": "A user uses 'Play through connected piano' with browser Sound off, so the tab is not audible and is throttled, and switches to another tab. A long main-thread stall over about 125 ms has the same effect. The piano plays bursts of simultaneous notes once a second instead of the melody.",
   "suggestedFix": "When the tick finds events that are already late by more than a small tolerance, re-anchor the run at the current position (like reanchor()) instead of firing the backlog. For silent or MIDI-only runs, enlarge the lookahead while document.hidden."
  },
  {
   "id": "audio-not-started-for-countin-monitor",
   "title": "Count-in clicks and 'Hear my playing' stay silent when they are enabled without an audio-starting gesture (count-in turned on mid-playback, or monitorInput restored from storage).",
   "severity": "minor",
   "briefRef": "§15 ('Browser audio must initialize through an appropriate user interaction rather than failing silently'); §9 (option to hear input through the browser)",
   "files": [
    "src/engine/session.ts",
    "src/ui/practice/PracticePage.tsx"
   ],
   "evidence": "updateSettings starts audio only when monitorInput or sound is switched on (session.ts:382-383); turning countIn on does nothing. Clicks are sent only when the run uses the audio clock (session.ts:744 'if (toSampler)'). A run started with Sound and Count-in off uses the wall clock, so the count-in at the next loop restart is silent.\n\nRepro /tmp/ps/t_countin_toggle.mts (sound off, loop on, play, then updateSettings({countIn:true})): status shows 'count-in remaining 4, 3, 2, 1', but 'ensureStarted calls: 0  clicks sent to sampler: 0'.\n\nThe constructor (session.ts:301-339) never starts audio for a restored monitorInput: true, and onMidiEvent sends monitor notes straight to sampler.noteOn (session.ts:926). That call is a no-op until a context exists. Repro /tmp/ps/t_monitor.mts: 'ensureStarted calls = 0; noteOn calls = 1'; with the real PianoSampler, state stays 'not-started' and the note is silent. The Connect piano click (a gesture) does not start audio either, and no message is shown.",
   "failureScenario": "(1) The user plays in Listen with Sound off and Repeat on, then switches Count-in on. At the loop the screen shows 'Get ready… 4…1' with no clicks. (2) The user reopens a piece where 'Hear my playing through the browser' was left on, connects the piano and plays: there is no browser sound until they press Play or step, and nothing explains why.",
   "suggestedFix": "Call startAudioQuietly() when countIn is turned on (and re-anchor a running wall-clock run onto the audio clock). For monitorInput, start audio from the Connect piano / Start click when monitorInput is on, or show a 'Click to enable sound' hint when monitored input arrives while sampler.state is 'not-started'."
  },
  {
   "id": "leading-rest-marker-jump",
   "title": "Passages that open with a rest: on Play the marker jumps back a column to an empty position, while the keyboard already shows step 0 as 'press now' through the rest.",
   "severity": "minor",
   "briefRef": "§7 ('A shared playback clock drives sound, key highlighting, and the notation position'; marker identifies the current action)",
   "files": [
    "src/engine/session.ts",
    "src/ui/notation/Timeline.tsx"
   ],
   "evidence": "positionAt returns -1..0 before the first step (session.ts:228). getVisualPosition returns displayIndex() = 0 when not playing (session.ts:358), but positionAt(times, 0) = -1 as soon as a run starts, including during count-in. The snapshot stepIndex cannot be below 0, so the 'current' column, aria-current and the keyboard's struck/expected keys show step 0 during the whole rest.\n\nRepro /tmp/ps/t_vis.mts (first note at 0.5 s): 'stopped pos 0 … right after play pos -1', then -0.9, -0.7 … with 'snap stepIndex 0' throughout. The C4 audio only starts at 0.5 s.",
   "failureScenario": "The user practises the left hand of a passage where the left hand enters after a rest of a measure or more. Pressing Play makes the timeline jump right by a column, and the marker sits over blank space. Meanwhile the keyboard tells the user to press the first chord seconds before it sounds. The same jump happens at every loop restart and seek to step 0.",
   "suggestedFix": "Keep the visual position at 0 (or start the run at times[0] and count the rest into the lead) instead of introducing a phantom column -1. Alternatively, expose a 'before first step' state so the keyboard shows no 'press now' keys until the first step's time."
  },
  {
   "id": "no-output-latency-compensation",
   "title": "Marker, keyboard and MIDI timestamps use AudioContext.currentTime without output-latency compensation, so they lead the audible browser sound.",
   "severity": "minor",
   "briefRef": "§7 ('A shared playback clock drives sound, key highlighting, and the notation position'); §16 audio timing",
   "files": [
    "src/engine/session.ts",
    "src/audio/sampler.ts"
   ],
   "evidence": "clockNow('audio') returns sampler.currentTime (session.ts:1010; sampler.ts:148-150). That is the context's render time, not the time the sound is heard; the gap is baseLatency + outputLatency. getVisualPosition (session.ts:359), the stepIndex update in advanceRun (session.ts:767-768), and the MIDI atMs conversion (session.ts:789) all use it directly. grep finds no use of outputLatency, baseLatency or getOutputTimestamp in src.",
   "failureScenario": "With Bluetooth headphones (output latency typically 150-250 ms), the scrolling marker and the keyboard highlight visibly arrive before each note is heard. With browser Sound and 'Play through connected piano' both on, the piano sounds that much earlier than the browser, giving a doubled 'flam'.",
   "suggestedFix": "Expose an output-latency estimate from the sampler (ctx.outputLatency ?? 0, plus ctx.baseLatency ?? 0, or ctx.getOutputTimestamp()). Subtract it from the audio clock for visual position and stepIndex, and add it to MIDI atMs when browser sound is also on."
  }
 ]
}


===== review:music =====
{
 "findings": [
  {
   "id": "cross-staff-voice-majority-misassigns-hands",
   "title": "Cross-staff hand assignment uses one whole-piece majority per voice id, so real notes go to the wrong hand (including a 'ready' catalog piece) and a whole staff can flip hands on import",
   "severity": "critical",
   "files": [
    "src/core/musicxml/parse.ts",
    "src/core/model/performance.ts"
   ],
   "evidence": "parse.ts:123-145 (homeStaves) and performance.ts:401-423 pick a voice's home staff as the staff holding most of that voice's notes across the whole part, with ties going to the lower staff. parse.ts:224-230 marks every note off that staff as crossStaff, and performance.ts:479-487 (handOf) gives those notes the home staff's hand. All library files are MuseScore exports, where the voice number itself identifies the home staff (voices 1-4 = staff 1, 5-8 = staff 2). Comparing assigned hands with that convention (script /tmp/pr/xs.mts) finds:\n(1) Prlude_No._4_in_E_Minor_Op._28_-_Frdric_Chopin.mxl. Catalog status is READY with no cross-staff warning. Its closing chords are RH voice 2 written on the bass staff, and they go to the LH. deriveSteps gives m24: `R:[E4]  L:[B3 F#3 E3 B2 B1]`, then `R:[D#4]  L:[B3 F#3 D#3 B2 F#2 B1]`; m25: `R:[E4]  L:[B3 G3 E3 E2 E1]`. That is one hand spanning E1-B3 while the RH plays one note.\n(2) Sonate_No._14_Moonlight_3rd_Movement.mxl: voice 6 is split 32/32, the tie goes to staff 1, so all 64 notes go to R. Affected: m9-13, m111-115, m164-167. In m164 the RH is told to press A#1 (`s2 v6 X @1.63 A#1 -> R`) together with its chords up to C#5, and in m13 G#3 eighths on top of the G#4/G#5 figure.\n(3) Import with voice '1' on both staves (also the default when the optional <voice> element is omitted), /tmp/pr/t1.mts: presses `RC3[0,192) RE5[0,48) ...`. The whole LH staff becomes RH: `#0 R:[E5 C3] L:[—]`. Readiness is only 'review'.\nScoreOverrides (types.ts:503-510) can only remap whole staves, so a per-arrangement override cannot fix this.",
   "failureScenario": "Open the built-in 'Prélude in E Minor, Op. 28 No. 4' (shown as ready) and practise the last two measures. The LH row asks for a 5-6 note stack from E1/B1 up to B3 while the RH plays only E4/D#4. That is physically impossible, and in the original the RH plays the upper chord. Moonlight 3rd tells the RH to play bass A#1. An imported file that reuses voice 1 on staff 2 plays the entire left-hand part in the right-hand row and leaves the LH row empty.",
   "suggestedFix": "Stop deriving the home staff from a single global majority per voice id. For MuseScore exports (source.software), use the voice-number convention: voice v belongs to staff ceil(v/4) within the part. For other files, decide cross-staff per measure or per contiguous run. A note counts as cross-staff only if the same voice also has notes on its home staff nearby; otherwise use the staff it is drawn on. Never move a whole staff because a voice id is reused across staves. Add these three files/cases as regression tests, and consider allowing a per-voice hand override in ScoreOverrides."
  },
  {
   "id": "three-staff-part-ossia-replaces-main-rh",
   "title": "A part with 3+ staves gives staff 1 to the RH even when it is an ossia staff; the main RH staff is dropped",
   "severity": "major",
   "files": [
    "src/core/model/hands.ts"
   ],
   "evidence": "hands.ts:82-93 (mapSinglePart, staves >= 3) always maps `${id}:1` to R and the lowest staff to L, and leaves the middle staves unmapped. The ossia checks (hands.ts:24-26, 45-58) only apply to whole parts. SourcePart.hiddenStaves is filled in (parse.ts:294) but never read: `grep hiddenStaves src` finds only the producer. Reproduction /tmp/pr/t4.mts: a 3-staff part where staff 1 is hidden (`<staff-details number=\"1\" print-object=\"no\">`), holds only an 'ossia' passage in m2, and the part's words include 'ossia'. Result: parts[0].words=['ossia'], hiddenStaves=[1], staffHands {'P1:1':'R','P1:3':'L'}. Presses `LC3[0,192) RG5[192,384) LD3[192,384) LE3[384,576)`. The main RH notes E5/F5/A5 on staff 2 are gone, and only the ossia's G5 is played.",
   "failureScenario": "An imported piano score with an ossia staff above the right hand inside the same part (brief §10's concrete ossia test case). The RH row is empty except in ossia bars, where it plays the alternative instead of the main music. The real right-hand line is never played. The review text says only 'the middle staff is left out'.",
   "suggestedFix": "In the 3+ staff case, drop staves that are hidden (hiddenStaves), carry ossia/alternative words, or are mostly empty, before choosing the RH staff. Prefer the upper staff with the most notes as RH. If that is still ambiguous, mark the piece unsupported or review with a message naming the risk, and add a fixture for an in-part ossia staff."
  },
  {
   "id": "multi-part-picks-first-two-staff-part",
   "title": "With several parts, the fallback practises the first two-staff part in file order, even if it is a small unlabeled alternative and the main piano part is excluded",
   "severity": "major",
   "files": [
    "src/core/model/hands.ts"
   ],
   "evidence": "hands.ts:143-144: `const twoStaff = main.find((p) => p.staves === 2); const chosen = twoStaff ?? main.reduce(largest)`. The largest part is only used when no part has two staves. Reproduction /tmp/pr/t7.mts: P1 is an unnamed 2-staff part with 8 notes, above the main part (as ossias usually are); P2 is 'Piano' with 2 staves and 80 notes. 8 is 10% of 80, so the 3% tiny-part rule does not fire. Result: staffHands {'P1:1':'R','P1:2':'L'}, excludedParts ['P2'], presses 8, reason \"Only an unnamed part is used for practice. “Piano” is left out.\"",
   "failureScenario": "Importing a file whose alternative/ossia (or reduction) part comes before the main piano part and is not labelled 'ossia' in its name or text. The learner practises a handful of alternative bars and the real piece is silently replaced. The review reason does not tell a non-reader which part is the real one.",
   "suggestedFix": "When several two-staff parts remain, choose the one with the most pitched notes, perhaps preferring a part named piano. Keep the review warning. Add a test with the alternative part placed first."
  },
  {
   "id": "tempo-after-skip-uses-skipped-written-tempo",
   "title": "After a forward skip (over a 1st ending, or To Coda) or a D.C. to a measure before the first mark, the tempo map uses the wrong tempo for the rest of the piece",
   "severity": "major",
   "files": [
    "src/core/model/performance.ts"
   ],
   "evidence": "performance.ts:347-365: at any non-continuous occurrence, buildTempoMap inserts writtenTempoBefore(m.startTick), the last mark strictly before the measure in written order. For a forward skip, that includes marks inside measures that were skipped on this pass. For a return to the start, it returns null when the first mark is later, so the previous (end-of-piece) tempo stays in force. Repro /tmp/pr/t5.mts: m1 tempo 120 with a forward repeat; m2 = 1st ending with 'rit.' tempo 60 at beat 3 and a backward repeat; m3 = 2nd ending; m4. Order: 1 | 2 | 1 (2nd time) | 3 | 4. Tempo points [{0,120},{288,60},{384,120},{576,60}]: the 2nd ending and everything after play at 60 even though the 1st ending was skipped. Listen times 0,2,3,5,7,11,15 s. Repro /tmp/pr/t8.mts: pickup m0 with no mark, m1 Allegro 120, m2 'rit.' 40 and D.C. al Fine. After the D.C. the pickup plays at 40 qpm (1.5 s instead of 0.5 s): points [{0,120},{336,40},{480,120}]. A library scan (/tmp/pr/tempo_skip.mts) found no affected built-in file, so the impact is on imported files.",
   "failureScenario": "An imported piece with a ritardando written as a tempo change in its 1st ending (a common MuseScore idiom) plays the 2nd ending and the rest of the piece in Listen mode at the ritardando tempo, for example half speed. That breaks §8 'Use source tempo changes where supported'.",
   "suggestedFix": "For forward skips (endings, To Coda), carry the tempo in force at the end of the previous performed occurrence, plus any marks in the target measure. Do not use marks from skipped measures. For back-jumps (repeat, D.C., D.S.), when no written mark precedes the target, apply the first tempo mark, matching the 'first tempo applies from tick 0' rule. Add both cases as tests."
  },
  {
   "id": "ending-plus-forward-repeat-measure-dropped",
   "title": "A 2nd-ending measure that also starts a new ||: section is never played",
   "severity": "major",
   "files": [
    "src/core/model/performance.ts"
   ],
   "evidence": "performance.ts:231-249: in simulate(), a forward repeat on measure i first resets `sectionStart = i; sectionPass = 1`. Only after that does it check the ending span starting at i, using `pass = sectionPass` (now 1). An ending numbered [2] is therefore skipped. Repro /tmp/pr/rep2.mts, case L: measures [1 ||:], [2 1st ending :||], [3 2nd ending (open) with ||:], [4 :||], [5]. Result `1 2 1 4 4 5`; expected `1 2 1 3 4 3 4 5`. Measure 3 never sounds, nothing is reported, and readiness is unchanged.",
   "failureScenario": "An imported score whose open 2nd ending flows straight into a new repeated section loses that ending measure every time. The repeat of the next section also starts one bar late. All notes in that bar are silently missing from Listen, Steady and Follow me.",
   "suggestedFix": "Check the ending span (using the pass of the enclosing section) before applying a forward repeat on the same measure. Alternatively, apply the forward-repeat reset only after a measure has been accepted for playing. Add case L to model.repeats tests."
  },
  {
   "id": "roundtrip-baseline-not-independent",
   "title": "The §17 round trip compares the notation with presses that derive.ts itself produced, so clipping and hand-filter errors are invisible",
   "severity": "minor",
   "files": [
    "src/core/actions/interpret.ts",
    "tests/e2e.fixtures.test.ts",
    "tests/e2e.library.test.ts"
   ],
   "evidence": "interpret.ts:221-224: roundTrip builds `expected = eventsFromPresses(seq.presses, seq.hands)`. seq.presses comes from clipPresses inside deriveSteps (derive.ts:163). The e2e checks (tests/e2e.fixtures.test.ts:56-63 boundaryTicks, :83 roundTrip; tests/e2e.library.test.ts:59) also use seq.presses only. Nothing compares the sequence with PreparedScore.presses or notes restricted to the passage and hands. The brief §17 asks to compare against 'the normalized source events'.",
   "failureScenario": "Suppose a regression in clipPresses or the hand filter in deriveSteps drops a press, mis-dates a carried press, or keeps the wrong hand's press. It changes the notation and the round-trip baseline together, so roundTrip still reports ok and every library and fixture test still passes.",
   "suggestedFix": "In roundTrip, or in a test helper used by the e2e suites, build the expected events from PreparedScore.presses: filter by the selected hands and clip to rangeTicks(...) with code that does not import derive.ts. Then compare the notation against that, not seq.presses."
  }
 ]
}


===== review:security-storage-deploy =====
{
 "findings": [
  {
   "id": "mxl-lying-header-cpu-bomb",
   "title": "MXL size limits trust zip header sizes, so a .mxl with false sizes freezes the tab for minutes before it fails",
   "severity": "major",
   "files": [
    "src/core/mxl.ts"
   ],
   "briefRef": "§12 Supported input: \"Handle corrupt ZIPs ... and excessive archive sizes with a readable error\"",
   "evidence": "src/core/mxl.ts:50-69 (listEntries) enforces maxUncompressedBytes (line 20, 60 MB) only against `f.originalSize`, the size the central directory claims. src/core/mxl.ts:119-120 (readEntry) then calls `unzipSync(bytes, { filter })`. fflate 0.8.3 (node_modules/fflate/esm/index.mjs:2704) runs `inflateSync(data.subarray(b, b + sc), { out: new u8(su) })` with `st.i == 2`, so `resize` is false (line 241). Output past `su` is silently discarded, but inflation keeps running over the whole compressed stream. Memory stays bounded; CPU time does not. The length check (line 125) and the CRC check only run after inflation has finished. The import runs synchronously on the main thread: src/storage/imports.ts:251-252 does `await nextFrame()` and then calls `parseScoreBytes`. docs/dev/app-builder-reports.md:280 already lists this as a known gap.\n\nReproduction: /tmp/rev/mkbomb.py writes a single-entry zip, entry score.musicxml, raw-deflated zeros, declared uncompressed size 1000 or 60,000,000. /tmp/rev/bomb.mts calls extractMusicXmlText under npx tsx:\n- /tmp/rev/bomb1g.mxl: archive 1,043,764 B, real 1 GiB, declared 1000. Result: bad-archive \"failed its checksum\" after 2078 ms, RSS +4 MB.\n- /tmp/rev/bomb1g_big.mxl: same stream, declared 60 MB, so it passes the 60 MB limit. Result: bad-archive after 2550 ms, RSS +62 MB.\n- /tmp/rev/bomb16g.mxl: archive 16,698,103 B, under the 20 MB maxArchiveBytes; real 16 GiB, declared 1000. Result: bad-archive after 474,185 ms (about 8 minutes) of uninterrupted synchronous CPU, RSS +43 MB.",
   "failureScenario": "The learner imports a hostile or badly produced 16 MB .mxl, for example one downloaded from a sheet-music site, whose central directory declares a tiny uncompressed size but whose deflate stream expands to many GB. The library shows \"Checking…\", then the page's main thread is blocked for minutes. The browser shows \"Page unresponsive\", and the user cannot cancel. Only after that does a bad-archive error appear, or the user kills the tab. The brief asks for a readable error for excessive archive sizes, not a hang.",
   "suggestedFix": "Never trust the header sizes while inflating. For the entry being read (container.xml and the score), inflate with fflate's streaming `Inflate` (or `Unzip` + `UnzipInflate`): push the compressed bytes in chunks, for example 64 KB, and count the produced bytes in `ondata`. Throw `too-large` / `bad-archive` as soon as the output exceeds that entry's declared `originalSize`, or the remaining 60 MB budget. As a cheap extra check, reject entries whose compressed size exceeds the declared uncompressed size plus deflate overhead (a header that is clearly false). Optionally run import parsing in a Web Worker so even a slow but legitimate file cannot freeze the UI. Add a test with a small zip whose header lies, and assert it fails fast."
  },
  {
   "id": "xml-literal-section-regex-quadratic",
   "title": "lexicalProblem's comment/CDATA/PI regex is quadratic on unterminated sections, so a few hundred KB of XML hangs import",
   "severity": "minor",
   "files": [
    "src/core/xml.ts"
   ],
   "briefRef": "§12 Supported input: malformed XML must produce a readable error",
   "evidence": "src/core/xml.ts:165 `LITERAL_SECTIONS = /<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>/g` runs in src/core/xml.ts:175 as `text.replace(LITERAL_SECTIONS, '')` whenever a bare `&` is present. Each unterminated `<!--` (or `<![CDATA[` or `<?`) makes the lazy scan run to the end of the text, and the match then restarts at the next occurrence, so the cost is O(occurrences × length). This runs synchronously on the main thread during import (imports.ts:252) and when an imported piece is opened.\n\nReproduction (/tmp/rev/regex.mts, loadSourceScore on `<?xml version=\"1.0\"?><score-partwise version=\"4.0\"><part-list/>&amp` + '<!--'.repeat(n) + `</score-partwise>`):\n- n=5000, 20 KB: 41 ms\n- n=10000, 40 KB: 161 ms\n- n=20000, 80 KB: 623 ms\n- n=40000, 160 KB: 2623 ms\nEvery case ends in malformed-xml. The growth is quadratic, so a 1 MB file takes about 100 s, and the 60 MB plain-XML limit allows far more.\n\nThe suggested fix pattern `/<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<\\?[\\s\\S]*?(?:\\?>|$)/g` handled the same 160 KB input in 0 ms and a 1 MB input in 2 ms (node -e benchmark).",
   "failureScenario": "The user imports a damaged or crafted .xml/.musicxml that contains an unescaped '&' and many unterminated '<!--' (or '<?'). Instead of an immediate \"The score file is damaged\" message, the tab freezes for seconds to minutes, depending on size, before reporting malformed-xml.",
   "suggestedFix": "Let an unterminated literal section consume the rest of the text so the regex stays linear, for example `/<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<\\?[\\s\\S]*?(?:\\?>|$)/g`. Alternatively, replace the regex with a single indexOf-based pass that skips comments, CDATA and PIs. Add a regression test with many unterminated '<!--' and a time bound."
  }
 ]
}


===== verify:traceability =====
{
 "verdicts": [
  {
   "id": "traceability:difficulty-title-word-shown-as-rating",
   "verdict": "confirmed",
   "reason": "Confirmed, but for fewer records than claimed: 3 clear cases, not 7.\n\nWhat is clearly wrong (3 in-file records):\n- I unzipped Carol_of_the_Bells_easy_piano, Greensleeves_for_Piano_easy_and_beautiful and Nocturne_in_E-flat_Major_Op._9_No._2_Easy. None of them contains easy, beginner or intermediate anywhere in the XML (credits, work-title or movement-title).\n- Their only basis is the file name or upload title. The research log says this outright (\"the label rests on the file name only\"; \"MuseScore page snippets showed no level suffix\").\n- The type contract says in-file means \"the arrangement's own score text states a level\" (src/core/types.ts:451).\n- The popover says \"Stated in the score\" and \"The arrangement’s own sheet music names this level.\" (DifficultyBadge.tsx:13,20). For these three files that is false.\n- Brief §3 says names containing \"easy\" are hints, not proof.\n- The Greensleeves note claims \"A sheet-music listing of the same arrangement also says Beginner\". The research record has no such source, and it says the opposite.\n- By contrast, Ode to Joy, Fur Elise Easy Piano and Hungarian Dance do contain their wording in the credits, so those are fine.\n\nWhat is overstated (4 source records):\n- The research log (docs/dev/difficulty-research-raw.json) shows these rest on MuseScore's level suffix in the page title (\"... Sheet Music for Piano (Solo) easy\"). It is not a word in the arrangement's own title.\n- That is arguably the \"explicit classification ... from MuseScore\" that §14 prefers. So \"Published rating\" is defensible, though the sourceName \"title marked “easy”\" is ambiguous.\n- One exception: the Prelude BWV 846 record could not be confirmed by the verify pass (HTTP 403). That pass recommended Unrated, yet the record was kept as Beginner.\n- Because those labels are probably legitimate, preferring the labelled Minuet copy in deduplication is a defensible choice, not a demonstrated defect.",
   "refinedFix": "1. In catalog/difficulty.json, change Carol_of_the_Bells_easy_piano, Greensleeves_for_Piano_easy_and_beautiful and Nocturne_in_E-flat_Major_Op._9_No._2_Easy to level \"Unrated\", basis \"none\". The \"easy\" hint can stay in the arrangement line or note. Delete the uncited Greensleeves sentence (\"A sheet-music listing of the same arrangement also says Beginner\").\n2. In scripts/build-catalog.ts record validation, fail (or downgrade to none) any basis 'in-file' record whose originalLabel does not occur, case-insensitively, in the file's title, subtitle or credit text from loadSourceScore.\n3. Rename the MuseScore sourceName to something like \"MuseScore level tag on the score page (“easy”)\", so it is not read as a title word.\n4. Consider making the Prelude BWV 846 record Unrated, since its verify pass could not confirm it.\n5. Regenerate the catalog, CATALOG_REPORT.md and inventory.json, and update the catalog tests. Leave the DifficultyInfo basis contract unchanged."
  },
  {
   "id": "traceability:entertainer-8va-repeat-silently-ignored",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/vf/ent.mts, which runs the real loadSourceScore and prepareScore with the catalog overrides.\n- the-entertainer-scott-joplin is 'ready'. Its only warning is the info hand-override note.\n- Measure 22, first pass (occ 36) and second pass (occ 52, \"22 (2nd time)\"), both give RH E5 G5 A5 E5 G5 E5 F5 F#5. The second pass is not an octave higher.\n- The file has <words>Repeat 8va</words> next to a forward repeat (line 2828). The 1902 edition has \"Repeat  8va.\".\n- `grep -i \"8va|ottava\"` over src/core finds nothing, so the instruction is never detected.\n- CatalogEntry.notes is documented as \"Short user-facing notes\" (types.ts:498). No file in src/ui reads it: DiagnosticsDialog renders only prepared.warnings and entry.licenseNote, and LibraryCard shows no notes. So the curated caveat 'Includes a \"Repeat 8va\" text instruction' never reaches the user.\n- This conflicts with brief §12: \"Never silently flatten away important information and present the result as faithful.\"",
   "refinedFix": "1. In the MusicXML parser (src/core/musicxml/part.ts, words handling), detect words directions matching /\\b(8va|8vb|15ma|15mb)\\b/i that are not backed by an <octave-shift>. Emit a new review warning (for example 'octave-text-not-applied': \"A written instruction to play a passage an octave higher or lower is not applied; those notes play as written.\") with the affected measures. Add the code to WarningCode and IMPORT_WARNINGS.\n2. Both Entertainer editions then become 'review' with a plain reason. Regenerate the catalog.\n3. Render CatalogEntry.notes as a short list in DiagnosticsDialog (\"About this arrangement\"), so curated caveats are visible as types.ts already promises.\n4. Add a parser test for the words detection."
  },
  {
   "id": "traceability:in-part-ossia-staff-replaces-rh",
   "verdict": "confirmed",
   "reason": "Reproduced with my own fixture (/tmp/vf/ossia3.musicxml and /tmp/vf/ossia.mts). The file has one 'Piano' part with 3 staves. Staff 1 has the words \"Ossia:\" and notes only in measure 2. Staff 2 is the real RH. Staff 3 is the LH.\n- Result: staffHands {P1:1:R, P1:3:L}, source 'unclear', readiness 'review'.\n- RH plays only 192:A4 240:B4 288:C5, which is the ossia. The real RH (C5 B4 A4 G4 F4) is dropped entirely.\n- part.words contains \"Ossia:\", but looksAlternativeByText is only used to choose between parts. mapSinglePart (hands.ts:82-92) maps staff 1 to R and the last staff to L without looking at the staves.\n- The f14 fixture and tests cover only an ossia in a separate part.\n- The piece is flagged review, which softens this. But brief §10 says not to map staves \"without inspecting the structure\", and names the 4-staff 'Ossia' screenshot as the test case for \"avoiding duplicate/alternative playback\". Here the app plays the alternative instead of the main passage, and the review reason (\"the middle staff is left out\") gives the beginner nothing they can act on.",
   "refinedFix": "1. In the parser, record which staff each words direction belongs to (the <staff> child of <direction>) and any <staff-details><staff-type> (ossia, alternate, cue) per staff on SourcePart.\n2. In hands.ts mapSinglePart, when part.staves >= 3:\n   - count pitched notes per staff from source.notes;\n   - treat a staff as alternative if it has ossia/alternate text or staff-type, or fewer than TINY_PART_SHARE of the densest staff's notes;\n   - if exactly two main staves remain, map the upper to R and the lower to L. Report the left-out staff with an 'alternative-part-excluded' style review warning in plain words;\n   - otherwise keep the current fallback.\n3. Update ARCHITECTURE.md §2 rule 4.\n4. Add same-part ossia fixtures (3 staves with ossia on top; 4 staves) to the f14 tests in tests/e2e.fixtures.test.ts. Assert the real RH is played and nothing is doubled."
  },
  {
   "id": "traceability:follow-me-deadlock-out-of-range",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/vf/oor.mts. It runs every catalog file through prepare and deriveSteps, then drives FollowMatcher with a perfect player who presses every expected key in A0–C8.\n- bach-toccata-and-fugue-in-d-minor-piano-solo: stuck at step 591 of 2456. Expects [G#0, G#1], measure 29.\n- mariage-damour: stuck at step 609 of 1117. Expects [D7, D8], measure 45.\n- follow.ts expectedKeys() and tryComplete() require every attack to be freshly down, with no range check. isOnPiano exists in pitch.ts but is not used here.\n- Both pieces are flagged review for out-of-range notes. Even so, brief §8 explicitly says Follow me must not \"require a hidden timeout or impossible note press\". A key below A0 or above C8 cannot be pressed on an 88-key piano. The status line just shows \"Waiting for: G#0 G#1\".",
   "refinedFix": "In src/core/practice/follow.ts:\n1. Make expectedKeys() return only keys with isOnPiano(k).\n2. Make isReleaseOnly() also skip a step whose attacks are all off the piano, so it auto-advances like a release-only step.\n3. In wrongKeys(), add off-piano attacks of the current step to the allowed set, so a device that can send them is not penalised.\n4. Optionally add the skipped off-piano keys to FollowStatus, so the status line can say e.g. \"D8 is beyond the piano's keys – skipped\".\n5. Add tests in tests/follow.test.ts for a step mixing in-range and out-of-range keys, and for a step with only out-of-range keys. Notes stay unclamped, as §5 requires."
  },
  {
   "id": "traceability:default-tempo-not-labelled-in-practice",
   "verdict": "confirmed",
   "reason": "Unambiguous from the code, and minor.\n- prepared.tempo.defaulted is read only in src/ui/practice/diagnostics.ts (tempoDescription).\n- The Listen speed slider's aria-valuetext is always \"… of the written speed\" (ControlsBar.tsx:203).\n- In the same dialog, DiagnosticsDialog.tsx:90 always says \"About m:ss at the written speed\", directly under a Speed row that says the tempo is not given in the file.\n- The library card length (UI_SPEC: \"m:ss at file tempo\") has no qualifier, and the catalog note about the default speed is never rendered.\n- With the real pipeline, six catalog pieces have a defaulted tempo: bella-ciao, carol-of-the-bells-easy-piano, fur-elise-easy-piano, both Happy Birthday files and minuet-in-g-major-bach. Four of them are Beginner.\n- Mitigation: the default is labelled in \"About this arrangement\" (Speed row plus an info warning). So the brief's \"label a default\" is partly met. But the \"written speed\" wording in those other places still presents the app's 120 qpm as if it came from the file, which §8 forbids.",
   "refinedFix": "1. Where tempo.defaulted is true, say something like \"of the default speed (no tempo in the file)\" in the Listen speed slider's aria-valuetext. Show a small visible hint next to the Speed control, e.g. \"1× = 120 beats/min, chosen by the app\".\n2. In DiagnosticsDialog's Length row, say \"at the app’s default speed\" instead of \"at the written speed\".\n3. On LibraryCard CardStats, add a qualifier when the entry has no file tempo. This needs a flag such as stats.tempoDefaulted from build-catalog. Then regenerate the catalog."
  },
  {
   "id": "traceability:stale-preview-noteoff-midi-out",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/vf/preview.mts, using the project's FakeMidi, FakeSampler and FakeClock. The score is RH C4 0-4 then E4 4-16 at 120 qpm, with midiOutputId set. I called next(), advanced 100 ms, then play().\n- MIDI sends, relative to the Next press: on 64 at 0; off 64 at 500 (the preview, queued at 0); on 64 at 150; off 64 at 1650.\n- The playback E4 struck at 150 ms is cut by the preview's queued note-off at 500 ms.\n- In the code, play() and startRun() call neither endPreview() nor releaseAll(), and preview() sends sendNoteOff(key, ms + 500) with a future timestamp.\n- The reviewer's suggested fix is not enough on its own. Once a future-timestamped message is sent, it can only be cancelled with MIDIOutput.clear(), which manager.ts treats as optional (its \"outputs without clear()\" path). In that case a later endPreview() or allNotesOff() still lets the queued note-off fire.",
   "refinedFix": "1. Make play() (inside the mutate, before startRun) and startRun call endPreview().\n2. Also stop relying on a pre-queued future note-off for the MIDI preview. Either:\n   - (a) record previewOffAtMs and send the note-off from the engine when it is due, cancelling it in endPreview(). This needs a short-lived interval during a MIDI preview, so the engine test asserting no interval for previews must allow this case; or\n   - (b) when a MIDI preview's note-off is still queued and the output has no clear(), start the run no earlier than previewOffAtMs (startAt = max(now + START_LEAD_SEC, previewOffAt)).\n3. Add an engine test with a MIDI output: next() then play() within PREVIEW_SEC. Assert that no note-off for a playback key falls between its playback note-on and its scheduled playback note-off."
  },
  {
   "id": "traceability:cross-staff-reason-asks-beginner-to-read-score",
   "verdict": "confirmed",
   "reason": "Unambiguous from the code, and minor.\n- The message is in src/core/musicxml/warnings.ts:21: \"Some notes are written on the other hand's staff. Check which hand should play them.\"\n- It appears in readinessReasons for 18 catalog entries. 16 of them are under review for this reason alone, matching the builder report.\n- ReadinessChip shows it in the \"Needs review\" popover on cards and in the practice header.\n- Checking which hand plays a note means reading the staff notation. Brief §2 says \"The user must not need to read sheet music to use or validate the app\", and §10 says review cases are not for the beginner to resolve.\n- The wording also hides that the app has already decided. Per ARCHITECTURE.md and performance.ts, cross-staff notes take the hand of their voice's home staff.\n- The builder report (app-builder-reports.md:408) itself says the message could be reworded and was left only because other tests assert the exact text.",
   "refinedFix": "1. Change the 'cross-staff-notes' message in src/core/musicxml/warnings.ts to plain wording that describes what the app does, e.g. \"Some notes are written on the other hand's staff. The app gives them to the hand whose line they belong to, which may sometimes differ from what a teacher would choose.\" Keep it at review severity.\n2. Update the exact-text assertions (tests/parser.test.ts:910 and any in model.prepare tests).\n3. Regenerate src/catalog/catalog.json and docs/CATALOG_REPORT.md, so tests/catalog.test.ts matches."
  }
 ]
}


===== review:ui =====
{
 "findings": [
  {
   "id": "shortcuts-swallowed-after-mouse-use",
   "title": "Space and arrow shortcuts stop working, or change settings, after ordinary mouse use of the practice controls",
   "severity": "major",
   "briefRef": "UI_SPEC Practice page: keyboard shortcuts (Space, ←/→, Home); brief §8 manual stepping; §16 focused controls and keyboard access",
   "files": [
    "src/ui/practice/Segmented.tsx",
    "src/ui/practice/ControlsBar.tsx",
    "src/ui/keyboard/Keyboard.tsx",
    "src/ui/practice/MoreMenu.tsx",
    "src/ui/notation/Timeline.tsx",
    "src/ui/common/Dialog.tsx",
    "src/ui/help/HelpDialog.tsx"
   ],
   "evidence": "Only the transport buttons (ControlsBar.tsx:48-54 keepFocus, used at :76) and the timeline columns (Timeline.tsx:28-34, used at :95) keep focus off themselves when clicked with the mouse. Other controls hold or get focus:\n- The Mode and Hands radios (Segmented.tsx:38-46), the Repeat, Sound and Count-in switches (ControlsBar.tsx:84-110) and the Fit radios (Keyboard.tsx:309-316) keep focus after a mouse click.\n- The More panel moves focus into its first control on open (MoreMenu.tsx:34), which is the \"Hear my playing\" switch.\n- Dialog sends focus back to the button that opened it (Dialog.tsx:94,107), for example the '?' help button.\n- After a measure-menu item is chosen, the menu sends focus back to the measure label (Timeline.tsx:246-250, 367-370, 378-381).\n\nshortcuts.ts then drops the shortcut. Any input counts as text entry (:33-36, :53), and a focused button swallows Space (:23-24, :55).\n\nReproduction (jsdom, real PracticePage, scripts in /tmp/pr/tests):\n- After closing Help, focus is on button \"Help: how to read and practise\" and shortcutFor(Space) returns null.\n- After opening More, focus is on input \"Hear my playing through the browser\" and shortcutFor(Space) returns null.\n- With the Right-hand radio focused, shortcutFor(ArrowRight) returns null. With the Fit radio focused, shortcutFor(Space) returns null.\n- After \"End passage here\", focus is on button \"Measure 3: passage options\". Space was dispatched, and the play button label stayed \"Play\".\n\nChrome and Edge, the Web MIDI browsers, focus radios, checkboxes and buttons on mouse click, and :focus-visible stays off, so no focus ring warns the user. Help (HelpDialog.tsx:200) says shortcuts only stop \"while you are typing or choosing from a list\".",
   "failureScenario": "- A learner clicks \"Right hand\" and presses → to step. The browser moves the radio to \"Left hand\", so the hands switch and playback halts; no step happens.\n- They click Repeat on, then press Space to play. Repeat turns off again and nothing plays.\n- They close Help and press Space. Help reopens.\n- They open More to look and press Space. Browser monitoring of the piano turns on.\n- After clicking Fit \"Whole piece\", ← flips the fit back to \"Passage\".",
   "suggestedFix": "Handle pointer interactions the same way everywhere:\n- Give Segmented options, Switch and the Fit radios the same mousedown handling as TransportButton (preventDefault and blur the field), or blur them after a pointer-initiated change.\n- Do not auto-focus the first control in the More panel when it is opened with the pointer.\n- When Help, About or the measure menu was opened with the pointer, do not send focus back to its trigger on close (blur instead), but keep focus return for keyboard opening.\n- Update the Help sentence so it matches the real rule."
  },
  {
   "id": "midi-disconnected-cannot-switch-device",
   "title": "Disconnected piano state gets stuck: the other connected device can't be chosen, and \"Try again\" does nothing",
   "severity": "major",
   "briefRef": "UI_SPEC Error and loading states: \"MIDI denied, no devices, and disconnected, each with a retry\"; brief §16 disconnected states",
   "files": [
    "src/ui/practice/ConnectPiano.tsx",
    "src/ui/practice/midiConnection.ts"
   ],
   "evidence": "- ConnectPiano.tsx:18 shows the input select only when `live.length > 1 || phase === 'choose'`. Otherwise it shows the chip with the old, missing device (ConnectPiano.tsx:48-55).\n- midiPhase returns 'disconnected' whenever a selection exists but is not connected (midiConnection.ts:41-44).\n- The notice's \"Try again\" (midiConnection.ts:144-146) calls connect(). MidiManager.connect returns at once when the state is already 'ready' (manager.ts:157).\n- reconcile auto-selects a sole input only when nothing is selected or on first connect (manager.ts:346).\n\nReproduction (jsdom, real MidiManager with a fake MIDIAccess, /tmp/pr/tests/midistuck.test.ts):\n- connected: phase=connected; text \"Yamaha P-125 connected\".\n- After unplugging A and plugging in B ('Digital Piano'): phase=disconnected; select shown=false; text \"Yamaha P-125 Your piano was disconnected. Reconnect it and it will be picked up again. Try again Dismiss\".\n- After Try again: unchanged. The manager does list the new input as connected: {\"id\":\"in-b\",\"name\":\"Digital Piano\",\"connected\":true}.",
   "failureScenario": "This happens if the chosen piano is unplugged and comes back with a new id and name. Examples: switching from USB to Bluetooth MIDI, Windows renaming a re-plugged device to \"2- …\", or a second keyboard being the only device left. The page then shows the old name with a grey dot and a \"Try again\" button that does nothing. There is no list to choose the device that is connected, and Follow me stays disabled until the page is reloaded.",
   "suggestedFix": "In the disconnected phase:\n- Show the input select whenever any connected input other than the selected one exists.\n- Make \"Try again\" re-pick: if exactly one input is connected, call midi.selectInput(thatId). Otherwise offer the list.\nAlternatively, add a re-select path in MidiManager that the retry can call."
  },
  {
   "id": "timeline-blank-frame-on-jump",
   "title": "Timeline shows no columns for at least one frame after big jumps (Home or restart, loop restart)",
   "severity": "minor",
   "briefRef": "UI_SPEC timeline virtualization; brief §7 timeline display, §16 stable alignment",
   "files": [
    "src/ui/notation/Timeline.tsx"
   ],
   "evidence": "In the rAF loop, render() writes the new strip transform to the DOM straight away (Timeline.tsx:201). The matching column window only goes through setWin (Timeline.tsx:205). A setState from requestAnimationFrame gets default priority, so React commits it in a later task, after the browser has painted that frame.\n\nReproduction (jsdom, real Timeline and Minuet sequence, rAF driven by hand, /tmp/pr/tests/blank.test.ts):\n- Steady at step 200: transform=-14128px, so columns 196..211 are on screen; columns 176..231 are mounted.\n- After the rAF frame with position 0, before React commits (this is the state that gets painted): transform=272px, so columns 0..11 are on screen, but columns 176..231 are mounted. None of the on-screen columns exist.\n- After React commits: columns 0..31 are mounted, and 12 are on screen.",
   "failureScenario": "With a long passage or the whole piece, every Repeat loop restart, Home or Restart jumps from far along back to the start. The instruction rows flash empty, apart from the tabs and marker, for one or more frames on every loop.",
   "suggestedFix": "Apply the window change synchronously for jumps larger than the overscan, using flushSync(() => setWin(next)) before writing the transform. Alternatively, defer the transform write to a layout effect that runs after the new window commits."
  },
  {
   "id": "measure-menu-unclamped",
   "title": "Measure-number menu is not kept inside the timeline or window, and stays put while the strip scrolls",
   "severity": "minor",
   "briefRef": "UI_SPEC \"Clicking a measure number opens a tiny menu\"; brief §13 selecting loop boundaries from the notation",
   "files": [
    "src/ui/notation/Timeline.tsx",
    "src/ui/notation/notation.css"
   ],
   "evidence": "- openMenu places the menu at `left: Math.max(0, r.left - rootRect.left)` (Timeline.tsx:234). The left edge is clamped but the right edge is not, and there is no flip.\n- The menu is absolutely positioned with min-width 190px (notation.css:289-298) inside `.tl`, which has `overflow: visible` (notation.css:92). No ancestor clips it, so it runs past the timeline and the window.\n- The position is captured once, while the strip keeps moving by transform during playback (Timeline.tsx:201), so the menu does not follow its label.",
   "failureScenario": "At 1280px width, the timeline's right edge is about 28px from the window edge. Clicking a measure number in the rightmost ~190px of the timeline (roughly the last 2–3 visible columns, where upcoming measures appear) opens a menu that runs past the window by up to ~150px. \"Start passage here\" and \"End passage here\" are cut off, and the page gets a horizontal scrollbar. During Listen, an open menu is left behind as its measure scrolls away.",
   "suggestedFix": "Clamp left to root.clientWidth - menu.offsetWidth (measure after mount) or flip to align right. Close or reposition the menu when the strip moves or the trigger unmounts."
  },
  {
   "id": "about-dialog-focus-lost",
   "title": "Closing \"About this arrangement\" (opened from More) drops focus to the page body",
   "severity": "minor",
   "briefRef": "brief §16 focused controls have keyboard access; UI_SPEC dialogs",
   "files": [
    "src/ui/practice/MoreMenu.tsx",
    "src/ui/common/Dialog.tsx"
   ],
   "evidence": "- MoreMenu.tsx:127-130 calls setOpen(false) and onOpenAbout() in the same click. The More panel, including the focused \"About this arrangement\" button, unmounts in the same commit that mounts the dialog.\n- Dialog.tsx:94 reads the opener from document.activeElement in useLayoutEffect. By then that is <body>, so on close (Dialog.tsx:107) focus goes back to body.\n\nReproduction (jsdom, real PracticePage, /tmp/pr/tests/focus.test.ts):\n- \"focus before opening About: button.ps-more__item 'About this arrangement'\"\n- \"focus in dialog: button.icon-btn 'Close'\"\n- \"focus after closing About: body\"",
   "failureScenario": "A keyboard or screen-reader user opens More, chooses About this arrangement and closes it. Focus lands at the top of the document instead of on the More button, so they have to tab through the whole header and controls again.",
   "suggestedFix": "Let Dialog take an explicit return-focus element, and pass the More button. Alternatively, focus the More button before opening the dialog, or close the panel after the dialog mounts."
  },
  {
   "id": "soft-highlight-contrast",
   "title": "\"Keep holding\" fills on white keys are nearly invisible (1.2:1 for left hand, 1.4:1 for right hand)",
   "severity": "minor",
   "briefRef": "brief §7 \"Provide a visible held-key state through the virtual keyboard\"; §16 readable contrast; UI_SPEC colours",
   "files": [
    "src/ui/theme.css",
    "src/ui/keyboard/Keyboard.tsx",
    "src/ui/keyboard/keyboard.css",
    "docs/UI_SPEC.md"
   ],
   "evidence": "Held-but-not-struck white keys are filled with --lh-soft #bbf7d0 or --rh-soft #ddd6fe (theme.css:14,16; Keyboard.tsx:57-58). They keep the same grey stroke as unlit keys (keyboard.css:112-116).\n\nComputed WCAG contrast:\n- lh-soft vs an unlit white key: 1.21:1\n- rh-soft vs an unlit white key: 1.39:1\n- lh-soft vs the key stroke: 1.37:1\n- strong --rh on a black key vs an unlit black key: 2.58:1 (--lh: 2.93:1)\n\nNon-text UI state needs 3:1. The small dark R/L letter is the only other cue.",
   "failureScenario": "After the instruction that started a long left-hand hold has scrolled past, the held key is a barely tinted white key. On a typical laptop screen, or for low-vision users, the learner can't see which keys to keep holding, which is exactly what §7 says the keyboard must show.",
   "suggestedFix": "Make lit white keys reach 3:1 against unlit ones. Options: a hand-coloured outline or inset border on soft-lit keys (2–3px in --rh or --lh), or a darker soft tint. Update the UI_SPEC colour table to match."
  },
  {
   "id": "raw-implicit-measure-labels",
   "title": "Raw MusicXML numbers \"X1\"–\"X4\" are shown as measure labels",
   "severity": "minor",
   "briefRef": "brief §16 no developer terms or internal ids in normal flows; §13 explain measures",
   "files": [
    "src/core/model/performance.ts"
   ],
   "evidence": "- occurrenceLabel uses `m.number.trim()` as written (performance.ts:116-123).\n- The_Entertainer_-_Scott_Joplin_-_1902.mxl has `<measure number=\"X1\" implicit=\"yes\">` through X4. These are MuseScore's ids for measures left out of the numbering.\n- Scan output: \"the-entertainer-scott-joplin-1902 … labels with X: 35:X1 67:X2 115:X3 151:X4\".\n- These labels go straight into the passage selects (ControlsBar.tsx:249-252), the timeline measure buttons (Timeline.tsx:302) and the status line (\"Measure X1\").",
   "failureScenario": "A learner practising The Entertainer (1902 edition) sees \"From measure X1\", a timeline header \"X1\" and \"Measure X2\" in the status line. These are meaningless to a beginner, and the hint above says a measure is a numbered section.",
   "suggestedFix": "For implicit or non-numeric measure numbers, use a readable label instead of the raw value. Either use the previous numbered measure with a suffix (for example \"16a\" or \"after 16\"), or use the 1-based written position. Read the implicit attribute in the parser if needed."
  },
  {
   "id": "keyboard-svg-title-tooltip",
   "title": "Keyboard SVG <title> pops up a large, quickly outdated tooltip over the keys",
   "severity": "minor",
   "briefRef": "brief §16 uncluttered keyboard",
   "files": [
    "src/ui/keyboard/Keyboard.tsx"
   ],
   "evidence": "The keyboard <svg> gets its name from a child <title> (Keyboard.tsx:337-339). Its text is \"Keyboard from C3 to C5. Right hand: C4 (press now), E4. Left hand: …\". Browsers show an SVG <title> as a native hover tooltip anywhere over the rendered SVG. The text is taken at hover time while the expected keys change every step.",
   "failureScenario": "If the mouse rests over the keyboard (common after clicking Fit, or simply leaving the pointer there while playing), a multi-line tooltip covers several keys and lists keys from an earlier step. That clutters and contradicts the live highlights. This is plausible; the orchestrator should confirm it in the browser.",
   "suggestedFix": "Drop the <title> and name the SVG with aria-label, or with aria-labelledby pointing to a visually hidden HTML element. That keeps the spoken summary without a hover tooltip."
  }
 ]
}


===== verify:follow-midi =====
{
 "verdicts": [
  {
   "id": "follow-midi:follow-wrongkey-exempts-released-keys",
   "verdict": "confirmed",
   "reason": "Reproduced with the real deriveSteps (/tmp/verif/v1.mts). For the legato melody C4(0-4) then D4(4-8), step 1 has heldBefore=[60] and releases=[60]. Re-striking C4 at the D4 step gives wrong=[]. Adding D4 while the re-struck C4 is still down advances the step. With a rest between the notes (C4 0-3), the same re-strike is flagged wrong=[60], so the behaviour depends on legato vs detached. The six-key cluster C4..A4 completes the D-F-A step with wrong=[] the whole time. This breaks brief §8: \"Highlight unexpected presses without advancing\" and \"distinguish unexpected new pitches\".\n\nCaveat on the reviewer's suggested fix: it is not fully safe. The heldBefore exemption also implements brief §13, \"In Follow me ... allow the learner to establish the needed initial keys\", when entering a step via start/seek. tests/follow.test.ts 'start(i) mid-sequence expects that step and accepts the score-held setup keys' puts down G4, which that '-G4 +A4' step releases. Switching unconditionally to heldAfter fails that test (/tmp/verif/fx, wrong=[67]). The refined fix below passes all 26 follow tests plus a new legato re-strike test. Aliased into the full suite (alias config /tmp/verif/fx/alias.config.mts; the alias was confirmed to take effect), it passes 926/926.",
   "refinedFix": "src/core/practice/follow.ts:\n1. Add `private entry = true;`.\n2. Set `this.entry = true` in start() before skipReleaseOnly().\n3. Set `this.entry = false` in tryComplete() when the step completes, before `this.index += 1`.\n4. In wrongKeys(), use `const step = this.seq.steps[this.index]; for (const k of this.unionOver(this.entry ? step.heldBefore : step.heldAfter)) ok.add(k);`.\n\nSo the setup keys (heldBefore) are exempt only on the step entered by start/seek/loop restart (brief §13). After an advance, only keys the score keeps holding are exempt (heldAfter = (heldBefore − releases) ∪ attacks).\n\nAdd matcher tests: re-striking the previous note in a legato melody is wrong and blocks completion; re-striking the previous chord on a chord change is wrong. Update the ARCHITECTURE §4 wording: \"not in the score's held state: heldBefore on the entry step (setup), otherwise the keys the score keeps holding through the step\"."
  },
  {
   "id": "follow-midi:follow-prev-stuck-on-release-only",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/verif/v2.mts) with the detached melody C4 0-3, D4 4-7, E4 8-12, where steps 1 and 3 are release-only. While waiting at step 4, prev() leaves the marker at 4; three more prev() calls also stay at 4. step(-1) targets index-1, and jumpTo calls matcher.start(k), which skips release-only steps forward to the current step. The existing engine test 'seek, next and prev restart the matcher' only uses a legato score, so it misses this.\n\nWhen paused, Prev moves the marker onto the release-only step, but the next Start skips forward again. seek() to an attack step works, so clicking an instruction is fine. Prev and the Left arrow are not. This violates the APP_CONTRACTS rule \"In Follow me, seek/next/prev restart the matcher at the new step\" and brief §8 Manual stepping.\n\nA prototype of the fix (prototype override of step) moves 4 -> 2 -> 0, and paused Prev then resume lands on step 2 waiting for D4.",
   "refinedFix": "In PracticeSession.step() (src/engine/session.ts ~520), after computing target: `if (delta < 0 && this.inFollow()) { while (target > 0 && (this.seq.steps[target].releaseOnly || unionOver(this.seq.steps[target], this.seq.hands, 'attacks').length === 0)) target--; }`. Do this before the `target === this.stepIndex` check. It then works for waiting, for finished with a pending restart, and for paused. Add an engine test: Prev across a release-only step in Follow me, both while waiting and while paused then resumed."
  },
  {
   "id": "follow-midi:midi-reconnect-dead-end",
   "verdict": "confirmed",
   "reason": "Reproduced with the real MidiManager plus an emulation of useMidiConnection.connect and the ConnectPiano select rule (/tmp/verif/v3.mts).\n- A device that returns with the same name and a new id re-attaches fine.\n- A2: the device returns with a new id and a new name ('2- Digital Piano'). Result: phase 'disconnected', live=['2- Digital Piano'], selectShown=false, and 'Try again' changes nothing.\n- C: a stale saved id, with a different piano switched on after Connect. Same dead end. The notice says \"Your piano was disconnected\" even though nothing ever connected.\n- C2: same name as savedInputName. 'Try again' does recover.\n\nThe cause is unambiguous in the code:\n- ConnectPiano shows the <select> only when live.length > 1 or phase is 'choose'.\n- reconcile() auto-selects only when nothing is selected or on first connect.\n- 'Try again' calls connect(), which returns 'ready' at once and only matches by savedInputName.\n- No other UI calls selectInput.\n\nUI_SPEC says disconnected has \"a retry\", and the brief §9 requires handling reconnection gracefully. The trigger set is narrower than the reviewer implies: it needs a new id and new name, or a different device. Still, it is a reload-only dead end.",
   "refinedFix": "Keep the manager contract (a missing selection is waited for).\n1. src/ui/practice/ConnectPiano.tsx: render the select when `live.length > 1 || phase === 'choose' || (phase === 'disconnected' && live.length > 0)`. `inputs` already includes the vanished selection labelled '(disconnected)', so the user can pick the live device. selectInput binds it immediately.\n2. src/ui/practice/midiConnection.ts connect().then: after the savedInputName lookup fails and the input is still not connected, if exactly one connected input exists, call midi.selectInput(it.id). 'Try again' then recovers.\n3. Optional: in midiPhase/notice, show the no-devices text rather than 'disconnected' when the selected id has never been connected in this session."
  },
  {
   "id": "follow-midi:echo-guard-drops-real-noteoff",
   "verdict": "confirmed",
   "reason": "Minimal repro with the real MidiManager (/tmp/verif/v4.mts): the user's note-on for C4 at 900 is delivered. The app sends note-off C4 at 1000. The user's genuine note-off at 1030 is dropped, and only note-off 62 is delivered. isEcho matches any same-key, same-type input within 0-80 ms of any sent record, so it swallows a real release whose note-on was delivered. The reviewer's session-level r5 also reproduces it: physicalDown stays [60], the monitored C4 is never released, and after switching to Follow me the first C4 press is ignored.\n\nThe reviewer's 'consume one record per echo' idea would not fix the non-echoing-piano case: the user's note-off would still be the first match. A per-key pairing counter does fix it. Prototyped in /tmp/verif/fx/manager_refined.ts, it passes all 926 tests via alias, including the existing echo-guard tests (velocity-0 echoes, scheduled notes, and echoed playback not advancing Follow me). It resolves the r5 scenario (physicalDown=[], sampler C4 noteOffs 2, first Follow press advances).",
   "refinedFix": "src/midi/manager.ts:\n1. Add `private readonly echoOns = new Map<number, number>()`. It counts echoed note-ons swallowed per key whose note-off has not yet arrived.\n2. In handleMessage, for 'noteon': if isEcho(...,'noteon',time), increment echoOns[midi] and return.\n3. For 'noteoff': `const pending = echoOns.get(midi) ?? 0; if (pending > 0) { decrement or delete; if (isEcho(midi,'noteoff',time)) return; }`. Otherwise always deliver. A note-off whose note-on reached listeners is never swallowed.\n4. Clear echoOns in bindInput when the port changes.\n5. Update the ARCHITECTURE §5 and builder-report wording: note-offs are treated as echo only when they pair with a swallowed echoed note-on."
  },
  {
   "id": "follow-midi:follow-loop-delay-swallows-press",
   "verdict": "refuted",
   "reason": "The mechanics reproduce (/tmp/verif/v5.mts F5). A C4 pressed 400 ms into the 1 s gap is not fed to the matcher. After the restart the screen shows waiting for [60] with physicalDown [60], and D4 is wrong [62]. But this is the documented design, not a defect:\n- APP_CONTRACTS says that on finish with loop on, the engine restarts at step 0 after 1 s.\n- During the gap the status reads 'Finished — passage complete'.\n- The ARCHITECTURE §4 matcher contract says keys already down when a step begins count as down, not as new presses. This is the same rule that makes held keys need re-striking everywhere else.\n\nD4 being flagged at step 0 is correct, because step 0 expects C4. The brief §8 requires new note-ons for attacks and that held keys never satisfy a later attack. It does not require presses made before a step starts (here, during a deliberate restart pause) to count. This is at most a UX enhancement, not a violation of the brief or contracts."
  },
  {
   "id": "follow-midi:follow-loop-gap-transport",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/verif/v5.mts F6). During the loop gap the status is 'finished', so ControlsBar's `running` is false and the label is 'Start Follow me'. session.isRunning() is true (followRestartAt set), so togglePlay() pauses, leaving status 'paused' at stepIndex 2 (the last, release-only step). The next play() runs startFollow(2), the matcher skips to the end, and the status is 'finished' again. It restarts only after another 1 s. The disconnect-during-gap path, via inputLost and pauseInternal, leaves the same paused-at-last-step state.\n\nA prototype (/tmp/verif/v7.mts) makes Start in the gap restart at step 0 at once, and Start after a gap disconnect begins at step 0.",
   "refinedFix": "src/engine/session.ts:\n1. togglePlay(): `if (this.status === 'finished') void this.play(); else if (this.isRunning()) this.pause(); else void this.play();`. This matches the UI's `running`, which excludes 'finished'.\n2. play(): allow the Follow gap through, for example `if (this.status === 'finished' && this.followRestartAt !== null && this.inFollow()) { this.playToken++; this.mutate(() => this.beginFollow()); return; }` before the isRunning guard. beginFollow already starts at 0 when finished, and startFollow clears followRestartAt.\n3. beginFollow(): when the status is not 'finished' and no step at or after stepIndex has attacks for the included hands, start from 0 instead. This covers pause or disconnect during the gap, and manually stepping onto the trailing release-only step."
  },
  {
   "id": "follow-midi:releaseall-cuts-monitored-input",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/verif/v5.mts F7, monitorInput on). The learner holds D4 through the Follow loop restart: tick() calls releaseAll(), which calls sampler.allNotesOff(), and soundingAt() becomes [] while physicalDown still shows [62]. Pressing E4 and then toggling Sound (which has no other effect in Follow me) also silences the held E4. releaseAll also clears `sustained` and `monitorOnAt`, so pedal-held monitored notes are lost too.\n\nFollow me never produces app audio: preview() returns early in follow mode, and there is no run. So these allNotesOff calls only kill the learner's own monitored input. Brief §9 asks to release app-generated notes and to keep physical input separate from playback. It is a minor defect, and the code follows the literal APP_CONTRACTS 'No stuck notes' list, so the fix needs a small contract clarification.",
   "refinedFix": "src/engine/session.ts:\n1. Give releaseAll a `keepMonitor` flag. When it is set, skip sampler.allNotesOff() and keep `sustained`/`monitorOnAt`. Still call midi.allNotesOff() when output is active, clear queued run events and clear previewKeys.\n2. Use keepMonitor=true when the mode is and stays 'follow' with no run and no previewKeys: the Follow loop restart in tick(), pauseInternal for 'waiting' or the gap, and updateSettings changes to sound/hands/range/loop while in Follow me.\n3. Keep the full release for mode changes, stop, MIDI disconnect (inputLost) and dispose.\n\nMonitored voices are still ended by the learner's own note-off and pedal-up events, which onMidiEvent processes in every status, so nothing sticks. Add a note to the APP_CONTRACTS 'No stuck notes' rule that in Follow me only app-generated sound is released, and monitored input that is still held keeps sounding."
  }
 ]
}


===== verify:engine =====
{
 "verdicts": [
  {
   "id": "engine:midi-out-stale-queue-no-clear",
   "verdict": "confirmed",
   "reason": "I reproduced this with the real MidiManager and a fake output port (/tmp/verify/t1.mts). Score: C4 0-0.5 s, C4 0.5-1 s, E4, LH C3. Playback runs for 400 ms, then the action. Port WITHOUT clear(): pause, stop and dispose all deliver 'off60@+150 on60@+150 off60@+151' after the immediate offs and CC123. That is a stray 1 ms strike, which a digital piano sounds. restart and seek(0) send on60@+50, then the stale queued off60@+150 cuts the restarted C4 (it should last to +550). speed 1->0.9 cuts the re-struck C4 at +150 instead of +216. Port WITH clear(): every case is clean. So the problem is specific to outputs without clear(). Chrome and Edge do not implement MIDIOutput.clear(), and the code itself has a fallback for that case. The fallback only prevents stuck notes: it neither cancels queued messages nor stops them from cutting the next run. This violates brief §9 ('cancel stale scheduled events') and APP_CONTRACTS 'No stuck notes ... clear every queued event'. The existing engine tests use FakeMidi, which does not model the device-side queue, so they miss it.",
   "refinedFix": "session.ts: (1) Give MIDI output its own short horizon. Add a Run cursor nextMidiEvent and a constant MIDI_LOOKAHEAD_SEC of about 0.03 s (just over one 25 ms tick). In advanceRun, send a MIDI event only when run.anchor + ev.t <= now + MIDI_LOOKAHEAD_SEC. The sampler keeps the 150 ms horizon, so dispatch() is split into sampler and MIDI paths. releaseAll() moves both cursors to the end. Timestamps are kept, so the contract 'sent with atMs timestamps' still holds; only the uncancellable window shrinks. (2) Record midiQueuedUntilMs, the largest atMs passed to sendNoteOn/sendNoteOff. In startRun, when outputActive(), compute first = max(now + START_LEAD_SEC, now + (midiQueuedUntilMs - nowMs())/1000 + 0.005). Stale queued note-offs then land before the new run's first strike. manager.ts: in allNotesOff without clear(), also track the latest timestamp of any queued message, not only note-ons, and send CC123 again 1 ms after it. Add an engine test that uses a real MidiManager whose port has no clear(). It should assert that no note-on is delivered after pause, stop or dispose, and that no stale note-off falls inside a re-struck note after restart, seek or a speed change."
  },
  {
   "id": "engine:midi-preview-noteoff-cuts-playback",
   "verdict": "confirmed",
   "reason": "I reproduced this in /tmp/verify/t2.mts with the real MidiManager, both with and without clear(). The result does not depend on the browser, because nothing calls clear() or allNotesOff() before play(). Steps: next(), then prev() to preview C4 (note-off queued at +500 ms), then play() 100 ms later. Device timeline relative to play: on60@+50, then the preview's queued off60@+400, then the run's own off60@+1050. The first chord is cut after 350 ms instead of being held 1 s. The sampler is correct (C4 voice 0.050-1.050) because its noteOff applies only to voices that exist when it is called. Stepping through repeated notes also cuts previews short: C4 struck at +300 is turned off at +500 by the previous preview's queued off, so it lasts 200 ms instead of 500. play() goes straight to startRun(), with no releaseAll or endPreview, and endPreview() only adds an immediate off. This contradicts APP_CONTRACTS ('preview ... for 0.5 s, then release them') and brief §9 (cancel stale scheduled events).",
   "refinedFix": "In preview(), send only the MIDI note-on, never a timestamped note-off. Store previewOffAtMs = nowMs() + PREVIEW_SEC*1000. In syncInterval, keep the interval needed while previewOffAtMs !== null. In tick(), once nowMs() >= previewOffAtMs, send immediate midi.sendNoteOff for previewKeys and clear both previewKeys and previewOffAtMs. Clear previewOffAtMs in endPreview(), which already sends immediate offs, and in releaseAll(). Call endPreview() at the start of startRun() and beginFollow(), so previewed keys are released before playback strikes them again. The sampler preview can keep its timestamped noteOff, which is voice-scoped and correct."
  },
  {
   "id": "engine:no-release-on-page-unload",
   "verdict": "confirmed",
   "reason": "This is clear from the code, and I demonstrated it in /tmp/verify/t3.mts. A grep of src finds only one pagehide listener (PracticePage.tsx:66), and it only flushes saved settings. There is no beforeunload or visibilitychange handler that touches the session or MIDI. dispose() runs only from the SessionHost React effect cleanup, which does not run on reload or tab close. At +1.5 s into a piece with a 4 s LH chord, keys 48, 55 and 74 have had note-on sent but no note-off yet: the scheduler sends note-offs only 150 ms ahead. If the page dies at that moment, those keys stay down on the digital piano. Neither Web MIDI nor the OS sends note-offs when the page goes away. The AudioContext dies with the page, so only MIDI out is affected. Brief §13 ('Do not leave keys stuck on after ... navigation') and §9 cover this.",
   "refinedFix": "Register a window 'pagehide' listener that calls session.pause() followed by midi.allNotesOff(). It can live in SessionHost's effect next to dispose, or app-wide in services/main for the midi part. midi.allNotesOff() releases every app-sent key, including preview keys when the session is stopped, and sends CC123/CC64. Do not call dispose() unconditionally on pagehide: a page restored from the back/forward cache would be left with a dead session. Dispose only when !event.persisted."
  },
  {
   "id": "engine:loop-seam-gap",
   "verdict": "confirmed",
   "reason": "I reproduced this in /tmp/verify/t4.mts with a 2.0 s passage, loop on and count-in off. Strikes land at 0.050, 2.100, 4.150, 6.200, 8.275, so each repeat lasts 2.050-2.075 s instead of 2.000, for both sampler and MIDI and on both clocks. /tmp/verify/t4b.mts shows the seam is the one place where a main-thread stall is not absorbed. A 120 ms timer stall mid-pass changes nothing, because the lookahead covers it. The same stall at the seam pushes the restart from 2.100 to 2.175. The cause: advanceRun restarts only after a tick sees rel >= duration, then calls startRun(0), which anchors at now + START_LEAD_SEC. Every pass therefore gets an unrequested 50-75 ms or more of extra silence after the final release. That contradicts the brief ('imported musical timing', 'correct duration after the final attack', §16 no drift from busy rendering) and ARCHITECTURE §7 ('Visual work never blocks audio timing'). Count-in is the only pause the brief allows at a loop restart.",
   "refinedFix": "In advanceRun, when settings.loop && !settings.countIn && run.duration > 0 and run.anchor + run.duration <= horizon, chain the next pass inside the lookahead. Build a new Run with anchor' = startAt' = run.anchor + run.duration, startRel 0 and events = buildEvents(times, 0), and dispatch its events in the same horizon. Make it this.run when now >= anchor'. Do not call releaseAll() at a chained seam. buildEvents only keeps presses whose end tick is a step, so every old-run event remaining at the seam is a note-off at or before duration. Those note-offs already release everything before the new pass's strikes, and the sampler and MIDI both order off-before-on at the same instant. Keep the existing release-then-startRun path when count-in is on."
  },
  {
   "id": "engine:late-ticks-burst",
   "verdict": "uncertain",
   "reason": "The behaviour reproduces (/tmp/verify/t5.mts). With the scheduler at 1 Hz, sound off and MIDI out on, eighth notes due at 0.30, 0.55 and 0.80 s are all sent at 1.00 s with past timestamps. Web MIDI plays past timestamps immediately and the sampler clamps them to now, so they sound as a cluster rather than late but in rhythm. The requirement link is weak, though. The brief and the design docs say nothing about hidden or throttled tabs. A tab that is actually playing audio is not throttled to 1 Hz, so the realistic trigger is MIDI-only with browser sound off. The builder report already lists background-tab lateness beyond the 150 ms lookahead as a known limitation. The §16 'rendering busy' angle only applies to main-thread stalls longer than about 125-150 ms, which the lookahead design deliberately does not cover. This is a reasonable robustness improvement, but I cannot show it is a required behaviour.",
   "refinedFix": "If addressed: in advanceRun, before dispatching, check whether the next due event (or click) is already later than a small tolerance (when < now - 0.03 s). If so, call this.reanchor() at the current musical position instead of firing the backlog, so late material is skipped rather than clustered. Optionally widen the lookahead while document.hidden for wall-clock or MIDI-only runs."
  },
  {
   "id": "engine:audio-not-started-for-countin-monitor",
   "verdict": "confirmed",
   "reason": "Both parts reproduce (/tmp/verify/t6.mts). (1) With Sound off, Repeat on and Count-in off, I played and then called updateSettings({countIn:true}). At the loop the status went playing -> count-in 4/3/2/1 -> playing, but ensureStarted was called 0 times and 0 clicks were sent. updateSettings starts audio only for the monitorInput and sound toggles, and advanceRun sends clicks only when run.clock === 'audio'. The builder report says clicks need audio and that play() starts it for count-in, so the toggle path is an oversight. (2) A session built with a restored monitorInput: true (it is persisted per piece in prefs.ts) never starts audio. A MIDI note-on calls sampler.noteOn, which does nothing before a context exists. With the real PianoSampler the state stays 'not-started', no context is created, and snapshot.message is null. No UI text covers 'not-started'. So 'Hear my playing' is silent until some other control starts audio, and nothing explains why. That is the silent failure brief §15 forbids. Follow me's Start button does start audio for monitor (beginFollow), so the gap is monitored input outside a started Follow session.",
   "refinedFix": "(1) In updateSettings, add: if (next.countIn && !prev.countIn && this.run) this.startAudioQuietly(). The Count-in toggle click is a user gesture. tick() already calls reanchor() when pickClock() changes, so the running wall-clock run moves onto the audio clock and the next loop's clicks play. (2) In onMidiEvent, when monitor is on and a note-on arrives while sampler.state === 'not-started', call this.startAudioQuietly() before sampler.noteOn. Chrome and Firefox allow this because the Connect piano click gave the page sticky user activation. Also start audio from the Connect piano click when monitorInput is on: wrap conn.connect in PracticeView to call sampler.ensureStarted() synchronously. As a fallback, set a plain-language message (e.g. 'Click Play or press a step button to hear your playing') if monitored input arrives and the sampler still cannot start."
  },
  {
   "id": "engine:leading-rest-marker-jump",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/verify/t7.mts: LH-only practice where the LH enters after a 2 s rest, so times = [2,3,4]. Stopped, the visual position is 0. Right after play() it is -1.00, then -0.77, -0.52, -0.27, -0.02, reaching 0.05 when C3 sounds at 2.05 s. Throughout the rest the snapshot has stepIndex 0, struck L=[48], expected L=[48] and nothing sounding. The -1 lead-in is intentional and tested (engine.test.ts:273). But it leaves the UI with two different 'current' positions. The marker sits a column left of column 0, over blank space, while column 0 carries is-current/aria-current and the keyboard shows C3 as strong 'press now' 2 s before it sounds. The timeline also snaps back a column on every Play, loop restart or seek to step 0 when there is an opening rest. That contradicts brief §7: one shared clock should drive sound, key highlighting and notation position, and the marker should identify the current action. Count-in already sets the precedent that the marker waits on column 0 while step 0 is shown on the keyboard.",
   "refinedFix": "In positionAt, return 0 when rel < times[0] instead of rel/times[0] - 1. The marker then dwells on column 0 through an opening rest, exactly as it does during count-in. This matches stepIndex 0, the 'current' column, the keyboard and the stopped position, and removes the jump. The stepIndex contract (0..stepCount-1) is unchanged. Update the doc comment and the engine.test.ts 'runs the visual position from -1 to 0 through an opening rest' expectation. Optional: while status is 'playing' and the clock is before times[0], publish empty struck (keeping expected per contract) so 'press now' lights when step 0 actually sounds."
  },
  {
   "id": "engine:no-output-latency-compensation",
   "verdict": "refuted",
   "reason": "The facts are accurate: clockNow('audio') returns sampler.currentTime and no code reads outputLatency, baseLatency or getOutputTimestamp. But nothing requires compensation. APP_CONTRACTS explicitly specifies the clock: 'With sound on, time comes from sampler.currentTime', and 'Listen and Steady events are sent with atMs timestamps converted from the audio clock'. ARCHITECTURE §7 names the AudioContext time as the single shared clock. Brief §7's 'shared playback clock drives sound, key highlighting, and the notation position' is met, since one clock drives all three. Latency is not mentioned anywhere in the brief or the design docs. On typical wired output the lead is a few tens of ms, which is not a visible marker error. The cases that matter are high-latency outputs such as Bluetooth, and running browser sound and MIDI output together, which doubles the sound. Compensating for them would be an enhancement that changes the documented contract, not a defect fix."
  }
 ]
}


===== verify:security-storage-deploy =====
{
 "verdicts": [
  {
   "id": "security-storage-deploy:mxl-lying-header-cpu-bomb",
   "verdict": "confirmed",
   "reason": "Reproduced independently. The size limit in listEntries (src/core/mxl.ts:50-69) only checks the central directory's claimed `originalSize`. readEntry (mxl.ts:120) then calls `unzipSync(bytes, {filter})`. In fflate 0.8.3 that becomes `inflateSync(..., {out: new u8(su)})`, which runs with `st.i == 2` and `resize = false`. Bytes past the buffer are silently dropped, but the whole stream is still inflated. The length and CRC checks (mxl.ts:125-130) only run after that. I built single-entry zips of deflated zeros that declare 1000 bytes (/tmp/verify/mk.mts, mk2.mts) and ran them through extractMusicXmlText (/tmp/verify/run.mts):\n- 261 KB archive (256 MiB real): bad-archive after 561 ms\n- 1.04 MB archive (1 GiB real): bad-archive after 2123 ms\n- 4.17 MB archive (4 GiB real): bad-archive after 38,941 ms\nTime grows faster than linearly, so a 16-20 MB archive under maxArchiveBytes freezes for many minutes, which matches the reviewer's 474 s. The work is synchronous on the main thread: imports.ts:251-252 does `await nextFrame()` and then calls `parseScoreBytes`. The brief requires a readable error here (§12, requirements line 373: \"Handle corrupt ZIPs ... and excessive archive sizes with a readable error\"). docs/dev/app-builder-reports.md:280 already lists this as a known, unfixed gap. I prototyped the fix below in a copy at /tmp/verify/proj. Every bomb, including /tmp/rev/bomb16g.mxl and the 60 MB-declared variant, then failed with bad-archive in 76-450 ms. Typecheck passed and the full suite passed (926/926, catalog comparison included). The bounded reader returned byte-identical output for all 138 entries of the library .mxl files.",
   "refinedFix": "In src/core/mxl.ts, stop calling unzipSync to read entry data; keep it only for listEntries. Steps:\n1. Turn `centralDirectoryCrcs` into `centralDirectory(bytes)`. For each central-directory record, return {name, crc, method (p+10), compressedSize (p+20), originalSize (p+24), dataStart}, where dataStart = localOffset (p+42) + 30 + u16(local+26) + u16(local+28). Return null if:\n   - there is no EOCD, or count === 0xffff, or the CD offset is 0xffffffff;\n   - any of sc/su/offset is 0xffffffff (zip64);\n   - the local header signature is not 0x04034b50;\n   - dataStart + sc > bytes.length.\n2. In readEntry:\n   - Fail closed with bad-archive when the directory is null, or its names and order differ from `entries` (fflate's view). The current code instead skips the CRC check. Keeping zip64 support would mean reading the 0x0001 extra field, which no legitimate file under 20 MB / 60 MB needs.\n   - Find the entry by name. Method 0 means a stored copy. Method 8 means `inflateBounded(bytes.subarray(dataStart, dataStart + compressedSize), originalSize)`. Any other method is bad-archive.\n   - Then keep the existing length check, and the CRC check against the directory's crc.\n3. `inflateBounded` uses fflate's streaming `Inflate`:\n   - Allocate `out = new Uint8Array(limit)`.\n   - The `ondata` callback throws `new ImportError('bad-archive', undefined, 'entry X inflates past its stated size')` as soon as n + chunk.length > limit; otherwise it copies the chunk into `out`.\n   - Push the compressed bytes in 16 KB slices, with `final` on the last slice, inside guardZip.\n   - Return `out.subarray(0, n)`.\nThis caps the work at the declared size (at most 60 MB in total) plus one slice of output. Add a regression test in tests/mxl.test.ts: a zip of about 1 MB whose header lies (deflated zeros declared as 1000 bytes, built in the test with fflate or zlib) must reject with bad-archive in well under a second. Optionally, also move parseScoreBytes into a Web Worker later."
  },
  {
   "id": "security-storage-deploy:xml-literal-section-regex-quadratic",
   "verdict": "confirmed",
   "reason": "Reproduced independently with /tmp/verify/rx.mts. When a bare `&` is present, parseXmlSafely calls lexicalProblem, which runs `text.replace(LITERAL_SECTIONS, '')` (src/core/xml.ts:165,175). Each unterminated `<!--` makes the lazy scan run to the end of the text, so the cost is quadratic. Input was `...&amp` + '<!--'.repeat(n):\n- 20 KB: 33 ms\n- 40 KB: 125 ms\n- 80 KB: 493 ms\n- 160 KB: 1970 ms\n- 320 KB: 11,267 ms\nEvery case ended in malformed-xml. The `<?` variant through the full loadSourceScore path took 1191 ms for 80 KB. Plain XML up to 60 MB is accepted, so far larger stalls are possible. The proposed regex handled 1 MB in 2 ms. It does not change any verdict:\n- Unterminated comments, CDATA and PIs are still rejected as malformed-xml, because xmldom raises a fatalError for each of them (checked), and browsers reject them too. Only the detail string can differ.\n- Old and new regex classify all 69 library scores identically.\n- With the patch applied to a copy of the project, the parser, mxl, storage and fixture tests passed, and so did the full suite (926/926). Severity minor is fair: it needs a damaged or crafted file with many unterminated sections plus a bare `&`.",
   "refinedFix": "In src/core/xml.ts:165, replace LITERAL_SECTIONS with `/<!--[\\s\\S]*?(?:-->|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)|<\\?[\\s\\S]*?(?:\\?>|$)/g`. An unterminated section then consumes the rest of the text in one linear pass. The result is unchanged because xmldom and browsers reject unterminated comments, CDATA and PIs as malformed-xml anyway. Add a regression test in tests/parser.test.ts: parseXmlSafely on `<score-partwise>&amp` + '<!--'.repeat(250000) + `</score-partwise>` (about 1 MB) must throw malformed-xml within a small time bound, for example under 500 ms."
  }
 ]
}


===== verify:ui =====
{
 "verdicts": [
  {
   "id": "ui:shortcuts-swallowed-after-mouse-use",
   "verdict": "confirmed",
   "reason": "I reproduced this in jsdom with the real PracticePage (/tmp/verif/tests/shortcuts.test.ts).\n- Opening More with .click() moves focus to the 'Hear my playing through the browser' checkbox (MoreMenu.tsx:34). A Space keydown is not handled: defaultPrevented=false and shortcutFor returns null.\n- Choosing 'End passage here' moves focus to the 'Measure 3: passage options' button (closeMenu(true) at Timeline.tsx:369/380 is called whatever the input method). Space returns null, the play button stays 'Play' and the step does not change.\n- When '?' had focus as it was opened (Chrome focuses buttons on click), closing Help returns focus to it (Dialog.tsx:94/107). Space then returns null, so the browser activates the button again and Help reopens.\n- With any Mode, Hands or Fit radio, or the Repeat, Sound or Count-in switch focused, Space, the arrows and Home all return null.\n- In Chrome, clicking a label focuses its radio or checkbox before the simulated click (HTMLLabelElement default handler). The browser's own arrow and Space behaviour then changes hands or flips the switch.\n\nThe contract only partly allows this. UI_SPEC says shortcuts apply whenever focus is not in an input, select or textarea, so the focused-button cases (Help, measure label, More) break the spec as written. The radio and checkbox cases are allowed by the wording, but they contradict the builder's stated intent ('so Space and the arrows keep working after clicking', app-builder-reports:348). The Help sentence (HelpDialog.tsx:200, 'only while typing or choosing from a list') is also inaccurate.",
   "refinedFix": "Keep focus off controls after pointer use, and keep keyboard behaviour exactly as it is now.\n(1) Segmented.tsx, the ControlsBar Switch, the Keyboard Fit radios and the More 'Hear my playing' switch: set a ref in the label's onPointerDown. In the input's onClick, call e.currentTarget.blur() when that ref is set, then clear it. Chrome focuses a label's input inside the click default action, so preventDefault on mousedown alone is not enough. A blurred input means focus is no longer 'in an input', so the UI_SPEC rule holds as written.\n(2) Give the Help '?' button, the More button and the timeline .tl__measure button the same onMouseDown={keepFocus} as TransportButton. A mouse-opened dialog or menu then has no button to return focus to.\n(3) Move focus in code only after keyboard activation. MoreMenu should focus its first control only when the More click had e.detail === 0. The Timeline menu items should call closeMenu(e.detail === 0) instead of closeMenu(true). Escape keeps returning focus.\n(4) Reword the HelpDialog note to match the real rule, e.g. 'Shortcuts don't apply while a text box, list or other control you reached with the keyboard has focus.'\nAlternative, more central fix: in shortcutFor, yield Space or arrows to a non-text control (button, radio, checkbox) only when el.matches(':focus-visible'), and keep the text-entry exclusion for text inputs, select and textarea."
  },
  {
   "id": "ui:midi-disconnected-cannot-switch-device",
   "verdict": "confirmed",
   "reason": "I reproduced this with the real MidiManager, a fake MIDIAccess and the real PracticePage (/tmp/verif/tests/midi.test.ts).\n- Connected: chip 'Yamaha P-125', Follow me enabled.\n- After unplugging A and plugging in B ('Digital Piano', a new id and name): the chip still says 'Yamaha P-125', the notice says 'Your piano was disconnected…', no select is shown, and Follow me is disabled. mgr.inputs() lists in-b as connected while the selection stays on in-a.\n- After 'Try again': nothing changes. MidiManager.connect returns at once in the 'ready' state (manager.ts:157), and reconcile only auto-selects when there is no selection or on first connect (manager.ts:346). ConnectPiano shows the select only when live.length > 1 or the phase is 'choose' (ConnectPiano.tsx:18).\n- Control check: the same name coming back with a new id is re-attached correctly. So the trap is limited to a different device name, but the retry button is a no-op in every disconnected case.\n\nUI_SPEC asks for 'disconnected … with a retry', and brief §9 asks for disconnection and reconnection to be handled gracefully.",
   "refinedFix": "(1) ConnectPiano.tsx:18: also render the select in the disconnected phase whenever any connected input exists: `if (live.length > 1 || phase === 'choose' || (phase === 'disconnected' && live.length > 0))`. `inputs` already includes the missing selected device, labelled '(disconnected)', so the user can pick the live one.\n(2) midiConnection.ts connect(): when midi.state === 'ready' and the selected input is not connected, re-pick instead of calling the no-op midi.connect(). If exactly one connected input other than the selected one exists, call midi.selectInput(thatId). Otherwise leave it to the select. An equivalent alternative is to make MidiManager.connect() in the 'ready' state with no attached input run reconcile(true) and emitChange(), so a sole connected input is adopted.\nKeep the existing auto re-attach by id or name."
  },
  {
   "id": "ui:timeline-blank-frame-on-jump",
   "verdict": "confirmed",
   "reason": "I reproduced this in jsdom with the real Timeline, the Minuet sequence (275 steps, whole piece), a viewport width of 1100 and requestAnimationFrame driven by hand (/tmp/verif/tests/blank.test.ts).\n- Steady at position 200: tx -14128, columns 196..211 on screen, 176..231 mounted.\n- After the rAF frame at position 0, both straight after the callback and after the microtask checkpoint (when the browser paints): tx 272, columns 0..11 on screen, still only 176..231 mounted. Zero on-screen columns exist.\n- Only after a macrotask does React commit 0..31.\n\nThe cause is that setWin inside rAF gets DefaultEventPriority, because window.event is undefined there. React schedules that on a scheduler task, not a microtask, so the transform written at Timeline.tsx:201 is painted before the matching columns mount. Any jump larger than the overscan of 20 columns (Home, Restart, loop restart on a long passage) flashes empty instruction rows for at least one frame.",
   "refinedFix": "In Timeline.tsx render(), compute `next` before writing the transform. When it is called from the rAF loop (not the initial render() inside the layout effect, where flushSync warns), and the new visible range is not covered by winRef.current (a jump beyond the overscan), set winRef.current = next and call flushSync(() => setWin(next)) from 'react-dom' first. Only then set strip.style.transform. Keep the async setWin for small, overlapping window changes."
  },
  {
   "id": "ui:measure-menu-unclamped",
   "verdict": "confirmed",
   "reason": "This is unambiguous from the code, and I checked it in jsdom with stubbed rectangles (/tmp/verif/tests/menu.test.ts).\n- openMenu clamps only the left edge (Timeline.tsx:234). With .tl at x=28 (1280px window, 28px page padding) and a measure label at x=1200, the menu gets left 1172px. Its right edge is at page x 1390 with the 190px min-width, about 110px past a 1280px window.\n- No ancestor clips it: .tl has overflow: visible, and .ps-main and .ps-page have no overflow rule. So the menu runs off-screen and widens the page.\n- After the position moved 50 steps (3600px of strip movement), the menu was still open at the same left. It never follows its label or closes during playback.",
   "refinedFix": "In Timeline.tsx, add a useLayoutEffect on `menu` that measures menuRef.current.offsetWidth and clamps the position: left = Math.max(0, Math.min(menu.left, rootRef.current.clientWidth - width)). Alternatively, right-align the menu with the trigger when it would overflow. Also close the menu (closeMenu(false)) when the strip position changes from where it was opened, or when the trigger is disconnected. This can be checked in the rAF render() via menuState.current."
  },
  {
   "id": "ui:about-dialog-focus-lost",
   "verdict": "confirmed",
   "reason": "I reproduced this in jsdom with the real PracticePage (/tmp/verif/tests/shortcuts.test.ts, 'about from More').\n- Focus before opening: 'About this arrangement'.\n- Focus in the dialog: 'Close'.\n- Focus after closing: body.\n\nsetOpen(false) and onOpenAbout() are batched into one commit, so the focused panel button is removed before Dialog's useLayoutEffect reads document.activeElement (Dialog.tsx:94). The opener is therefore <body>. The native showModal path reads the same activeElement, and its own focus restore also goes to body, so Chrome behaves the same.",
   "refinedFix": "In MoreMenu.tsx, in the About button's onClick, call buttonRef.current?.focus() before setOpen(false) and onOpenAbout(). The Dialog then records the More button as its opener and returns focus there on close. The panel's onBlur does not close it, because the More button is inside rootRef. Alternatively, add a returnFocusRef prop to Dialog and pass the More button."
  },
  {
   "id": "ui:soft-highlight-contrast",
   "verdict": "refuted",
   "reason": "The contrast numbers are correct: #bbf7d0 against white is about 1.21:1 and #ddd6fe is about 1.39:1. But the behaviour is not a requirement violation.\n- UI_SPEC's colour table prescribes exactly --rh-soft #ddd6fe and --lh-soft #bbf7d0 for 'held-but-not-just-struck'. The implementation follows that contract.\n- UI_SPEC also requires 'a small R or L letter on highlighted keys, so colour is not the only cue'. Keyboard.tsx renders that letter on soft-lit keys too: dark --fg #111827, weight 800, white halo. So the held state is carried by high-contrast text as well as the tint.\n- Because of that redundant cue, WCAG 1.4.11's 3:1 rule does not strictly apply to the fill. Brief §16's 'readable contrast' is met for the text on these fills.\n- The claim that the learner 'can't see which keys to keep holding' is not established.\n\nA hand-coloured outline on soft keys would be a reasonable design improvement, but it would change the documented colour contract and is not a defect fix."
  },
  {
   "id": "ui:raw-implicit-measure-labels",
   "verdict": "confirmed",
   "reason": "I reproduced this with npx tsx (/tmp/verif/s/labels.mts) on public/scores/The_Entertainer_-_Scott_Joplin_-_1902.mxl.\n- The prepared measures have labels '35:X1 67:X2 115:X3 151:X4', in a sequence like '19 (2nd time) | X1 | 21'.\n- The raw XML has <measure number=\"X1\" implicit=\"yes\">. That is MuseScore's id for a measure left out of the count, which MusicXML does not print.\n- displayNumber() returns m.number.trim() unchanged (performance.ts:116-118). That label feeds the From/To selects (ControlsBar.tsx:249-252), the timeline measure buttons and aria-labels (Timeline.tsx:302), and the status line 'Measure X1' (StatusLine.tsx:13).\n- The piece is in the shipped catalog (id the-entertainer-scott-joplin-1902; readiness 'review' but loadable).\n\nShowing a source-internal id in normal practice flows goes against brief §16.",
   "refinedFix": "In src/core/model/performance.ts, work out display numbers per written measure once. In toOccurrences, and in the warning paths at :325 and :517 that call displayNumber, use m.number.trim() only when it starts with a digit. Otherwise (for example 'X1', usually with implicit=true), derive a readable label from the nearest preceding written measure with a numeric number, e.g. `${prev}a` ('19a'). Fall back to String(m.index + 1) when no numbered measure precedes it. occurrenceLabel's '(2nd time)' suffix logic stays the same. Also update the SourceMeasure.number doc comment, which cites 'X1' as a display value."
  },
  {
   "id": "ui:keyboard-svg-title-tooltip",
   "verdict": "confirmed",
   "reason": "Keyboard.tsx:337-339 gives the outermost inline <svg role=\"img\"> a <title> child, which holds the live summary ('Keyboard from … Right hand: C4 (press now)…').\n- Chromium's SVGElement::title() returns the first <title> child's text for any SVG element. It only skips the outermost <svg> of a standalone SVG document, not inline SVG in HTML.\n- HitTestResult::Title walks up from the hovered key <path> to the <svg>, so a native tooltip with this text appears anywhere over the keyboard. Firefox behaves the same.\n- The text changes every step, while the tooltip only refreshes on mouse movement, so it can show earlier keys.\n\nThis is a known platform behaviour, but I could not check it in a browser (I was told not to use browser tools). Whether the tooltip is stale was not verified.",
   "refinedFix": "In Keyboard.tsx, remove the <title> element. Name the SVG with aria-label={`Keyboard from ${lowLabel} to ${highLabel}. ${summary}.`}. Alternatively, keep aria-labelledby={titleId} but point it at a visually hidden HTML element outside the <svg> (e.g. <span id={titleId} className=\"kb-sr-only\">…</span>). The spoken summary stays and there is no hover tooltip."
  }
 ]
}


===== verify:music =====
{
 "verdicts": [
  {
   "id": "music:cross-staff-voice-majority-misassigns-hands",
   "verdict": "confirmed",
   "reason": "Reproduced all three cases with my own scripts (/tmp/v/f1a.mts, f1b.mts, f1d.mts).\n(1) In Prlude_No._4_in_E_Minor_Op._28_-_Frdric_Chopin.mxl (MuseScore 3.6.2), voice 2 has all 9 of its notes on staff 2, and the XML draws them with stems up against voice 5's stems down. That is MuseScore's cross-staff RH chord. The majority rule gives them to L: m24 L=[B1 B2 E3 F#3 B3] while R=[E4]; m25 L=[E1 E2 E3 G3 B3]. prepareScore gives readiness 'ready' with only pedal and grace warnings, and catalog.json also lists the piece as 'ready'.\n(2) In Moonlight 3rd, v6 is split 32/32, so home is staff 1 and all 64 notes go to R. In m164 that puts an A#1 in the RH at @780, the same moment as the LH's voice-5 A#1, and again at @960 together with RH C#3-C#4. In m13 the RH gets G#3 eighths. The piece is 'review', but the warning's 20-measure list stops at m90, so m164 is never named.\n(3) Voice '1' on both staves, or <voice> omitted: every press is R ('RC3@0 RE5@0 ... RG2@96'), and Left-hand-only mode has 0 steps.\nI also found a 4th library file the majority rule gets wrong: in the other Chopin E-minor Prelude edition, m16's RH turn figure B4-A#4-A4-A#4 (voice 2, staff 1) goes to L. Brief §12 requires cross-staff voices to be supported correctly or labelled, and case (1) is neither. All 69 library files are MuseScore exports. ScoreOverrides only maps whole staves, so no override can fix this.",
   "refinedFix": "Replace both duplicate whole-piece-majority homeStaves functions (parse.ts:123-145 and performance.ts:401-423) with one shared helper. Example: src/core/voices.ts exporting `voiceHomeStaves(notes, stavesOf: (partId) => number, software: string | null): Map<SourceNote, number>`.\nRules:\n(A) If `software` matches /musescore/i and the voice is an integer v >= 1 with ceil(v/4) <= the part's staff count, home = ceil(v/4). MuseScore exports voices 1-4 for staff 1 and 5-8 for staff 2, and a cross-staff note keeps its original voice.\n(B) Otherwise, group notes by (part, voice, measureIndex):\n- If the group uses only one staff, home = the drawn staff.\n- If the voice sounds on two staves at once (overlapping non-grace notes on different staves that are not a single chord split across staves, i.e. the same onset and duration), the file reuses voice numbers per staff. Use home = the drawn staff.\n- Otherwise, home = the staff with most of the group's notes, ties going to the lower staff.\nThen, in parse.ts buildNotes (pass meta.software and each part's staves), set crossStaff = (home.get(n) !== n.staff). In performance.ts handOf, use `mapping.staffHands[`${partId}:${home.get(n) ?? n.staff}`] ?? drawn`.\nI prototyped this in a copy (/tmp/v/proj). It fixes all four library files: the Chopin Prelude in both editions (m16, m24, m25), Moonlight 3rd voice 6, and Mariage d'Amour m81, whose v6 LH arpeggio currently goes to R. The voice-1 import now maps staff 2 to L. No other library file changes. typecheck passes, and 924 of 926 tests pass. The two failures are pinned expectations that must change on purpose: the e2e.library counts go from 49 ready / 20 review to 48 / 21, because the Chopin Prelude now gets a cross-staff-notes review, and the committed catalog must be regenerated with scripts/build-catalog.ts.\nAlso:\n- Update the cross-staff paragraph in ARCHITECTURE.md and the builder-report known gaps.\n- Add regression tests: Chopin m24/m25 upper chord goes to R, Moonlight 3rd m164 A#1 goes to L, voice-1-on-both-staves goes to L, and the existing ScoreBuilder voice-5 test still passes."
  },
  {
   "id": "music:three-staff-part-ossia-replaces-main-rh",
   "verdict": "confirmed",
   "reason": "Reproduced with my own file (/tmp/v/f2.mts). It has 3 staves; staff 1 is hidden with print-object=\"no\" and holds only an ossia note in m2 next to 'ossia' words; staff 2 is the main RH; staff 3 is the LH. The parser reports hiddenStaves=[1] and words=['ossia'], but mapSinglePart (hands.ts:82-93) still maps P1:1 to R and P1:3 to L. The resulting presses are `LC3@0 RG5@192 LD3@192 LE3@384`: the main RH notes E5/F5/A5 are gone and only the ossia's G5 plays. hiddenStaves is collected but never read in src. The piece is flagged 'review', but the only message says 'the middle staff is left out', which hides that the main melody is the part being dropped. ARCHITECTURE rule 4 does prescribe 'staff 1 -> R, lowest -> L'. However, brief §10 names the ossia as the concrete test case for avoiding alternative playback and forbids mapping staves without inspecting the structure. Playing the ossia instead of the main RH breaks that intent.",
   "refinedFix": "In hands.ts, give mapSinglePart the source (`mapSinglePart(source, part, bag)`, updating both callers). For staves >= 3:\n- Count pitched notes per staff from source.notes for that part.\n- usable = staves that have notes and are not in part.hiddenStaves.\n- L = the lowest usable staff.\n- R = the usable staff above it with the most notes (ties go to the upper staff).\n- Fall back to 1 and part.staves when nothing is usable, so the current behaviour and wording stay for the ScoreBuilder test with no notes.\nWhen the result differs from 1/lowest, keep source 'unclear' and the 'unclear-hand-mapping' review. The message should name the staves left out and say they are hidden, empty or much less busy, as an ossia would be.\nI prototyped this in /tmp/v/proj. The repro now presses RE5 RF5 RA5 with LC3 LD3 LE3. The full suite passes except the two expected finding-1 pins, and typecheck passes.\nAdd a fixture for an in-part hidden ossia staff, and update ARCHITECTURE hands rule 4."
  },
  {
   "id": "music:multi-part-picks-first-two-staff-part",
   "verdict": "refuted",
   "reason": "The behaviour reproduces (/tmp/v/f3.mts): with an unnamed 8-note 2-staff P1 and an 80-note 'Piano' P2, the app uses P1 and leaves out P2. But this is exactly what the documented contract says (ARCHITECTURE hands rule 6: 'choose the first two-staff part'). It also meets the brief's only requirement for this case (§10: multiple instruments or unclear alternatives need review). Readiness is 'review' with two messages, 'Only an unnamed part is used for practice.' and '“Piano” is left out.', so the claim that the piece is 'silently replaced' is false. The scenario needs a 2-staff alternative part that is unlabelled (no ossia/alternat text), has at least 3% of the notes and comes first, so it is contrived. Picking the part with the most notes instead is not clearly better either: in piano duets it would often pick the Secondo over the Primo. This is at most an optional heuristic tweak, such as preferring a part whose name matches /piano/ or treating a two-staff part with far fewer notes as an alternative. Neither the brief nor the contracts require it."
  },
  {
   "id": "music:tempo-after-skip-uses-skipped-written-tempo",
   "verdict": "confirmed",
   "reason": "Reproduced with my own MusicXML (/tmp/v/f4.mts).\nCase A: m1 has ||: and 120; m2 is the 1st ending with 60 at beat 3 and :||; m3 is the 2nd ending; then m4. The order is 1|2|1|3|4 and the points are [{0,120},{288,60},{384,120},{576,60}]. The 2nd ending and m4 play at 60 because writtenTempoBefore(m3.startTick) picks up the mark from the skipped 1st ending. Listen times are 0,2,3,5,7,11,15 where they should be ...,7,9,11.\nCase B: a pickup with no mark, m1 at 120 with Fine, m2 with 40 and D.C. al Fine. On the return, writtenTempoBefore(0) is null, so the pickup plays at 40 (1.5 s instead of 0.5 s), against the documented rule 'If the first tempo is after tick 0, it also applies from 0'.\nThis breaks §8 'use source tempo changes'. No library file is affected: I compared all 69 tempo maps and none change with the fix below.",
   "refinedFix": "In buildTempoMap (performance.ts:346-369), replace writtenTempoBefore with performance-order state:\n```ts\nlet current = tempos[0].qpm; // first tempo applies from 0\nconst entryQpm = new Map<number, number>(); // tempo when each measure was first entered\noccurrences.forEach((o, k) => {\n  const m = source.measures[o.measureIndex];\n  const continuous = k > 0 && occurrences[k - 1].measureIndex === o.measureIndex - 1;\n  if (!continuous) {\n    // back-jump (repeat/D.C./D.S.): resume at the measure's entry tempo;\n    // forward skip (later ending/To Coda): keep the tempo in force — skipped marks never sounded\n    current = entryQpm.get(o.measureIndex) ?? current;\n    raw.push({ tick: o.startTick, qpm: current });\n  }\n  if (!entryQpm.has(o.measureIndex)) entryQpm.set(o.measureIndex, current);\n  for (const t of byMeasure.get(o.measureIndex) ?? []) {\n    raw.push({ tick: o.startTick + (t.tick - m.startTick), qpm: t.qpm });\n    current = t.qpm;\n  }\n});\n```\nThe merge, unshift and compact steps stay as they are. I prototyped this in /tmp/v/proj. Case A becomes [{0,120},{288,60},{384,120}] and case B returns to 120 at the D.C. All 926 tests pass, typecheck passes, and no library tempo map changes. Add both cases to tests/model.tempo.test.ts."
  },
  {
   "id": "music:ending-plus-forward-repeat-measure-dropped",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/v/f5.mts) with measures [1 ||:], [2 1st ending :||], [3 2nd ending + ||:, closed with type discontinue or stop], [4 :||], [5]. unrollMeasures gives `1 2 1 4 4 5` and no warning, so measure 3 never sounds. Cause in simulate() (performance.ts:231-249): the forward repeat resets sectionPass to 1 before the ending check, so ending [2] is skipped. The skip then moves sectionStart to m4, so the second section repeats from the wrong bar. A second problem appears once that is fixed: the 'final ending closes the section' branch (line 281) would move sectionStart past the ||: measure. No library file has this combination (scanned all 69), so only imported files are affected. Brief §12 says 'Common repeats and endings, or a clearly reported limitation', and this measure is dropped silently.",
   "refinedFix": "In simulate():\n1. At the top of the loop, take `const arrived = arrivedByRepeat; arrivedByRepeat = false;`.\n2. Run the ending check before the forward-repeat reset. Guard it with `if (entering && !(arrived && m.repeatForward && i === sectionStart))` and use the enclosing section's pass. A measure you come back to through its own ||: is always played.\n3. Only after the ending check (and its skip/continue), apply `if (m.repeatForward && !arrived && !jumped) { sectionStart = i; sectionPass = 1; }`.\n4. In the post-push branch, change `else if (span && span.end === i && span.lastInGroup)` to also require `!(sectionStart >= span.start && measures[sectionStart].repeatForward)`. That way a ||: inside the final ending keeps the new section's start.\nI prototyped this in /tmp/v/proj. Case L gives `1 2 1 3 4 3 4 5`. All 926 tests pass, typecheck passes, and no library playing order changes. Add case L to tests/model.repeats.test.ts."
  },
  {
   "id": "music:roundtrip-baseline-not-independent",
   "verdict": "refuted",
   "reason": "It is true that roundTrip builds its expected events from seq.presses, which clipPresses produced. But that is the documented contract: ARCHITECTURE's `roundTrip(seq)` compares interpretCells(steps) against eventsFromPresses(presses), and the suggested API change would break it. §17's independence requirement is about the interpreter, which is separate. tests/actions.roundtrip.test.ts checks that interpret.ts does not import derive.ts and reads only tick/cells. The baseline is the passage's model presses, i.e. the normalized source events for that passage. The claim that clipping or hand-filter regressions slip past every fixture test is false. I mutated a copy of the project and ran the full suite:\n- Dropping carried presses in clipPresses failed 8 tests, including e2e.fixtures f10's exact-notation check, the clipPresses unit tests, the deriveSteps fixtures, timing and engine.\n- Removing the clipPresses hand filter failed 3 actions.derive tests. It does not change the notation at all, because deriveSteps skips hands that are not included.\nClipping and hand filtering are therefore covered by explicit tests outside the round trip. Building a second clip from PreparedScore.presses in an e2e helper is an optional extra, not a gap the brief requires closing."
  }
 ]
}


===== fix:catalog-deploy =====
Both items are fixed. `tests/catalog.test.ts` passes (34/34) after `npm run catalog`, and the typecheck shows no errors in `scripts/` or `tests/`. The new data test failed before the fix with 9 findings.

**queued:override-reasons: fixed**
- **Reasons reworded.** All four `overrides.reason` texts in `catalog/metadata.json` are now plain language: Chopin Ballade No. 1, G Minor Bach, Schubert Serenade and The Entertainer. None mentions P1/P2 or a file name. For example: "The second piano part (named “Grand Piano”) only holds an optional alternative version of one chord in measure 7, so it is left out…"
- **Technical detail kept.** The original wording (part ids, clef counts, the other file's name) moved to a new curator-only field, `overrides.evidence`. It is never copied into `catalog.json`; it appears in a new "Hand overrides" section of `docs/CATALOG_REPORT.md`.
- **Notes reworded.** Three notes said "The file name says …". They now read like "The MuseTrainer library lists it as "C Minor"; the piece is in C-sharp minor" (Liebestraum, Nocturne No. 20, Waltz Op. 64 No. 2).
- **Root cause.** The build script had no check on this text. It now has `INTERNAL_WORDING`, `internalWording()` and `wordingProblems()`. These check every curated field the app shows: title, composer, arrangement, attribution, licence note, override reason, notes, difficulty note and source name. Any part ids, `.mxl`/`.musicxml` names or "file name" wording appear under "Data checks" when `npm run catalog` runs. `parseMetadata` now rejects a `reason` or `evidence` that isn't a string.
- **Docs.** `docs/ARCHITECTURE.md` now says the reason is plain language and describes `evidence`. I also fixed its stale "overrides.json" line, which now says metadata.json. In `docs/dev/app-builder-reports.md` the open item is marked as fixed.

**queued:difficulty-wording: fixed**
- In `catalog/difficulty.json`, Carol of the Bells (easy piano) now reads "The arrangement’s published title says “easy piano”."
- Für Elise (Easy Piano) now reads "The score’s subtitle says “Easy Ver.”, and the MuseTrainer library lists it as “Easy Piano”."

**Files changed:**
- `/Users/gapp/Desktop/Piano/catalog/metadata.json`
- `/Users/gapp/Desktop/Piano/catalog/difficulty.json`
- `/Users/gapp/Desktop/Piano/scripts/build-catalog.ts`
- `/Users/gapp/Desktop/Piano/tests/catalog.test.ts`
- `/Users/gapp/Desktop/Piano/docs/ARCHITECTURE.md`
- `/Users/gapp/Desktop/Piano/docs/dev/app-builder-reports.md`
- Regenerated: `/Users/gapp/Desktop/Piano/src/catalog/catalog.json`, `/Users/gapp/Desktop/Piano/catalog/inventory.json`, `/Users/gapp/Desktop/Piano/docs/CATALOG_REPORT.md`

**Tests added (all in `tests/catalog.test.ts`):**
- "shows no part ids, file names or "file name" remarks in curated text": runs `wordingProblems` on the committed `catalog.json` and checks no entry carries `evidence`.
- "flags part ids, score file names and "file name" remarks, and nothing else": unit test of `internalWording`, including text it must leave alone ("Op. 23", "S. 541/3", "PianoVoorslagen").
- "reports every curated field of an entry that would show internal wording": unit test of `wordingProblems`.
- "keeps the curator's override evidence out of the catalog entry": unit test of `buildEntry`.
- "accepts a string evidence next to the override reason and rejects other types": unit test of `parseMetadata`.

**Notes for the orchestrator:**
- **Catalog needs one more regeneration.** Someone else changed `src/core/voices.ts` (03:59) after my first catalog run, so I ran `npm run catalog` again. That edit changed the catalog:
  - Ready dropped from 47 to 46.
  - Note counts changed for Mariage d'Amour and Moonlight 3rd movement.
  - The duplicate pick for Prélude Op. 28 No. 4 flipped: `prlude-opus-28-no-4-in-e-minor-chopin` is now kept and `prlude-no-4-in-e-minor-op-28-frdric-chopin` is left out.

  This also makes `tests/e2e.library.test.ts` fail ("counts: 49 ready, 20 review" now gets 48/21). Please run `npm run catalog` once the core fixers are done.
- **Other failures aren't mine.** `tests/engine.test.ts` and typecheck errors in `src/engine/session.ts` (`hasAttacks`, `livePass` missing) come from another fixer's work in progress.
- **Possible UI follow-up (not my area).** For a hand-assignment override (Schubert, Entertainer), "About this arrangement" shows the same reason twice: in the Hands section and in "What the app noticed".


===== fix:runtime =====
I fixed 10 of the 12 items. One (the reconnect dead end) needs UI changes outside my area, and one is the same bug as another item, so it is fixed with it.

`npx tsc --noEmit -p tsconfig.json` passes. The full suite has 1061 of 1062 tests passing. The one failure is `tests/e2e.library.test.ts` ("counts: 49 ready, 20 review"), which imports only core modules that other fixers are changing. I ran the new tests against a copy of the original `session.ts`/`manager.ts` and each fails there for the reported reason.

Files changed: `src/engine/session.ts`, `src/midi/manager.ts`, `tests/engine.test.ts`, `tests/midi.test.ts`, `tests/helpers/fakes.ts` (added `FakeClock.stall(ms)` to simulate a busy main thread; only `engine.test.ts` uses this helper). `src/audio/**` is unchanged.

| id | Result | What changed | Tests added (in `tests/engine.test.ts` unless noted) |
|---|---|---|---|
| engine:midi-out-stale-queue-no-clear | fixed | MIDI output now has its own 40 ms lookahead (`MIDI_LOOKAHEAD_SEC`, below the 50 ms start lead) with a separate cursor; the sampler keeps 150 ms. A new run starts after anything still queued (`midiQueuedUntilMs`). Without `clear()`, `allNotesOff` now also sends All Notes Off again 1 ms after the last queued message. | "MIDI output on a port that cannot clear its queue": a real `MidiManager` and a simulated device port without `clear()`, covering pause/stop/dispose, restart, seeks and speed changes; plus two `allNotesOff` tests in `tests/midi.test.ts` |
| engine:midi-preview-noteoff-cuts-playback | fixed | The preview sends only its note-on to the MIDI output. The note-off is sent by the timer when due (`previewOffAtMs`), never queued ahead. Any pending preview is released before playback starts. | "MIDI output previews": play straight after next(), repeated same-key previews, no queued note-off, Stop |
| traceability:stale-preview-noteoff-midi-out | fixed | Same fix as the previous row. | Same tests |
| engine:no-release-on-page-unload | fixed | The session listens for `pagehide` itself (new optional `SessionDeps.pageEvents`, default `window`), pauses and releases everything. It does not dispose, so a page restored from the back/forward cache still works. The listener is removed on `dispose`. | "Page hide": Listen with MIDI out, pending preview plus monitored notes, Follow me, default `window` |
| engine:loop-seam-gap | fixed | With loop on and count-in off, the next pass is scheduled inside the lookahead, anchored exactly at the passage end, with no release-all and no start lead. With count-in on, it releases and counts in as before. | "Loop without count-in": exact 2.000 s repeats on sampler and MIDI, a 110 ms stall just before the seam, marker, pause or seek just before the seam, count-in path |
| engine:audio-not-started-for-countin-monitor | fixed in the engine | Turning count-in on during playback starts audio. A monitored note-on while audio is not started starts it; if that fails, a new message `SESSION_MESSAGES.monitorNoSound` is shown. | "Starting browser audio" (3 tests) |
| engine:leading-rest-marker-jump | fixed | The marker stays on column 0 through an opening rest, matching the reported step and the stopped position. | Updated the opening-rest test |
| follow-midi:follow-prev-stuck-on-release-only | fixed | In Follow me, Previous/Next skip steps with nothing to strike, in the direction of travel. The rule matches the matcher, including its new "beyond the 88 keys" rule. | "Follow me transport": while waiting and while paused |
| follow-midi:follow-loop-gap-transport | fixed | During the loop gap, the play button and `play()` restart at step 0 at once. Start after a pause or disconnect in the gap begins at step 0. | "during the loop gap" (4 tests) |
| follow-midi:releaseall-cuts-monitored-input | fixed | In Follow me, the loop restart, pause and sound/hands/range/output changes no longer cut the learner's own browser notes; the MIDI output is still released. Stop, mode change, disconnect, dispose and page hide still release everything. | "Follow me keeps the learner's own monitored notes" (3 tests) |
| follow-midi:echo-guard-drops-real-noteoff | fixed (`src/midi/manager.ts`) | A note-off is treated as an echo only if it pairs with an echoed note-on that was dropped. The player's own release always gets through. The count resets when the input changes. | 3 echo-guard tests in `tests/midi.test.ts` |
| follow-midi:midi-reconnect-dead-end | not fixed | The fix is in UI files I don't own (see below). The manager rule that a missing selected input is waited for stays as it is. | — |

Behaviour you should know about:
- **Stray strike after Pause/Stop:** on Chrome/Edge (no `clear()`), a note already due within about 40 ms of the press can still sound, released 1 ms later. This used to be up to 150 ms.
- **Repeat switched off at the very end:** if Repeat is turned off in roughly the last 0.15 s of a pass, the next pass has already been scheduled and plays once more, then stops. Earlier than that, it stops at the end as before.
- **Count-in turned on during silent playback:** the run moves onto the audio clock once, so notes held at that moment are struck again on the MIDI output. (Resolved in the next fix round: the run now moves onto the audio clock in place, with no release and no MIDI re-strike; see ARCHITECTURE §7.)
- **Optional leading-rest part:** I did not do the optional part of the leading-rest fix (hiding "press now" keys during the opening rest). It would change what the snapshot's struck keys mean in the contract.

Changes needed outside my area:
- **Reconnect dead end:**
  - `src/ui/practice/ConnectPiano.tsx` should show the input select when `live.length > 1 || phase === 'choose' || (phase === 'disconnected' && live.length > 0)`.
  - In `src/ui/practice/midiConnection.ts`, "Try again" should, when the saved-name lookup fails and nothing is connected, select the only connected input if there is exactly one.
- **Optional UI:** the Connect piano click could also start audio when "Hear my playing" is on. The engine fix already covers this through the page's earlier click.
- **No UI change needed** for page unload, the play button, or the timeline.
- **Docs:**
  - `docs/APP_CONTRACTS.md` Engine section: the new optional `pageEvents` dep, the 40 ms MIDI lookahead, the seamless loop when count-in is off, the preview release sent when due, the Follow me exception to "No stuck notes", release on page hide, the marker staying at 0 before the first step, Follow Previous/Next skipping, and Start during the loop gap.
  - `docs/ARCHITECTURE.md` §5: the echo-guard pairing rule and the extra All Notes Off.
  - `docs/ARCHITECTURE.md` §7: the two lookaheads and the loop restart.
  - `docs/dev/core-builder-reports.md`: the echo-guard sentence "Records are not used up by a match".
- **Core suggestion:** the core owner could add a public `FollowMatcher` method that says whether it waits on a step. The engine currently copies that rule into `PracticeSession.hasAttacks`.


===== fix:ui =====
Everything I own is fixed except one item, `traceability:difficulty-title-word-shown-as-rating`, which has no UI fix: it needs changes to the catalog data and build script. Typecheck is clean. The full suite has 1064 passing and 1 failing (1065 tests). The failure is `tests/e2e.library.test.ts`, "counts: 49 ready, 20 review, none unsupported". It counts readiness from `prepareScore` in core, so it comes from another fixer's concurrent core changes. Nothing in my area touches it.

I checked that the new tests fail without the fixes. I briefly undid each main fix in place, saw the matching tests go red, then put the fix back: the flushSync jump, the menu clamp and follow, the MIDI re-pick and list, the pointer-focus helpers, and the About focus step.

New shared helper: `/Users/gapp/Desktop/Piano/src/ui/common/pointerFocus.ts`. It holds `keepFocusOnMouse` (moved out of ControlsBar and Timeline), `isKeyboardClick` (true when `e.detail === 0`), `usePointerRelease` for radios, checkboxes and selects, and `releaseAfterDrag` for sliders.

**ui:shortcuts-swallowed-after-mouse-use — fixed**
- Mouse or touch use no longer leaves focus on a control; keyboard use behaves as before.
- Radios, switches and sliders (Mode, Hands, Fit, Repeat, Sound, Count-in, "Hear my playing", Speed, Seconds per step) drop focus after a pointer change.
- I went beyond the listed files in a few places, for the same reason:
  - Selects (From/To, the piano list, the MIDI output list) drop focus after a mouse choice.
  - The `?`, More, About, measure-label, Whole piece, Reset, Connect piano and Try again buttons, and the Popover ⓘ button, no longer take focus on a mouse click. The ⓘ change also applies on the library page.
- More opened with the mouse no longer moves focus into the panel. Esc returns focus to More only if focus was inside the panel.
- Measure menu:
  - Opened with the mouse, focus goes to the menu itself, not its first item. Otherwise Space would silently pick "Start passage here" with no visible focus.
  - Choosing an item returns focus to the measure label only after keyboard use.
  - **Departure from the suggested fix:** Esc returns focus to the label only if the menu was opened from the keyboard.
- Help text now reads: "Shortcuts don’t apply while a dialog or menu is open, or while a control you moved to with the Tab key is highlighted…"
- `Dialog.tsx` and `shortcuts.ts` are unchanged.
- Files: pointerFocus.ts, Segmented.tsx, ControlsBar.tsx, MoreMenu.tsx, ConnectPiano.tsx, PracticePage.tsx, Keyboard.tsx, Timeline.tsx, notation.css, Popover.tsx, HelpDialog.tsx.
- Tests: `tests/practice.focus.test.ts` (19). These include keyboard-path tests showing the old behaviour is kept.

**ui:midi-disconnected-cannot-switch-device — fixed**
- When the chosen piano is disconnected and any other input is connected, the piano list is shown, with the old piano marked "(disconnected)".
- "Try again" now re-picks through a new `fallbackInput()`: a connected input with the remembered name first, otherwise the only other connected input. It is no longer a no-op.
- New notice text when other devices exist ("…or choose your piano from the list"). The single chip now shows a visible "disconnected".
- Files: ConnectPiano.tsx, midiConnection.ts, practice.css.
- Tests: `tests/practice.midi.test.ts` (5), using the real MidiManager with a fake Web MIDI access.

**ui:timeline-blank-frame-on-jump — fixed**
- `render(fromFrame)` now works out the new column window first. On a jump past the rendered columns it commits them with `flushSync` before moving the strip. Small moves stay async; the first render inside the layout effect never uses flushSync.
- File: Timeline.tsx.
- Tests: `tests/timeline.behaviour.test.ts` (jump test and small-move test).

**ui:measure-menu-unclamped — fixed**
- The menu is measured after mount and kept inside the timeline using a new pure `menuLeft()` in timelineWindow.ts.
- **Departure from the suggested fix:** it follows its label each frame instead of closing as soon as the strip moves, which would make it unusable during playback. It closes when the label leaves the visible timeline or is no longer rendered.
- Files: Timeline.tsx, timelineWindow.ts.
- Tests: `tests/timeline.behaviour.test.ts` (clamp, follow-then-close, `menuLeft`).

**ui:about-dialog-focus-lost — fixed**
- About activated from the keyboard first moves focus to More, so closing the dialog returns focus there. After a mouse click focus is left alone.
- File: MoreMenu.tsx.
- Test: in practice.focus.test.ts.

**ui:keyboard-svg-title-tooltip — fixed**
- The SVG `<title>` is gone; the keyboard is named with `aria-label` (same summary text).
- File: Keyboard.tsx.
- Test: in `tests/practice.labels.test.ts`.

**traceability:difficulty-title-word-shown-as-rating — not fixed (outside my area)**
- The badge texts are right if the data is right, and the contract is to stay unchanged, so there is no UI change to make.
- Catalog owner needs to:
  - Make Carol_of_the_Bells_easy_piano, Greensleeves_for_Piano_easy_and_beautiful and Nocturne_in_E-flat_Major_Op._9_No._2_Easy "Unrated" with basis none, and delete the uncited Greensleeves sentence.
  - Add a check in build-catalog that an in-file label really appears in the file's credits.
  - Rename the MuseScore sourceName.
  - Consider making Prelude BWV 846 Unrated.
  - Regenerate the catalog and its report.

**traceability:default-tempo-not-labelled-in-practice — fixed in my area; library card needs one build change**
- When the file has no tempo:
  - The Listen slider is read out as "…of the app’s default speed (the file gives no speed)".
  - A note under it says "No speed is written in this file, so 1× is the app’s default: 120 quarter notes a minute."
  - The About dialog's Length row says "at the app’s default speed".
- Imported pieces now store an optional `tempoDefaulted` flag, and their library card shows "at default speed".
- Built-in cards read `entry.stats.tempoDefaulted` when present. Until build-catalog and `src/core/types.ts` add that field and the catalog is regenerated, built-in cards show no qualifier.
- Files: ControlsBar.tsx, text.ts, PracticePage.tsx, diagnostics.ts, DiagnosticsDialog.tsx, LibraryCard.tsx, library.css, practice.css, src/storage/imports.ts.
- Tests: in practice.labels.test.ts.

**queued:select-names — fixed**
- The passage lists have `aria-label` "From measure" and "To measure". File: ControlsBar.tsx. Test in practice.labels.test.ts.

**queued:help-inline-token — fixed**
- The carried G3 example is now an inline token on the text baseline instead of a boxed cell. Files: HelpDialog.tsx, practice.css. Test in practice.labels.test.ts.

**queued:connected-dot — fixed**
- The connected dot uses the neutral `--fg` colour instead of green. File: practice.css. Test in practice.labels.test.ts (checks the CSS rule).

**For other owners**
- `docs/UI_SPEC.md`: the shortcut rule should say a control reached with the keyboard (including a button, for Space) keeps its keys, and that pointer use never leaves focus on a control.
- `docs/APP_CONTRACTS.md`: `ImportedPieceMeta` gains optional `tempoDefaulted`.
- `docs/dev/app-builder-reports.md`: the note at line 348 now covers all pointer use, not just transport buttons and columns.

New test files are all in /Users/gapp/Desktop/Piano/tests:
- practice.focus.test.ts
- practice.midi.test.ts
- timeline.behaviour.test.ts
- practice.labels.test.ts


===== fix:core =====
All 13 items are fixed, but one test fails until the catalog is regenerated. `npx tsc --noEmit -p tsconfig.json` is clean and the full suite gives 1084 passed, 1 failed. The failure is `tests/catalog.test.ts > is reproducible`, because parser and model output changed. I did not run `scripts/build-catalog.ts`; whoever owns `src/catalog/catalog.json`, `catalog/inventory.json` and `docs/CATALOG_REPORT.md` needs to run it.

A dry run of the catalog build (no files written) shows what will change:
- `readinessReasons` text changes for the 20 entries with the cross-staff message.
- `the-entertainer-scott-joplin` goes from ready to review.
- Several inventory reasons change.

To check each fix fails without it, I kept a copy of the project with the original code at `/tmp/fx/base` and ran the new tests there. A library-wide comparison against that copy shows no change to playing order, tempo maps or hand mappings for any library file. Hands change only in Mariage d'Amour, both Chopin E-minor Preludes and Moonlight 3rd. The library count pin moves from 49 ready / 20 review to 47 / 22 (Chopin Prelude, the other edition, plus The Entertainer for 8va).

**music:cross-staff-voice-majority-misassigns-hands — fixed**
- Both copies of the whole-piece-majority rule are replaced by one shared helper, `voiceHomeStaves(notes, stavesOf, software)` in the new `src/core/voices.ts`.
- MuseScore files use the voice number: voices 1–4 belong to staff 1, 5–8 to staff 2. Files from other programs whose numbering clearly follows the same scheme are read the same way.
- For other files I did not use the suggested per-measure majority. Tested against the 69 library files, it got 1270 notes wrong versus 104 for the old rule. Instead:
  - a voice id that sounds on two staves at once is treated as reused, and its notes stay with the staff they are drawn on;
  - otherwise a voice belongs to the staff holding most of its notes, and only an exact tie is decided measure by measure;
  - a staff is never left without a voice of its own, so a reused voice id can't move a whole staff to the other hand.
- Results: Chopin m24/m25 upper chords and the other edition's m16 turn go to R, Moonlight 3rd m13/m164 voice 6 goes to L, Mariage d'Amour m81 voice 6 goes to L, and voice 1 on both staves (or no `<voice>` element) keeps the bass staff in L.
- Files: `src/core/voices.ts` (new), `src/core/musicxml/parse.ts`, `src/core/model/performance.ts`.
- Tests: `tests/voices.test.ts` (new, 12 tests); `tests/e2e.library.test.ts` pin updated.

**music:three-staff-part-ossia-replaces-main-rh and traceability:in-part-ossia-staff-replaces-rh — fixed together**
- The parser now records ossia hints per staff in a new optional `SourcePart.staffDetails` (new `StaffDetails` type): `<staff-type>`, a reduced `<staff-size>`, and words placed on a staff via `<direction><staff>`.
- In `hands.ts`, a part with 3 or more staves first leaves out staves that are hidden, marked as an ossia, printed small, or nearly empty. Two exceptions:
  - the busiest staff is never left out;
  - the lowest staff is never left out just for having few notes.
- A staff next to an excluded ossia whose notes all fall in the ossia's measures is left out too, which covers a two-staff ossia for both hands.
- The top remaining staff is the right hand and the bottom one the left hand, with a plain-words review warning (`alternative-part-excluded`). When nothing qualifies, the current rule and its wording are unchanged.
- Files: `src/core/model/hands.ts`, `src/core/musicxml/part.ts`, `src/core/musicxml/parse.ts`, `src/core/types.ts`.
- Tests: `tests/model.ossia-staves.test.ts` (new, 11 tests); new fixtures `tests/fixtures/f14b-ossia-staff.musicxml` (3 staves) and `tests/fixtures/f14c-ossia-four-staves.musicxml` (4 staves); fixture count in `tests/e2e.fixtures.test.ts` changed from 20 to 22.

**music:tempo-after-skip-uses-skipped-written-tempo — fixed**
- `buildTempoMap` now follows the tempo in performance order.
- Going back (repeat, D.C., D.S.) resumes the tempo the measure had when it was first played. Skipping forward (a later ending, To Coda) keeps the current tempo.
- A D.C. back to a pickup before the first mark now uses the first tempo.
- File: `src/core/model/performance.ts`. Tests: 3 added in `tests/model.tempo.test.ts`.

**music:ending-plus-forward-repeat-measure-dropped — fixed**
- `simulate()` now checks the ending before a `||:` on the same measure starts a new section.
- A measure reached by going back to its own `||:` is always played.
- A final ending no longer closes a section that a `||:` inside it has just opened.
- Case L now plays `1 2 1 3 4 3 4 5`.
- File: `src/core/model/performance.ts`. Tests: case L in `tests/model.repeats.test.ts` with stop, discontinue and open endings (3 cases).

**follow-midi:follow-wrongkey-exempts-released-keys — fixed**
- Keys the score held before the step are allowed only on a step entered by `start()` (passage start, seek, loop restart).
- After an advance, only keys the score keeps holding through the step are allowed, so re-striking the previous note or chord is marked wrong and blocks the step.
- File: `src/core/practice/follow.ts`. Tests: 3 added in `tests/follow.test.ts`.

**traceability:follow-me-deadlock-out-of-range — fixed**
- Follow me no longer waits for notes beyond A0–C8. A step whose only notes are beyond the piano is skipped automatically.
- A device that can send such a note is not marked wrong for it.
- The status now carries the notes it can't ask for in a new optional `FollowStatus.beyondPiano`.
- A simulated perfect player now finishes the Toccata and Mariage d'Amour.
- Files: `src/core/practice/follow.ts`, `src/core/types.ts`. Tests: 3 added in `tests/follow.test.ts`.

**ui:raw-implicit-measure-labels — fixed**
- New `measureDisplayNumbers()` in `src/core/measures.ts`: a measure number like "X1" becomes the previous numbered measure plus a letter ("20a"), or "0" before the first numbered measure, and never repeats a number already in the file.
- Used for occurrence labels, `MeasureOccurrence.number`, and measure lists in parser and model warnings. The Entertainer 1902 now shows 20a, 36a, 68a, 88a.
- `occurrenceLabel` now takes `(displayNumber, pass)`; nothing outside `performance.ts` called it.
- Files: `src/core/measures.ts` (new), `src/core/model/performance.ts`, `src/core/musicxml/parse.ts`, `src/core/types.ts` (doc comments).
- Tests: `tests/measures.test.ts` (new, 8 tests).

**security-storage-deploy:mxl-lying-header-cpu-bomb — fixed**
- Entries are read from the zip's central directory, with zip64 sizes supported. Deflate data goes through a streaming inflater in 16 KB slices that stops as soon as the output passes the declared size.
- Unknown compression methods and unreadable directories now raise `bad-archive`. The length and checksum checks are kept.
- A 1 GiB archive declared as 1000 bytes now fails in about 10–60 ms instead of about 2 s, and the 60 MB-declared variant in about 220 ms.
- All 69 library files give the same text as before.
- File: `src/core/mxl.ts`. Tests: 5 added in `tests/mxl.test.ts`, which builds the bomb inside the test.

**security-storage-deploy:xml-literal-section-regex-quadratic — fixed**
- An unterminated comment, CDATA or processing instruction now runs to the end of the text, so the scan is linear: 320 KB went from 7.9 s to 1 ms.
- File: `src/core/xml.ts`. Tests: 4 added in `tests/parser.test.ts`, including a 1 MB case per section type with a 500 ms limit.

**traceability:entertainer-8va-repeat-silently-ignored — core part fixed; UI part not done (not my area)**
- The parser now flags words like "8va", "8vb", "15ma" or "ottava" that have no `<octave-shift>` in the same measure, with a new review warning `octave-text-not-applied`. In the library only the two Entertainer editions trigger it (m22 and m21).
- Files: `src/core/musicxml/part.ts`, `src/core/musicxml/warnings.ts`, `src/core/types.ts`.
- Tests: 12 added in `tests/parser.test.ts`.
- Still needed elsewhere: show `CatalogEntry.notes` in `src/ui/practice/DiagnosticsDialog.tsx` ("About this arrangement"). Optionally add the new code to `WARNING_NOTES` in `scripts/build-catalog.ts`.

**traceability:cross-staff-reason-asks-beginner-to-read-score and queued:cross-staff-message — fixed**
- The message now reads: "Some notes are written on the other hand's staff. The app gives them to the hand of the musical line they belong to; check these measures if a hand feels wrong."
- File: `src/core/musicxml/warnings.ts`. Test: exact text updated in `tests/parser.test.ts`.

**Requests for other owners**
- **Catalog:** regenerate `src/catalog/catalog.json`, `catalog/inventory.json` and `docs/CATALOG_REPORT.md` with `scripts/build-catalog.ts`.
- **`docs/ARCHITECTURE.md` (not my area):**
  - the cross-staff paragraph (§1, around line 119) should describe the new home-staff rule;
  - hands rule 4 should describe how ossia staves are left out;
  - the `buildTempoMap` section should say tempo follows performance order;
  - the MXL section should say entry reading is size-bounded and checksum-verified;
  - the Follow §4 wrong-key rule should allow held keys only on the entry step and otherwise only keys held through the step, and say notes beyond A0–C8 are not expected;
  - a note on readable measure numbers and the new `octave-text-not-applied` warning.
- **Builder reports:** the known gaps at `docs/dev/app-builder-reports.md` lines 280 (lying zip sizes), 282 (voices renumbered on the second staff) and 408 (cross-staff wording) are now resolved, and line 405 of `docs/dev/core-builder-reports.md` describes the old majority rule.
- **UI (optional):** the status line could mention `FollowStatus.beyondPiano`, e.g. "D8 is beyond the piano's keys – skipped".
- **Types:** the additions to `src/core/types.ts` are all additive: `SourcePart.staffDetails?`, `StaffDetails`, `FollowStatus.beyondPiano?`, and the new warning code.
- **Not done:** a per-voice hand override in `ScoreOverrides`, which the issue only suggested considering.


===== integrate:final =====
All 38 test files pass (1090 tests), the typecheck is clean, the build succeeds, and `dist/index.html` loads only relative assets (`./assets/…`). The bundle's audio and score paths are relative too (`./audio/piano/`, `scores/…`).

**Commands run:** `npm run catalog` (run again after my data changes), `npx tsc --noEmit -p tsconfig.json`, `npx vitest run` and `npm run build`. Nothing was failing when I started (1085/1085): the 47 ready / 22 review pin and the catalog reproducibility test both passed once the catalog was regenerated. The catalog now has 65 entries: 45 ready, 20 review, 4 duplicates. The report's Data checks section lists no problems.

**Changes I made:**
1. **Difficulty shown from a title word** (the item the UI fixer couldn't do):
   - `catalog/difficulty.json`: Carol of the Bells (easy piano), Greensleeves (easy and beautiful) and Nocturne Op. 9 No. 2 Easy are now Unrated. Their "in-file" label was not in the score; it came only from the file name or upload title. The uncited Greensleeves "sheet-music listing" sentence is gone.
   - The four MuseScore entries are renamed to "MuseScore score page (level tag in its page title)".
   - The Prelude BWV 846 note no longer claims "many teachers grade it early intermediate". It stays Beginner (see the end).
   - Difficulty is now Beginner 8, Intermediate 6, Advanced 2, Unrated 49.
   - `scripts/build-catalog.ts`: new `inFileLabelProblem()` check that an in-file label really appears in the score's title or credits, and the report's method text is updated to match.
2. **Default speed on built-in library cards:**
   - `src/core/types.ts`: optional `CatalogEntry.stats.tempoDefaulted`.
   - `scoreStats()` writes it only when true; 6 entries have it.
   - `LibraryCard.tsx` now reads the typed field.
3. **8va:**
   - `WARNING_NOTES` gains `octave-text-not-applied`.
   - Both Entertainer notes in `catalog/metadata.json` now add "the app plays those notes as written".
4. **"About this arrangement"** (`DiagnosticsDialog.tsx`, `practice.css`):
   - It now shows `CatalogEntry.notes` in a new "About this version" section.
   - A checked hand setting that already appears under Hands is no longer repeated under "What the app noticed" (Schubert and the 2014 Entertainer).
5. **Tests:**
   - `tests/catalog.test.ts`: the in-file check, a library check on the three files, `tempoDefaulted`, and an empty data-check list required in the reproducibility test.
   - `tests/practice.labels.test.ts`: two About-dialog tests. Both fail if I undo the dialog fix.
6. **Docs:**
   - `docs/ARCHITECTURE.md`: every section the fixers listed, including the voice home-staff rule, ossia staves, tempo order, the new zip reading, the Follow me rules, the echo guard and the two lookaheads.
   - `docs/APP_CONTRACTS.md`: the engine changes, `ImportedPieceMeta.tempoDefaulted` and the catalog stats field.
   - `docs/UI_SPEC.md`: the shortcut and focus rule, and the About dialog contents.
   - Resolved items are marked in `docs/dev/app-builder-reports.md` and `docs/dev/core-builder-reports.md`.
   - Regenerated: `src/catalog/catalog.json`, `catalog/inventory.json`, `docs/CATALOG_REPORT.md`.

**Checked, no change needed:** the reconnect dead end the runtime fixer left open is already fixed in `ConnectPiano.tsx` and `midiConnection.ts`, with the condition the runtime fixer asked for.

**Still open:**
- **Prelude BWV 846:** the fixer said to "consider" making it Unrated. I kept Beginner, because it has the same MuseScore level evidence as the other three MuseScore entries. However, an earlier check of that page failed (MuseScore returned 403), so it is the weakest of the four. Changing it is a one-record edit in `difficulty.json` followed by `npm run catalog`.
- **Optional items not done:**
  - showing `FollowStatus.beyondPiano` in the status line;
  - a public `FollowMatcher` "does it wait on this step" method (the engine still copies that rule in `hasAttacks`);
  - starting audio from the Connect piano click;
  - hiding "press now" keys during an opening rest;
  - a per-voice hand override.
- **Known behaviour from the runtime fixer:**
  - On Chrome and Edge, a note due within about 40 ms of Pause or Stop can still sound briefly.
  - If Repeat is turned off in roughly the last 0.15 s of a pass, it plays one more time.

Main files changed:
- /Users/gapp/Desktop/Piano/scripts/build-catalog.ts
- /Users/gapp/Desktop/Piano/catalog/difficulty.json
- /Users/gapp/Desktop/Piano/catalog/metadata.json
- /Users/gapp/Desktop/Piano/src/core/types.ts
- /Users/gapp/Desktop/Piano/src/ui/practice/DiagnosticsDialog.tsx
- /Users/gapp/Desktop/Piano/src/ui/library/LibraryCard.tsx
