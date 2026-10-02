

===== review:ui =====
{
 "findings": [
  {
   "id": "remembered-piano-replaced-by-sole-other-input",
   "title": "A remembered piano that is switched off is replaced by any single other input (e.g. \"Midi Through Port-0\"). The app reports it as connected, saves it over the remembered piano, and does not attach the real piano when it is switched on.",
   "severity": "major",
   "briefRef": "UI_SPEC:230-234 (\"A piano remembered from an earlier visit that has not turned up yet is reported as 'No piano found' (or the list asks for a choice) ... and it is attached when it is switched on. 'Try again' never switches to a device that was already connected beside the piano\"); brief §9 (handle no devices, connection and reconnection gracefully); §16 understandable disconnected states. This is a regression from the round-2 inputSeen fix.",
   "files": [
    "src/midi/manager.ts",
    "src/ui/practice/midiConnection.ts",
    "src/ui/practice/PracticePage.tsx"
   ],
   "evidence": "How the code gets there:\n- midiConnection.ts:167 pre-selects the piece's saved midiInputId before connect().\n- manager.ts:403-416 reconcile(): `mayAutoSelect = this.inputSel.id === null || firstConnect || !this.inputSeenFlag`. Then `if (connected.length === 1) input = connected[0]`. It takes the only connected input whatever its name. The remembered name (global prefs midiInputName, passed to useMidiConnection as savedInputName) is never consulted.\n- bindInput marks the new input as seen (manager.ts:419-421). From then on, mayAutoSelect is false and the real piano is no longer picked up.\n- PracticePage.tsx:179-182 onConnected saves the new device as both the global midiInputName and the piece's midiInputId.\n- The round-2 knownOthers/fallbackInput guard (midiConnection.ts:80-91, 174-178) only runs on Try again. It does not cover this automatic path.\n\nReproduction: /tmp/r3/t/midithrough.test.ts uses the real PracticePage, the real MidiManager and the FakeAccess from tests/practice.midi.test.ts. The piece is saved with midiInputId 'in-a', the global midiInputName is 'Yamaha P-125', the Yamaha is off, and only 'Midi Through Port-0' (in-x) is present. Pressing Connect piano gives:\n```\nSTATUS: Step 1 of 275·Measure 1·MIDI: Midi Through Port-0 connected | notice: null | follow disabled: false\nglobal: {...\"midiInputName\":\"Midi Through Port-0\"...}\npiece: {...\"midiInputId\":\"in-x\"}\nafter piano on: selected in-x STATUS: ...MIDI: Midi Through Port-0 connected | notice: null | select: in-x\n```",
   "failureScenario": "Chrome on Linux always lists \"Midi Through Port-0\". The same happens with any IAC or loopMIDI port, or a second USB device.\n1. The learner opens a piece they practised before, with the piano still off, and presses Connect piano.\n2. Instead of \"No piano found\", the app attaches the virtual port and shows it as connected.\n3. Follow me is enabled (and is restored if it was the saved mode), then waits forever on a port that never sends notes.\n4. The remembered piano is overwritten in both saved settings.\n5. When the learner switches the piano on, it is not attached. They have to notice the wrong device name and pick the piano from the list.",
   "suggestedFix": "When the selected input is a remembered one that has not been seen this session, only auto-select a sole input in two cases: its name matches the remembered name, or it appeared after access was granted (a statechange), not one that was already present at connect().\n\nOtherwise, keep the remembered selection and report 'no-devices' or 'choose'. For example, pass savedInputName into MidiManager.connect or selectInput and use it in reconcile. Alternatively, have midiConnection.connect() compare the auto-picked device with savedInputName and undo a mismatching auto-pick without calling selectInput(null), which disables auto-select.\n\nAdd a jsdom test: remembered Yamaha off plus Midi Through present. Expect no 'connected', nothing saved over the remembered piano, and the Yamaha attached when it is plugged in."
  },
  {
   "id": "status-line-unnamed-device-disconnected",
   "title": "The status line says \"MIDI: Unnamed MIDI device disconnected\" for a remembered piano that has not turned up, while the notice says \"No piano found\"",
   "severity": "major",
   "briefRef": "UI_SPEC:230-232 (a remembered piano that has not turned up \"is reported as 'No piano found' (or the list asks for a choice), never as disconnected\"); UI_SPEC:182 status line; brief §16 understandable disconnected states. The round-2 fix for follow-midi:saved-input-never-connected is incomplete.",
   "files": [
    "src/engine/session.ts",
    "src/ui/practice/StatusLine.tsx"
   ],
   "evidence": "- manager.ts:510-519 listWithSelection() adds a placeholder `{ id: sel.id, name: sel.name || 'Unnamed MIDI device', connected: false }` for a selected id that is not in the port map.\n- session.ts:1275-1279 readInputName() takes the name from midi.inputs(), placeholder included.\n- StatusLine.tsx:14-15: `else if (midiState === 'ready' && midiInputName) parts.push(`MIDI: ${midiInputName} disconnected`)`.\n- The round-2 fix taught midiPhase and the piano list about inputSeen (midiConnection.ts:53, 146), but not the session or the status line.\n\nReproduction: /tmp/r3/t/statusline.test.ts uses the real PracticePage, the real MidiManager and a fake access. The piece is saved with midiInputId 'in-a', the piano is off, then Connect piano:\n```\nNOTICE: No piano found. Check that it is switched on ... Try againDismiss\nSTATUS: Step 1 of 275·Measure 1·MIDI: Unnamed MIDI device disconnected\ninputs(): [{\"id\":\"in-a\",\"name\":\"Unnamed MIDI device\",\"manufacturer\":\"\",\"connected\":false}]\n```\nWith two other devices present:\n```\nC NOTICE: More than one MIDI device was found. Choose your piano from the list.\nC STATUS: ...MIDI: Unnamed MIDI device disconnected\n```\nThe existing test (tests/practice.midi.test.ts:442-456) only checks that the page lacks \"Your piano was disconnected.\", so this text slips through.",
   "failureScenario": "A learner returns to a piece they practised with their piano and presses Connect piano before switching the piano on. The notice under the controls says \"No piano found…\". The status line at the bottom says \"MIDI: Unnamed MIDI device disconnected\" at the same time. The two messages contradict each other, and the status line refers to a device the learner never had.",
   "suggestedFix": "In session.readInputName() (or in the snapshot), report no input name while the selection has not been seen and is not connected (`!this.midi.inputSeen && !this.midi.inputConnected`). Alternatively, have StatusLine use the same phase as midiConnection and show nothing (or \"MIDI: no piano found\") in that case. Extend the saved-piano tests to assert on the .ps-status__facts text."
  },
  {
   "id": "timeline-tab-scrolls-hidden-viewport",
   "title": "Tabbing through the timeline focuses measure-number buttons that are rendered beyond the right edge of the hidden-overflow viewport. The browser then scrolls the viewport, which pushes the play marker and current column out of view, and nothing scrolls it back.",
   "severity": "major",
   "briefRef": "brief §16 (\"Focused controls have keyboard access\"; stable alignment); §7 (fixed play marker); UI_SPEC:120-147 (fixed marker at about 28%, virtualized ±20 columns)",
   "files": [
    "src/ui/notation/Timeline.tsx",
    "src/ui/notation/notation.css"
   ],
   "evidence": "- notation.css:137-143: `.tl__viewport { overflow: hidden }`. An overflow:hidden box is still a scroll container that can be scrolled from code. The strip inside it is total×72 px wide (Timeline.tsx:380), so the viewport always has horizontal scrollable overflow.\n- Timeline.tsx:66-82: every rendered column that starts a measure has a `<button class=\"tl__measure\">` in the normal tab order. Columns are rendered for the viewport ±20 (timelineWindow.ts:10, DEFAULT_OVERSCAN).\n- Browsers scroll a focused element's scroll-container ancestors, including overflow:hidden ones, to bring it into view. Nothing in src/ui resets scrollLeft, listens for scroll, or uses focus({preventScroll}) (grep for scrollLeft/onScroll/preventScroll in src/ui finds only LibraryPage's window scroll).\n- The marker (Timeline.tsx:374-379) is positioned inside the same viewport, so it scrolls away with the content.\n\nI measured how many focusable labels sit off-screen with /tmp/r3/s/offscreen.mts: Minuet in G, 1052 px viewport, real deriveSteps and visibleRange/measureStarts:\n```\npos 0:   ... focusable measure labels right of the viewport: 5  col 13 (x=1195px) ... col 31 (x=2491px)\npos 100: ... 5  col 112 (x=1123px) ... col 130 (x=2419px)\npos 200: ... 4  col 213 (x=1195px) ... col 227 (x=2203px)\n```\nNot reproduced in a real browser, because jsdom has no layout or focus scrolling. Browser check for the orchestrator: open a piece, step to about step 100, Tab past the current column through the measure numbers, then read `document.querySelector('.tl__viewport').scrollLeft` and see where the marker is.",
   "failureScenario": "A keyboard user tabs from the controls into the timeline and keeps pressing Tab to reach the keyboard's Fit control. Tab moves through the current column, then 4-5 measure numbers rendered up to about 1400 px beyond the right edge. Each one scrolls the viewport further, so the marker (at about 300 px) and the current column leave the visible area. Playback and stepping then move the strip by transform only, while scrollLeft stays where it is. The instruction rows keep showing columns well ahead of the music with no marker, until the page is reloaded.",
   "suggestedFix": "- Take off-screen measure labels out of the tab order: tabIndex -1 unless the column is inside the visible range, or use a single roving tab stop.\n- Also reset the viewport whenever it scrolls: add a `scroll` listener on `.tl__viewport` that sets `scrollLeft = 0`, or `scrollLeft = 0` in the rAF render. Alternatively, use `overflow: clip`, which is not scrollable.\n- Use `focus({ preventScroll: true })` in closeMenu."
  },
  {
   "id": "keyboard-focus-lost-or-misplaced",
   "title": "Keyboard focus is lost or lands on the wrong control: Reset (speed), \"Start passage here\" from a measure menu (focus moves to a different measure's label), and a focused timeline column that scrolls out of the rendered window",
   "severity": "minor",
   "briefRef": "brief §16 (\"Focused controls have keyboard access and accessible labels\"); UI_SPEC:187-199 (keyboard-reached controls keep working; measure menu keyboard use)",
   "files": [
    "src/ui/practice/ControlsBar.tsx",
    "src/ui/notation/Timeline.tsx"
   ],
   "evidence": "Reproduction: /tmp/r3/t/focus.test.ts uses the real PracticePage with the Minuet and keyboard-style activation (focus, then click with detail 0).\n\n1. Reset. The button exists only while speed is not 1× (ControlsBar.tsx:223-232). Activating it unmounts it:\n```\nafter keyboard Reset, focus: BODY | reset still there: false\n```\n2. Measure menu. closeMenu(true) focuses the trigger (Timeline.tsx:170-174, 403-408) before the passage change re-renders. Columns are keyed by index (Timeline.tsx:324-342), so the same button now belongs to another measure:\n```\nOPENING menu on Measure 4: passage options\nafter Start passage here: BUTTON tl__measure \"Measure 7: passage options\"\n```\n3. Timeline column. Only tabIndex follows the current step (Timeline.tsx:85-92); focus does not. After focusing the current column and pressing → 40 times, the focused column leaves the rendered ±20 window and unmounts:\n```\nfocused col: BUTTON tl__cells \"Step 1. ...\"\nafter 40x ArrowRight: BODY connected: false Step 41 of 275\n```\nThe same family, not checkable in jsdom: Next step, Previous step, Stop and \"Whole piece\" become disabled while focused (ControlsBar.tsx:166-181, 313). Chrome's focus fix-up then moves focus to the body.",
   "failureScenario": "A keyboard or screen-reader user:\n- presses Reset after slowing the speed, and focus jumps to the top of the document;\n- opens the Measure 4 menu with Enter and chooses \"Start passage here\". Focus and the announcement land on \"Measure 7: passage options\", a measure they did not touch. A second Enter then opens the wrong measure's menu;\n- focuses the current instruction column and steps with →. After about 20 steps, focus silently drops to the page body.\nEach time they have to Tab back from the top through the header and controls.",
   "suggestedFix": "- Reset: move focus to the Speed slider (or keep a stable placeholder) when it was activated from the keyboard.\n- Measure menu: after a keyboard Start or End, focus the label of the chosen occurrence once the new sequence has rendered (look it up by occ after commit), or the current column, instead of the old trigger element.\n- Timeline: when the current column changes while the old one had focus, move focus to the new current column (roving tabindex).\n- For buttons that become disabled under keyboard focus, move focus to a neighbouring transport button."
  },
  {
   "id": "measure-list-and-others-false",
   "title": "\"About this arrangement\" adds \"and others\" to measure lists that are already complete (85 warnings across the built-in pieces), and the Needs-review chip sends learners to this list",
   "severity": "minor",
   "briefRef": "brief §12 (do not misstate what was found); §16 understandable states; UI_SPEC About this arrangement (warnings with their measures). The cross-staff readiness reason says \"the measures are listed under More → About this arrangement\".",
   "files": [
    "src/ui/practice/diagnostics.ts",
    "src/core/musicxml/warnings.ts"
   ],
   "evidence": "- diagnostics.ts:18-24: `const more = w.count !== undefined && w.count > measures.length;` then appends ' and others'.\n- WarningSink.add (warnings.ts:74-90) increments `count` once per note, while `measures` is the set of distinct measures, capped at 20 (warnings.ts:53, 109-112). Every per-note add passes a measure index (part.ts:533-591, parse.ts:242-277).\n- So `count > measures.length` whenever any measure has two or more affected notes, even when every measure is listed.\n\nScan with /tmp/r3/s/warn.mts (all 64 catalog pieces through loadSourceScore and prepareScore with overrides, then measureList, keeping cases with fewer than 20 measures):\n```\nla-campanella-... | ornament-not-played | count 2 | measures 1 | Measure 87 and others\nmozart-piano-sonata-no-16-allegro | cross-staff-notes | count 20 | measures 4 | Measures 18, 19, 20, 21 and others\nprelude-no-2-bwv-847-in-c-minor | cross-staff-notes | count 98 | measures 8 | Measures 25, 26, 31, 32, 35, 36, 37, 38 and others\n...\ntotal 85\n```",
   "failureScenario": "A learner opens a \"Needs review\" piece such as Mozart Sonata No. 16. The chip says the cross-staff measures are listed under More → About this arrangement. There they read \"Measures 18, 19, 20, 21 and others\", so they look for other affected measures that do not exist. The same happens with \"Measure 87 and others\" (La Campanella trills) and many more.",
   "suggestedFix": "Track whether the measure list was truncated: record the number of distinct measures, or a `truncated` flag when more than MAX_MEASURES measures were seen, in WarningSink.toList and the WarningBag in prepare.ts. Show \"and others\" only in that case. Add a unit test with two notes in one measure."
  },
  {
   "id": "hand-span-reason-jargon",
   "title": "The Needs-review reason on 11 built-in pieces uses music-theory jargon (\"wider than a tenth\", \"meant to be rolled\") and does not say where the places are",
   "severity": "minor",
   "briefRef": "UI_SPEC:4-6 (\"Plain language throughout\"); brief §4 (\"No ... musical-theory knowledge is required\"); brief §4 clear readiness state",
   "files": [
    "src/core/model/prepare.ts",
    "src/catalog/catalog.json"
   ],
   "evidence": "prepare.ts:80 gives the 'hand-span-too-wide' review reason: \"In some places one hand is asked to strike keys too far apart to reach at once (wider than a tenth). Some of those notes may belong to the other hand, or the chord may be meant to be rolled.\" It is copied into catalog.json for 11 pieces (for example lines 156, 190, 466, 509, 618, 654, 1274). ReadinessChip.tsx:27-30 shows it on library cards and in the practice header.\n\nThe interval name \"a tenth\" and \"rolled\" chord mean nothing to a learner who can't read music. Unlike the cross-staff reason, which now points to More → About this arrangement, this one says only \"In some places\" and gives no way to find them, although DiagnosticsDialog does list the measures (for example moonlight-sonata-3rd-movement: Measures 1, 3, 5, 15, …).",
   "failureScenario": "A beginner opens the \"Needs review\" chip on, for example, Moonlight Sonata 3rd movement. They read that keys are \"wider than a tenth\" and that a chord \"may be meant to be rolled\". They can't tell what that means, how far apart is too far, or which measures to check.",
   "suggestedFix": "Use plain wording with a pointer, for example: \"In some places one hand is asked to press keys more than about 16 white keys apart at once, which no hand can reach. Some of those notes may belong to the other hand, or the keys may be meant to be played quickly one after another. The measures are listed under More → About this arrangement.\" Then regenerate the catalog."
  }
 ]
}


===== review:follow-midi =====
{
 "findings": [
  {
   "id": "always-present-port-replaces-piano",
   "title": "Connect piano with the piano switched off attaches whatever single MIDI port is always present (Linux \"Midi Through Port-0\", an audio interface's MIDI In, IAC/loopMIDI) and reports it as connected. The real piano is never picked up, even under its saved id, and the wrong port is saved for this piece and globally. This is the round-2 Try-again fix left incomplete.",
   "severity": "major",
   "briefRef": "§9 Input: \"Offer an explicit Connect piano control and device selection if multiple inputs exist. Handle ... no devices, connection, disconnection, and reconnection gracefully.\" Round-2 item ui:midi-try-again-grabs-other-input (\"silently switches to ... 'Midi Through Port-0', says it is connected, and stops the real piano from being picked up\")",
   "files": [
    "src/midi/manager.ts",
    "src/ui/practice/midiConnection.ts",
    "src/ui/practice/PracticePage.tsx"
   ],
   "evidence": "Code path:\n- manager.ts:408-413 (reconcile): `mayAutoSelect = this.inputSel.id === null || firstConnect || !this.inputSeenFlag` replaces a remembered-but-unseen selection with any sole connected input. It also auto-selects at first connect when nothing was remembered.\n- A saved id pre-selected before access has name null (midiConnection.ts:167, manager.ts:244). So once the saved id is replaced it cannot be re-found, and the new selection is 'seen', so it is kept.\n- The round-2 `knownOthers` exclusion (midiConnection.ts:140-153, fallbackInput :80-91) only guards the Try-again path, not this one.\n- PracticePage.tsx:179-181 (onConnected) then saves the port as the global `midiInputName` and the piece's `midiInputId`.\n\nPage-level jsdom repro (/tmp/r3fm/ui/linux.test.ts): real PracticePage, MidiManager and fake Web MIDI; the piece is saved with midiInputId 'piano'; only 'Midi Through Port-0' is present at Connect.\n```\nafter Connect: { selected: 'thru', followDisabled: false, notice: null, status: 'Step 1 of 275·Measure 1·MIDI: Midi Through Port-0 connected' }\npiano switched on: { selected: 'thru', list: 'thru', notice: null }   // the piano came back with the SAME id 'piano'\nsaved: { globalName: 'Midi Through Port-0', pieceInput: 'thru' }\n```\nManager-level (/tmp/r3fm/linux1.mts): `piano key C4 delivered to app: false`.\n\nIt persists and spreads:\n- /tmp/r3fm/linux2.mts: next visit with the piano ON, Connect gives `{ phase: 'connected', selected: 'thru' }`.\n- /tmp/r3fm/linux3.mts: any other piece (no saved id), piano on, gives `{ phase: 'connected', selected: 'thru' }`, because fallbackInput matches the saved global name 'Midi Through Port-0'.",
   "failureScenario": "A Linux/Chrome learner (or anyone whose audio interface exposes a MIDI In port) opens a piece and clicks Connect piano before switching the piano on. The app shows \"MIDI: Midi Through Port-0 connected\" with no notice. Follow me is enabled, and a saved Follow me mode is switched on, but the piano's keys do nothing. Switching the piano on changes nothing, and Follow me waits forever. On every later visit, and on other pieces, the app connects to Midi Through again even with the piano on, until the learner notices and picks the piano from the list.",
   "suggestedFix": "Two complementary changes:\n1. In MidiManager.reconcile, do not let a remembered selection that has not been seen give way to a sole input whose name differs from the remembered piano. Pass the saved name into the pre-selection: `selectInput(savedInputId, savedInputName)`, so the remembered piano can be re-found by name. Keep waiting, so the UI shows 'No piano found' or offers the list.\n2. Never auto-select loopback ports (name matches /midi through/i).\nThen, in useMidiConnection/onConnected, do not save `midiInputName` or the piece's `midiInputId` for an automatic pick that does not match the saved piano. While connected to such a pick, switch to an input that appears with the saved id or name. Add a jsdom test: Midi Through only at Connect, then the piano plugged in with the saved id, should attach the piano."
  },
  {
   "id": "echo-guard-swallows-in-time-presses",
   "title": "With \"Play through connected piano\" on, any real key press that lands 0–80 ms after the app's note on the same key is dropped as an echo, even when the device never echoes. The learner's in-time notes vanish from the keyboard and are not heard with \"Hear my playing\".",
   "severity": "minor",
   "briefRef": "§9 Input: \"Track physical pressed keys separately from expected score keys and app-generated playback events.\" §9 Audio routing: option to hear input through the browser.",
   "files": [
    "src/midi/manager.ts"
   ],
   "evidence": "- manager.ts:452-455: a note-on is swallowed when `isEcho(midi,'noteon',time)` matches.\n- isEcho (:482-487) matches any app-sent note-on of the same key within 0–80 ms. Records are never consumed and are not tied to an observed echo. The guard is active whenever an output is selected, whether or not that device echoes, and even if it is a different device from the input.\n\nManager repro (/tmp/r3fm/echo1.mts): the output is a separate 'Sound Module'; the piano input never echoes. App note-on C4 at 1040; the learner strikes C4 at 1065, releases at 1500, then strikes D4.\n```\ndelivered to app: [ 'noteoff:60', 'noteon:62' ]\n```\nThe real C4 strike is lost; only an orphan note-off arrives.\n\nSession repro (/tmp/r3fm/echo2.mts): Listen, Sound off, monitorInput on, output = module.\n```\napp note-ons to the module (key, atMs): [ [ 60, 10050 ] ]\nt=10070 after learner C4: physicalDown [] monitor noteOns []\nt=10300 after learner G4: physicalDown [ 67 ] monitor noteOns [ 67 ]\n```",
   "failureScenario": "The learner plays along with Listen, with playback sent to the piano (or to a sound module). Each note they play in time with the playback (within 80 ms after it) shows no 'your key' dot. With \"Hear my playing through the browser\" on it is also silent, while late or wrong notes do show and sound. Good timing is penalised.",
   "suggestedFix": "Apply the note echo guard only once the input has been shown to echo the output. A clean detector already exists: allNotesOff sends CC123, which a player never sends. Set an `inputEchoes` flag when takeCcEcho(CC123) matches, or when a note-on arrives within a few ms of an app note-on several times in a row while no player keys are down. Until echo is detected, deliver every note event. Also consume one `sent` record per swallowed echo, so a second matching event (the player's) is delivered."
  },
  {
   "id": "late-midi-echo-leaks-as-input",
   "title": "After a main-thread stall of about 90 ms or more during Listen with an echoing output piano, the echoes of late-sent app notes are not recognised. They reach the session as the player's key presses: phantom 'your key' dots, and \"Hear my playing\" strikes the app's note a second time in the browser.",
   "severity": "minor",
   "briefRef": "§9: \"Do not let generated audio/playback events satisfy Follow me checks\", \"Track physical pressed keys separately from ... app-generated playback events\", \"Prevent MIDI echo/feedback loops\".",
   "files": [
    "src/midi/manager.ts",
    "src/engine/session.ts"
   ],
   "evidence": "- session.ts:1022: a late tick computes `atMs = nowMs() + (when - now) * 1000`, which is in the past for overdue events. Web MIDI sends a past-timestamped message immediately.\n- manager.ts:277 and :492: `remember(midi, 'noteon', atMs)` records `at: atMs`, the past time, not the actual send time.\n- isEcho (:485) requires `time - r.at <= 80`, so an echo arriving 3 ms after the real send is outside the window once the event is more than ~77 ms late.\n\nRepro (/tmp/r3fm/echo3.mts): a port that echoes 3 ms after each message really goes out. Listen, Sound on, monitorInput on; a 150 ms stall just after a tick, then normal ticks.\n```\nnormal timing: physicalDown ever non-empty? false\nafter stall: physicalDown samples (time, keys): [ [ 10664, 64 ], [ 10665, 64 ], [ 10666, 64 ] ] ... count 139\nmonitored (browser) note-ons: [ 60, 62, 64, 65, 64, 67 ]   // E4 (64) struck twice: playback + echoed 'player' note\ndelivered input events: [ 'noteoff62@10664', 'noteon64@10664', 'noteoff64@10803' ]\n```",
   "failureScenario": "In Listen with playback sent to a piano that echoes, a GC pause or heavy render of 100–150 ms causes the next app note to be shown as the learner pressing it. With \"Hear my playing\" on, the browser plays that note again on top of playback. The physical-key display briefly shows keys the learner never touched.",
   "suggestedFix": "Record the time the message will actually go out: in remember() use `at: Math.max(atMs ?? now, now)` (the same for lastSent/scheduledOns), because a past timestamp is sent at once. Add a test with FakeClock.stall(150) and an echoing port: no input events and no extra monitored note-ons."
  },
  {
   "id": "follow-still-sends-cc123-cc64-to-piano",
   "title": "Round-2 fix incomplete: Follow me still sends All Notes Off and Sustain Off to the selected output piano at every loop restart, pause and setting change, although it has played nothing. On the piano this can lift the learner's pedalled chord.",
   "severity": "minor",
   "briefRef": "Round-2 item engine:follow-me-sends-sustain-off-to-piano; §9 \"CC64 sustain state is separate from physical key-down state\", \"Prevent MIDI echo/feedback loops\"",
   "files": [
    "src/engine/session.ts",
    "src/midi/manager.ts",
    "docs/APP_CONTRACTS.md"
   ],
   "evidence": "- session.ts:1099: releaseAll(keepMonitor) still calls `if (this.outputActive()) this.midi.allNotesOff();` on the Follow me paths: the tick loop restart (:853-857), pauseInternal (:663-664) and updateSettings (:445-447).\n- manager.ts:326-328 always sends CC123 and CC64=0, even when appNotes is empty.\n- Round 2 only added the echo guard for the app's own state. The message is still sent to the instrument.\n\nRepro (/tmp/r3fm/follow_out.mts): real MidiManager, Follow me with loop on, output = the same piano. The learner holds the pedal and plays C4, D4.\n```\nstatus after last note: finished\nsent to the piano at the Follow me loop restart: [ 'b0 7b 0', 'b0 40 0' ]\nsent at hands change / pause: [ 'b0 7b 0', 'b0 40 0' ]\napp note-ons ever sent in Follow me: 0\n```",
   "failureScenario": "The learner loops a passage in Follow me with \"Play through connected piano\" set to their piano and holds the last chord with the pedal. One second later the loop restarts and the app sends CC64=0 and All Notes Off on channel 1. On instruments that apply received MIDI to the local sound, the pedalled chord is cut while the foot is still down. The same happens on Pause or when changing hands or Sound.",
   "suggestedFix": "Release the MIDI output only when the app has something outstanding on it:\n- either skip midi.allNotesOff() on the Follow me keepMonitor paths;\n- or make MidiManager.allNotesOff send CC123/CC64 only when appNotes is non-empty or a message is still queued.\nUpdate the APP_CONTRACTS Follow me exception (\"The MIDI output is still released\") and engine.test.ts:1937 accordingly."
  },
  {
   "id": "output-select-desync-after-rename",
   "title": "When the output piano comes back under a new id (same name), the manager keeps sending playback to it, but \"Play through connected piano\" shows Off. The learner cannot choose Off to stop it.",
   "severity": "minor",
   "briefRef": "§9 Audio routing: \"Optional 'Play through connected piano' MIDI output is off by default and requires explicit output-device selection\"; controls must reflect state.",
   "files": [
    "src/midi/manager.ts",
    "src/ui/practice/MoreMenu.tsx",
    "src/ui/practice/PracticePage.tsx"
   ],
   "evidence": "- manager.ts:416-417: reconcile re-finds the output by name and changes `outputSel.id` to the new id. Nothing updates the session's `settings.midiOutputId`; inputs have onConnected for this, outputs have no equivalent.\n- midiConnection.ts:224 lists only connected outputs or the manager's selected one, so the old id is filtered out.\n- MoreMenu.tsx:61/117: `outputKnown` is false, so the select's value is '' (\"Off\").\n- session.outputActive() (session.ts:1325-1327) is still true, so playback continues.\n\nRepro (/tmp/r3fm/out1.mts): output 'out-1' is selected; the piano is re-enumerated as in-2/out-2 with the same name.\n```\n{ managerOutput: 'out-2', sessionSetting: 'out-1', uiOptions: [ 'out-2' ], selectShows: 'Off' }\nplayback still sent to the piano: [ [ 144, 60, 80 ] ]\n```",
   "failureScenario": "On Windows, the learner unplugs and replugs the piano's USB cable while practising with \"Play through connected piano\". Playback keeps sounding on the piano, but the menu says Off. Picking \"Off\" fires no change, so the learner must pick the piano and then Off again. Reopening the piece later re-selects the stale 'out-1', so the output silently stops while the list shows \"Unnamed MIDI device\".",
   "suggestedFix": "Propagate output re-identification as is done for inputs: when midi.selectedOutputId changes under a name match, call session.updateSettings({ midiOutputId: newId }). Alternatively drive the MoreMenu value from midi.selectedOutputId, and resolve a saved output by its remembered name (`midiOutputName` is saved but never read)."
  }
 ]
}


===== review:traceability =====
{
 "findings": [
  {
   "id": "suite-red-research-log-verify-batch2",
   "title": "The test suite fails again, so the Pages deploy workflow stops: a new 'verify:batch2' pass in the research log trips tests/catalog.difficulty-evidence.test.ts",
   "severity": "major",
   "briefRef": "§18.1 local setup and build work; §18.2 deployment prepared; §18.10 correctness tests pass",
   "files": [
    "tests/catalog.difficulty-evidence.test.ts",
    "docs/dev/difficulty-research-raw.json"
   ],
   "evidence": "`npx vitest run` at 08:07 and again at 08:24 gives 'Tests 1 failed | 1201 passed (1202)'.\n\nThe failing test is tests/catalog.difficulty-evidence.test.ts:97, 'every other sourced label was confirmed too, apart from the listed batch-2 backlog':\n`AssertionError: Fur_Elise.mxl now has a verdict: take it off AWAITING_VERIFICATION: expected { file: 'Fur_Elise.mxl', …(4) } to be undefined`.\n\nCause:\n- docs/dev/difficulty-research-raw.json (mtime 08:05:02) now has a pass 'verify:batch2', described as 'Run as a separate verifier agent on 2026-10-02 after the workflow's batch-2 verifier hit a session limit'.\n- That pass has verdicts for all four files the test still lists in AWAITING_VERIFICATION (tests/catalog.difficulty-evidence.test.ts:56-61): Fur_Elise, Gnossienne_No._1, Gymnopdie_No._1__Satie and Liebestraum_No._3. All four are confirmed=true at the same level as catalog/difficulty.json.\n- The test file (mtime 07:25) was not updated.\n\n.github/workflows/deploy.yml runs `npm test` before `npm run build`. A push therefore fails the build job, and nothing is published.",
   "failureScenario": "Push to main → the 'Deploy to GitHub Pages' workflow runs npm test → 1 failure → no build and no deployment. A developer running `npm test` locally also sees a red suite, although no app code changed.",
   "suggestedFix": "Empty AWAITING_VERIFICATION in tests/catalog.difficulty-evidence.test.ts. All four files now have confirming verdicts at their recorded levels, so the remaining assertions pass. Then re-run the full suite. Also update any generated text or docs that still say these four labels were never re-checked."
  },
  {
   "id": "greensleeves-rating-found-but-says-none",
   "title": "Greensleeves (Makowski) has an identifiable 'Beginner' listing in the research log, but the catalog shows Unrated and says no published rating was found",
   "severity": "minor",
   "briefRef": "§2 'Difficulty filtering using external classifications where a reliable arrangement match exists'; §14 'Prefer an explicit classification … from MuseScore or another identifiable source', 'Do not invent…'; §18.4 honest provenance",
   "files": [
    "catalog/difficulty.json",
    "src/catalog/catalog.json",
    "docs/CATALOG_REPORT.md"
   ],
   "evidence": "catalog/difficulty.json, record 'Greensleeves_for_Piano_easy_and_beautiful.mxl':\n- level 'Unrated', basis 'none'\n- note: 'The arrangement’s published title says “easy and beautiful”, but the score states no level and no published rating of this arrangement was found.'\n\ndocs/dev/difficulty-research-raw.json, pass 'verify:batch2':\n- {file: 'Greensleeves_for_Piano_easy_and_beautiful.mxl', confirmed: true, level: 'Beginner', reason: \"'easy' in the published title; LaSolSheet lists 'Arrangement: Makowski Dominique, Skill Level: Beginner, Measures: 33'. (Later set to Unrated by the round-1 review because the level word is not inside the score itself.)\"}\n- The file has 33 measures and is credited 'Arr. Dominique Makowski', so arranger and length both match.\n\nThe same source type ('LaSolSheet listing of this MuseScore arrangement', matched by arranger or measure count) backs six labelled pieces: Canon_in_D_easy, Carol_of_the_Bells, Clair_de_lune_-_Claude_Debussy, Flight_of_the_Bumblebee, Fur_Elise and Gymnopdie_No._1__Satie.\n\nThe round-1 reason for Unrated was that the in-file basis was false (the word is not in the score). That reason does not apply to a source-basis label.\n\nThe popover shows BASIS_DESCRIPTION.none, 'No published rating was found for this arrangement.' (src/ui/common/DifficultyBadge.tsx:22), plus the note above. Per the project's own log, both statements are false.",
   "failureScenario": "The learner filters Beginner. This easy arrangement is missing, although a matching third-party Beginner listing was recorded. If they open its ⓘ popover, they are told no published rating exists.",
   "suggestedFix": "Re-check the LaSolSheet listing under the same rule used for Für Elise. If it holds, give the record level Beginner, basis 'source', originalLabel 'Skill Level: Beginner', sourceName 'LaSolSheet listing of this MuseScore arrangement', the LaSolSheet sourceUrl and arrangementUrl musescore.com/dominiquemakowski/greensleeves, then run `npm run catalog`. If you decide not to accept it, rewrite the note to say a third-party listing gives Beginner and why it was not used. Do not say that none was found."
  },
  {
   "id": "zip64-format-mxl-rejected",
   "title": "A valid small .mxl written in zip64 format (classic end record holds the 0xFFFFFFFF directory offset) is rejected as 'damaged or incomplete'",
   "severity": "minor",
   "briefRef": "§12 Supported input: compressed MusicXML .mxl; §18.5 MusicXML/MXL import creates playable sequences",
   "files": [
    "src/core/mxl.ts"
   ],
   "evidence": "src/core/mxl.ts:128 in centralDirectory(): `if (count === 0xffff || p === ZIP64) return null;`. readEntry() (mxl.ts:250-252) then throws bad-archive 'the list of files in the archive could not be read'. fflate's own listing in listEntries() reads this archive fine through the zip64 end record.\n\nReproduction:\n- Build an archive of tests/fixtures/f01-melody-repeated.musicxml plus a META-INF/container.xml with Info-ZIP's force-zip64 option: `cd d && zip -q -X -fz ../infozip_z64.mxl META-INF/container.xml score.musicxml`. The result is /tmp/r3t/mxl/infozip_z64.mxl.\n- `unzip -t` reports 'No errors detected', and Python zipfile reads it.\n- Its classic EOCD has entries=2 and cd offset=4294967295; the zip64 EOCD at 1100 gives the real offset 948.\n- `npx tsx /tmp/r3t/g.mts` (extractMusicXmlText + loadSourceScore):\n  - `FAIL infozip_z64.mxl bad-archive The compressed score (.mxl) is damaged or incomplete, so it cannot be opened. the list of files in the archive could not be read`\n  - These variants all open: fflate zipSync (deflate, stored mimetype, comment), Python normal / streaming with data descriptors / force_zip64 local headers / comment and directory entries / no container / rootfile in a subfolder with an extra PDF rootfile, Info-ZIP normal and streamed, and macOS ditto.\n\nThe round-2 test 'an archive with a zip64 end record that names the same directory is read normally' (tests/mxl.test.ts:439) covers only an archive whose classic EOCD still holds real values.",
   "failureScenario": "A learner imports a score .mxl that was packaged by a writer that always emits zip64 records. Examples: `zip -fz`, or libraries set to 'always zip64'. The import fails with 'The compressed score (.mxl) is damaged or incomplete', although the archive is valid and fflate can list it.",
   "suggestedFix": "In centralDirectory(), when the classic EOCD holds 0xFFFF entries or a 0xFFFFFFFF offset, and a zip64 locator and end record are present and in bounds, take the count (z+32) and the directory offset (z+48) from the zip64 end record instead of returning null. Keep the existing rule that both records must agree whenever both hold real values. Add a fixture built with real-value-free classic fields to tests/mxl.test.ts."
  },
  {
   "id": "single-staff-reason-asks-to-read-notation",
   "title": "Two remaining 'Needs review' reasons still tell the beginner to 'Check whether some of them belong to the left hand', which needs staff-notation reading (round-1 wording fix covered only the cross-staff message)",
   "severity": "minor",
   "briefRef": "§2 'The user must not need to read sheet music to use or validate the app'; §10 'The user must not have to read staff notation'; §16 plain language (round-1 traceability item on 'Check which hand should play them')",
   "files": [
    "src/core/model/hands.ts"
   ],
   "evidence": "src/core/model/hands.ts:85, review warning 'single-staff-part':\n'All notes are written on a single staff, so they are all given to the right hand. Check whether some of them belong to the left hand.'\n\nsrc/core/model/hands.ts:229, review warning 'unclear-hand-mapping':\n'Only … of the piano music has the main music, so all of it is given to the right hand. Check whether some of it belongs to the left hand.'\n\nassessReadiness (src/core/model/prepare.ts:103-113) copies review messages into readinessReasons. The library card chip and the practice header's ReadinessChip show these reasons. The fixture f-single-staff gets this reason (tests/e2e.fixtures.test.ts:401, 'one staff goes to the right hand and the piece needs review').\n\nRound 1 rewrote the cross-staff message for the same reason. The new text is 'The app guesses which hand… If a hand feels wrong, the measures are listed under More → About this arrangement'. These two messages were not changed. They also name no measures, and the app offers no control to move notes to the left hand.",
   "failureScenario": "A learner imports a one-staff melody or lead sheet, or a 3-staff file where only one staff carries the main music. The 'Needs review' chip tells them to check which written notes belong to the left hand. That is a task that needs reading the staff notation the app replaces, and they have no way to act on it.",
   "suggestedFix": "Reword both messages in the style of the round-1 cross-staff text. For example: 'All notes are written on one staff, so the app gives them all to the right hand. If some feel like left-hand notes, try practising with the right hand only, or choose another arrangement.' Do not ask the learner to inspect the staff. Update the expectations in tests/parser.test.ts, tests/model.hands.test.ts, tests/model.ossia-staves.test.ts and tests/e2e.fixtures.test.ts that quote the old text."
  }
 ]
}


===== review:engine =====
{
 "findings": [
  {
   "id": "monitor-and-playback-share-sampler-voices",
   "title": "With 'Hear my playing' on, the learner's notes and the app's Listen/Steady notes on the same key cut each other: the app's note-off silences a key the learner is still holding, and a short tap by the learner cuts the app's melody note",
   "severity": "major",
   "briefRef": "§9 Input: 'Track physical pressed keys separately from expected score keys and app-generated playback events'; §9 Audio routing: 'Provide a clearly named option to hear input through the browser'; §8 Listen and Steady (playing along with the app's sound)",
   "files": [
    "src/audio/sampler.ts",
    "src/engine/session.ts"
   ],
   "evidence": "Monitored input and app playback go into the same PianoSampler, which keeps one set of voices per key and does not record who started a voice:\n- noteOff releases every voice of that key that started before t (sampler.ts:248-250).\n- noteOn fades any earlier voice of that key that is still sounding (sampler.ts:222-226).\n- The engine sends app events with sampler.noteOn/noteOff (session.ts:1004-1007). It sends the learner's keys through the same calls: onMidiEvent noteOn (session.ts:1211), and monitorOff on key-up, pedal-up and when monitoring is switched off (session.ts:1197, 1217, 1230-1235).\nThe 'Hear my playing through the browser' switch is offered in every mode (MoreMenu.tsx:92-107), and the engine monitors in every mode.\n\nRepro /tmp/r3eng/t1b.mts (FakeSampler, Sound on, monitorInput on). The app plays C4 0-1 s, then D4 1-2 s. The learner holds C4 from 0.02 s to 1.6 s and taps D4 from 0.95 s to 1.1 s:\n`listen | C4 (learner holds 0.02-1.6): app 0-0.02, learner 0.02-1 | D4 (app 1.0-2.0, learner tap 0.95-1.1): app 1-1.1, learner 0.95-1`\n`steady | (identical)`\nSo the learner's held C4 goes silent at 1.0 s, and the app's D4 sounds for only 0.1 s instead of 1 s. /tmp/r3eng/t1.mts shows the same.",
   "failureScenario": "A learner with a silent MIDI keyboard turns on 'Hear my playing' and plays along with Listen or Steady steps with Sound on, which is the normal way to practise with the app's sound. On every shared key:\n- If they hold a note longer than the score, their own sound stops at the app's release.\n- If they strike slightly early and let go early, the app's melody note is cut to a blip.\n- Turning 'Hear my playing' off, or lifting the pedal, also cuts the app's notes on the keys involved.\nWhat they hear is neither their own playing nor the piece.",
   "suggestedFix": "Keep the two sources apart in the sampler:\n- Add an owner tag to noteOn/noteOff/Voice (for example 'app' | 'input').\n- Apply the re-strike and noteOff matching only within the same owner.\n- Have the engine pass 'input' for monitored notes (onMidiEvent, monitorOff, releaseMonitored).\nAlternatively, give the monitor its own voice map or gain bus.\nAdd an engine test: in Listen with monitorInput, a learner holding the app's key past its release keeps sounding until their own note-off, and a learner's short tap leaves the app's note sounding for its full length."
  },
  {
   "id": "sampler-error-state-silences-new-session",
   "title": "If any piano sample failed to load on an earlier page, the next practice page treats browser sound as unusable: step previews are silent, and Sound turned on mid-run plays nothing. A run on the audio clock also falls silent when loading fails mid-run.",
   "severity": "minor",
   "briefRef": "§15 'Browser audio must initialize through an appropriate user interaction rather than failing silently'; ARCHITECTURE §6 (fallback voice 'so audio never fails silently'); APP_CONTRACTS Manual stepping (preview with sound on)",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "'error' in PianoSampler means 'some samples failed; the triangle fallback still plays' (sampler.ts:355-369; statusMessage text.ts:54 shows 'The piano sound could not load, so a simpler sound is used.'). In the engine, however:\n- audioUsable() is `this.audioStarted || state === 'loading' || state === 'ready'` (session.ts:1285-1288).\n- audioStarted is per session and set only when this session's ensureStarted() resolves.\n- startAudioQuietly() returns at once unless the state is 'not-started' (session.ts:1308), so it never retries from 'error'.\nConsequences:\n- preview() checks audioUsable() (session.ts:1045) and plays nothing.\n- pickClock() returns 'wall' (session.ts:1299), so a Sound-on re-anchor stays on the wall clock and dispatchDue sends nothing to the sampler.\n- A run that started on the audio clock because another page left the sampler 'loading' is moved to the wall clock by tick()→switchClock('wall') (session.ts:861) when loading ends in 'error', and goes silent mid-passage.\nRepro /tmp/r3eng/t2.mts (shared FakeSampler; page A played, then setState('error'); page B is a new session): `preview on page B, sampler calls: []`; Steady with Sound off → Play → Sound on: `noteOns: 0 status finished audioState error`.\nRepro /tmp/r3eng/t7.mts (page A left 'loading'; page B Steady with Sound on mid-run; the load then fails): `noteOns before the load error 3 after 0 status finished sound true`.",
   "failureScenario": "A sample fetch fails once (flaky network, one 404) on the first piece. The learner opens another piece and steps through it with Next/Previous: no preview sound at all. Or they play Steady steps silently and turn Sound on: nothing is heard, while the status line says a simpler sound is used. The same silence hits a run if the samples fail while it plays. Only pressing Pause and then Play (which calls ensureStarted) brings the sound back.",
   "suggestedFix": "Treat 'error' as 'audio may still work':\n- In startAudioQuietly, also call ensureStarted() when the state is 'error'. It retries loading and resolves when the context runs; these calls come from gestures.\n- Or expose from the sampler whether a running AudioContext exists, and use that in audioUsable().\n- Never move a run from 'audio' to 'wall' only because the sample state became 'error'.\nAdd tests with a shared sampler in state 'error' for a new session: next() previews audibly, and Sound on mid-run is heard."
  },
  {
   "id": "count-in-beat-ignores-meter",
   "title": "Count-in clicks are always quarter notes, so in 3/8, 6/8, 9/8 and 12/8 pieces they do not fall on the music's beat (ready pieces Für Elise ×3 and Lacrimosa)",
   "severity": "minor",
   "briefRef": "§13 'optionally provide a short count-in'; APP_CONTRACTS Count-in: 'The interval is one beat at the start tempo divided by speed'",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "countInBeat() (session.ts:715-721) uses `60 / tempoAt(tempo, tick) / speed`. That is one quarter note, because the tempo map is in quarter notes per minute. The time signature (SourceMeasure.timeSignature) and any <metronome> beat unit are never consulted. startRun builds four clicks with that spacing (session.ts:788).\nRepro /tmp/r3eng/t4.mts (catalog pieces through the engine):\n- `fur-elise ready time 3/8 qpm 72 ... click gap 0.833 s; dotted-quarter would be 1.250 eighth 0.417`\n- `fur-elise-fingered ready time 3/8 qpm 60 ... click gap 1.000 s ... eighth 0.500`\n- `fur-elise-beethoven-for-beginner-piano ready time 3/8 ... click gap 1.132 s`\n- `lacrimosa-requiem ready time 12/8 ... click gap 0.937 s; dotted-quarter would be 1.406`\n- Also Clair de Lune (9/8) and Nocturne Op. 9 No. 2 (12/8), both review.\nFur_Elise_fingered.mxl itself writes `<beat-unit>eighth</beat-unit><per-minute>120</per-minute>`, yet the count-in clicks at 60 per minute, two eighths apart: a pulse that does not exist in a 3/8 bar.\n/tmp/r3eng/t6.mts (Für Elise, 3/8 with an eighth-note pickup): clicks at 2.05, 2.883, 3.717 and 4.55 s; pickup E5 at 5.383; first downbeat at 5.8, which falls between click positions.",
   "failureScenario": "A beginner turns on Count-in for Für Elise or Lacrimosa to learn when and how fast to start. They hear four clicks at a pulse that cuts across the bar (two eighths in 3/8, two-thirds of a beat in 12/8). The music then moves in a different pulse, so the count-in sets up the wrong feel instead of the piece's beat.",
   "suggestedFix": "Derive the count-in beat from the score:\n- Use the <metronome> beat unit when present.\n- Otherwise use the time signature in force at the start tick: compound meters (6/8, 9/8, 12/8) → dotted quarter; other x/8 → eighth; x/2 → half; else quarter.\n- Convert with the quarter-note tempo map and divide by speed.\nThis needs the beat unit or time signature in PreparedScore (for example, on MeasureOccurrence). Update the APP_CONTRACTS wording, and add a test with a 6/8 score: clicks are 1.5 quarter notes apart."
  },
  {
   "id": "pause-during-count-in-skips-count-in",
   "title": "Pausing during the count-in and pressing Play again starts the music at once with no count-in",
   "severity": "minor",
   "briefRef": "§13 count-in; APP_CONTRACTS Count-in ('four clicks play before Listen or Steady starts'); UI hint 'Four clicks before playback starts'",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "pauseInternal() turns 'count-in' into 'paused' and keeps the marker (session.ts:651-662). play() counts in only when `fromStart = restart || this.status === 'stopped'` (session.ts:511-514). A count-in that was interrupted before the music began is therefore treated like a mid-piece pause. The same applies to the count-in before a loop restart, and to a page hide during a count-in.\nRepro /tmp/r3eng/t10.mts (Listen, count-in on): Play, then 800 ms later ('Get ready… 3', 2 clicks played) Pause, then Play: `clicks added 0 first notes (s after Play) [ [ 60, 0.05 ], [ 62, 0.55 ] ]`. The first note comes 50 ms after Play.\nThe existing test 'does not count in when resuming from pause' (engine.test.ts:766) only pauses after the music has started.",
   "failureScenario": "With Count-in on, the learner presses Play and realises during 'Get ready… 3' that their hands are not on the keys. They press Space to pause, get ready, and press Space again. The piece starts at once, without the four clicks they turned on to find the tempo.",
   "suggestedFix": "When pausing from 'count-in', remember that the count-in was not finished: set status 'stopped' while keeping the marker, or keep a flag that play() reads, so the next play() counts in again from the same step. Add a test: pause during the count-in, then play → four clicks before the first note."
  },
  {
   "id": "follow-me-still-sends-cc64-cc123",
   "title": "Round-2 fix incomplete: with an output selected, Follow me still sends Sustain Off and All Notes Off to the piano at every loop restart, pause and settings change, although the app played nothing. Only the echo of those messages is now filtered.",
   "severity": "minor",
   "briefRef": "§9 Audio routing ('release app-generated notes'; keep physical input separate from app playback); round-2 engine finding 'follow-me-sends-sustain-off-to-piano'",
   "files": [
    "src/engine/session.ts",
    "src/midi/manager.ts"
   ],
   "evidence": "The round-2 change (manager.ts) only swallows the echoed CC123/CC64 on input. The engine still calls midi.allNotesOff() in releaseAll whenever an output is selected (session.ts:1099), including the Follow me keep-monitor paths:\n- the loop restart (session.ts:855);\n- pause while waiting (session.ts:664);\n- settings changes with prev.mode === 'follow' (session.ts:446).\nMidiManager.allNotesOff always sends `b0 7b 00` and `b0 40 00` (manager.ts:327-328). The app never sends a sustain-on, so CC64=0 can only lift the player's own pedal.\nRepro /tmp/r3eng/t9.mts (real MidiManager; the piano is both input and output; Follow me with loop): the learner plays C4 and D4 with the pedal held (`status finished pedal down true`), then 1 s later the piano receives `[ '11200 b0 7b 0', '11200 b0 40 0' ]`, with no note sent by the app at any point.\nThe same CC64=0 goes out on every Listen/Steady pause, seek and speed change, even when the learner is pedalling along on that piano.",
   "failureScenario": "A learner who chose 'Play through connected piano' (a global preference) practises Follow me with Repeat on. They finish the passage holding the last chord on the pedal. One second later the app sends Sustain Off and All Notes Off on channel 1. On digital pianos whose tone generator applies received CC64/CC123, as most do with Local On, the pedalled chord is cut while the foot is still down. Every Space-pause does the same.",
   "suggestedFix": "Release the output only when the app has something outstanding:\n- Track in the session (or in MidiManager via appNotes and the queue) whether any app note was sent since the last release, and skip midi.allNotesOff() otherwise.\n- At minimum, skip it in the Follow me keep-monitor paths.\n- Send CC64=0 only if the app itself sent a sustain-on.\nUpdate the APP_CONTRACTS 'The MIDI output is still released' line accordingly."
  }
 ]
}


===== review:music =====
{
 "findings": [
  {
   "id": "ornament-replacement-drops-note-before-hidden-turn",
   "title": "When hidden notes spell out an ornament, the whole printed note is removed, including the part before the hidden notes start. In the 'ready' Pathétique 2nd movement, the RH F4 in m21 is struck an eighth late and a rest is shown in its place; in m20 the tied D5 is released a 16th early.",
   "severity": "major",
   "briefRef": "§12 Baseline correctness ('Never silently flatten away important information and present the result as faithful'); §6 canonical cells; ARCHITECTURE §1 (written-out ornament: 'the hidden notes are played instead of it')",
   "files": [
    "src/core/musicxml/parse.ts"
   ],
   "evidence": "parse.ts:191-218 replacedByHiddenNotes() puts a printed note in `replaced` when any hidden note on its staff overlaps its time and its pitch is among them (line 206). buildNotes (parse.ts:231-238) then drops the whole note. The hidden notes' start is never compared with the printed note's onset.\n\nPathétique XML, divisions 48, 2/4:\n- m21 RH: Eb5 quarter (0-48), F4 dotted eighth with <turn/> (48-84), Ab4 32nd, C5 32nd.\n- Hidden v2 notes F4 G4 F4 E4 F4 start at 72, i.e. beat 2.5. The turn comes after the held note (Beethoven's dotted-note turn).\n- m20: D5 eighth tieStart (24-48) is tied to a D5 eighth with <turn/> (48-72). The hidden D#5 D5 C5 D5 start at 60.\n\nScript /tmp/r3m/repl.mts lists every replaced printed note whose hidden realisation starts late. Only Pathétique has them: m20 D5 (tie-stop, hidden start late by 0.25 quarter) and m21 F4 (late by 0.5 quarter).\n\n/tmp/r3m/path.mts shows the RH steps, deriveSteps(prep, ['R'], m20..m21). Catalog readiness is 'ready' (id sonate-no-8-pathetique-2nd-movement):\n  m20 beat 1.5000  RH D5\n  m20 beat 2.0000  RH .        <- score still holds tied D5 until 2.25\n  m20 beat 2.2500  RH D#5 (turn)\n  m21 beat 1.0000  RH D#5\n  m21 beat 2.0000  RH .        <- score strikes F4 here\n  m21 beat 2.5000  RH F4       <- first F4, an eighth late\nRound trip is ok, because the notation faithfully shows the already-wrong presses.\n\nThe only signal is an info 'other' warning (m20, 21, 68). It claims the hidden notes are played 'in place of the main note', so the piece stays ready.",
   "failureScenario": "A learner opens the ready Pathétique 2nd movement and plays m20-21 in Listen or Follow me. At m21 beat 2 the RH cell shows '.' (release everything) where the score has the melody note F4. Follow me waits for F4 half a beat later, so the melody rhythm is wrong. In m20 the tied D5 is cut a 16th before the turn.",
   "suggestedFix": "In replacedByHiddenNotes, when the first overlapping hidden note starts after the printed note's onset, keep the printed note (and the tie-stop continuation in m20) from its onset up to the first hidden onset. Only the covered part should be replaced, so the attack and the hold before a 'turn after the note' survive. Add a regression test on Pathétique m20-21: RH F4 attack at m21 beat 2, and D5 held until m20 beat 2.25."
  },
  {
   "id": "per-staff-voice-rule-misreads-global-numbering",
   "title": "Regression from the round-2 voices.ts rule. In a non-MuseScore file that numbers voices per hand (voice 1 = RH, voice 2 = LH), one measure where the RH line sits wholly on the bass staff makes the whole part 'numbered per staff'. That measure's RH notes go to the left hand, every cross-staff warning disappears, and the piece is 'ready'.",
   "severity": "major",
   "briefRef": "§10 (cross-staff writing needs care; do not assign hands without inspecting structure); §12 (cross-staff voices: support correctly or label for review)",
   "files": [
    "src/core/voices.ts"
   ],
   "evidence": "voices.ts:85-101 numberedPerStaff() returns true when voice 1 is drawn on only one staff in some measure, for every staff (lines 98-100: 'the hands take turns in voice 1'). Line 179 then sets perStaff, and every note in the part keeps its drawn staff (line 186). No note is crossStaff, so no cross-staff-notes warning is raised.\n\nIn a file with global voice numbering (voice 1 = RH, voice 2 = LH, the MusicXML tutorial's piano layout), a measure where the RH melody is notated wholly on the bass staff meets the 'alone' test. The LH's own voice 2 is sounding on that staff at the same time, but the rule does not look at that.\n\nRepro /tmp/r3m/vreg.mts (software tag absent):\n- 4 measures. Voice 1 (RH) has quarters on staff 1, except m3 where all four (G3 B3 D4 B3) are drawn on staff 2. Voice 2 (LH) has a whole note on staff 2 in every measure.\n- Output: crossStaff flags m3: all false. readiness ready, warnings: no-tempo-in-file/info only.\n  t384 R:.  L:G3,G2\n  t432 R:—  L:+B3,-G3\n  t480 R:—  L:+D4,-B3\nSo the LH must hold G2 and play the RH melody, and the RH rests.\n\nControl (same file, but one of m3's four RH notes stays on staff 1):\n- review, cross-staff-notes/review m3, and m3 is correctly 'R:G3 R:B3 R:D4 R:G4 / L:G2'.\nThe behaviour flips on a single note. Before round 2 the majority rule gave voice 1 home staff 1 and flagged m3.",
   "failureScenario": "A user imports a Finale/Sibelius/hand-written MusicXML whose piano part uses voice 1 for the RH and voice 2 for the LH. One passage has the RH notated on the bass staff for a full measure (common in hand-crossing or low-register passages). The app shows it as ready, gives those RH notes to the LH (stacked on the LH's own line), and drops every other cross-staff warning in the piece.",
   "suggestedFix": "Count a measure as 'hands take turns in voice 1' only when no other voice is sounding on that staff during voice 1's notes there. In a global-numbering file the LH's own voice is present, which rules it out. Otherwise, when the per-staff signal comes only from the 'alone' test, keep inferring homes but raise the cross-staff-notes review warning instead of silently mapping by drawn staff. Add the repro above as a voices.test.ts case."
  },
  {
   "id": "hidden-playback-notes-duplicate-printed-notes",
   "title": "Hidden (print-object=\"no\") playback notes are played on top of the printed notes they duplicate. In the 'ready' G minor Bach (Original) m65, the LH is told to strike F#4 and A4 while the RH is holding those same keys.",
   "severity": "major",
   "briefRef": "§12 (do not present a flattened/wrong result as faithful); §6 (preserve voices, report ambiguity instead of producing impossible actions); §10",
   "files": [
    "src/core/musicxml/parse.ts",
    "src/core/musicxml/part.ts"
   ],
   "evidence": "parse.ts:195 uses hidden notes only to decide whether a printed ornament note is replaced. Otherwise every hidden, non-muted note is emitted (parse.ts:230-270) and expected in Follow me. part.ts:534 gives `<arpeggiate>` only an info warning.\n\nG_Minor_Bach_Original.mxl m65 (/tmp/r3m/meas.mts, /tmp/r3m/gmb.mts):\n- The printed RH chord F#4+A4 (dotted quarter, <arpeggiate/>) sits at beat 3.\n- Hidden LH v5 grace notes D3 A3 C4 F#4 A4 realise the roll; D3 A3 C4 are tied into the LH chord.\n- Steps in m65:\n  beat 3.000  RH A4,F#4   LH D3\n  beat 3.375  RH —        LH +F#4   (RH heldAfter 66,69)\n  beat 3.500  RH —        LH +A4,-F#4\n- Catalog: g-minor-bach-original readiness 'ready'. Its only warnings are info: arpeggio-not-rolled, grace-notes-approximated, pedal-not-modelled.\n\nThe same mechanism in review pieces (/tmp/r3m/hid3.mts):\n- La Campanella m114: hidden F#5/C#6/F#6 last 1 beat while the printed chord lasts 0.5. Unison coalescing keeps the RH chord down twice as long.\n- Clair de Lune (Clair_de_Lune__Debussy) m1: hidden LH F4/G#4 duplicate the RH's cross-staff F4/G#4, so both hands strike the same keys at the same instant.",
   "failureScenario": "In Follow me on the ready G minor Bach (Original) at m65, the learner plays the RH chord F#4+A4 and holds it. The next steps ask the LH to press F#4 and then A4, keys the RH is holding down, which no pianist can do without releasing them. Listen re-strikes both keys mid-chord.",
   "suggestedFix": "When a hidden, non-muted note duplicates the key of a printed note that is sounding at its onset (in either hand), drop the hidden note, or treat it as a continuation instead of a new attack. Alternatively, raise a review warning ('hidden playback notes double printed notes') so such pieces are not 'ready'. Also cap a hidden duplicate's length at the printed note's length when both start together on the same key."
  },
  {
   "id": "glissando-silently-dropped",
   "title": "Glissando and slide marks are ignored without any warning, so an imported piece with a glissando is 'ready' and plays only the two end notes",
   "severity": "minor",
   "briefRef": "§12 Baseline correctness: advanced constructs must be supported correctly or the piece labelled as needing review; 'Never silently flatten away important information'",
   "files": [
    "src/core/musicxml/part.ts",
    "src/core/musicxml/warnings.ts"
   ],
   "evidence": "part.ts:209-226 scanNotations recognises only tied, ornaments (trill/mordent/turn/tremolo) and arpeggiate. `<glissando>` and `<slide>` are never read. `grep -rn \"glissando\\|slide\" src/core` finds nothing.\n\nRepro /tmp/r3m/gliss.mts: RH C4 half note with <glissando type=\"start\"> to C6 half note with <glissando type=\"stop\">, LH C3 whole.\nOutput: readiness ready; warnings: (none); presses RC4[0-96] LC3[0-192] RC6[96-192].\nThe two-octave sweep a piano glissando asks for is silently dropped and nothing in the app mentions it. No library file uses glissandos, so this affects user imports.",
   "failureScenario": "A user imports a pop or ragtime arrangement that ends with a notated glissando. It shows as ready. Listen and Follow me present just the start and end keys, with no indication that a sweep across the keys was written.",
   "suggestedFix": "Detect `<glissando>` and `<slide>` in scanNotations. Add a review warning (for example 'glissando-not-played': 'A glissando (a quick sweep over the keys between two notes) is written here; only its first and last notes are played'), with its measure list, so the piece is marked for review."
  }
 ]
}


===== verify:ui =====
{
 "verdicts": [
  {
   "id": "ui:remembered-piano-replaced-by-sole-other-input",
   "verdict": "confirmed",
   "reason": "Reproduced with the real PracticePage, MidiManager and fake access (/tmp/vu/t/midithrough.test.ts). Setup: piece midiInputId 'in-a', global midiInputName 'Yamaha P-125', piano off, only 'Midi Through Port-0' present. After Connect piano:\n- status reads 'MIDI: Midi Through Port-0 connected', there is no notice, and Follow me is enabled;\n- global midiInputName and the piece's midiInputId are overwritten with in-x;\n- after the Yamaha is plugged in, the selection stays on in-x.\n\nThe damage persists (/tmp/vu/t/nextvisit.test.ts). On the next visit with both devices on, findPort matches in-x by id, so Midi Through is attached again.\n\nTwo paths cause it:\n- manager.ts:408-411: at firstConnect, a sole connected input is taken whatever its name;\n- midiConnection.ts:174-177: the connect().then fallbackInput call has an empty knownOthers in a new session. With only the manager fixed, this path would still pick Midi Through.\n\nThis breaks UI_SPEC:230-234: the remembered piano is not reported as 'No piano found' or offered as a choice, and it is not attached when switched on. It also goes against the round-2 rule that a device already present beside the piano is never auto-picked.\n\nCaveats:\n- It is not a round-2 regression. The connect-time fallback predates round 2 (firstConnect). It is documented in ARCHITECTURE §5 ('gives way to the only connected input, at Connect') and core-builder-reports, and asserted by tests/midi.test.ts:308. Those must change with the fix.\n- A never-practised piece also auto-selects a sole Midi Through, by contract. Only the remembered-piano case, where the app knows the piano's name and overwrites it, is the defect.\n\nI prototyped the fix below (/tmp/vu/proto, aliased in). The repro then shows no connection and nothing overwritten, and the Yamaha is attached when switched on. The full suite passes except the old-contract test at midi.test.ts:308 and a catalog test that already fails without the change.",
   "refinedFix": "1. src/midi/manager.ts\n   - Add `private presentAtConnect = new Set<string>()`.\n   - In reconcile(firstConnect), compute `connected = portList(access.inputs).filter(isConnected)`. When firstConnect is true, set presentAtConnect to the ids of `connected`.\n   - Replace the mayAutoSelect block: with no selection (`inputSel.id === null`), keep the sole-input auto-select. With a remembered, unseen selection (`!inputSeenFlag`), auto-select only when exactly one connected input is *not* in presentAtConnect, i.e. it turned up after Connect. `inputDeclined` still blocks both.\n   - Give `selectInput(id, rememberedName?: string | null)` a name parameter, so `inputSel.name = port?.name || keptName || rememberedName`. findPort can then re-find the remembered piano by name under a new id.\n\n2. src/ui/practice/midiConnection.ts\n   - Add the optional name parameter to `MidiControl.selectInput`.\n   - In connect(), pre-select with `midi.selectInput(savedInputId, savedInputName)`.\n   - In connect().then, when `midi.inputSeen === false`, pass every currently connected input id as `exclude` to fallbackInput, so only a saved-name match can be picked. Otherwise keep `knownOthers.current`.\n   - Give the 'choose' notice a one-device wording, because 'More than one MIDI device was found' is wrong when only Midi Through is live. For example: 'Your piano was not found. Switch it on, or choose it from the list.'\n\n3. Docs and tests\n   - Update ARCHITECTURE §5 (the remembered-id rule) and core-builder-reports.\n   - Replace tests/midi.test.ts:308 with two tests: a sole input present at connect is not taken over a remembered id, and one with the remembered name is.\n   - Add the jsdom test (remembered Yamaha off plus Midi Through): no 'connected', nothing saved, and the Yamaha is attached when plugged in (same id, and new id with the same name)."
  },
  {
   "id": "ui:status-line-unnamed-device-disconnected",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/vu/t/statusline.test.ts, real PracticePage and MidiManager). With the saved id in-a and the piano off, the notice says 'No piano found…' while the status line says 'MIDI: Unnamed MIDI device disconnected'. With two other devices, the notice says 'More than one MIDI device was found…' and the status line says the same 'Unnamed MIDI device disconnected'.\n\nCause:\n- listWithSelection adds a placeholder for the selected id (manager.ts:516-518).\n- session.readInputName (session.ts:1275-1279) reads it.\n- StatusLine.tsx:15 prints '<name> disconnected' whenever the state is 'ready' and a name exists.\n\nThis contradicts UI_SPEC:230-232 ('never as disconnected'). I prototyped the fix below and ran it against the copied repro tests and the existing suites (/tmp/vu/proto/session.ts). The status line then shows only 'Step 1 of 275·Measure 1' in these states, and engine, practice.midi and the full suite still pass.",
   "refinedFix": "1. src/engine/session.ts\n   - Add `readonly inputSeen?: boolean` to MidiLike. MidiManager already provides it.\n   - In readInputName(), after the null-id check, add `if (!this.midi.inputConnected && this.midi.inputSeen === false) return null;`. onMidiChange re-reads the name on every manager change, so the name appears once the piano connects. A piano that was seen and then unplugged still shows '<name> disconnected'.\n\n2. Tests\n   - Extend the 'a piece whose saved piano is switched off' tests in tests/practice.midi.test.ts to assert that `.ps-status__facts` contains no 'disconnected' and no 'Unnamed MIDI device'.\n   - Add a session unit test for readInputName with inputSeen false."
  },
  {
   "id": "ui:timeline-tab-scrolls-hidden-viewport",
   "verdict": "confirmed",
   "reason": "The code leaves no doubt about the conditions:\n- `.tl__viewport` is `overflow: hidden` (notation.css:137-143). That makes it a scroll container that can be scrolled from code.\n- The absolutely positioned strip (width total×72, transformed left) extends far past its right edge, so it has horizontal scrollable overflow.\n- Every rendered measure-start column has a `.tl__measure` button in the normal tab order (Timeline.tsx:67-82), and columns are rendered up to 20 past the visible edge.\n- Nothing in src/ui resets scrollLeft, listens for scroll, uses preventScroll, or uses overflow: clip. I grepped for each.\n- The marker is positioned inside the same viewport, so it scrolls with the content.\n\nI re-ran the reviewer's geometry script with the real visibleRange/measureStarts: 4-5 focusable labels sit 70-1440 px past the right edge at positions 0, 100 and 200.\n\nThe last step is standard platform behaviour, not project code. Focusing an element, including by sequential Tab navigation, scrolls its scroll-container ancestors, overflow:hidden ones included, to bring it into view. Once scrollLeft is non-zero, the rAF loop only changes the transform, so the offset stays. I did not reproduce this in a real browser (jsdom has no layout), as instructed. The orchestrator's check is to Tab through the labels and read `.tl__viewport` scrollLeft.\n\nA related point: labels in the left overscan also take focus while invisible.",
   "refinedFix": "1. src/ui/notation/notation.css\n   - Make the viewport non-scrollable: in `.tl__viewport`, write `overflow: hidden; overflow: clip;`. A clip box is not a scroll container, so focus cannot scroll it.\n   - Belt and braces for older engines: in Timeline's layout effect, add a 'scroll' listener on the viewport that sets `viewport.scrollLeft = 0` (or reset it in render()).\n\n2. src/ui/notation/Timeline.tsx\n   - Keep off-screen labels out of the tab order. Pass each Column an `onScreen` flag: the index is inside `visibleRange(stepIndex, width, colWidth, MARKER_FRACTION, total, 0)`, using the viewport width kept in a ref or state. Set `tabIndex={onScreen ? 0 : -1}` on `.tl__measure`.\n   - Use `focus({ preventScroll: true })` in closeMenu and for the menu's first item."
  },
  {
   "id": "ui:keyboard-focus-lost-or-misplaced",
   "verdict": "confirmed",
   "reason": "All three reproduced cases reproduce with the reviewer's jsdom test (/tmp/vu/t/focus.test.ts, real PracticePage, Minuet):\n1. Keyboard Reset of speed leaves focus on BODY. The button unmounts once speed is 1 (ControlsBar.tsx:223-232).\n2. Keyboard 'Start passage here' from the Measure 4 menu leaves focus on the same DOM button, which now reads 'Measure 7: passage options'. closeMenu(true) focuses the trigger before the new sequence renders, and columns are keyed by index (Timeline.tsx:324-342), so the element is reused for another measure.\n3. With focus on the current column, 40× ArrowRight leaves focus on BODY at 'Step 41 of 275'. tabIndex follows the step but focus does not, and the old column unmounts once it leaves the ±20 window.\n\nThe brief §16 requires keyboard access, and the project already treats lost focus as a defect elsewhere (ConnectPiano useFocusRecovery). Severity minor.\n\nThe extra claim about Next, Previous, Stop and 'Whole piece' becoming disabled while focused was not reproduced (jsdom cannot show it), so it is not part of this confirmation.",
   "refinedFix": "1. Reset (src/ui/practice/ControlsBar.tsx): in the Reset onClick, call `speed.set(1)`. When `isKeyboardClick(e)`, also focus the speed slider: add a ref on the range input and call `sliderRef.current?.focus()`.\n\n2. Measure menu (src/ui/notation/Timeline.tsx)\n   - Add `data-occ={measure.occ}` to `.tl__measure`.\n   - On a keyboard Start/End, close the menu without focusing the old trigger. Store the chosen occ in a `pendingFocusOcc` ref.\n   - In a useLayoutEffect that runs after the sequence/stepIndex change, focus `root.querySelector('.tl__measure[data-occ=\"'+occ+'\"]')` if rendered, else the current `.tl__cells[tabindex=\"0\"]`, using `{ preventScroll: true }`. Then clear the ref.\n\n3. Timeline column (src/ui/notation/Timeline.tsx): add a useLayoutEffect on stepIndex. If `rootRef.current` contains `document.activeElement` and it is a `.tl__cells` button, focus the new current `.tl__cells[tabindex=\"0\"]` with `{ preventScroll: true }` (roving tabindex).\n\n4. Tests: add jsdom tests for all three in tests/practice.focus.test.ts."
  },
  {
   "id": "ui:measure-list-and-others-false",
   "verdict": "confirmed",
   "reason": "Unambiguous from the code, and reproduced:\n- measureList (diagnostics.ts:21) adds ' and others' when `count > measures.length`.\n- `count` counts notes: WarningSink.add does `count += 1` per note (warnings.ts:88), and WarningBag/mergeWarnings sum counts.\n- `measures` holds distinct measures, capped at 20.\n- Every per-note add passes a measure index (parse.ts:242-277, part.ts:533-591), so 'and others' never stands for measures that could not be located.\n\nRepro with a minimal score (/tmp/vu/s/trill.mts): two trills in measure 1 give `ornament-not-played count 2 ['1'] => 'Measure 1 and others'`. The reviewer's catalog scan, re-run, reports total 85, e.g. waltz-opus-64-no-2 cross-staff 'Measures 13, … 156 and others' with count 35 over 10 measures.\n\nThe cross-staff warning text sends learners to this list, so the false 'and others' misleads. Note that tests/practice.helpers.test.ts:210 encodes the current semantics and must be updated.",
   "refinedFix": "Record whether the measure list was cut short, instead of comparing note counts with measure counts.\n\n1. Add `measuresTruncated?: boolean` to ScoreWarning (src/core/types.ts).\n\n2. Set it where the 20-measure cap drops something:\n   - WarningSink.toList (warnings.ts): `if (e.measures.size > MAX_MEASURES) w.measuresTruncated = true`;\n   - addMeasures and the WarningBag/mergeWarnings paths (src/core/model/performance.ts): when a new distinct measure is skipped because target.length >= MAX_WARNING_MEASURES, set the flag. mergeWarnings also carries over `w.measuresTruncated` from its inputs.\n\n3. In measureList (src/ui/practice/diagnostics.ts), use `const more = w.measuresTruncated === true`.\n\n4. Tests\n   - Update tests/practice.helpers.test.ts:210.\n   - Add a unit test: two notes in one measure give 'Measure 1' with no 'and others'.\n   - Add a test with more than 20 measures that does show 'and others'.\n\n5. Regenerate catalog.json if it stores warnings."
  },
  {
   "id": "ui:hand-span-reason-jargon",
   "verdict": "refuted",
   "reason": "The text is as quoted (prepare.ts:80) and appears in catalog.json for 11 pieces, but no requirement is broken.\n- Brief §16 and UI_SPEC:4-6 define 'plain language' as no developer terms, parser names or internal ids. Music words are not covered.\n- Brief §4 ('no musical-theory knowledge is required') is about using the app. Practising these pieces does not depend on understanding this note.\n- The main clause already says it plainly: 'one hand is asked to strike keys too far apart to reach at once'. '(wider than a tenth)' is a supplementary aside.\n- Other accepted diagnostics use the same kind of vocabulary: 'Trills, mordents and turns', 'Tremolos', 'Rolled (arpeggiated) chords', '8va'.\n- No contract says a readiness reason must point to where the problem is. Only the cross-staff message happens to, and the About dialog does list the hand-span measures.\n\nThe suggested rewrite is also wrong on the facts. MAX_HAND_SPAN is 16 semitones (prepare.ts:41), about 9-10 white keys, not '16 white keys'. Any optional polish should say 'about 10 white keys apart' and could add the More → About this arrangement pointer."
  }
 ]
}


===== verify:traceability =====
{
 "verdicts": [
  {
   "id": "traceability:suite-red-research-log-verify-batch2",
   "verdict": "confirmed",
   "reason": "Reproduced. `npx vitest run` gives 1 failed | 1201 passed (1202). The only failure is tests/catalog.difficulty-evidence.test.ts:97: \"Fur_Elise.mxl now has a verdict: take it off AWAITING_VERIFICATION\". The research log (mtime 08:05) now has a 'verify:batch2' pass. It gives confirmed=true verdicts for all four AWAITING_VERIFICATION files, and each verdict's level matches catalog/difficulty.json: Fur_Elise Intermediate, Gnossienne_No._1 Intermediate, Gymnopdie_No._1__Satie Beginner and Liebestraum_No._3 Advanced, all with basis 'source'. The test file (mtime 07:25) predates that pass. .github/workflows/deploy.yml runs `npm test` (vitest run) before `npm run build`, so a push to main would fail the build job and nothing would deploy. I simulated the test logic in /tmp with an empty backlog, and every sourced label then has a confirming verdict at the same level (0 failures). README.md:184-187 still says the four labels 'have not been re-checked since they were found'.",
   "refinedFix": "1. In tests/catalog.difficulty-evidence.test.ts, set `const AWAITING_VERIFICATION: string[] = [];`. Keep the constant and the 'may only shrink' check. Update its doc comment to say the batch-2 backlog was cleared by the 'verify:batch2' pass, and optionally retitle the test to 'every other sourced label was confirmed too'. The trailing `for (const file of AWAITING_VERIFICATION)` loop then does nothing.\n2. In README.md:184-187, replace the sentence saying four third-party labels have not been re-checked. Say instead that they were re-checked in 'verify:batch2' on 2026-10-02.\n3. Re-run `npx vitest run` and expect 1202/1202.\nOptional consistency note: the Für Elise verdict rests on 'search-index readings', because a direct fetch returned a directory index. In verify:batch1 that same page state made Ave Maria Unrated. If the team rejects that standard, make Fur_Elise.mxl Unrated and run `npm run catalog` instead of accepting the verdict. Either way, the test list must change."
  },
  {
   "id": "traceability:greensleeves-rating-found-but-says-none",
   "verdict": "confirmed",
   "reason": "The contradiction is clear from the data. The catalog/difficulty.json and src/catalog/catalog.json record has level Unrated and basis none. Its note says 'no published rating of this arrangement was found', and the popover adds BASIS_DESCRIPTION.none, 'No published rating was found for this arrangement.' (DifficultyBadge.tsx:22). The project's own log contradicts this: the 'verify:batch2' pass has a confirmed=true, level Beginner verdict citing \"LaSolSheet lists 'Arrangement: Makowski Dominique, Skill Level: Beginner, Measures: 33'\". I unzipped the score: one part, 33 measures, credit 'Arr. Dominique Makowski'. Arranger and length match, which is the same matching standard used for Für Elise and Gymnopédie. Round 1 made the label Unrated because the in-file basis was false and the 'sheet-music listing' sentence had no citation. That reason does not cover a source-basis label. I could not independently confirm the listing: a direct WebFetch of lasolsheet.com/piano-sheet-music/greensleeves/ returns an empty directory index, the same state as Für Elise and Ave Maria. The verdict also records no sourceUrl, which build-catalog.ts:217 requires for basis 'source'. So whether to adopt Beginner is a judgment call, but the 'none was found' wording is wrong under the project's own log.",
   "refinedFix": "Option A, adopt the label. Use this only if the listing is re-checked under the same evidence rule accepted for Fur_Elise in verify:batch2 (search-index readings when direct fetch shows a directory index). Set the catalog/difficulty.json record to: level 'Beginner', basis 'source', originalLabel 'Skill Level: Beginner', sourceName 'LaSolSheet listing of this MuseScore arrangement', sourceUrl 'https://lasolsheet.com/piano-sheet-music/greensleeves/', checkedOn the re-check date, arrangementUrl 'https://musescore.com/dominiquemakowski/greensleeves', and note 'Matched by Dominique Makowski credits and 33 measures.' Then run `npm run catalog` to regenerate src/catalog/catalog.json, catalog/inventory.json and docs/CATALOG_REPORT.md, and update any catalog tests that pin basis counts.\nOption B, keep Unrated (consistent with Ave Maria, since the page cannot be fetched directly). Rewrite the note along these lines: 'A third-party listing (LaSolSheet) reportedly gives this arrangement Beginner, but the listing could not be opened to re-check it, so it is left Unrated. The word “easy” in the title is a hint, not a rating.' Then run `npm run catalog`.\nUnder either option, nothing shown to the learner should say that no published rating was found."
  },
  {
   "id": "traceability:zip64-format-mxl-rejected",
   "verdict": "confirmed",
   "reason": "Reproduced in /tmp/vf/z. `zip -q -X -fz` on f01-melody-repeated.musicxml plus a META-INF/container.xml gives an archive whose classic EOCD has entries=2 and cd offset=0xFFFFFFFF, with a zip64 EOCD at 1149 (count 2, offset 997). `unzip -t` reports no errors, and Python zipfile and fflate's unzipSync both list both entries. extractMusicXmlText and loadSourceScore fail with \"bad-archive … the list of files in the archive could not be read\" because centralDirectory() returns null at mxl.ts:128 (`if (count === 0xffff || p === ZIP64) return null;`). The same files zipped without -fz open fine. fflate 0.8.3 always takes count and offset from the zip64 EOCD (ze+32, ze+48) when the locator is present, so the listing and the reader disagree only in this case. §12 lists .mxl as supported input, and this is a valid zip. Real-world exposure is limited to writers that force zip64, so the severity is minor. I patched a /tmp copy of mxl.ts with the fix below: the zip64 archive then opens, and tests/mxl.test.ts and tests/parser.test.ts (153 tests, including the two-directory hostile-archive tests) still pass against the patched module.",
   "refinedFix": "In src/core/mxl.ts centralDirectory(), replace the early `if (count === 0xffff || p === ZIP64) return null;` and the following agreement block with the steps below.\n1. Read the classic values first: `classicCount = getUint16(eocd+10)` and `classicOffset = getUint32(eocd+16)`. Keep `if (getUint16(eocd+8) !== classicCount) return null`.\n2. If the locator (0x07064b50 at eocd-20) points to an in-bounds zip64 EOCD (0x06064b50, with z+56 <= length), read `c64 = getBigUint64(z+32)` and `o64 = getBigUint64(z+48)`. Return null if c64 > 0xffffffff or o64 > MAX_SAFE_INTEGER.\n3. If classicCount === 0xffff or classicOffset === 0xffffffff and no valid zip64 record exists, return null.\n4. If a zip64 record exists, check each field separately: when the classic count is not the sentinel it must equal c64, and when the classic offset is not the sentinel it must equal o64, otherwise return null. Then use count = c64 and p = o64.\nThe directory-walk bounds checks and readEntry's comparison against fflate's listing stay unchanged, so the hostile two-directory protection is kept. Add a tests/mxl.test.ts case that takes the existing 'zip64 end record that names the same directory' fixture and also sets the classic EOCD offset to 0xFFFFFFFF (and, separately, the counts to 0xFFFF), and expects the F01 title. Keep the existing case where the records disagree, which must still give bad-archive."
  },
  {
   "id": "traceability:single-staff-reason-asks-to-read-notation",
   "verdict": "confirmed",
   "reason": "Reproduced. prepareScore on tests/fixtures/f-single-staff.musicxml gives readiness 'review' with readinessReasons ['All notes are written on a single staff, so they are all given to the right hand. Check whether some of them belong to the left hand.']. The second message, at hands.ts:229 ('… Check whether some of it belongs to the left hand.'), is produced when a part has more than one staff but only one carries main music. ReadinessChip shows readinessReasons on library cards (LibraryCard.tsx:112,155) and in the practice header (PracticePage.tsx:106). No UI component lets the user reassign notes to the left hand: there are no staffHands or ScoreOverrides references in src/ui. Round 1 confirmed and fixed the near-identical cross-staff message ('Check which hand should play them') under §2 ('must not need to read sheet music to use or validate the app') and §10. These two messages were missed. Built-in catalog entries do not carry these reasons (0 occurrences in catalog.json), so only imported files are affected. One correction to the suggested fix: the tests that quote the old text are tests/e2e.fixtures.test.ts:406, tests/model.hands.test.ts:223 and tests/model.prepare.test.ts:78. tests/parser.test.ts and tests/model.ossia-staves.test.ts do not quote it.",
   "refinedFix": "In src/core/model/hands.ts, keep both warnings at 'review' severity and with the same codes. Reword them to describe what the app does, without asking the learner to inspect the staff.\n- Line 85 (single-staff-part): 'All notes are written on one staff, so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for two hands, choose a two-staff arrangement instead.'\n- Line 229 (unclear-hand-mapping, left === null): `Only ${staffName(right, total)} of the piano music has the main music, so the app gives all of it to the right hand and the left-hand row stays empty. If the piece is meant for two hands, choose a two-staff arrangement instead.`\nUpdate the exact-text assertions in tests/e2e.fixtures.test.ts:406, tests/model.hands.test.ts:223 and tests/model.prepare.test.ts:78. No catalog regeneration is needed, because no catalog entry carries these reasons. Re-run `npx vitest run`."
  }
 ]
}


===== verify:engine =====
{
 "verdicts": [
  {
   "id": "engine:monitor-and-playback-share-sampler-voices",
   "verdict": "confirmed",
   "reason": "I reproduced this with the engine and FakeSampler (/tmp/r3eng/t1b.mts): in both Listen and Steady, the learner's held C4 is cut at 1.0 s, and the app's D4 sounds only from 1.0 to 1.1 s. I then checked the real PianoSampler with the Web Audio fakes from tests/audio.test.ts (/tmp/v3/real2.mts), calling it in the order the engine dispatches (app events about 150 ms ahead, learner events at once):\n- the learner's C4 source, struck at 0.02 s and held to 1.6 s, stops at 1.25 s, which is the app's note-off at 1.0 s plus the release fade;\n- the app's D4 source, struck at 1.0 s, stops at 1.35 s, which is the learner's tap release at 1.1 s plus the fade, instead of after 2.0 s.\nCause, from the code:\n- noteOff (sampler.ts:248-250) releases every voice of the key with start < t, whoever started it;\n- the noteOn re-strike/nextStrike logic (sampler.ts:222-226, 236) works across sources too;\n- the engine sends monitored input through the same calls (session.ts:1211 and monitorOff at 1236-1241) as app playback (session.ts:1004-1007);\n- releaseMonitored (on 'Hear my playing' off) and pedal-up also send noteOff(k, now), so they cut app voices on those keys.\nThe 'Hear my playing' switch is offered in every mode (MoreMenu.tsx:92-107). The brief does not literally require separate voices, but §9 requires input to be kept separate from app playback, and the result is plainly wrong: each source's release ends the other's sound.",
   "refinedFix": "Tag voices with their source in the sampler:\n- Add an optional last parameter `source: 'app' | 'input' = 'app'` to noteOn(midi, velocity?, when?, source?) and noteOff(midi, when?, source?) in PianoSampler, SamplerLike and FakeSampler.\n- Store it on Voice/FakeVoice. Make voicesOf(midi, source) filter by it, so that both the noteOn re-strike/nextStrike logic and noteOff's `v.start < t` release apply only to voices of the same source.\n- allNotesOff stays as it is.\nIn session.ts:\n- onMidiEvent: `this.sampler.noteOn(ev.midi, ev.velocity, t, 'input')`;\n- monitorOff: `this.sampler.noteOff(midi, ..., 'input')`. This covers key-up, pedal-up and releaseMonitored.\nApp playback, previews and switchClock keep the default 'app'.\nAdd engine tests with Listen and Steady, Sound on and monitorInput on:\n- the learner holds the app's key past the app's release, and their voice sounds until their own note-off;\n- a short learner tap that overlaps the app's next strike leaves the app's voice sounding to its scheduled end;\n- turning monitorInput off, or lifting the pedal, does not shorten app voices.\nAdd a sampler unit test that noteOff(k, t, 'input') leaves an 'app' voice of k untouched."
  },
  {
   "id": "engine:sampler-error-state-silences-new-session",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3eng/t2.mts (shared FakeSampler, page A played, then 'error', page B is a new session):\n- the preview on page B makes no sampler calls;\n- Steady with Sound off → Play → Sound on gives 0 noteOns.\nReproduced with /tmp/r3eng/t7.mts: a run that page B placed on the audio clock (sampler 'loading' from page A) falls silent when the load ends in 'error'. It had 3 noteOns before and 0 after.\nThe code confirms the chain:\n- the sampler is an app-wide singleton (src/app/services.ts:8), and PracticePage creates a new PracticeSession per piece (PracticePage.tsx:281);\n- audioUsable() excludes 'error' unless this session's own ensureStarted resolved (session.ts:1285-1288);\n- startAudioQuietly returns unless the state is 'not-started' (1308);\n- tick() moves an audio-clock run to 'wall' when pickClock changes (861).\nWith the real PianoSampler (/tmp/v3/real.mts):\n- after a sample 404, the state is 'error', yet noteOn still creates a voice (the fallback or the loaded samples);\n- ensureStarted() called from 'error' switches the state to 'loading' synchronously and retries the load.\nSo 'error' does not mean audio is unusable, and the engine wrongly goes silent. This contradicts §15 and ARCHITECTURE §6 (audio must not fail silently). The impact is minor: Play with Sound on recovers, because play() calls ensureStarted.",
   "refinedFix": "In src/engine/session.ts:\n1. startAudioQuietly: replace the early return with `const st = this.sampler.state; if ((st !== 'not-started' && st !== 'error') || this.audioPending) return;`. A gesture (preview via next/prev, Sound on, Count-in on, 'Hear my playing' on) then calls ensureStarted(). When a context exists, PianoSampler switches to 'loading' synchronously, so preview()'s audioUsable() check right after passes and the step sounds. audioStarted is set when it resolves. If the AudioContext itself cannot be created, the state stays 'error' and the call rejects, so the preview stays silent as today.\n2. Do not move a run from 'audio' to 'wall' only because the state became 'error'. In pickClock: `if (this.run?.clock === 'audio' && this.sampler.state === 'error') return 'audio';`. A run only reaches the audio clock when a context exists, and a sample-load failure does not stop that context.\nCleaner alternative to both: add `readonly contextRunning: boolean` to SamplerLike (PianoSampler: `this.ctx?.state === 'running'`) and make audioUsable() return `this.audioStarted || this.sampler.contextRunning || s === 'loading' || s === 'ready'`.\nMake FakeSampler.ensureStarted copy the real sampler: from 'error' without failStart, set 'loading', then 'ready' or 'error'.\nAdd tests with a shared sampler in 'error' and a new session:\n- next() produces sampler noteOns;\n- Steady with Sound off → play → Sound on produces noteOns;\n- a run on the audio clock keeps sounding after setState('error')."
  },
  {
   "id": "engine:count-in-beat-ignores-meter",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3eng/t4.mts on the catalog pieces:\n- fur-elise (ready, 3/8, qpm 72): click gap 0.833 s, which is a quarter note;\n- fur-elise-fingered (3/8): 1.000 s;\n- fur-elise-beethoven-for-beginner-piano (3/8): 1.132 s;\n- lacrimosa-requiem (ready, 12/8): 0.937 s, a quarter instead of the 1.406 s dotted quarter;\n- the 9/8 and 12/8 review pieces behave the same.\nThe cause is clear in the code. countInBeat (session.ts:715-721) uses only `60 / tempoAt(...) / speed`, and the tempo map is in quarter notes per minute (types.ts:195). Nothing outside the parser reads SourceMeasure.timeSignature; grep finds no consumer.\nCaveats:\n- the brief only asks for 'a short count-in';\n- app-builder-reports.md documents 'The beat is a quarter note' as a deliberate choice.\nHowever, APP_CONTRACTS says the interval is 'one beat', and a quarter note is not a beat of 3/8 or 12/8. Clicks every two eighths in 3/8 set up a duple pulse that contradicts the piece, which defeats the purpose of a count-in. Minor.\nThe reviewer's claim that PreparedScore needs a new field is not accurate: PreparedScore.source.measures[measureIndex].timeSignature and MeasureOccurrence.measureIndex are already available to the engine.",
   "refinedFix": "In session.ts countInBeat, Listen branch:\n1. Find the MeasureOccurrence in this.score.measures with startTick <\\= tick < startTick + durationTicks.\n2. From occ.measureIndex, scan this.score.source.measures backwards for the first timeSignature: {beats, beatType}.\n3. Set quartersPerBeat:\n   - beatType === 8 && beats % 3 === 0 && beats >= 6 → 1.5 (dotted quarter for 6/8, 9/8, 12/8);\n   - otherwise 4 / beatType (3/8 → 0.5, x/4 → 1, x/2 → 2);\n   - with no time signature, 1.\n4. beat = quartersPerBeat * 60 / tempoAt(this.score.tempo, tick) / this.settings.speed, with the same finite/positive guard.\nSteady stays at stepSeconds.\nUpdate the APP_CONTRACTS Count-in line, for example: 'one beat of the time signature in force at the start (dotted quarter in 6/8, 9/8, 12/8; eighth in 3/8; half in x/2), at the start tempo divided by speed'. Also update the builder report line.\nAdd tests at qpm 120, speed 1, by setting source.measures[0].timeSignature:\n- 6/8 → clicks 0.75 s apart;\n- 3/8 → 0.25 s;\n- 4/4 → 0.5 s (unchanged)."
  },
  {
   "id": "engine:pause-during-count-in-skips-count-in",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3eng/t10.mts (Listen, count-in on): Play, then pause at 800 ms (status count-in, countInRemaining 3), then Play again. The result is 0 new clicks and the first note 50 ms after Play.\nThe code makes the cause clear:\n- pauseInternal (session.ts:651-662) turns 'count-in' into 'paused' without remembering that the music never started;\n- play() counts in only when `restart || this.status === 'stopped'` (session.ts:532-534).\nThe documented intent is that an interrupted count-in starts again: app-builder-reports.md says 'Seeking or changing the speed during a count-in starts the count-in again'. The contract also says the count-in plays before Listen or Steady starts, and here playback starts with none. The existing test (engine.test.ts:766) only pauses after the music has begun. The same path applies to a loop-restart count-in and to pagehide, which calls pauseInternal.",
   "refinedFix": "Add `private countInInterrupted = false` to PracticeSession.\n- In pauseInternal, before changing status: `if (s === 'count-in') this.countInInterrupted = true;`.\n- In play(): `const fromStart = restart || this.status === 'stopped' || this.countInInterrupted;`.\n- Clear the flag at the start of startRun() and in stop().\nThe status stays 'paused', so the UI and the 'paused' semantics are unchanged, and the marker (the start step) is kept.\nAdd tests:\n- Listen with count-in: play, advance 800 ms, pause, play → 4 new clicks, and the first noteOn comes no sooner than 4 beats after the second play;\n- the same for a loop restart's count-in;\n- pausing after the music has started still resumes without a count-in (the existing test)."
  },
  {
   "id": "engine:follow-me-still-sends-cc64-cc123",
   "verdict": "uncertain",
   "reason": "The emission reproduces. In /tmp/r3eng/t9.mts (real MidiManager, Follow me with loop, output = the piano), the learner finishes the passage with the pedal down, and at the loop restart the piano receives `b0 7b 0` and `b0 40 0` although the app sent no note.\nFrom the code:\n- releaseAll calls midi.allNotesOff() whenever an output is selected, including the keepMonitor paths (session.ts:1099; reached from 855, 664 and 446);\n- MidiManager.allNotesOff always sends CC123 and CC64=0 (manager.ts:327-328);\n- in Follow me no app note can be outstanding: preview() returns early, there is no run, and a mode change already does a full release.\nHowever, I could not confirm a defect:\n- this is the documented contract: APP_CONTRACTS 'No stuck notes' says of the Follow me exception 'The MIDI output is still released';\n- the brief (§9) asks to release app-generated notes and prevent echo loops; the echo half was fixed in round 2, and nothing in the brief forbids these controller messages;\n- the actual harm (a pedalled chord cut on the learner's piano) depends on the instrument and cannot be reproduced without hardware.\nThe round-2 verifier reached the same 'uncertain' verdict on this exact issue. The 'round-2 fix incomplete' framing is therefore inaccurate: round 2 deliberately left this part unresolved, not half-fixed.",
   "refinedFix": "If the orchestrator chooses to act, this is low-risk and contract-changing:\n- in PracticeSession.releaseAll, change the output line to `if (this.outputActive() && !keepMonitor) this.midi.allNotesOff();`. keepMonitor is true only on the Follow me paths (loop restart, pause while waiting, non-mode settings changes while prev.mode === 'follow'), where the app has sent nothing.\n- update APP_CONTRACTS 'No stuck notes' (replace 'The MIDI output is still released' with 'Nothing is sent to the MIDI output, which Follow me never plays on') and the matching ARCHITECTURE §7 sentence.\n- optional and separate: drop CC64=0 from MidiManager.allNotesOff, because the app never sends a sustain-on. This also needs the sentCc echo-guard records adjusted.\n- add a test: Follow me with an output and loop on; across the loop restart, pause and a hands change, the output receives no messages."
  }
 ]
}


===== verify:follow-midi =====
{
 "verdicts": [
  {
   "id": "follow-midi:always-present-port-replaces-piano",
   "verdict": "confirmed",
   "reason": "Reproduced. I ran the reviewer's manager scripts (/tmp/r3fm/linux1-3.mts) and the page-level jsdom test (/tmp/r3fm/ui/linux.test.ts, real PracticePage and MidiManager) myself.\n- Piece saved with midiInputId 'piano', only 'Midi Through Port-0' present at Connect: selected 'thru', notice null, status 'MIDI: Midi Through Port-0 connected', Follow me enabled.\n- The piano is then plugged in with the SAME id 'piano': the selection stays on 'thru', and a C4 from the piano is not delivered.\n- The page saves global midiInputName 'Midi Through Port-0' and the piece's midiInputId 'thru'.\n- Next visit with the piano on: 'thru' is chosen again by the saved id. Another piece with no saved id: 'thru' is chosen by fallbackInput's saved-name match, although two inputs are present and the phase would otherwise be 'choose'.\n\nCause:\n- manager.ts:408-413: mayAutoSelect includes firstConnect and !inputSeenFlag, so a never-seen saved id gives way to any sole input.\n- The pre-selection at midiConnection.ts:167 has name null (manager.ts:243-244), and the displaced id is not remembered. The piano can never win back the selection once the stand-in has been 'seen'.\n- PracticePage.tsx:179-181 persists whatever connects.\n\nThis matches ARCHITECTURE §5's 'gives way to the only connected input' wording. It breaks UI_SPEC's rule that a remembered piano that has not turned up yet is reported as 'No piano found' (or the list asks for a choice) and 'is attached when it is switched on', and brief §9's graceful connection/reconnection. The trigger needs an always-present input: Linux Midi Through, an audio interface's MIDI In, or an enabled IAC/loopMIDI port.",
   "refinedFix": "1. src/midi/manager.ts: remember the displaced selection and restore it.\n   - Add `private displaced: Selection | null = null`.\n   - In reconcile(), when the sole-input branch replaces a non-null selection that was never seen (`this.inputSel.id !== null && !this.inputSeenFlag`), set `this.displaced = { ...this.inputSel }` before overwriting inputSel.\n   - At the start of reconcile(), if `this.displaced` is set and `findPort(access.inputs, this.displaced)` returns a port, switch to it: `inputSel = { id: port.id, name: port.name }`, `bindInput(port)`, `displaced = null`.\n   - Clear `displaced` in selectInput(), which is an explicit choice.\n   - Expose `get inputAutoPicked(): boolean { return this.displaced !== null; }`.\n\n2. Let the pre-selection carry the remembered name, so the piano can also be re-found by name.\n   - Change the signature to `selectInput(id, name?: string | null)` and store `name: port?.name || rememberedName || name || null`.\n   - In midiConnection.ts:167 call `midi.selectInput(savedInputId, savedInputName)`.\n   - Add the optional parameter to MidiControl.\n\n3. src/ui/practice/midiConnection.ts:159-161: skip onConnected while `midi.inputAutoPicked` is true, and add it to the effect's deps. A stand-in port is then never saved as the piece's midiInputId or the global midiInputName. Once the piano is re-attached, or the learner picks a device from the list, it is saved as before.\n\n4. Never auto-pick loopback ports: ignore inputs whose name matches /^midi through\\b/i when counting the sole input in reconcile() and in fallbackInput's 'only other input' rule. On Linux, Connect with the piano off then says 'No piano found'.\n\n5. Docs and tests.\n   - Update ARCHITECTURE §5: a never-seen remembered input gives way to the only connected input until it turns up, and is then re-attached.\n   - Add jsdom tests:\n     (a) Saved 'piano', only 'USB MIDI Interface' at Connect: connected to it and nothing persisted. Then plug in 'piano': the selection moves to 'piano' and 'piano' is persisted.\n     (b) Only 'Midi Through Port-0' at Connect: the 'No piano found' notice."
  },
  {
   "id": "follow-midi:echo-guard-swallows-in-time-presses",
   "verdict": "refuted",
   "reason": "The mechanics reproduce (/tmp/r3fm/echo1.mts gives ['noteoff:60','noteon:62']; echo2.mts gives physicalDown [] after the learner's in-time C4), but this is the documented trade-off, not a defect.\n- ARCHITECTURE §5 specifies it: 'an input note-on that matches a note-on the app sent to an output within the last 80 ms is dropped'.\n- Brief §9's 'Prevent MIDI echo/feedback loops' forces it: Web MIDI cannot tell an echo from a real strike of the same key in the same instant.\n\nThe impact is narrower than claimed.\n- Follow me never sends notes to the output (preview() returns early in follow and there is no run), so no Follow me check can be affected.\n- The loss is limited to Listen/Steady. There input is never scored (onMidiEvent only feeds the matcher in follow), so 'good timing is penalised' is wrong.\n- The swallowed key is one the app's playback is sounding at that same moment on the output, so the pitch is still heard and the key is lit as app playback. Only the 'your key' dot and a doubled monitor voice are missing.\n- Nothing gets stuck: the orphan note-off is harmless.\n\nThe suggested fix would regress §9. No echo can be detected before the first allNotesOff (selectOutput sends nothing to the new port), so a whole first Listen run on an echoing piano would leak echoes into physicalDown and 'Hear my playing'.\n\nOne optional, safe refinement: consume one `sent` record per swallowed echoed note-on in isEcho. On an echoing device the player's own strike after the echo is then delivered. It does not change the non-echo case the finding describes.",
   "refinedFix": ""
  },
  {
   "id": "follow-midi:late-midi-echo-leaks-as-input",
   "verdict": "confirmed",
   "reason": "Reproduced with my own script (/tmp/vfm3/stall.mts): real MidiManager and PracticeSession, an output port that echoes 3 ms after the real send time max(at, now), Listen with Sound and monitorInput on.\n- Stall 150 ms right after the tick at 10250: D4's note-on, due at 10300, goes out late at 10400 with atMs 10300. Its echo at 10403 is delivered as 'noteon62@10403'.\n- physicalDown shows [62] for about 150 ms, and the sampler gets an extra noteOn 62 at 2.403 on top of playback's 62 at 2.3 (a double strike).\n- Stall 200 ms: the same.\n- Stalls of 90-120 ms at these offsets do not trigger it. The threshold depends on alignment: roughly 95-120 ms (40 ms MIDI lookahead + 80 ms window, minus the offset within the 25 ms tick).\n\nCause:\n- session.ts dispatchMidi computes `atMs = nowMs() + (when - now) * 1000`, which is in the past for overdue events.\n- manager.ts:489-493 remember() records that past time.\n- isEcho requires `time - r.at <= 80`.\n\nAPP_CONTRACTS itself says later MIDI messages tolerate only about 15-40 ms of stall, so late sends are expected; when they happen, echoes become 'player' input. That violates brief §9 ('Track physical pressed keys separately from ... app-generated playback events', 'Prevent MIDI echo/feedback loops').\n\nI prototyped the fix (/tmp/vfm3/proto/manager.ts, /tmp/vfm3/stall_fixed.mts):\n- With 150, 200 and 400 ms stalls: no input events, no physicalDown, no extra monitored note-on.\n- With the prototype aliased in (alias confirmed loaded), tests/midi.test.ts and tests/engine.test.ts pass 161/161. The full suite passes apart from tests/catalog.difficulty-evidence.test.ts, which also fails without the change and is unrelated.",
   "refinedFix": "src/midi/manager.ts, remember(): record when the message actually goes out. A past timestamp is sent at once.\n\n```ts\nprivate remember(midi: number, type: NoteKind, atMs?: number): void {\n  const now = this.now();\n  this.sent = this.sent.filter((r) => r.at + SENT_RECORD_TTL_MS >= now);\n  this.sent.push({ midi, type, at: atMs === undefined ? now : Math.max(atMs, now) });\n}\n```\n\n- lastSent and scheduledOns need no change: lastSent is only compared with `<= now` later, and scheduledOns is only set for atMs > now.\n- Add a test in tests/midi.test.ts or tests/engine.test.ts with an output that echoes 3 ms after max(at, now). Run Listen with monitorInput on, call FakeClock.stall(150) right after a tick so that a note-on is more than 80 ms overdue, then advance. Expect no delivered input events, physicalDown always [], and no extra sampler noteOn."
  },
  {
   "id": "follow-midi:follow-still-sends-cc123-cc64-to-piano",
   "verdict": "uncertain",
   "reason": "The emission reproduces (/tmp/r3fm/follow_out.mts): Follow me with loop, output set to the piano. The loop restart, a hands change and Pause each send 'b0 7b 0','b0 40 0', and no app note-on is ever sent in Follow me.\n\nHowever, it is not a defect against the documented contracts.\n- APP_CONTRACTS ('No stuck notes', Follow me exception) says 'The MIDI output is still released'.\n- tests/engine.test.ts:1936 pins it ('The MIDI output is still released on each change').\n- ARCHITECTURE §5 defines allNotesOff as always sending CC123 and CC64=0.\n- The finding's framing as 'Round-2 fix incomplete' is inaccurate. Round 2's verifier rated engine:follow-me-sends-sustain-off-to-piano 'uncertain', and it was left unfixed by decision. The related echo item, which was fixed, now keeps an echoed CC64=0 from lifting the app's pedal state.\n- Brief §9 requires releasing app-generated notes and keeping input state separate. It does not forbid extra controller messages.\n\nThe remaining harm is that a real instrument applies a received CC64=0/CC123 on channel 1 to the learner's locally pedalled sound. That is plausible for many digital pianos but device-dependent, and it cannot be reproduced without hardware.\n\nThe messages are redundant: nothing app-generated can be outstanding in Follow me. A mode change already does a full release, and selectOutput releases the old port. If the orchestrator acts, the low-risk change is to skip midi.allNotesOff() on the keepMonitor paths:\n- releaseAll(keepMonitor=true) from the tick loop restart;\n- pauseInternal while following;\n- updateSettings when prev.mode === 'follow' and the mode is unchanged.\nThen update the APP_CONTRACTS exception text and engine.test.ts:1936."
  },
  {
   "id": "follow-midi:output-select-desync-after-rename",
   "verdict": "confirmed",
   "reason": "Reproduced at page level with my own jsdom test (/tmp/vfm3/ui/out.test.ts): real PracticePage and MidiManager, piece saved with midiOutputId 'out-1'.\n- Before the re-plug, the More menu's 'Play through connected piano' select value is 'out-1'.\n- After both ports re-enumerate as in-2/out-2 with the same name 'Digital Piano', the manager re-finds them by name (selectedOutputId 'out-2', input in-2 connected).\n- The select now shows '' (Off), with options [Off, out-2:Digital Piano], while sendNoteOn still reaches out-2 ([144,60,80]). The reviewer's /tmp/r3fm/out1.mts gives the same result.\n\nCause:\n- manager.ts:416-417 updates outputSel.id silently.\n- Nothing syncs settings.midiOutputId: session.onMidiChange only tracks the input, and there is no output counterpart to onConnected.\n- midiConnection.ts:224 drops 'out-1' from the list, so MoreMenu.tsx:61 sees `outputKnown` false and renders value ''.\n- session.outputActive() is still true (midiOutputId 'out-1' is non-null), so playback continues.\n\nChoosing 'Off' while 'Off' is already the selected option fires no change event in a browser, so the learner cannot turn the output off directly. The control does not reflect state (brief §9: 'explicit output-device selection').\n\nThe reopen claim follows from the code. A new session calls selectOutput('out-1'); if the old port is gone from the map, rememberedName is null, so the output goes silent and the list shows 'Unnamed MIDI device'. With Chrome keeping the disconnected port in the map, its name would let it re-find out-2. So that sub-claim depends on the platform.",
   "refinedFix": "Sync the session setting when the manager re-identifies the selected output by name. In src/engine/session.ts onMidiChange(), inside the existing mutate():\n\n```ts\nconst outId = this.midi.selectedOutputId;\nif (this.settings.midiOutputId !== null && outId !== null && outId !== this.settings.midiOutputId) {\n  this.settings = { ...this.settings, midiOutputId: outId };\n}\n```\n\n- Do not releaseAll or call selectOutput: it is the same device, and the manager has already moved to it.\n- The snapshot change makes usePieceStateSaver persist the new id, and MoreMenu's outputKnown becomes true again.\n- Optionally, also save the global midiOutputName there.\n- Add a jsdom test next to tests/practice.midi.test.ts: output out-1 selected, then the port re-enumerates as out-2 with the same name. Expect the More menu select value to be 'out-2', choosing Off to call selectOutput(null) and stop sends, and the piece state to save midiOutputId 'out-2'."
  }
 ]
}


===== review:security-storage-deploy =====
{
 "findings": [
  {
   "id": "parts-times-columns-oom",
   "title": "A 15 KB .mxl with many parts crashes the tab (heap out of memory): the parser allocates one cell per part for every measure column of the longest part",
   "severity": "major",
   "briefRef": "§12 Supported input: corrupt or unsupported content and excessive sizes must give a readable error. Same class as the round-2 finding staves-count-oom-crash.",
   "files": [
    "src/core/musicxml/parse.ts",
    "src/core/musicxml/part.ts"
   ],
   "evidence": "Code:\n- parse.ts:319 sets `columns` to the longest part's measure count.\n- parse.ts:324-327 calls `reader.readMeasure(i, p.measures[i])` for every column of every part, including columns the part does not have.\n- part.ts:346-397: readMeasure allocates a cell object plus `emptyMarks()` (an object with an `endings` array) even when `src` is undefined.\n- parse.ts:151-153 buildMeasures then runs `results.map(...)` over all parts for every column.\n- Work and memory are therefore parts x columns, unbounded. There is no limit on part count.\n\nRepro: /tmp/r3sec/parts2.mts and /tmp/r3sec/imp1.mts. The file has one part with M measures (one note) and P parts holding one empty `<measure/>` each.\n- P=M=1000: 43 KB XML, 193 ms, 351 MB RSS.\n- P=M=3000: 131 KB XML or a 7.8 KB .mxl. parseMusicXml takes 1628 ms at 2.16 GB RSS, readiness 'review', so importFile saves it.\n- P=M=6000: /tmp/r3sec/parts_6000x6000.mxl, 15,074 bytes. parseScoreBytes dies with \"FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\" at 4.46 GB RSS after 7 s.\n\nimportFile runs this synchronously on the main thread (imports.ts:258), and loader.ts:95 does it again on every open. An OOM cannot be caught by the ImportError path or the ErrorBoundary.",
   "failureScenario": "1. The learner imports a tiny damaged or hostile .mxl (about 15 KB).\n2. While \"Checking the score…\" is shown, the tab runs out of memory and Chrome shows \"Aw, Snap! Out of memory\". Chrome's 4 GB V8 heap cage is reached sooner than Node's.\n3. No readable error appears.\n4. A slightly smaller file (7.8 KB) imports as 'review' using about 2 GB. Every later open of that piece repeats the 2 GB, multi-second parse.",
   "suggestedFix": "1. Do not create cells for measures a part does not have. Keep each part's cells sparse (a Map by column, filled only for present measures).\n2. In buildMeasures, iterate only the present cells of each column, for example by building column → cells lists once.\n3. As defence in depth, reject implausible structure early with ImportError('too-large' or 'unsupported'). For example, cap the number of parts (a few hundred), or reject when parts x columns exceeds about 2e6.\n4. Add a test in which a parts=columns=6000 file fails fast with a readable error."
  },
  {
   "id": "measure-label-quadratic-regression",
   "title": "Regression (round-2 duplicate measure numbering): a 9 KB .mxl whose measure numbers repeat freezes the page for about 90 s on import and again on every open",
   "severity": "major",
   "briefRef": "§12: malformed content must give a readable error, not hang. Regression from the round-2 fix music:duplicate-measure-numbers-not-disambiguated.",
   "files": [
    "src/core/measures.ts"
   ],
   "evidence": "Code, measures.ts:33-46:\n- When a digit number repeats, `base = raw; extra = 0`, then `do { label = nextLabel(base, extra++) } while (used.has(label))`.\n- Every repeat of the same number restarts the search at \"1a\" and walks past every earlier label. The k-th repeat costs k iterations.\n- Each iteration builds `letters(k)` = `'z'.repeat(k/26) + letter` (line 57), a string up to k/26 characters long.\n- Total cost is roughly cubic in the repeat count.\n- The all-equal shortcut at lines 22-25 does not apply when two numbers alternate.\n- measureDisplayNumbers runs at parse.ts:334, performance.ts:173 and :333, and hands.ts:397.\n\nRepro: /tmp/r3sec/mnum.mts. Measures are numbered 1,2,1,2,..., each with one note. Times are measureDisplayNumbers alone, then the full parseScoreBytes:\n- N=2,000 (1.4 KB .mxl): 133 ms; import 341 ms.\n- N=5,000 (2.7 KB): 1.3 s; import 2.8 s.\n- N=10,000 (4.9 KB): 7.1 s; import 14.5 s.\n- N=20,000 (9.2 KB, /tmp/r3sec/mnum_20000.mxl): 43 s; import 88 s.\n\nReadiness is 'review', so the file is saved. Its labels are 380+ characters long (\"1zzzz…zx\").",
   "failureScenario": "1. The learner imports a small damaged or hostile .mxl whose measures repeat a few numbers.\n2. The tab is frozen with \"Checking the score…\" for 1.5 minutes. A larger file freezes it for many minutes, and the browser offers to kill the page.\n3. If the user waits, the piece is saved. Each later open freezes for as long again.\n4. The passage selects list measure names hundreds of characters long.",
   "suggestedFix": "1. Keep a per-base counter, `const nextExtra = new Map<string, number>()`, and resume each base's letter search where it stopped, so labelling is O(N).\n2. Optionally cap the suffix length or fall back to positional numbers (String(index+1)) once a base repeats more than about 26 times.\n3. Add a test: 20,000 measures numbered 1,2,1,2,… must label in well under 100 ms."
  },
  {
   "id": "test-suite-fails-deploy-blocked",
   "title": "`npm test` currently fails (1 of 1202), so the GitHub Pages workflow stops before building or deploying",
   "severity": "major",
   "briefRef": "§15 \"Provide a documented build and a GitHub Pages deployment workflow\"; §18.2 \"GitHub Pages deployment is prepared\"",
   "files": [
    "tests/catalog.difficulty-evidence.test.ts",
    "docs/dev/difficulty-research-raw.json",
    "README.md"
   ],
   "evidence": "Results:\n- `npx vitest run` (also with TZ=UTC LANG=C CI=true) gives \"Tests 1 failed | 1201 passed (1202)\".\n- Failing test: catalog.difficulty-evidence.test.ts > \"every other sourced label was confirmed too, apart from the listed batch-2 backlog\".\n- Message: \"Fur_Elise.mxl now has a verdict: take it off AWAITING_VERIFICATION\" (test line 97).\n\nCause:\n- docs/dev/difficulty-research-raw.json was modified at 08:05:02, after the round-2 integration report (review-round2.md, 08:03:53).\n- It gained a `verify:batch2` pass with confirmed verdicts for all four files still listed in AWAITING_VERIFICATION (test lines 56-61): Fur_Elise (Intermediate), Gnossienne (Intermediate), Gymnopdie (Beginner), Liebestraum (Advanced).\n- Their levels match catalog/difficulty.json, so the tripwire fires by design.\n\nImpact:\n- .github/workflows/deploy.yml:29 runs `npm test` before `npm run build` (line 30) and upload (31-33), so the deploy job fails.\n- README.md:185 still says these labels \"have not been re-checked since they were found\".",
   "failureScenario": "1. The user follows README §Deploying (`git add -A`, commit, push to main).\n2. The \"Deploy to GitHub Pages\" run fails at the `npm test` step.\n3. The site is never published.\n4. Locally, `npm test` also reports a failure although the project is described as passing.",
   "suggestedFix": "1. Remove the four now-verified files from AWAITING_VERIFICATION in tests/catalog.difficulty-evidence.test.ts. Their verdicts confirm the recorded levels, so the stricter branch at lines 100-101 then passes.\n2. Update README.md:185, and CATALOG_REPORT.md if it repeats it, so they no longer say these labels were never re-checked.\n3. Re-run `npx vitest run` and `npm run catalog`."
  },
  {
   "id": "absurd-pitch-stalls-scheduler",
   "title": "Pitches far outside MIDI range (e.g. <octave>100000</octave>) are imported, then throw in the audio scheduler on every tick: the rest of the passage never sounds and started notes are never released",
   "severity": "minor",
   "briefRef": "§12: validate content and give a readable error for malformed input; §17 browser check \"Pause, resume, seek, loop, and navigation do not leave notes sounding\"",
   "files": [
    "src/core/musicxml/part.ts",
    "src/core/musicxml/parse.ts",
    "src/audio/sampler.ts",
    "src/engine/session.ts"
   ],
   "evidence": "Import:\n- The parser accepts any `<octave>`, `<alter>` or `<transpose>` value (MusicXML limits octave to 0-9).\n- /tmp/r3sec/craft.mts: `<octave>100000000</octave>` gives press midi 1,200,000,012, `<alter>1e8</alter>` gives 100,000,060, and transpose chromatic 1e8 gives 112,000,072.\n- Each is readiness 'review' (\"outside the 88 keys\") and is saved. Card stats read e.g. \"C100000000\".\n\nAudio:\n- sampler.noteOn (sampler.ts:207-233) only checks Number.isFinite(midi).\n- sampleForMidi gives playbackRate 2^((midi-108)/12) = Infinity for any midi above about 12,400.\n- sampler.ts:403 then does `source.playbackRate.value = Infinity` (fallback voice: `osc.frequency.value`, line 413). In browsers that throws TypeError, because AudioParam.value is a WebIDL float.\n- session.ts dispatchDue (≈ lines 1000-1007) has no try/catch and does `run.nextEvent++` only after the call, so every scheduler tick rethrows on the same event.\n\nSimulation: /tmp/r3sec/pitch.mts runs the real PracticeSession with a FakeSampler that throws like the browser on a non-finite rate. Score: RH C5, D(octave 100000), E5, F5, G5; LH C3, G3.\n- \"errors thrown from the scheduler tick: 93\".\n- noteOns [48, 72], noteOffs [72].\n- status 'playing', stepIndex 0.\n- So LH C3 is started but never released, nothing after the bad note plays, and the marker stays still.",
   "failureScenario": "1. A damaged or hostile file with an absurd octave or alter value imports as \"needs review\".\n2. When the learner presses Play, the notes before the bad one sound and then playback silently stalls while still showing \"playing\".\n3. Every 25 ms tick throws an uncaught TypeError.\n4. Keys already started (including on a MIDI output) stay on until the learner pauses or stops.",
   "suggestedFix": "1. In part.ts, treat octave outside 0-9, |alter| above a small bound (e.g. 3) and |chromatic transpose| above e.g. 48 as invalid: ignore or round them and add a warning.\n2. In buildNotes, drop or flag notes whose midi is outside 0-127.\n3. Also guard the runtime: sampler.noteOn should return when the computed rate or frequency is not finite (or the note is not on the piano). dispatchDue should advance `nextEvent` before calling out, or catch per event, so one bad event cannot stall a run."
  },
  {
   "id": "internal-hostname-in-published-docs",
   "title": "The round-2 lockfile fix removed the employer's internal registry host from package-lock.json, but docs/dev/review-round2.md now publishes it (with access details), and the README's `git add -A` commits it",
   "severity": "minor",
   "briefRef": "§14/§15: a GitHub Pages site and its repository are normally public; round-2 finding lockfile-pinned-to-private-registry (\"the public repository publishes an internal company infrastructure hostname\")",
   "files": [
    "docs/dev/review-round2.md"
   ],
   "evidence": "Search:\n- `grep -rln 'internal mirror\\|<internal-host>' --exclude-dir=node_modules --exclude-dir=dist .` returns only docs/dev/review-round2.md.\n- `grep -c internal mirror docs/dev/review-round2.md` gives 5.\n\nDetails published:\n- Line 39 names <internal-host>/repository/npm-all/, says the host \"resolves publicly (8.8.8.8 returns d2dzg2xfa6top.cloudfront.net)\", and says \"from this corporate network an unauthenticated GET of fflate-0.8.3.tgz returned 200\".\n- Lines 360-361, 768-769 and 996 repeat the host and describe the user's ~/.npmrc.\n\nPublication path:\n- .gitignore does not exclude docs/dev.\n- README.md:142-154 tells the user to `git init`, `git add -A` and push to a GitHub repo that must be public for free Pages.\n- package-lock.json itself is clean: 212 of 212 `resolved` URLs point to registry.npmjs.org, and the guard test passes.",
   "failureScenario": "The user publishes the repository as the README instructs. The public repo then contains the employer's internal package-mirror hostname, its CloudFront backing, and a note that it serves packages without authentication from the corporate network. This is the exposure the round-2 fix set out to remove.",
   "suggestedFix": "Redact the host and the network/access details from docs/dev/review-round2.md (e.g. \"an internal company npm mirror\"), and check review-round1.md and the builder reports the same way. Alternatively, keep docs/dev out of the published repo (add it to .gitignore or move it outside the project). Optionally extend tests/deploy.lockfile.test.ts to fail if the internal host appears in any tracked text file."
  },
  {
   "id": "zip64-mxl-rejected-as-damaged",
   "title": "A valid Zip64 .mxl (end record with 0xFFFF/0xFFFFFFFF markers) is rejected as \"damaged\", although fflate and every other unzip tool read it",
   "severity": "minor",
   "briefRef": "§12 Supported input: compressed MusicXML (.mxl); errors must be accurate and readable",
   "files": [
    "src/core/mxl.ts"
   ],
   "evidence": "Code: centralDirectory() returns null when the classic end record holds the Zip64 markers (mxl.ts:133-135: `if (count === 0xffff || p === ZIP64) return null`), even when a valid Zip64 end record and locator are present. readEntry then throws bad-archive (mxl.ts:244-245).\n\nRepro: /tmp/r3sec/run.mts over /tmp/r3sec/out, which holds the same score re-zipped by Info-ZIP, Info-ZIP with forced data descriptors, piped zip, jar, ditto, bsdtar (also with zip:zip64), Python (seekable, unseekable with data descriptors, force_zip64, comment, UTF-8 names) and fflate.\n- All open and give 'ready', except infozip_z64.mxl (`zip -fz`), which gives \"bad-archive … the list of files in the archive could not be read\".\n- The same file passes `unzip -t` (\"No errors detected\") and Python zipfile.testzip(), and fflate's own unzipSync returns {mimetype: 34, META-INF/container.xml: 183, score.xml: 171929}.\n- Its classic EOCD is (0,0,3,3,213,0xFFFFFFFF,0); the Zip64 EOCD gives count 3 and offset 6682.\n\nScope:\n- All 69 MuseScore 0.9-4.0 catalog archives, including data-descriptor ones, still open.\n- This is inherited from the round-1 reader, not introduced in round 2.",
   "failureScenario": "1. A learner imports an .mxl produced or re-packed by a tool that writes Zip64 records (e.g. `zip -fz`, or any writer that always emits Zip64).\n2. The app says the file \"is damaged or incomplete\", which is false.\n3. The same file opens in every other unzip program.",
   "suggestedFix": "When the classic EOCD has the 0xFFFF/0xFFFFFFFF markers and a Zip64 locator plus end record are present, take the count and directory offset from the Zip64 end record (the same values fflate uses), with bounds checks. Keep the existing rule that both records must agree whenever the classic one is not a marker. Add a test with a `zip -fz`-style archive."
  }
 ]
}


===== verify:music =====
{
 "verdicts": [
  {
   "id": "music:ornament-replacement-drops-note-before-hidden-turn",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3m/path.mts and repl.mts against the unmodified project. I also read the raw XML of m20-21 (divisions 48).\n- m21: Eb5 quarter (0-48); printed F4 dotted eighth with <turn/> (48-84); hidden v2 F4 G4 F4 E4 F4 from 72 to 84.\n- m20: D5 tie-start (24-48) tied to D5 with <turn/> (48-72); hidden Eb5 D5 C5 D5 from 60 to 72.\n\nreplacedByHiddenNotes (parse.ts:191-218) never compares the first hidden onset with the printed onset, and buildNotes drops the whole note.\n\nResulting RH steps:\n- m20 beat 2.0 is '.': the D5 is released at tick 48, a 16th before the turn at 60.\n- m21 beat 2.0 is '.' and the first F4 comes at beat 2.5, an eighth late.\n\ncatalog/inventory.json lists sonate-no-8-pathetique-2nd-movement as \"Included: ready to practise\". Its only warnings are grace/info, other/info and voice-overlap/info.\n\nARCHITECTURE L122-125 says the hidden notes play the ornament 'during its time'. It does not justify deleting the part of the note before they start. Brief §12 forbids presenting that as faithful.\n\nI prototyped the fix below in a /tmp copy:\n- Pathétique now gives m20 D5 beat 1.5 held to the turn at 2.25, and m21 F4 at beat 2 then the turn at 2.5. Round trip is ok and the piece stays ready.\n- Only Pathétique changes in the library: 1639 → 1640 notes. Every test still passes except catalog reproducibility, which needs regeneration.",
   "refinedFix": "In src/core/musicxml/parse.ts, change replacedByHiddenNotes to return Map<DraftNote, number>: the ticks of the printed note to keep, where 0 means drop it.\n- For each candidate v (and each tied continuation c), let firstHidden be the minimum onset of the overlapping hidden notes on its staff. The value is max(0, firstHidden - onset(v)).\n- The continuation test still uses the printed note's full written length (onset(v) + v.duration === onset(c)).\n\nIn buildNotes:\n- `const keep = replaced.get(d)`.\n- If keep !== undefined, add the existing 'other' info message. When keep === 0, `continue` as today.\n- Otherwise emit the note with `durationTicks: keep ?? d.duration`.\n- Skip 'ornament-not-played' and 'silent-notes-played' when keep !== undefined, because the hidden notes play the ornament.\n\nTie handling:\n- m20: the shortened tie-stop D5 (48-60) merges with D5 24-48 in performance.ts, so the D5 sounds 24-60.\n- A shortened note whose continuation is fully replaced just leaves an open tie, which is harmless.\n\nUpdate ARCHITECTURE L122-125: the hidden notes replace the printed note from the first hidden onset, and any earlier part of the printed note is kept.\n\nAdd a regression test on Pathétique:\n- m21 RH F4 press at m21 beat 2, lasting until beat 2.5, with the turn notes after it.\n- m20 D5 held from beat 1.5 to 2.25, with no '.' cell at m20 beat 2 or m21 beat 2.\n\nThen regenerate the catalog (Pathétique: 1640 notes, still ready)."
  },
  {
   "id": "music:per-staff-voice-rule-misreads-global-numbering",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3m/vreg.mts, with no software tag.\n- Voice 1 (RH) is on staff 1 except m3, where all four notes are drawn on staff 2. Voice 2 (LH) holds a whole note on staff 2 throughout.\n- numberedPerStaff (voices.ts:85-101) then counts both staves as 'alone' for voice 1, so perStaff is true and every note keeps its drawn staff.\n- Result: crossStaff is false everywhere, readiness is ready, and the only warning is no-tempo-in-file/info.\n- Steps for m3: `R:.  L:G3,G2` / `L:+B3,-G3` / `L:+D4,-B3`. The LH must hold G2 while playing G3-D4 (19 semitones), and the RH rests.\n- Control: with one of m3's notes moved back to staff 1, the piece is review (cross-staff-notes m3) with R:G3 B3 D4 G4.\n\nThe flip on one note is real. The code explicitly supports '1 and 2 per hand' numbering from other programs (voices.test.ts: 'numbers its voices 1 and 2 per hand is read by the staff'). Brief §10/§12 require cross-staff voices to be handled or labelled.\n\nI prototyped the fix below in a /tmp copy:\n- The repro becomes review with cross-staff-notes m3, and RH plays G3 B3 D4 B3.\n- voices/parser/e2e.library/e2e.regressions/model.hands tests all pass (277/277), including 'the hands take turns in voice 1'.\n- No library file changes, since they are all MuseScore exports and use block numbering.",
   "refinedFix": "In src/core/voices.ts numberedPerStaff, replace the 'alone' computation:\n- Group voice 1's notes by measureIndex.\n- For a measure where they are drawn on a single staff st, count st as 'alone' only if no note of another voice drawn on st overlaps any of those voice-1 notes in time (o.onsetTick < n.onsetTick + n.durationTicks && n.onsetTick < o.onsetTick + o.durationTicks).\n- Keep `return [...staves].every((st) => alone.has(st))`.\n\nWhen another voice shares the staff, the other hand's own line is present, so voice 1 there is a cross-staff visitor, not the hands taking turns.\n\nUpdate the ARCHITECTURE cross-staff paragraph (~L150-156) and the voices.ts doc comments to say: 'drawn on that staff alone, with no other voice sounding on that staff meanwhile'.\n\nAdd the vreg repro as a voices.test.ts case. Expect the m3 voice-1 notes crossStaff=true, RH presses G3 B3 D4 B3, LH G2, and a cross-staff-notes review for m3. The existing take-turns test still passes."
  },
  {
   "id": "music:hidden-playback-notes-duplicate-printed-notes",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3m/gmb.mts and meas.mts on G_Minor_Bach_Original m65.\n- Printed RH F#4+A4 (st1 v1, arpeggiate) sounds from beat 3 for 1.5 beats.\n- Hidden LH grace notes (st2 v5) D3 A3 C4 F#4 A4 roll the chord. The F#4 starts at +0.375 and the A4 at +0.5, while the RH still holds those keys.\n- Steps: `beat 3.375 LH +F#4 (RH heldAfter 66,69)`, `beat 3.5 LH +A4,-F#4`.\n- The catalog lists g-minor-bach-original as ready. Its warnings are all info: pedal, arpeggio-not-rolled, grace.\n\nThere is no cross-hand same-key handling anywhere. physical.ts reconciles same-key overlaps only within one hand, and FollowMatcher needs a fresh note-on, so the learner must lift the RH key and strike it again. Brief §8 forbids an 'impossible note press', and §12 asks for repeated notes 'without accidental retriggering'.\n\nThe Clair de Lune m1 same-instant double strike also reproduces, but that piece is review.\n\nThe La Campanella sub-claim is weaker. A same-hand, same-onset hidden unison held longer is the documented unison coalescing in physical.ts ('one press ending at the max end'), so I would not change it.\n\nI prototyped the fix below in a /tmp copy:\n- G minor Bach m65 becomes RH F#4+A4 with LH D3, +A3, +C4, and it stays ready with an info note.\n- Changes in the other library files: Clair de Lune (both editions), Liebestraum and Prelude No. 2, all already review.\n- Tests still pass apart from the catalog regeneration pin.",
   "refinedFix": "Put the fix after hand assignment and tie merging, so a hidden tie start whose continuation is printed counts as printed. In src/core/model/performance.ts buildPerformanceNotes, before the final sort:\n- Index source notes by id.\n- Call a performance note hidden-only when every id in sourceNoteIds is a source note with printed === false.\n- Drop a hidden-only note pn when another performance note o, which is not hidden-only, has the same partId and midi, a different hand, and o.startTick <= pn.startTick < o.endTick.\n- For each dropped note, add an info warning via the bag (code 'other'): 'Hidden playback notes that repeat a key the other hand is already holding are left out.', listing occurrences[pn.occ].number.\n\nLeave same-hand doublings to physical.ts. Rearticulation and coalescing there are documented, and some realise ornaments, for example the Chopin E-minor Prelude m16 turn.\n\nDocument the exception next to 'Notes drawn with print-object=\"no\" still sound' (types.ts L189) and in ARCHITECTURE.\n\nAdd a regression test: G_Minor_Bach_Original m65 has no LH press of F#4/A4 while the RH F#4+A4 is down, and LH D3/A3/C4 still roll in.\n\nThen regenerate the catalog.\n\nA weaker alternative, if hidden notes must always sound: raise a review warning for such cross-hand doublings so the piece is not 'ready'."
  },
  {
   "id": "music:glissando-silently-dropped",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r3m/gliss.mts: C4 with <glissando type=\"start\"> to C6 with <glissando type=\"stop\">.\n- Result: readiness ready, no warnings, presses RC4[0-96] LC3[0-192] RC6[96-192].\n- scanNotations (part.ts:209-226) reads only tied, ornaments and arpeggiate. `grep -rni 'glissando\\|slide' src/core` finds nothing.\n- None of the 69 library files contains <glissando> or <slide> (grep over the extracted XML), so this only affects user imports.\n\nBrief §12 requires advanced constructs to be 'supported correctly or labelled as needing review' and forbids silently flattening them. The analogous constructs are already review warnings: 'ornament-not-played' (extra notes missing) and 'tremolo-not-expanded'.\n\nThe impact is limited, so minor is the right severity.",
   "refinedFix": "In src/core/musicxml/part.ts:\n- Add `glissando: boolean` to NoteFields, defaulting to false in scanNote.\n- In scanNotations, set f.glissando = true when nameOf(c) is 'glissando' or 'slide' with attr type === 'start'. MuseScore writes wavy lines as <glissando> and straight ones as <slide>.\n- In makeDraft, next to the tremolo and arpeggio lines, add `if (f.glissando) this.warnings.add('glissando-not-played', this.m)`.\n\nAdd 'glissando-not-played' to the WarningCode union in src/core/types.ts.\n\nIn src/core/musicxml/warnings.ts IMPORT_WARNINGS, add an entry with severity 'review', for example: 'A glissando (a quick slide across the keys between two notes) is written here; only its first and last notes are played.'\n\nAdd the code to WARNING_NOTES in scripts/build-catalog.ts.\n\nExtend the ARCHITECTURE ornaments bullet (~L191-197).\n\nAdd a parser test: the gliss repro gives review with glissando-not-played on m1, and the presses are unchanged."
  }
 ]
}


===== verify:security-storage-deploy =====
{
 "verdicts": [
  {
   "id": "security-storage-deploy:parts-times-columns-oom",
   "verdict": "confirmed",
   "reason": "I reproduced it with my own generator, /tmp/vsec/parts.mts. The file has one part with N measures, each holding one note, and N extra parts with one empty measure each, run through storage/imports.parseScoreBytes.\n\nResults:\n- N=1000 (9.6 KB .mxl): 202 ms, 367 MB RSS.\n- N=2000 (18.7 KB): 637 ms, 1.05 GB.\n- N=3000 (26.8 KB): 1.4 s, 2.19 GB, readiness 'review', so it would be saved.\n- N=4500 (39.8 KB .mxl), with --max-old-space-size=4096 to match roughly Chrome's per-tab 4 GB heap: \"FATAL ERROR: Ineffective mark-compacts near heap limit ... JavaScript heap out of memory\" at 4.46 GB RSS.\n\nThe code matches the claim:\n- parse.ts:319 sets columns to the longest part's measure count.\n- parse.ts:324-327 calls readMeasure(i, p.measures[i]) for every column of every part.\n- part.ts readMeasure always allocates a cell plus emptyMarks(), even when src is undefined.\n- No part-count or parts×columns limit exists. The only limits are archive and XML size, and those don't bound this, because an absent cell costs about 250 B of heap and no input bytes.\n- importFile (imports.ts:258) and catalog/loader.ts:95 both parse synchronously, so an OOM can't become an ImportError.\n\nThe brief requires this: §12 says excessive sizes need a readable error. For context, the largest catalog score is 2 parts × 504 columns = 524 cells.",
   "refinedFix": "1. Make cells sparse. In parseMusicXml (parse.ts:324-327), call reader.readMeasure only for columns the part actually has: `p.measures.forEach((m, i) => reader.readMeasure(i, m))` (forEach skips timewise holes), or `for (let i = 0; i < p.measures.length; i++) if (p.measures[i]) reader.readMeasure(i, p.measures[i])`.\n2. Keep time-signature carry-over intact. Absent cells currently report the part's last-known `time`, so buildMeasures must fall back to each part's last present cell at or before i. Track it in a per-part cursor while walking columns.\n3. Build the column → present-cells lists once, in one pass over each part's present cells, instead of `results.map(r => r.measures[i])` per column.\n4. As defence in depth, after computing `columns` and before reading any part, add: `if (layout.length > MAX_PARTS || layout.length * columns > MAX_CELLS) throw new ImportError('too-large', 'This score has too many parts and measures to open safely.')`. For example MAX_PARTS = 200 and MAX_CELLS = 1_000_000; the catalog peaks at 2 parts and 524 cells.\n5. Add a test: a parts = columns = 6000 file (about 15 KB .mxl) must throw ImportError('too-large') within about 100 ms, and a 2-part 500-measure score must be unaffected."
  },
  {
   "id": "security-storage-deploy:measure-label-quadratic-regression",
   "verdict": "confirmed",
   "reason": "I reproduced it with /tmp/vsec/mnum.mts, using measures numbered 1,2,1,2,...\n\nmeasureDisplayNumbers alone:\n- N=1000: 28 ms\n- N=2000: 158 ms\n- N=4000: 865 ms\n- N=8000: 4.1 s\n\nFull parseScoreBytes of a 3.8 KB .mxl at N=8000: 8.4 s, readiness 'review', so the file is saved. The largest label is 155 characters (\"2zzzz…\").\n\nGrowth is clearly super-quadratic. Cause, in measures.ts:33-46:\n- Every repeat of a digit number resets `extra = 0`.\n- The do/while then walks past every earlier suffix for that base.\n- Each step builds `'z'.repeat(k/26)` and hashes it into the Set.\n\nThe function runs at least 4 times per load (parse.ts:334, performance.ts:173 and 333, hands.ts:397), and again on every open via loader.ts:95. The all-equal shortcut doesn't catch alternating numbers.\n\nI prototyped the per-base resume counter in /tmp/vsec/fix:\n- Output is identical to the current function on 20,000 random inputs.\n- 20,000 alternating measures label in 15 ms.",
   "refinedFix": "In src/core/measures.ts, replace the shared `extra` counter with a per-base resume counter:\n- Declare `const nextExtra = new Map<string | null, number>()`.\n- Drop the `extra = 0` reset in the digit branch.\n- Before the loop: `let extra = nextExtra.get(base) ?? 0; do { label = nextLabel(base, extra++); } while (used.has(label)); nextExtra.set(base, extra);`\n\nThe `used` set only grows, so resuming yields exactly the same labels as restarting from 0. This is verified identical on 20,000 random cases, keeps the documented labelling contract, and makes labelling linear (15 ms for 20,000 measures).\n\nOptionally, avoid absurd labels: if any base needs more than 26 suffixes, fall back to positional numbers (String(m.index + 1)) for the whole score, as the existing all-equal shortcut does.\n\nAdd a test: 20,000 measures numbered 1,2,1,2,… label in under 100 ms, and all labels are unique."
  },
  {
   "id": "security-storage-deploy:test-suite-fails-deploy-blocked",
   "verdict": "confirmed",
   "reason": "`npx vitest run` now gives \"Test Files 1 failed | 41 passed (42); Tests 1 failed | 1201 passed (1202)\".\n\nThe failure is catalog.difficulty-evidence.test.ts > \"every other sourced label was confirmed too, apart from the listed batch-2 backlog\", with \"Fur_Elise.mxl now has a verdict: take it off AWAITING_VERIFICATION\" at line 97.\n\ndocs/dev/difficulty-research-raw.json (mtime 08:05:02) now contains a `verify:batch2` pass. It has confirmed verdicts for all four files in AWAITING_VERIFICATION, and each level matches catalog/difficulty.json:\n- Fur_Elise: Intermediate\n- Gnossienne_No._1: Intermediate\n- Gymnopdie_No._1__Satie: Beginner\n- Liebestraum_No._3_in_A_Major: Advanced\n\nAll are basis 'source'. .github/workflows/deploy.yml runs `npm test` (vitest run) before `npm run build` and the Pages upload, so the deploy job fails.\n\nREADME.md:184-187 still says these four labels \"have not been re-checked since they were found\", which is now false.\n\nThis breaks §15 (\"Provide a documented build and a GitHub Pages deployment workflow\") and §18.2/§18.10.",
   "refinedFix": "1. In tests/catalog.difficulty-evidence.test.ts:56-61, remove all four entries, leaving `const AWAITING_VERIFICATION: string[] = []`. Keep the \"may only shrink\" comment. The stricter branch (lines 100-101: confirmed and same level) then passes for them, because their verify:batch2 verdicts confirm the recorded levels.\n2. In README.md:184-187, replace the sentence about four labels not being re-checked with one saying all sourced labels, including the four third-party listings (LaSolSheet, Scribd), were confirmed by a verification pass. Also check that docs/CATALOG_REPORT.md and the generator text in scripts/build-catalog.ts don't repeat the old claim; the current grep finds none.\n3. Re-run `npx vitest run` (expect 1202 passing) and `npm run catalog`."
  },
  {
   "id": "security-storage-deploy:absurd-pitch-stalls-scheduler",
   "verdict": "confirmed",
   "reason": "I reproduced it with /tmp/vsec/pitch.mts. It uses the real PianoSampler on a fake AudioContext whose AudioParam.value setter applies WebIDL `float` conversion: TypeError on non-finite values, or when the value rounds past float32 range.\n\nThe real sampler:\n- noteOn(127) and noteOn(1000) are fine.\n- noteOn(1700) throws: playbackRate/frequency overflows float32, so the threshold is about midi 1644, lower than the reviewer's 12,400.\n- noteOn(12500) and noteOn(1,200,000,012) throw \"provided float value is non-finite\".\n- This holds whether or not samples are decoded (sample voice and fallback oscillator).\n\nThe parser:\n- It accepts `<octave>100000</octave>`. readPitch (part.ts:201-207) only checks the octave is an integer, and midiFromSpelled doesn't clamp alter.\n- Presses: [72, 48, 1200014, 76, 77, 79, 55], readiness 'review' with just the out-of-piano-range warning, so the file is saved.\n\nThe real PracticeSession, with a sampler forwarding to the strict real sampler:\n- 93 TypeErrors thrown from scheduler ticks.\n- noteOns [48, 72], noteOffs [72], so LH C3 is started and never released.\n- Status stays 'playing' at step 0, and nothing after the bad note sounds.\n- dispatchDue (session.ts:1000-1007) increments run.nextEvent only after the sampler call, with no try/catch.\n\nMIDI output is already guarded: manager.sendNoteOn checks isMidiNumber. That breaks §12 (validate content) and the §17 check that playback does not leave notes sounding.",
   "refinedFix": "1. Parser, part.ts readPitch: treat `octave` outside 0..9 as a bad pitch, so it takes the existing badPitch path (line 548). Treat a non-finite `alter` or |alter| > 3 as bad too.\n2. Transpose (part.ts:478-480): ignore non-finite values, and clamp or ignore |chromatic + 12·octave-change| > 48, with a warning.\n3. buildNotes: drop notes whose midi is outside 0..127, and add a warning, so presses only carry valid MIDI numbers.\n4. Runtime guard, sampler.noteOn (sampler.ts:207-210): return early unless `Number.isInteger(midi) && midi >= 0 && midi <= 127`. Alternatively, return when `!isFinite(Math.fround(rate))` / `!isFinite(Math.fround(freq))`.\n5. Session, session.ts dispatchDue: capture `ev`, do `run.nextEvent++` before calling the sampler, and wrap the sampler call in try/catch. One bad event then cannot stall the run or strand started notes.\n6. Add tests:\n   - `<octave>100000</octave>` is dropped or flagged and never reaches presses.\n   - A session whose sampler throws on one event still plays and releases the rest."
  },
  {
   "id": "security-storage-deploy:internal-hostname-in-published-docs",
   "verdict": "confirmed",
   "reason": "Grepping the project for 'internal mirror|<internal-host>' (excluding node_modules and dist) matches only docs/dev/review-round2.md:\n- Line 33: the title naming \"the employer's internal internal mirror mirror\".\n- Line 39: <internal-host>/repository/npm-all/, the 8.8.8.8 → d2dzg2xfa6top.cloudfront.net resolution, and that \"from this corporate network an unauthenticated GET of fflate-0.8.3.tgz returned 200\".\n- Lines 360, 361, 768, 769 and 996: the host again, plus a description of the user's ~/.npmrc.\n\npackage-lock.json itself is clean.\n\nPublication path:\n- .gitignore lists only node_modules/, dist/, .DS_Store, *.log, .vite/ and coverage/, so docs/dev is committed.\n- README.md:136-154 tells the user to `git add -A` and push to a GitHub repo for Pages.\n- The public repo would therefore expose the internal host and its access characteristics, the exposure round 2 set out to remove.\n\nNote for the fix: docs/dev can't simply be gitignored. tests/catalog.difficulty-evidence.test.ts:29 and README.md:184 depend on docs/dev/difficulty-research-raw.json, so ignoring the folder would break CI.",
   "refinedFix": "Redact docs/dev/review-round2.md:\n- Lines 33, 39, 360, 361, 768, 769 and 996: replace the hostname and URL with a neutral phrase such as \"an internal company npm mirror\" or `<internal-registry>`.\n- Remove the DNS/CloudFront resolution, the \"unauthenticated GET … returned 200\" note and the ~/.npmrc description.\n- Rewrite the sed recipe at line 768 with a placeholder host.\n\nAlso grep review-round1.md, the builder reports and difficulty-research-raw.json for the same terms; they are currently clean.\n\nIf the review logs shouldn't ship at all, gitignore only `docs/dev/review-round*.md`, not docs/dev. difficulty-research-raw.json is read by tests.\n\nOptionally, extend tests/deploy.lockfile.test.ts to scan tracked text files (excluding node_modules and dist) for any registry host other than registry.npmjs.org, so a leak can't come back."
  },
  {
   "id": "security-storage-deploy:zip64-mxl-rejected-as-damaged",
   "verdict": "confirmed",
   "reason": "I reproduced it independently. I built the same score with Info-ZIP as plain.mxl and with `zip -fz` as z64.mxl, then ran /tmp/vsec/z64.mts.\n\nz64.mxl:\n- Passes `unzip -t` (\"No errors detected\") and Python zipfile.testzip().\n- fflate 0.8.3 unzipSync lists {mimetype: 34, score.xml: 2227}.\n- The app's parseScoreBytes throws bad-archive: \"The compressed score (.mxl) is damaged or incomplete…\" with detail \"the list of files in the archive could not be read\".\n\nplain.mxl opens as 'ready'.\n\nThe classic EOCD of z64.mxl is (0,0,2,2,133,0xFFFFFFFF,0), with a Zip64 locator present. centralDirectory (mxl.ts:133-135) returns null whenever count is 0xffff or the offset is 0xFFFFFFFF, without consulting the Zip64 end record that fflate itself uses (fflate 0.8.3 unzipSync takes c/o from the zip64 EOCD at ze+32/ze+48 whenever the locator is present). readEntry then throws bad-archive.\n\nThis gives a false \"damaged\" error for a valid .mxl, against §12's accurate, readable errors. It is minor, because few writers emit Zip64 for small files.",
   "refinedFix": "In centralDirectory (src/core/mxl.ts), replace the early `return null` for markers.\n\nWhen `count === 0xffff || p === ZIP64` (or the CD size is 0xFFFFFFFF):\n1. Require a Zip64 locator at eocd-20 (0x07064b50) and a Zip64 EOCD at its offset `z`: 0x06064b50, with z + 56 <= bytes.length.\n2. Read the total entries (uint64 at z+32) and the directory offset (uint64 at z+48), rejecting values above Number.MAX_SAFE_INTEGER, an entry count above MXL_LIMITS.maxEntries, or an offset outside the file.\n3. Use these as `count` and `p`.\n4. Where a classic field is not a marker, keep requiring it to equal the Zip64 value. Keep the existing rule that both records must agree when neither is a marker.\n\nThe later check in readEntry, that the directory agrees with fflate's listing on names, sizes and methods, still guards against split-directory tricks.\n\nAdd a test with a `zip -fz`-style archive (classic EOCD offset 0xFFFFFFFF plus Zip64 EOCD and locator) that opens as 'ready'. Keep the existing hostile mismatched-records test rejecting."
  }
 ]
}


===== fix:catalog-deploy =====
All four items are fixed. Three of my test files pass (49 tests). The full suite still has 2 failures, in tests that belong to other fixers.

**Full suite:** 1222 passed, 2 failed. The failures are `tests/parser.test.ts` ("warning aggregation") and `tests/e2e.regressions.test.ts` ("a silenced trill note…"). Other fixers were editing `src/core` while I ran it. `npx tsc --noEmit -p tsconfig.json` passes.

**Action needed:** because of those concurrent `src/core` edits, rerun `npm run catalog` once every fixer is done. While I was working, the "is reproducible" catalog test failed once (one entry's note count and a readiness reason were out of date). It passed after I regenerated.

### security-storage-deploy:test-suite-fails-deploy-blocked — fixed
### traceability:suite-red-research-log-verify-batch2 — fixed (same root cause)
- **`tests/catalog.difficulty-evidence.test.ts`:**
  - `AWAITING_VERIFICATION` is now an empty `string[]`. The "may only shrink" rule stays, and the doc comment says the backlog was cleared by `verify:batch2`.
  - The test is retitled "every other sourced label was confirmed too, apart from any listed backlog".
- **`README.md`, lines 184–189:** the sentence about four labels "not re-checked" now says every sourced label was re-checked by a later pass at the same level. That includes the LaSolSheet and Scribd listings, re-checked on 2026-10-02, some of them from search-engine copies of the page. README.md is outside my listed area; I changed only these lines because both items name the file.
- **New test**, "the README describes the re-check backlog as the log has it": it works out the backlog from the log itself. If the backlog is empty, the README must not say "not been re-checked"; otherwise the README must name each file in it. It failed before the README edit and passes now.
- `docs/CATALOG_REPORT.md` and `scripts/build-catalog.ts` never repeated the old claim.

### security-storage-deploy:internal-hostname-in-published-docs — fixed
- **`docs/dev/review-round2.md`:** I removed the internal registry host and URL from lines 33, 39, 360, 361, 768, 769 and 996, using "an internal company npm mirror" or `<internal-registry>` instead. I also removed:
  - the DNS/CloudFront resolution;
  - the note that an unauthenticated download returned 200;
  - the description of the `~/.npmrc`.
- The sed recipe now uses a placeholder host. A grep for the host or company name across the project (excluding `node_modules` and `dist`) now finds nothing. `docs/dev` is not gitignored, because the difficulty test and the README read `difficulty-research-raw.json`.
- **New test `tests/deploy.no-internal-hosts.test.ts`** (3 tests). It scans every text file in the project except git-ignored output and binaries. It fails on:
  - any host under the employer's domain label;
  - hosts whose names look like a package mirror (internal mirror, artifactory, jfrog, verdaccio, intranet) or that use an internal top-level domain;
  - package-registry URLs on any host except registry.npmjs.org;
  - `registry=` settings that point anywhere but npmjs.
- The employer's label is stored only as a SHA-256 hash, and failure messages give line numbers without repeating the host. A built-in self-check tests the rules on made-up examples. I confirmed the test fails on the old review file (8 hits) and passes on the redacted one.

### traceability:greensleeves-rating-found-but-says-none — fixed (option A: adopted Beginner)
- **Re-check:** a direct fetch of the LaSolSheet page shows only an empty directory listing. I re-checked it with two independent web searches (the same standard used for Für Elise). Both gave "Arrangement: Makowski Dominique, Skill Level: Beginner, 3/4, Pages: 1, Measures: 33".
- **Score match:** the score itself has 33 measures, 3/4 time, no key signature and the credit "Arr. Dominique Makowski".
- **`catalog/difficulty.json`:** Greensleeves is now Beginner, basis `source`, with original label "Skill Level: Beginner", the LaSolSheet source name and URL, and the musescore.com/dominiquemakowski/greensleeves arrangement link. The note no longer says that no rating was found.
- **`docs/dev/difficulty-research-raw.json`:** I added a new pass, `verify:greensleeves-listing`, holding this re-check.
- **`scripts/build-catalog.ts`:** the generated policy now has a bullet saying third-party listings (LaSolSheet, PianoMetric, Scribd copies) count only after a verification pass, and may be read from search-engine copies.
- **`npm run catalog`** regenerated `src/catalog/catalog.json`, `catalog/inventory.json` and `docs/CATALOG_REPORT.md`. The counts are now Beginner 9 / Unrated 47 and source 14 / none 47.
- **New test** "a confirmed verdict is not dropped…": an Unrated piece fails if its latest verdict confirmed a level. The only exceptions are listed in `TITLE_HINT_ONLY` (Carol of the Bells easy piano and Nocturne Op. 9 No. 2 Easy), whose verdicts rest only on a word in the file name. It failed on Greensleeves before the change and passes now.

### Not in scope, for the orchestrator
- `README.md:14` links to `docs/IMPLEMENTATION_REPORT.md`, which does not exist yet; round 2 already noted this.
- Ave Maria stays Unrated. Its LaSolSheet listing was never read at all (no search was possible in `verify:batch1`), so it is consistent with the rule above. A search-based re-check could be a follow-up.


===== fix:ui =====
Both items are fixed. Every new test fails on the original code and passes now (checked by swapping the original files back in). `npx tsc --noEmit -p tsconfig.json` is clean, and the 14 UI-related test files (326 tests) pass. The full suite has 12 failures right now, all in `tests/engine.test.ts`, `tests/parser.test.ts`, `tests/e2e.regressions.test.ts` and `tests/core.regressions.test.ts`. None of those import `src/ui`; they come from the core, parser and engine files being edited concurrently. Nothing was checked in a real browser.

## ui:timeline-tab-scrolls-hidden-viewport: fixed
- **`src/ui/notation/notation.css`**: `.tl__viewport` is now `overflow: hidden; overflow: clip;`. A clipped box is not a scroll container, so focusing something in it can't scroll it.
- **`src/ui/notation/Timeline.tsx`**:
  - The rendered-window state now also holds the on-screen range (`windowsAt` gives `{ rendered, visible }`).
  - Each column gets an `onScreen` flag. A measure label outside the viewport (overscan on either side) gets `tabIndex=-1`, so Tab only reaches labels you can see.
  - Labels carry `data-occ`.
  - A `scroll` listener puts the viewport's `scrollLeft`/`scrollTop` back to 0, as a fallback for browsers without `clip`.
  - All programmatic focus calls in the timeline use `{ preventScroll: true }`.
- **Tests** (`tests/timeline.behaviour.test.ts`, new describe "the viewport never scrolls away from the play marker"):
  - Off-screen labels are out of the tab order and on-screen ones are in, at positions 0, 100 and 200.
  - The tab order keeps up as the strip moves over 30 frames.
  - A scroll of the viewport is undone.
  - The CSS rule ends with `overflow: clip`.

## ui:keyboard-focus-lost-or-misplaced: fixed
- **Reset** (`src/ui/practice/ControlsBar.tsx`): Reset from the keyboard sets speed back to 1× and moves focus to the Speed slider. A mouse click still leaves focus free.
- **Measure menu** (`Timeline.tsx`): choosing Start or End from the keyboard no longer focuses the old trigger. Instead, once the new passage has rendered, focus goes to that measure's label (found by `data-occ`) if it is in view, otherwise to the current column. A keyboard-opened menu that closes because its label scrolled away also sends focus to the current column. Esc still returns focus to the label.
- **Timeline column**: a single layout effect after every commit does two things:
  - If a column has focus, focus follows the current step.
  - It notices when the focused column or label was removed, or now shows a different measure, and moves focus to that measure's label if in view, otherwise to the current column. This covers the reported 40 × → case, Home jumps, and a focused label leaving the rendered columns.
- **Beyond the confirmed cases**: I also fixed the related case the verifier left unconfirmed. A new hook, `src/ui/common/focusHandoff.ts` (`useFocusHandoff`), handles buttons that become disabled while focused:
  - Previous step, Next step and Stop hand focus to Play.
  - "Whole piece" hands focus to the "From measure" list.
  - If Enter is being held when this happens (for example holding Next step to the last step), the repeats don't go on to press Play.
- **Tests** (`tests/practice.focus.test.ts`, real PracticePage with the Minuet):
  - I changed the existing test "the measure menu opened from the keyboard … returns focus to the label". It used to check for the same DOM element, which only passed because of the bug; it now checks that the focused label is the same measure.
  - New describe "keyboard focus is not lost or moved to the wrong control":
    - Reset by keyboard, and by mouse.
    - Start passage on Measure 4 keeps focus on Measure 4, not Measure 7.
    - End passage.
    - 40 × → keeps focus on the current column.
    - Home jump.
    - A focused label leaving the rendered columns.
    - Previous step becoming disabled → focus on Play.
    - Holding Enter on Next step to the end does not press Play.
    - Whole piece → From list.
  - I also added a test that Esc from a keyboard-opened menu returns focus to its label. It already passed before the fix and is only a guard.

**Doc update needed in `docs/UI_SPEC.md`** (outside my files, so I didn't edit it). It should say:
- Measure numbers outside the viewport are not in the tab order, and the viewport clips rather than scrolls.
- A focused instruction column follows the current step.
- Keyboard focus is never dropped to the page: it goes to the places listed above.

**For your browser check:** step to about step 100, Tab through the measure numbers, then read `document.querySelector('.tl__viewport').scrollLeft`. It should stay 0, and the marker should stay put.


===== fix:runtime =====
All nine items are fixed on the engine/audio/MIDI side. Two of them still need a UI change before the user-facing bug is gone: `follow-midi:always-present-port-replaces-piano` and `ui:remembered-piano-replaced-by-sole-other-input`. Typecheck is clean and the full suite passes (44 files, 1276 tests). One transient failure in `tests/parser.test.ts` came from another fixer's concurrent parser edits and passed on rerun. Every new test fails when its fix is reverted (checked in a scratch copy of the project).

**Files changed:**
- `src/audio/sampler.ts`
- `src/engine/session.ts`
- `src/midi/manager.ts`
- `tests/helpers/fakes.ts`
- `tests/audio.test.ts`
- `tests/engine.test.ts`
- `tests/midi.test.ts`

## Per item

**engine:monitor-and-playback-share-sampler-voices — fixed**
- `PianoSampler.noteOn/noteOff` take an optional last `owner: VoiceOwner = 'app' | 'input'`. Re-strike and release only touch voices with the same owner; `allNotesOff` still silences everything. `SamplerLike` and `FakeSampler` match.
- The session sends the learner's monitored notes as `'input'` (on key-down, and in `monitorOff`, which covers key-up, pedal-up and turning "Hear my playing" off).
- Tests: an audio unit test that the two owners never cut each other. Engine tests in Listen and Steady: a held key outlasts the app's release, a short tap leaves the app's note whole, and monitor-off or pedal-up shortens only the learner's notes. The reviewer's repro t1b now gives learner C4 0.02–1.6 and app D4 1–2.

**engine:sampler-error-state-silences-new-session — fixed**
- `startAudioQuietly` now also retries from `'error'`, with a guard against two retries at once.
- A run already on the audio clock stays there unless the sampler is `'not-started'`, so a failed sample load no longer silences it.
- `FakeSampler.ensureStarted` now goes from `'error'` to `'ready'`, like a successful retry.
- Tests: on a shared sampler in `'error'`, Next previews the step and Sound turned on mid-run is heard; a run on the audio clock keeps sounding after `'error'`.

**engine:count-in-beat-ignores-meter — fixed**
- The Listen count-in beat now comes from the time signature in force at the start tick: dotted quarter in 6/8, 9/8, 12/8; eighth in 3/8; half in x/2; quarter in x/4 or with no signature. Steady still uses the step length.
- Tests cover 6/8, 9/8, 12/8, 3/8, 2/2, 4/4 and 3/4, a mid-piece change of meter, speed, and Steady. The reviewer's t4 now gives Für Elise 0.417 s and Lacrimosa 1.406 s.

**engine:pause-during-count-in-skips-count-in — fixed**
- A pause or page hide during a count-in is remembered, and the next Play counts in again from the same step.
- Tests: a plain count-in, and the loop-restart count-in with both Pause and page hide. The existing resume-without-count-in test still passes.

**follow-midi:late-midi-echo-leaks-as-input — fixed**
- `remember()` now records `max(atMs, now)`, the time the message actually goes out.
- Test: an echoing piano with a 150 ms stall at 11 timing offsets; no learner keys appear and no extra monitored strikes. The verifier's `stall.mts` shows no leak.

**follow-midi:output-select-desync-after-rename — fixed**
- When the manager re-finds the output under a new id, the session updates `settings.midiOutputId` to match, so the menu shows it, the piece saves it, and Off works.
- Test with the real `MidiManager`: the setting follows to out-2, playback goes there, and Off stops it.
- Not fixed: reopening a piece whose old output port is no longer known to the browser can't be re-found by name, because the session doesn't know the name.

**ui:status-line-unnamed-device-disconnected — fixed**
- `MidiLike` gains optional `inputSeen`. The session reports no input name while a remembered piano hasn't turned up, so the status line no longer says "Unnamed MIDI device disconnected".
- Tests: a fake-MIDI unit test and one with the real manager. The verifier's `statusline.test.ts` now shows only "Step 1 of 275·Measure 1".

**follow-midi:always-present-port-replaces-piano and ui:remembered-piano-replaced-by-sole-other-input — fixed in the manager, UI part still needed**
Manager changes:
- `selectInput(id, rememberedName?)` keeps the remembered name, so the piano is found by name under a new id.
- A remembered piano that hasn't turned up is never replaced by a device that was already connected at Connect. It only gives way to the single device that turns up afterwards. If the remembered piano appears later after all, it takes over again; an explicit choice clears this.
- New exported `isLoopbackPort(name)` (matches "Midi Through"). Such a port is never picked automatically and doesn't block a piano switched on later. A piano that is already on beside Midi Through at Connect still gets the existing "choose" list, so the UI test there is unchanged.
- Tests: the old test at `midi.test.ts:308` is replaced by four new ones.

What still goes wrong: the verifier's page-level `midithrough.test.ts` still connects to Midi Through. That pick now comes from the UI's own fallback in `midiConnection.ts`, not the manager. Simulating the UI changes below in `/tmp/r4mine/linux_fixed_ui.mts`, the piano is attached when switched on with the same id, a new id and the same name, or a new id and name.

## Changes needed outside my area
1. **`src/ui/practice/midiConnection.ts`** (UI fixer):
   - Add `rememberedName?: string | null` to `MidiControl.selectInput`.
   - In `connect()`, pre-select with `midi.selectInput(savedInputId, savedInputName)`.
   - In the `connect().then(...)` fallback, when `midi.inputSeen === false`, exclude every currently connected input, so only a saved-name match can be picked.
   - In `fallbackInput`'s "only other input" rule, skip ports where `isLoopbackPort(i.name)` is true.
   - In `midiPhase`, return `'no-devices'` when the only connected inputs are loopback ports.
   - Reword the "choose" notice when only one device is live and the remembered piano is missing.
2. **Docs** (not edited, so the following still describe the old behaviour):
   - `docs/APP_CONTRACTS.md`: the `SamplerLike` signature (lines 49–50) needs `owner?`; `MidiLike` needs `inputSeen?`. The Count-in paragraph needs the meter rule and "pause or page hide during a count-in counts in again". Physical input should say monitored notes are separate voices. MIDI output should say the output id follows a rename. Clock should say a run on the audio clock survives `'error'` and gestures retry from `'error'`.
   - `docs/ARCHITECTURE.md`: §5 (the remembered-id rule on line 522 and the `inputSeen` paragraph, loopback ports, `selectInput(id, name)`, and the echo window counted from the actual send time), and §6 (the `owner` parameter on `noteOn`/`noteOff`).
   - `docs/dev/app-builder-reports.md:111` says "The beat is a quarter note"; `docs/dev/core-builder-reports.md` lines 127–128 and 278 need the new signatures.


===== fix:core =====
All ten items are fixed in `src/core`, but two of them still need work from other fixers, and the committed catalog must be regenerated again from the current code. `npx tsc --noEmit -p tsconfig.json` passes. `npx vitest run` gives 1278 passed and 1 failed; the failure is the catalog reproducibility test.

**Catalog: regenerate it again.** Someone regenerated it at 08:59, while my code still had a temporary limit on `<alter>` values that I later removed. One library file (Mozart_-_Piano_Sonata_No._16_-_Allegro.mxl) spells D4 as F3 with nine sharps, so that limit wrongly dropped 20 of its notes. The committed catalog therefore shows that piece with 2522 notes and without its cross-staff reason. Regenerating from the final code puts back 2562 notes and the cross-staff reason; I diffed this in memory and found nothing else different. The library-wide changes against the original code are only these:
- Pathétique 2nd movement: 1640 presses, still ready.
- G minor Bach (Original): two left-hand presses fewer in m65, still ready.
- Clair de Lune (both editions), Liebestraum and Prelude No. 2 (all already review): fewer hidden doubled notes, and fewer `hand-span-too-wide` measures where the doubles caused them.
- No piece changes readiness.

I confirmed the new tests fail on a copy of the original code and pass now. On the original code, the 6000-part test crashes the test worker with out-of-memory.

**Per item**

- **music:ornament-replacement-drops-note-before-hidden-turn: fixed.**
  - `replacedByHiddenNotes` (`src/core/musicxml/parse.ts`) now records how many ticks of the printed note to keep, and `buildNotes` emits that part instead of dropping the whole note. This also applies to a tied continuation.
  - `ornament-not-played` is skipped for these notes. `silent-notes-played` still appears when a muted note's kept part sounds.
  - The info message now ends "…in place of the main note shown, from where they start."
  - Tests: two small turn cases, plus Pathétique m20–21 (F4 struck on m21 beat 2, D5 held to m20 beat 2.25, no rest on either beat 2) in `tests/core.regressions.test.ts`. The message text is updated in `tests/e2e.regressions.test.ts`.

- **music:per-staff-voice-rule-misreads-global-numbering: fixed** (`src/core/voices.ts`). A measure only counts as "voice 1 on this staff alone" when no other voice sounds on that staff during it. The overlap check uses a binary search, so it stays fast on large files. Doc comments are updated.
  - Test: the voice-1-is-RH / voice-2-is-LH repro in `tests/voices.test.ts`. The m3 notes are now cross-staff, the RH plays G3 B3 D4 B3 over LH G2, and the piece is review.

- **music:hidden-playback-notes-duplicate-printed-notes: fixed** (`src/core/model/performance.ts`, comment in `src/core/types.ts`). After hands are assigned and ties joined, a note made only of hidden notes is left out when a printed note in the other hand is holding the same key at its start. An info note (code `other`) lists the measures.
  - I matched on the key alone, not key plus part, because the two hands share one physical keyboard.
  - Same-hand doublings are left to `physical.ts` as before.
  - Tests: four in `tests/core.regressions.test.ts`, including G minor Bach m65, plus checks that same-hand and tied-into-printed hidden notes stay.

- **music:glissando-silently-dropped: fixed.** `<glissando>` or `<slide>` with `type="start"` now raises a new review warning, `glissando-not-played` (`part.ts`, `warnings.ts`, `types.ts`). Tests: one case each for glissando and slide.
  - Still needed outside my area: a `glissando-not-played` entry in `WARNING_NOTES` in `scripts/build-catalog.ts`.

- **ui:measure-list-and-others-false: core part fixed.** `ScoreWarning` has a new optional `measuresTruncated` flag. It is set only when a new distinct measure did not fit in the 20-measure list (`WarningSink.toList`, `WarningBag`/`addMeasures`, `mergeWarnings`, which also carries it over). Tests: four in `tests/core.regressions.test.ts`; `tests/parser.test.ts` expectation updated.
  - Still needed in the UI: `src/ui/practice/diagnostics.ts` `measureList` should use `const more = w.measuresTruncated === true;`, and `tests/practice.helpers.test.ts:210` needs updating.

- **security-storage-deploy:parts-times-columns-oom: fixed** (`parse.ts`).
  - Each part now reads only the measures it has, and `buildMeasures` groups the existing cells by column once. Time-signature carry-over still uses each part's last known signature, as before.
  - A file with more than 200 parts, or more than 200,000 parts × measure columns, raises `ImportError('too-large', 'This score has too many parts and measures to open safely.')`. I lowered the second limit from the suggested 1,000,000 because 1,000,000 measures still used about 2 GB.
  - The 6000×6000 file is now refused in about 60 ms.
  - Tests: the 6000×6000 file, the limit boundaries (40 parts × 2000 measures still opens), and a two-part file of unequal length keeping its time signature.

- **security-storage-deploy:measure-label-quadratic-regression: fixed** (`src/core/measures.ts`). The letter search now resumes where it stopped for each measure number, which gives the same labels as before; I checked this against the old function on 20,000 random inputs.
  - 20,000 measures numbered 1, 2, 1, 2… now take about 15 ms, against 65 s before.
  - New behaviour: if one number would need more than 52 letter suffixes (past "12zz"), the whole score is numbered by position instead.
  - Tests: two in `tests/measures.test.ts`.

- **security-storage-deploy:absurd-pitch-stalls-scheduler: parser side fixed; the playback side is not in my area.**
  - An octave outside 0–9, or any note whose MIDI number falls outside 0–127 (for example from `<alter>1e8`), is left out. It gets a review `out-of-piano-range` warning plus an info note.
  - A `<transpose>` larger than 48 semitones is ignored, with an info note.
  - Large valid `<alter>` values are kept (the Mozart file above uses 9).
  - Tests: seven in `tests/core.regressions.test.ts`.
  - Still needed by the audio/engine fixers: `sampler.noteOn` should ignore anything that is not a MIDI number 0–127, and `session.ts` `dispatchDue` should advance `nextEvent` before calling the sampler and catch errors for each event.

- **security-storage-deploy:zip64-mxl-rejected-as-damaged and traceability:zip64-format-mxl-rejected: fixed** (`src/core/mxl.ts`). When the classic end record holds the 0xFFFF / 0xFFFFFFFF markers, the entry count and directory offset are taken from the zip64 end record. Any field that holds a real value must still match, so the hostile two-directory archive is still rejected.
  - The real `zip -fz` archives in `/tmp/r3sec/out` and `/tmp/r3t/mxl` now open as ready.
  - Tests: two in `tests/mxl.test.ts`.

- **traceability:single-staff-reason-asks-to-read-notation: fixed** (`src/core/model/hands.ts`). Both messages now say "…so the app gives them all to the right hand and the left-hand row stays empty. If the piece is meant for both hands, choose an arrangement written for two hands instead."
  - The exact-text checks are updated in `tests/e2e.fixtures.test.ts`, `tests/model.hands.test.ts` and `tests/model.prepare.test.ts`. Two new tests in `tests/core.regressions.test.ts` cover both messages.

**ARCHITECTURE.md edits for the doc owner** (I did not edit docs):
- **Hidden-notes bullet (L122–125):** the hidden notes replace the printed note from where the first one starts, and any earlier part of the printed note is kept. Also add the cross-hand exception: a hidden-only note repeating a key the other hand holds is left out, with an info note.
- **Cross-staff bullet (~L150–156):** voice 1 is "drawn on that staff alone, with no other voice sounding on that staff meanwhile".
- **Ornaments bullet (~L191–197):** add `glissando-not-played` (review) for `<glissando>` and `<slide>`.
- **Warnings bullet (L198–201):** `measuresTruncated` marks a list cut at 20, and `count` counts notes, not measures.
- **Piano range (L69–71):** notes beyond MIDI 0–127, or with an octave outside 0–9, are left out with a review warning, and a transposition over 48 semitones is ignored.
- **Section 1:** add the limit of 200 parts and 200,000 parts × measure columns, raising `too-large`.
- **MXL (L228–232):** the zip64 marker-value rule described above.
- **Measure labels (~L323–336):** the fallback to positional numbers after more than 52 suffixes.

**Files changed:**
- Source:
  - /Users/gapp/Desktop/Piano/src/core/measures.ts
  - /Users/gapp/Desktop/Piano/src/core/mxl.ts
  - /Users/gapp/Desktop/Piano/src/core/voices.ts
  - /Users/gapp/Desktop/Piano/src/core/types.ts
  - /Users/gapp/Desktop/Piano/src/core/musicxml/parse.ts
  - /Users/gapp/Desktop/Piano/src/core/musicxml/part.ts
  - /Users/gapp/Desktop/Piano/src/core/musicxml/warnings.ts
  - /Users/gapp/Desktop/Piano/src/core/model/performance.ts
  - /Users/gapp/Desktop/Piano/src/core/model/hands.ts
- New tests:
  - /Users/gapp/Desktop/Piano/tests/core.regressions.test.ts (new file)
  - /Users/gapp/Desktop/Piano/tests/mxl.test.ts
  - /Users/gapp/Desktop/Piano/tests/voices.test.ts
  - /Users/gapp/Desktop/Piano/tests/measures.test.ts
- Updated expectations:
  - /Users/gapp/Desktop/Piano/tests/parser.test.ts
  - /Users/gapp/Desktop/Piano/tests/e2e.regressions.test.ts
  - /Users/gapp/Desktop/Piano/tests/e2e.fixtures.test.ts
  - /Users/gapp/Desktop/Piano/tests/model.hands.test.ts
  - /Users/gapp/Desktop/Piano/tests/model.prepare.test.ts