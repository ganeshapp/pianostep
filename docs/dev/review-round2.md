

===== review:security-storage-deploy =====
{
 "findings": [
  {
   "id": "mxl-two-directories-bypass-size-limit",
   "title": "Round-1 MXL bomb fix is incomplete: size limits are checked against fflate's central directory, but entries are read and size-bounded using a different directory. A ~1-4 MB .mxl makes the page allocate and fill 1-4 GB.",
   "severity": "major",
   "briefRef": "§12 Supported input: \"Handle corrupt ZIPs ... and excessive archive sizes with a readable error\" (round-1 finding security-storage-deploy:mxl-lying-header-cpu-bomb)",
   "files": [
    "src/core/mxl.ts"
   ],
   "evidence": "Two different readers decide the sizes:\n- listEntries (src/core/mxl.ts:50-69) applies maxEntries and maxUncompressedBytes (60 MB) to fflate's unzipSync listing.\n- fflate 0.8.3 unzipSync (node_modules/fflate/esm/index.mjs:2670-2690) takes the entry count and central-directory offset from the zip64 end record whenever a zip64 locator sits 20 bytes before the EOCD (`z = b4(data, e - 20) == 0x7064B50`). It does this even when the classic EOCD has no 0xFFFF/0xFFFFFFFF sentinels.\n- The new centralDirectory() (mxl.ts:116-182) reads only the classic EOCD: count at +10, offset at +16 (lines 126-128).\n- readEntry (mxl.ts:211-232) checks only that the two listings have the same names (line 213, `dir.some((e, i) => e.name !== entries[i].name)`).\n- It then calls inflateBounded with ITS OWN entry.originalSize. inflateBounded runs `new Uint8Array(limit)` (line 194) and inflates up to that limit.\n\nSo one central directory can declare 1000 bytes, which passes the 60 MB check, while the other declares up to 4 GB, which becomes the allocation and inflation bound.\n\nReproduction:\n- /tmp/r2sec/mk2cd.py writes a one-entry archive (score.musicxml, raw-deflated zeros). Its zip64 end record points to a CD declaring 1000 bytes; its classic EOCD points to a second CD with the same name declaring N bytes.\n- /tmp/r2sec/run.mts runs extractMusicXmlText under `/usr/bin/time -l npx tsx`.\n\nResults:\n- /tmp/rev/bomb1g.mxl (round-1 single-CD bomb): bad-archive in 53 ms, peak RSS 163 MB. The round-1 fix works for this case.\n- two1g.mxl: 1.04 MB archive, second CD 1,000,000,000. bad-archive after 1803 ms, peak RSS 1.29 GB.\n- two2g.mxl: 3.1 MB archive, second CD 2,147,483,000. 3795 ms, peak RSS 2.43 GB.\n- two4g.mxl: 4.2 MB archive, second CD 4,294,967,294. 7447 ms, peak RSS 4.30 GB.\n\nThis runs synchronously on the main thread during import (src/storage/imports.ts:257-258).",
   "failureScenario": "The learner imports a crafted 1-4 MB .mxl. While \"Checking…\" is shown, the page's main thread allocates and fills 1-4 GB for several seconds. On a laptop, phone or browser with less headroom, the renderer is killed (\"Out of memory\") and the readable \"too large\" or \"damaged\" message never appears. The 60 MB uncompressed cap that the round-1 fix documents is not actually enforced.",
   "suggestedFix": "Enforce the limits on the directory that is actually used to read data:\n- Sum centralDirectory() originalSize values and check them against maxEntries and maxUncompressedBytes. Alternatively, reject when `dir[index].originalSize !== entries[index].originalSize`, or when the method or compressed size differs from fflate's view.\n- Reject any archive that has a zip64 locator or end record. No .mxl at or below the 20 MB archive limit needs zip64. At minimum, reject when the zip64 record's count or offset differs from the classic EOCD.\n- Cap inflateBounded's `limit` at limits.maxUncompressedBytes as a final guard.\n- Add a regression test in tests/mxl.test.ts with a two-directory archive. It should fail quickly with too-large or bad-archive."
  },
  {
   "id": "staves-count-oom-crash",
   "title": "A <1 KB MusicXML file declaring a huge <staves> count crashes the tab with a heap out-of-memory error (regression from the round-1 ossia-staff code in hands.ts)",
   "severity": "major",
   "briefRef": "§12 Supported input: malformed or unsupported content must produce a readable error; round-1 fix traceability:in-part-ossia-staff-replaces-rh",
   "files": [
    "src/core/model/hands.ts",
    "src/core/musicxml/part.ts"
   ],
   "evidence": "- src/core/musicxml/part.ts:449-451 accepts any integer `<staves>` larger than the current value, with no upper bound.\n- The new mapManyStaves (src/core/model/hands.ts:126-141), added in round 1 for parts with 3+ staves, sizes its work by total = part.staves:\n  - `new Array<number>(total + 1).fill(0)` (line 129)\n  - `Array.from({ length: total + 1 }, () => new Set<number>())` (line 130)\n  - `for (let s = 1; s <= total; s++)` (line 137)\n- Before round 1, mapSinglePart only mapped staff 1 and the last staff, with no per-staff allocation.\n\nReproduction: /tmp/r2sec/staves.mts builds a 747-754 byte file (one Piano part, one measure, C5 on staff 1, C3 on staff 2, `<staves>N</staves>`). It runs loadSourceScore and prepareScore under `/usr/bin/time -l npx tsx`:\n- N=2 or 3: parse 4 ms, prepare 1 ms, RSS ~100 MB, ready.\n- N=1,000,000: prepare 136 ms, RSS 280 MB.\n- N=5,000,000: prepare 562 ms, RSS 979 MB.\n- N=10,000,000: prepare 1211 ms, peak RSS 1.83 GB, readiness 'ready', so it would be saved.\n- N=30,000,000: \"FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\" (process killed, 4.6 GB).\n\nimportFile runs parseScoreBytes and prepareScore on the main thread (src/storage/imports.ts:258). A V8 heap OOM cannot be caught, so neither the ImportError path nor the ErrorBoundary can respond.",
   "failureScenario": "The user imports a tiny damaged or hostile .musicxml or .mxl with, for example, `<staves>30000000</staves>`. The tab crashes (\"Aw, Snap! Out of memory\") instead of showing a readable error. With a somewhat smaller value (about 10 million), the import succeeds as 'ready'. Every later opening of that piece then freezes for over a second and uses about 2 GB.",
   "suggestedFix": "- In part.ts, treat `<staves>` above a sane maximum (for example 16) as unsupported, or ignore it and use the highest staff number that actually carries notes.\n- In hands.ts mapManyStaves, count notes and measures with Maps keyed by the staves that actually have notes, instead of arrays sized by part.staves. Iterate over those keys, not 1..total.\n- Add a parser or prepare test with `<staves>100000000</staves>` that must finish quickly with a bounded result or a readable ImportError."
  },
  {
   "id": "lockfile-pinned-to-private-registry",
   "title": "The deploy workflow's `npm ci` downloads every package from an internal company npm mirror, because all 212 lockfile `resolved` URLs point to it",
   "severity": "major",
   "briefRef": "§15 \"Provide a documented build and a GitHub Pages deployment workflow\"; §18.2 \"GitHub Pages deployment is prepared\"; §19 README setup",
   "files": [
    "package-lock.json"
   ],
   "evidence": "- `grep -c '\"resolved\": \"https://<internal-registry>' package-lock.json` gives 212. All 212 `resolved` entries point to it; none point to registry.npmjs.org (for example, line 2701: rollup-4.63.1.tgz from the internal mirror).\n- The project has no .npmrc. .github/workflows/deploy.yml:24-28 uses actions/setup-node (default registry, registry.npmjs.org) and then `npm ci`.\n- npm's documented `replace-registry-host` default is \"npmjs\" (/opt/homebrew/lib/node_modules/npm/docs/content/using-npm/config.md:1284-1295). npm only rewrites lockfile URLs that point to registry.npmjs.org, so the GitHub runner fetches every tarball from the internal mirror.\n- README.md:19-22 tells every user to run `npm ci`.\n- Not verifiable here: whether GitHub-hosted runners can reach the mirror.\n- The lockfile itself is otherwise consistent: `npm ci --dry-run` in a copy adds 212 packages, and `npm ls` is clean.",
   "failureScenario": "The user pushes the repo to GitHub as the README instructs. The Deploy job's `npm ci` must download all 212 tarballs from the employer's internal package mirror. If that mirror is IP-allowlisted, VPN-only, rate-limited for outside traffic, or later moved, `npm ci` fails (403 or ETIMEDOUT) and the site never deploys. The same applies to anyone cloning the repo outside that network. Even when it works, the public repository publishes an internal company infrastructure hostname, and a personal project's build depends on a third-party mirror.",
   "suggestedFix": "Regenerate the lockfile against the public registry, for example `npm install --package-lock-only --registry=https://registry.npmjs.org/` (the integrity hashes stay valid). Alternatively, commit a project .npmrc with `registry=https://registry.npmjs.org/` and `replace-registry-host=always`, so CI and other users never touch the mirror. Optionally add a CI step or test that fails if any lockfile `resolved` URL is not on registry.npmjs.org."
  }
 ]
}


===== review:traceability =====
{
 "findings": [
  {
   "id": "repeat-first-ending-at-forward-repeat-replayed",
   "title": "Regression: when a ||: and a 1st ending start on the same measure, the 1st ending plays twice and the 2nd ending never plays (the piece still shows as ready)",
   "severity": "critical",
   "briefRef": "§12 baseline correctness (\"Common repeats and endings, or a clearly reported limitation before practice\"; \"Never silently flatten away important information\"); §13 occurrences; regression from the round-1 fix \"A 2nd-ending measure that also starts a new ||: section is never played\"",
   "files": [
    "src/core/model/performance.ts",
    "tests/model.repeats.test.ts"
   ],
   "evidence": "src/core/model/performance.ts:238 now reads `if (entering && !(arrived && m.repeatForward && i === sectionStart))`. That skips the ending check for every measure reached by jumping back to its own ||:. Round 1 meant it only for a later ending that also opens a new section (case L). It also fires when the ||: measure is itself the 1st ending of the section it opens.\n\nEnd-to-end repro: /tmp/rv2/h.musicxml with m1 C4; m2 left barline ||: plus [1., right barline :|| with D4; m3 [2. with E4; m4 F4. I ran loadSourceScore, prepareScore and deriveSteps (RH) with /tmp/rv2/h.mts:\n  current: readiness ready [] | measures ['1','2','2 (2nd time)','4'] | RH attacks C4 D4 D4 F4\n  pre-fix copy (/tmp/fx/base): measures ['1','2','3','4'] | RH attacks C4 D4 E4 F4\n\nThe same comparison with unrollMeasures and ScoreBuilder (current vs base):\n  H2  m1 | ||:[1. m2 :|| | [2. m3 | m4 | m5  -> current 1 2 2(2nd) 4 5; base 1 2 3 4 5\n  H3  piece starts with ||:[1. m1 :|| | [2. m2 | m3 -> current 1 1(2nd) 3; base 1 2 3\n  H4  ||:[1. m2 | m3 :|| | [2. m4 | m5 (two-bar 1st ending) -> current 1 2 3 2 3 5; base 1 2 3 4 5\nNo warning is raised in any of these cases, and no test covers this pattern (grep finds no `forward: true, endingStart: [1]` in tests).",
   "failureScenario": "An imported (or future built-in) score has a short repeated section that starts with its 1st-ending bar (\"||: [1. A :|| [2. B ||\"). The app plays and teaches bar A twice and drops bar B entirely. The piece is shown as ready with no warning, so the learner practises wrong notes without knowing it.",
   "suggestedFix": "Skip the ending check on arrival only when the ending belongs to the section that closed before this measure, i.e. the span at i is not the first span of its volta group (its numbers do not include the current section's pass 1). Keep the existing check when the span is the section's own 1st ending. Add H2/H3/H4 to tests/model.repeats.test.ts next to the case-L tests, and an e2e fixture through deriveSteps."
  },
  {
   "id": "ornaments-dropped-but-ready",
   "title": "Trills, mordents and turns are played as the main note only, yet 8 built-in pieces stay \"ready\"; the brief requires correct support or a \"needs review\" label",
   "severity": "major",
   "briefRef": "§12: \"Grace notes, trills, complex jumps ... must be inspected against the chosen parser. Support them correctly or label affected pieces/passages as needing review. Never silently flatten away important information and present the result as faithful.\"",
   "files": [
    "src/core/musicxml/warnings.ts",
    "docs/ARCHITECTURE.md",
    "src/catalog/catalog.json",
    "docs/CATALOG_REPORT.md"
   ],
   "evidence": "src/core/musicxml/warnings.ts:10-13 gives 'ornament-not-played' (\"Trills, mordents and turns are played as the main note only\") severity 'info'. Lines 14-17 give the analogous 'tremolo-not-expanded' (notes also not expanded) severity 'review'. Readiness only becomes 'review' for review-severity warnings (ARCHITECTURE.md Readiness). docs/dev/app-builder-reports.md:407 records the decision \"Grace notes, ornaments, rolled chords and pedal are always information only\", which contradicts §12 for trills, which the brief names.\n\nRepro (/tmp/rv2/orn.mts: real catalog files through loadSourceScore and prepareScore with overrides). Ready pieces with unplayed ornaments:\n  12-variations [ready] count=21 m15,23,66,75,86,91,276,290…\n  bella-ciao-la-casa-de-papel [ready] count=1 m32\n  chopin-nocturne-op-9-no-2 [ready] count=8 m2,5,13,21,26,27,30\n  chopin-spring-waltz [ready] count=4\n  minuet-in-g-major-bach [ready] Beginner count=5 m3,5,11,13,30\n  nocturne-in-c-sharp-minor [ready] count=8\n  sonata-no-16-1st-movement-k-545 [ready] count=1 m70\n  waltz-in-a-minorchopin [ready] count=4\nThe library card and practice header show no readiness chip for these. The only mention is the info line in \"About this arrangement\" and the curated note.",
   "failureScenario": "A beginner filters to Beginner and opens \"Minuet in G Major\". No \"Needs review\" chip appears. The notation and keyboard show a single held note in measures 3, 5, 11, 13 and 30, where the score has trills or mordents. The app presents this as a faithful ready piece, although the brief allows that only when the piece is labelled as needing review.",
   "suggestedFix": "Make 'ornament-not-played' severity 'review', with plain wording such as \"Trills and similar ornaments are played as their main note only; check these measures.\" Keep 'grace-notes-approximated' as info, because those notes are played. Alternatively expand trills, mordents and turns into notes. Update ARCHITECTURE.md (Ornaments), the warnings tests and the library readiness pin, then regenerate the catalog."
  },
  {
   "id": "uniform-staff-size-drops-left-hand",
   "title": "Regression in 3+-staff hand mapping: if every staff has the same reduced <staff-size>, all but the busiest staff are called \"printed smaller than the others\" and the left hand is dropped",
   "severity": "minor",
   "briefRef": "§10 (inspect structure; don't drop the main music); round-1 fix for in-part ossia staves (hands.ts)",
   "files": [
    "src/core/model/hands.ts",
    "tests/model.ossia-staves.test.ts"
   ],
   "evidence": "src/core/model/hands.ts:112 is `if (d?.size !== undefined) return 'it is printed smaller than the others';`. The check is absolute (any recorded size below 100), not relative to the other staves. The `lowest` exemption at line 113 only protects the lowest staff from the \"very few notes\" rule, not from the size rule.\n\nRepro (/tmp/rv2/ossia.mts): a 3-staff part (top RH line, middle line, LH bass) with staffDetails {1:{size:80},2:{size:80},3:{size:80}}, run through detectHandMapping:\n  {\"P1:1\":\"R\"} unclear\n  \"The second staff from the top and the bottom staff ... look like an alternative version ... (the second staff from the top: it is printed smaller than the others; the bottom staff: it is printed smaller than the others), so they are left out...\"\n  \"Only the top staff of the piano music has the main music, so all of it is given to the right hand.\"\nBefore round 1 the same file mapped staff 1 to R and staff 3 to L.",
   "failureScenario": "A user imports a three-staff piano score where the arranger shrank every staff (\"small staff\" or a uniform scale on each staff). The left hand disappears completely. The review reason tells the beginner that the staves are smaller than the others, which is false, and gives them nothing they can act on.",
   "suggestedFix": "Treat a staff as small only if its size is below the largest size among the staves with notes (or below the busiest staff's size; a missing size counts as 100). Exempt the lowest staff with notes from the size rule unless it is also marked as an alternative. Add a uniform-size test to tests/model.ossia-staves.test.ts."
  },
  {
   "id": "difficulty-verification-inconsistent",
   "title": "Unverifiable MuseScore level tags are handled inconsistently: one copy becomes Unrated, four stay Beginner (one failed its verification), and the inventory calls an unverified label \"verified\"",
   "severity": "minor",
   "briefRef": "§14 (\"Missing or inaccessible classification means Unrated, not Beginner\"; \"Do not ... claim\" provenance that isn't there); §18.4 honest provenance; round-1 item difficulty-title-word-shown-as-rating (Prelude left open)",
   "files": [
    "catalog/difficulty.json",
    "scripts/build-catalog.ts",
    "docs/CATALOG_REPORT.md",
    "catalog/inventory.json",
    "src/catalog/catalog.json"
   ],
   "evidence": "docs/dev/difficulty-research-raw.json has verify passes for batch1 and batch3 only.\n- verify:batch3 says of Prelude_I_in_C_major_BWV_846: \"confirmed\": false, \"musescore.com ... returned HTTP 403 ... Without seeing the level, the file should stay Unrated.\" catalog/difficulty.json:164 still makes it Beginner (basis source, \"MuseScore score page (level tag in its page title)\").\n- verify:batch1 rejected Bach_Minuet_in_G_Major_BWV_Anh._114 for the same reason (403, level not confirmable), although research had found MuseScore \"easy\" plus \"Elementary-Late Elementary (RCM 1)\". It was left out of difficulty.json, so it is Unrated.\n- Minuet_in_G_Major_Bach (:140), Fur_Elise_-_..._for_beginner_piano (:69) and Happy_Birthday_To_You_Piano (:113) carry the same kind of MuseScore tag from research:batch2, which never had a verify pass. They are all Beginner.\n- Deduplication then keeps Minuet_in_G_Major_Bach over the PianoXML copy \"because it has a verified difficulty label\" (scripts/build-catalog.ts:460; docs/CATALOG_REPORT.md:94,202; catalog/inventory.json). The kept copy has no tempo in the file and unplayed ornaments. The dropped copy has rights \"Public Domain (PianoXML typeset)\" and a file tempo.",
   "failureScenario": "The catalog report and inventory say the Beginner Minuet was kept for a \"verified\" label that no verification pass ever checked. The equivalent PianoXML copy, whose label was rejected only because the page was unreachable, is discarded. The original WTC Prelude in C stays Beginner after its only verification attempt recommended Unrated.",
   "suggestedFix": "Apply one rule to MuseScore-tag labels whose page could not be re-checked: either all Unrated (Prelude BWV 846, and the batch-2 MuseScore records unless re-verified) or all kept. Replace \"verified difficulty label\" in build-catalog.ts, the report and the inventory with accurate wording, e.g. \"a difficulty label\". Re-run the Minuet duplicate choice without the label preference if the label is not verified, then regenerate the catalog."
  },
  {
   "id": "follow-mode-lost-on-return",
   "title": "A saved Follow me mode is replaced by Listen on every return visit and is not restored after connecting the piano, contrary to the documented intent",
   "severity": "minor",
   "briefRef": "§4 main journey step 8 (\"Return later and resume the piece and saved settings\"); §15 (store preferences locally)",
   "files": [
    "src/ui/practice/settings.ts",
    "src/ui/practice/PracticePage.tsx"
   ],
   "evidence": "src/ui/practice/settings.ts:21-33 documents that \"a saved Follow me falls back to Listen until the piano is connected again\". Line 33 sets `if (mode === 'follow' && !canFollow) mode = 'listen';`.\n- PracticePage.tsx:236 passes `midi.inputConnected`. On a fresh page load this is always false, because MIDI is only connected by the Connect piano click (midiConnection.ts:124-139).\n- usePieceStateSaver (PracticePage.tsx:46-64, called at :130) saves the session settings 600 ms after mount, so the stored mode 'follow' is overwritten with 'listen'.\n- Nothing switches back to Follow me after the piano connects: grep finds no code that sets mode 'follow' outside ControlsBar's option list.\n- The fallback is correct in itself (Follow me needs a piano), but the stored preference is destroyed, not deferred.",
   "failureScenario": "The learner practises a piece in Follow me, closes the tab and comes back the next day. The piece opens in Listen. After they click Connect piano it stays in Listen, and the stored setting already says Listen, so their chosen practice mode is never resumed.",
   "suggestedFix": "Keep the stored mode separate from the effective one: don't persist the fallback, for example by saving `mode: 'follow'` while the fallback is active. When useMidiConnection reports a connected input and the stored mode was 'follow', call session.updateSettings({ mode: 'follow' }). Add a PracticePage test: saved follow, no piano, reload, then connect → Follow me."
  }
 ]
}


===== review:ui =====
{
 "findings": [
  {
   "id": "midi-try-again-grabs-other-input",
   "title": "\"Try again\" after the piano disconnects silently switches to whatever other input is connected (e.g. \"Midi Through Port-0\"), says it is connected, and stops the real piano from being picked up when it returns",
   "severity": "major",
   "briefRef": "UI_SPEC:217 \"MIDI denied, no devices, and disconnected, each with a retry\"; brief §16 understandable disconnected states; regression from the round-1 fix ui:midi-disconnected-cannot-switch-device",
   "files": [
    "src/ui/practice/midiConnection.ts",
    "src/ui/practice/ConnectPiano.tsx"
   ],
   "evidence": "- The notice's \"Try again\" calls conn.connect (ConnectPiano.tsx:98-102).\n- connect() resolves at once when access is already granted. If the selected input is not connected, it calls fallbackInput() and selects the result (midiConnection.ts:133-137).\n- fallbackInput() first looks for a live input with the remembered name. Otherwise it returns \"the only other connected input\", whatever that device is (midiConnection.ts:66-75). The unplugged piano is never live, so the name match cannot succeed until the piano is back.\n\nReproduction: /tmp/pr2/tests/midinotice.test.ts, using the real PracticePage and real MidiManager with a fake Web MIDI access. Inputs are \"Yamaha P-125\" and \"Midi Through Port-0\"; the user picks the Yamaha, then unplugs it:\n- C notice: \"Your piano was disconnected. Reconnect it, or choose your piano from the list. Try again Dismiss\"\n- D after Try again: selected in-t, connected true. Status: \"MIDI: Midi Through Port-0 connected\". Follow me disabled: false.\n- E after the piano is plugged back in: selected is still in-t.\n- Control, same setup without pressing Try again: after re-plugging, selected in-a, connected true. The piano is re-attached automatically.",
   "failureScenario": "On Linux, Chrome always lists \"Midi Through Port-0\". On Windows or macOS this happens with any second input (a loopMIDI or IAC port, a USB MIDI interface, a second keyboard).\n\nThe learner's piano drops out, for example because the cable is knocked or the piano powers down. They press the obvious \"Try again\" button. The app attaches the virtual port, shows a \"connected\" dot and \"MIDI: Midi Through Port-0 connected\", and enables Follow me. Follow me then waits on a device that never sends notes.\n\nWhen the piano is plugged back in, it is no longer re-attached, because the selection has moved to the other port. The learner has to notice the wrong device name and pick the piano from the list. Without pressing Try again, it would have reconnected by itself.",
   "suggestedFix": "Make \"Try again\" re-pick only an input that plausibly is the same piano: a live input whose name matches the selected input's remembered name (the inputs() entry for selectedInputId) or the saved name. Never auto-switch to an unrelated sole device. When nothing matches, keep the current selection, so the returning piano is still re-attached automatically, and point the learner to the device list, which is already shown in this state. Add a test with a piano plus a virtual port."
  },
  {
   "id": "select-keeps-focus-without-change",
   "title": "After a mouse look at a select with no new choice, focus stays on it, so Space and → no longer play or step (on Windows the arrows change the passage instead)",
   "severity": "minor",
   "briefRef": "UI_SPEC:186-191 \"Pointer (mouse or touch) use never leaves focus on a control … so the shortcuts keep working after clicking\"; Help text HelpDialog.tsx:200-203; incomplete round-1 fix ui:shortcuts-swallowed-after-mouse-use",
   "files": [
    "src/ui/common/pointerFocus.ts",
    "src/ui/practice/ControlsBar.tsx",
    "src/ui/practice/ConnectPiano.tsx",
    "src/ui/practice/MoreMenu.tsx"
   ],
   "evidence": "- usePointerRelease.release() is only called from each select's onChange: From/To at ControlsBar.tsx:265-268 and 286-289, Your piano at ConnectPiano.tsx:34-37, Play through at MoreMenu.tsx:121-124.\n- Opening the native list with the mouse and then closing it with Esc, a click outside, or the already-selected item fires no change event. Focus stays on the select.\n- shortcutFor() returns null for any focused select (shortcuts.ts:33-36 and :53).\n- The same applies to clicking a field's text label (\"Speed\", \"Seconds per step\", \"From measure\", \"to\"). In Chrome that focuses the control, and nothing releases it: the slider's releaseAfterDrag is only on the slider's own pointerdown (ControlsBar.tsx:208, 244).\n\nReproduction: /tmp/pr2/tests/selectfocus.test.ts, real PracticePage, Chrome-like pointerClick on the \"From measure\" select with no change:\n- focus after select look: select \"From measure\"\n- shortcut Space: null, ArrowRight: null, Home: null\n- step before/after →: \"Step 1 of 275\" / \"Step 1 of 275\"\n- play label after Space: \"Play\"",
   "failureScenario": "The learner clicks \"From measure\" to see which measures exist, then closes the list without changing it. They then press Space to play and → to step:\n- On Chrome for Windows, → moves the passage start to the next measure, rebuilding the passage and stopping playback. Each further → moves it again, because keyboard use cancels the pointer mark.\n- On macOS, Space reopens the list and → does nothing.\n\nHelp says \"Clicking the controls with the mouse doesn't get in the way.\"",
   "suggestedFix": "Release on pointer interactions that end without a change too. On selects, also release on blur of the native popup: for example, on the 'pointerup'/'click' following a pointerdown, schedule a blur if the value is unchanged and the pointer mark is still set. Alternatively, track the select's open/close via its 'click' and 'keydown' events. Give field labels the same treatment: a pointer-down on a label marks the control, and the control releases focus after the label click. Add tests for an unchanged select."
  },
  {
   "id": "midi-notice-dismissed-forever",
   "title": "Dismissing any MIDI notice hides every later notice for the rest of the visit, including the \"disconnected\" notice and its Try again",
   "severity": "minor",
   "briefRef": "UI_SPEC:217 \"MIDI denied, no devices, and disconnected, each with a retry\"; brief §16 disconnected states",
   "files": [
    "src/ui/practice/midiConnection.ts"
   ],
   "evidence": "- `dismissed` is a single boolean (midiConnection.ts:106). dismissNotice sets it (:187), and only connect() clears it (:126).\n- The notice is built only `if (!dismissed)` (:150-176), whatever the current phase is.\n- In the 'disconnected' phase with no other device, ConnectPiano shows only the chip, not the Connect button (ConnectPiano.tsx:12-66). The notice is therefore the only place a retry is offered.\n\nReproduction: /tmp/pr2/tests/midinotice.test.ts, real MidiManager:\n- 1 notice: \"No piano found … then try again. Try again Dismiss\". The user dismisses it and plugs the piano in.\n- 2 after plug: \"Yamaha P-125\", notice: none.\n- 3 after unplug: midi area \"Yamaha P-125 disconnected\", notice: none, Try again button: false, Connect piano button: false.",
   "failureScenario": "A learner dismisses the \"No piano found\" (or \"choose your piano\") message, plugs the piano in, and practises. Later the piano disconnects. No \"Your piano was disconnected. Reconnect it…\" explanation appears, and there is no Try again button anywhere. Only a grey dot and \"disconnected\" text remain.",
   "suggestedFix": "Remember what was dismissed, for example the phase or the notice text, rather than a global flag. Clear it whenever the phase changes, so a new problem always shows its notice and retry."
  },
  {
   "id": "readiness-reason-dangling-measures",
   "title": "The \"Needs review\" chip on 19 built-in pieces says \"check these measures if a hand feels wrong\" but lists no measures",
   "severity": "minor",
   "briefRef": "brief §4 \"Clear readiness state\", §16 plain language and understandable states; UI_SPEC readiness chip popover listing the reasons; follows from the round-1 queued cross-staff wording change",
   "files": [
    "src/ui/common/ReadinessChip.tsx",
    "src/core/musicxml/warnings.ts",
    "src/core/model/prepare.ts"
   ],
   "evidence": "- The cross-staff warning text ends \"…; check these measures if a hand feels wrong.\" (warnings.ts:22).\n- readinessReasons are the bare warning messages, without their measures (prepare.ts:39-45).\n- ReadinessChip renders those strings only (ReadinessChip.tsx:28-30), on library cards and in the practice header (PracticePage.tsx:96).\n- Only \"About this arrangement\" adds the measures, via measureList (DiagnosticsDialog.tsx:117-123).\n- A catalog scan finds this exact reason on 19 built-in pieces.",
   "failureScenario": "A beginner opens the \"Needs review\" popover on a library card or in the practice header and reads \"check these measures if a hand feels wrong\". No measures are shown and nothing says where to find them.",
   "suggestedFix": "Either render the warning's measures in the chip (keep the structured warnings, or pass `{message, measures}` to ReadinessChip and show \"Measures 12, 14\" under the reason), or reword the reason so it doesn't refer to a list, e.g. \"…; the measures are listed under More → About this arrangement.\""
  },
  {
   "id": "space-plays-while-menu-open",
   "title": "Space plays or pauses while the measure menu or More panel (opened with the mouse) is open, although the spec and Help say shortcuts don't apply while a menu is open",
   "severity": "minor",
   "briefRef": "UI_SPEC:181-182 \"Keyboard shortcuts apply when … no dialog or menu is open\"; Help text HelpDialog.tsx:200-201",
   "files": [
    "src/ui/practice/shortcuts.ts",
    "src/ui/notation/Timeline.tsx",
    "src/ui/practice/MoreMenu.tsx"
   ],
   "evidence": "- shortcutFor() only blocks on open dialogs (shortcuts.ts:38-40, 50). Its Space rule covers [role=menuitem] but not [role=menu] (:23-24).\n- A mouse-opened measure menu focuses the role=\"menu\" container (Timeline.tsx:283-284). Space then reaches the shortcut, while ←/→ are swallowed by ARROWS_OWNED (:27).\n- A mouse-opened More panel leaves focus on <body> (MoreMenu.tsx:39), so every shortcut fires.\n\nReproduction: /tmp/pr2/tests/selectfocus.test.ts:\n- menu open: true; focus: div \"Measure 1\"; shortcut Space with menu open: toggle\n- play label: Pause; menu still open: true\n- More panel open: true; focus: body; shortcut: toggle",
   "failureScenario": "A learner opens the Measure 5 menu with the mouse and presses Space (or Enter, then Space) expecting to pick an item. Playback starts instead, and the menu then slides along with its label until it closes. ← and → do nothing in the same state. The behaviour contradicts what Help tells the learner.",
   "suggestedFix": "Decide on one rule and make the code, UI_SPEC and Help agree. Either treat an open measure menu or More panel as \"menu open\": add [role=\"menu\"] to SPACE_ACTIVATES, and have the More panel or a shared flag suppress shortcuts while it is open. Or, if Space should keep working, update UI_SPEC:182 and the Help sentence."
  },
  {
   "id": "identical-chip-button-names",
   "title": "Library: 20 identical \"Needs review: show reasons\" buttons, and identical ⓘ names on same-title cards",
   "severity": "minor",
   "briefRef": "brief §16 \"Focused controls have keyboard access and accessible labels\"; UI_SPEC:66 cards with accessible names",
   "files": [
    "src/ui/common/ReadinessChip.tsx",
    "src/ui/common/DifficultyBadge.tsx",
    "src/ui/library/LibraryCard.tsx"
   ],
   "evidence": "- ReadinessChip names its trigger `${text}: show reasons` with no piece (ReadinessChip.tsx:20).\n- DifficultyInfoButton uses only the title (DifficultyBadge.tsx:141).\n\nAccessible-name scan of the real LibraryPage (/tmp/pr2/tests/names.test.ts):\n- 20 × button \"Needs review: show reasons\"\n- 4 × button \"About the difficulty of Für Elise\"\n- 3 × \"About the difficulty of Canon in D\"\n- 2 × each for Clair de lune, Carol of the Bells, Gymnopédie No. 1 and Happy Birthday to You",
   "failureScenario": "A screen-reader user lists the page's buttons, or tabs through them out of reading context. They hear \"Needs review: show reasons\" twenty times and \"About the difficulty of Für Elise\" four times, with no way to tell which piece or arrangement each belongs to.",
   "suggestedFix": "Pass the piece title (plus the arrangement when titles repeat) into ReadinessChip and the ⓘ label. Examples: \"Needs review: show reasons for Für Elise (Easy piano)\" and \"About the difficulty of Für Elise (Easy piano)\". Alternatively, reference the card heading and arrangement with aria-describedby."
  },
  {
   "id": "nothing-to-play-both-hands-wording",
   "title": "With Both hands, an empty passage tells the learner to \"Choose the other hand\", and Play reports \"nothing to play for the chosen hand\"",
   "severity": "minor",
   "briefRef": "brief §16 understandable empty states, plain language",
   "files": [
    "src/ui/practice/PracticePage.tsx",
    "src/engine/session.ts"
   ],
   "evidence": "- nothingToPlayText() builds `There is nothing for ${who} to play in these measures. Choose the other hand or a different passage.` with who = \"either hand\" for both hands (PracticePage.tsx:40-43).\n- SESSION_MESSAGES.nothingToPlay is 'There is nothing to play for the chosen hand in these measures.' (session.ts:130), and the status line shows it on Play.\n- Catalog scan (/tmp/pr2/s/empty.mts): Swan Lake (ready) measures 28–32 and Lacrimosa (ready) measures 31–32 have nothing to play in either hand.",
   "failureScenario": "A learner selects Swan Lake measures 28 to 32 with Both hands. The timeline says \"There is nothing for either hand to play in these measures. Choose the other hand or a different passage.\" With both hands already selected there is no \"other hand\". Pressing Play then says \"nothing to play for the chosen hand\".",
   "suggestedFix": "Word the both-hands case separately: \"There is nothing to play in these measures (they are silent). Choose a different passage.\" Make SESSION_MESSAGES.nothingToPlay hand-neutral, or give it the same hand-aware text."
  }
 ]
}


===== review:follow-midi =====
{
 "findings": [
  {
   "id": "echo-guard-misses-cc64-and-reset-noteoffs",
   "title": "With \"Play through connected piano\" selected, Follow me sends All Notes Off and Sustain Off to the piano at every loop restart, pause and setting change, even though it played nothing. On a piano that echoes, the echoed Sustain Off and the extra note-offs get past the echo guard and are taken as the player's own input.",
   "severity": "minor",
   "briefRef": "§9 Input ('Track physical pressed keys separately from expected score keys and app-generated playback events'; 'CC64 sustain state is separate'); §9 Audio routing ('Prevent MIDI echo/feedback loops'); round-1 fix releaseall-cuts-monitored-input (Follow me keeps the learner's monitored notes)",
   "files": [
    "src/midi/manager.ts",
    "src/engine/session.ts"
   ],
   "evidence": "Code:\n- manager.ts:384-405 (handleMessage) checks only note-on and note-off events against the echo guard. A CC64 'sustain' event (decode.ts:35-38) is always delivered.\n- manager.ts:283-288 (allNotesOff) sends a note-off for every key in appNotes, then CC123 and CC64=0. appNotes holds every key struck since the last allNotesOff, including keys already released (:128-129, :249).\n- The echoes of those extra note-offs have no swallowed note-on to pair with, because the regular echo already used up echoOns. So :397-403 delivers them to listeners.\n- session.ts:1012: releaseAll() calls midi.allNotesOff() whenever an output is selected. That includes Follow me's keepMonitor path: the loop restart (:814-817), pause (:644-645) and settings changes (:432-434). Follow me never sends a note.\n\nRepro /tmp/r2fm/t1b.mts uses the real MidiManager with a port that echoes what it receives 3 ms later. Setup: Follow me, loop on, monitorInput on, output set to the same piano. The learner holds the pedal and plays C4 and D4 to the end:\n```\n10000 status waiting pedalDown true\n10210 status finished pedalDown true\n11210 sampler.noteOff 60\n11210 sampler.noteOff 62\n11210 status waiting pedalDown false\nsent to piano at loop restart: [[176,123,0],[176,64,0]]\nend: status waiting pedalDown false (learner foot still on the pedal)\n```\nWith `noecho`, pedalDown stays true, but the piano still receives [[176,123,0],[176,64,0]] at every restart.\n\nRepro /tmp/r2fm/t2.mts: Listen, echoing piano, monitorInput on. The learner holds C4 after the app's own C4 has ended, then presses Pause:\n```\nlearner holds C4: [ 60 ]\nafter Pause, learner still holds C4: []\nmonitor sampler calls for C4: [\"noteOn\",\"noteOff\"]\n```",
   "failureScenario": "1. A learner keeps the piece's \"Play through connected piano\" setting from Listen and moves to Follow me, with \"Hear my playing\" on. They loop a passage and hold the sustain pedal through the last chord.\n2. The piano echoes received MIDI, which is the case the echo guard exists for.\n3. At each loop restart (and on Pause, the Sound switch or a hands change), the app sees its own CC64=0 come back as a pedal release. The pedal chip turns off while the foot is still down, and the browser's pedal-held notes are cut. This brings back, for this setup, the bug round 1 fixed for Follow me.\n4. Even without an echo, the piano receives Sustain Off and All Notes Off at every Follow loop restart. On instruments whose MIDI-received damper and local damper share state, this can cut the learner's own sustain (device-dependent, plausible).\n5. In Listen, pausing while holding a key the app played earlier removes it from the keyboard's held-key dots and silences its monitored sound.",
   "suggestedFix": "1. In PracticeSession.releaseAll, call midi.allNotesOff() only when the app has something on the output to release: note-ons sent since the last release, a pending preview, or queued messages. In Follow me, which sends no notes, that means never.\n2. In MidiManager, keep appNotes as the keys currently sounding: remove a key once its note-off has been sent. allNotesOff then does not re-send offs for keys that are already released.\n3. Record the CC64/CC123 values the app sends, and drop an input CC64 with the same value within ECHO_WINDOW_MS as an echo.\n4. Add loopback tests: Follow loop restart with the pedal held; Listen pause while holding a key the app played earlier."
  },
  {
   "id": "connect-piano-keyboard-focus-lost",
   "title": "Using Connect piano or Try again from the keyboard drops focus to the page body; the new piano list is not focused",
   "severity": "minor",
   "briefRef": "§16 ('Focused controls have keyboard access and accessible labels'); §9 ('device selection if multiple inputs exist')",
   "files": [
    "src/ui/practice/ConnectPiano.tsx"
   ],
   "evidence": "- ConnectPiano.tsx:12-67 replaces the Connect piano button (:72-82) with a chip or a <select> as soon as the phase becomes connected, choose or disconnected.\n- MidiNotice (:98-104) unmounts the Try again button once the notice clears.\n- Nothing moves focus in either case.\n\nRepro with jsdom, the real MidiManager, useMidiConnection and ConnectPiano/MidiNotice.\n\n/private/tmp/r2fm/focus.test.ts focuses the button and activates it:\n```\none device: { before: true, after: 'BODY' }\ntwo devices: { before: true, after: 'BODY' }\n```\nIn the two-device case the notice asks the user to \"Choose your piano from the list\", but the new 'Your piano' select is not focused.\n\n/private/tmp/r2fm/focus2.test.ts: the piano re-enumerates under a new id and name, and Try again is focused and activated:\n```\nTry again focused before: true after: BODY connected: true\n```",
   "failureScenario": "A keyboard or screen-reader user tabs to Connect piano and presses Enter. With a piano plus a second MIDI device, the app now needs them to pick from the list, but focus has dropped to <body>. They have to tab through the page again from the top to find the select, and nothing is announced where focus landed. The same happens after Try again recovers a re-plugged piano.",
   "suggestedFix": "When Connect piano or Try again was activated from the keyboard (isKeyboardClick):\n- If the input select appears, move focus to it.\n- Otherwise move focus to a stable control next to it, such as a focusable connection chip or the More button.\n- Do the same when Dismiss removes the notice.\n\nAdd a focus test next to tests/practice.focus.test.ts."
  },
  {
   "id": "saved-input-never-connected-shown-as-disconnected",
   "title": "On a piece with a saved piano, connecting while the piano is off says \"Your piano was disconnected\" (it never connected); the no-devices help never appears, and a piano that shows up under a new id/name is not picked up automatically (round-1 reconnect fix incomplete)",
   "severity": "minor",
   "briefRef": "§9 Input ('Handle permission denial, unsupported browser, no devices, connection, disconnection, and reconnection gracefully'); round-1 follow-midi:midi-reconnect-dead-end, suggested fix item 3 / scenario C",
   "files": [
    "src/ui/practice/midiConnection.ts",
    "src/midi/manager.ts"
   ],
   "evidence": "Code:\n- midiConnection.ts:128 pre-selects the piece's saved midiInputId before connect().\n- manager.ts:359-368 (reconcile) keeps that id while it is absent. mayAutoSelect (:364) is true only on first connect or when nothing is selected.\n- midiPhase (midiConnection.ts:43) returns 'disconnected' for any non-null selection, so the notice (:164-169) never uses MIDI_TEXT.noDevices or stillNoDevices.\n\nRepro /tmp/r2fm/t6.mts (real MidiManager, connect flow as in useMidiConnection):\n```\nafter Connect with piano switched off: ready { phase: 'disconnected', notice: 'Your piano was disconnected. Reconnect it and it will be picked up again.' }\nsame, piece never practised: no-devices\npiano switched on (new id/name): { phase: 'disconnected', notice: 'Your piano was disconnected. Reconnect it, or choose your piano from the list.' } inputConnected false\n```\nOn a piece without a saved id, the same late-arriving piano is auto-selected (manager test 'is ready with no devices, then auto-selects a piano that is plugged in later').\n\nRound 1 reported this exact case (r9.mts: \"The notice says 'Your piano was disconnected...' although it never connected\"). The fix added the select and the Try again fallback but not the wording or no-devices part.",
   "failureScenario": "1. A learner opens a piece they practised yesterday with the piano still switched off, and clicks Connect piano.\n2. They are told their piano \"was disconnected\". They never get \"No piano found. Check that it is switched on and connected…\" or the \"Still no piano found\" follow-up.\n3. They switch the piano on and it is reported under another id and name (for example Bluetooth instead of USB, or another computer's port naming). It is not attached automatically, unlike on a piece never practised.\n4. Follow me stays disabled until the learner works out that they must choose it from the list or press Try again, under a message that misstates what happened.",
   "suggestedFix": "- Treat a saved input id that is not present when access is granted as no selection. For example, in useMidiConnection's connect().then, clear the selection if the saved id never connected. Then midiPhase reports 'no-devices' and reconcile auto-selects a sole input when it appears.\n- Alternatively, have MidiManager track whether the selected input has connected in this session: a never-seen selection gives way to a sole input on statechange, and midiPhase shows 'no-devices' text for it.\n- Add a test for the saved-id, piano-off, piano-on-with-new-id flow."
  }
 ]
}


===== review:engine =====
{
 "findings": [
  {
   "id": "play-after-finish-plays-nothing",
   "title": "Play does nothing after a finished passage when the marker is restored to, or left on, the final release (reopening the piece, or a mode/hands/passage change after finishing)",
   "severity": "major",
   "briefRef": "§8 Listen and Steady (play, stop/restart); §15 (last selected piece/passage is stored); APP_CONTRACTS Engine: play() 'plays (Listen/Steady)'",
   "files": [
    "src/engine/session.ts",
    "src/ui/practice/PracticePage.tsx",
    "src/ui/practice/settings.ts"
   ],
   "evidence": "Root cause: play() rewinds to step 0 only when status === 'finished' (session.ts:493-495). Two paths turn a finished passage into 'stopped' with the marker still on the final release step:\n(a) haltPlayback() (session.ts:655-663) sets status 'stopped' on any mode, hands or range change and keeps the marker (updateSettings 444-452).\n(b) usePieceStateSaver saves the tick of the finished marker (PracticePage.tsx:130). On the next visit SessionHost restores it with stepIndexForTick (settings.ts:71-75) and seek() (PracticePage.tsx:238-239), and the status stays 'stopped'.\nPlay then calls startRun(times[n-1]). Nothing is left to play, so the session runs through the trailing rest (plus a count-in when that is on) and reports 'finished'. Follow me already has the matching rule (beginFollow, session.ts:1049, `attackAtOrAfter`), but Listen and Steady do not.\nRepro /tmp/r2eng/t9.mts (reopen): `day 1 ended finished at step 3/4; saved tick 16; day 2 opens stopped at step 3` → `first Play: notes 0 → finished` → `second Play: notes 5`.\nRepro /tmp/r2eng/t8b.mts (count-in on, both hands end on one chord): `{\"mode\":\"steady\"} | finished 3/4 → stopped 3/4 → Play: count-in; clicks 4, notes 0, then finished`; the same happens for hands R and hands L.",
   "failureScenario": "Case 1: a learner listens to a piece to the end and closes it. Next day they open it and press Play. They hear four count-in clicks or nothing at all, the status goes straight to finished, and the marker never moves. Case 2: after listening to the end, the learner switches to Steady steps (or to Right hand) and presses Play, with the same result. Only a second press of Play actually plays.",
   "suggestedFix": "In play() (Listen/Steady), start from step 0 when no step at or after the marker has a key to strike, as beginFollow already does. Alternatively, let haltPlayback keep 'finished' (or reset the marker to 0) when the status was 'finished', and do not restore a saved position that is on the final release. Add engine tests for: finish, then mode/hands change, then play; and for a session restored at the final tick, then play."
  },
  {
   "id": "midi-out-late-under-main-thread-load",
   "title": "MIDI output notes come late whenever the main thread is busy for more than about 15–40 ms; the browser sound is unaffected (regression from the 40 ms MIDI lookahead)",
   "severity": "minor",
   "briefRef": "§16 'Audio timing must not drift materially because visual rendering is busy'; §9 'Play through connected piano'",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "session.ts:105 and 115: the scheduler runs every 25 ms (SCHEDULER_INTERVAL_MS), but MIDI messages are handed over only MIDI_LOOKAHEAD_SEC = 0.04 s ahead (dispatchDue, 927-941). The browser sampler keeps 0.15 s. A timer tick that is more than about 15-40 ms late (depending on tick phase) therefore sends MIDI notes with past timestamps, and they sound late. The new run's first chord is the most exposed: it is dispatched on the next tick, after the React re-render that the Play click or seek itself triggers.\nRepro /tmp/r2eng/t1b.mts (0.5 s notes, a stall starting 40 ms before a note): `stall 50 ms ... MIDI E4 takes effect 10 ms late; sampler E4 late 0 ms`, `stall 80 ms ... MIDI E4 takes effect 40 ms late; sampler E4 late 0 ms`.\nRepro /tmp/r2eng/t1c.mts (main thread busy right after Play): `busy 60 ms → first chord on the MIDI piano at +60 ms, in the browser at +50 ms`, `busy 100 ms → +100 ms vs +50 ms`.\nBefore round 1 the MIDI path had the same ~125 ms tolerance as the sampler.",
   "failureScenario": "With 'Play through connected piano' on, the piano's notes lose their rhythm whenever rendering, a big timeline window mount (the flushSync at loop restarts and jumps), or a GC pause holds the main thread for a few tens of ms. This is most likely on the first chord after Play or a seek, and on slower laptops. The browser sound stays exact, so the two sources also drift apart audibly.",
   "suggestedFix": "Keep the short MIDI horizon for safety, but let the next tick catch up without losing rhythm. Option 1: send messages that are already overdue at their intended relative spacing, by shifting the run's MIDI anchor rather than playing them at once. Option 2: dispatch the next run's first MIDI events in startRun with the full START_LEAD, since START_LEAD already exceeds the queue margin. At least document the reduced tolerance in ARCHITECTURE §7, and add a stall test for the MIDI output like the sampler's 'busy main thread' test."
  },
  {
   "id": "follow-me-sends-sustain-off-to-piano",
   "title": "In Follow me (no app playback), loop restart, pause and settings changes still send All Notes Off and Sustain Off to the selected MIDI output, which can cut the learner's own pedalled chord on the same piano",
   "severity": "minor",
   "briefRef": "§9 audio routing ('release app-generated notes'; keep physical input separate from app playback); round-1 fix follow-midi:releaseall-cuts-monitored-input",
   "files": [
    "src/engine/session.ts",
    "src/midi/manager.ts"
   ],
   "evidence": "Follow me plays nothing on the output: preview() returns early in follow mode and there is no run. Still, releaseAll() calls midi.allNotesOff() whenever an output is selected (session.ts:1012). It is reached from:\n- the Follow loop restart (tick, 814-817);\n- pause while waiting (pauseInternal, 644-645);\n- sound, hands, range and output changes (432-433).\nMidiManager.allNotesOff then always sends CC123 and CC64=0 on channel 1 (manager.ts:287-288). The app never sends a sustain-on, so CC64=0 can only affect the player's own pedal. The round-1 fix kept monitored browser notes sounding in exactly these cases but left this MIDI release in place.\nRepro /tmp/r2eng/t3.mts (real MidiManager, output = the piano, Follow me with loop): the learner completes the passage holding the final chord with the pedal down, and 1 s later the piano receives `b0 7b 0` and `b0 40 0`. Space (pause) sends the same pair again.",
   "failureScenario": "A learner set 'Play through connected piano' for Listen, and it stays selected because it is a global preference. In Follow me with Repeat on, they finish the passage holding the last chord on the pedal. One second later the app sends Sustain Off and All Notes Off to their piano. On instruments that apply received CC64/CC123 to their own sound, the chord is cut while the pedal is still held. The same happens each time they pause with Space.",
   "suggestedFix": "Call midi.allNotesOff() only when the app has sent notes since the last release (track a flag in the session, or have MidiManager skip when appNotes and the queue are empty). Never send CC64=0 unless the app itself sent a sustain-on. At minimum, skip the output release in the Follow me keep-monitor paths, matching the browser-side fix."
  },
  {
   "id": "clock-switch-cuts-first-monitored-note",
   "title": "Starting browser audio during silent playback (the first monitored key, or turning 'Hear my playing' or count-in on) re-anchors the run: the learner's first note is cut after ≤25 ms and the marker and MIDI output pause",
   "severity": "minor",
   "briefRef": "§9 ('Provide a clearly named option to hear input through the browser'); §7 shared clock/marker continuity; round-1 fix engine:audio-not-started-for-countin-monitor",
   "files": [
    "src/engine/session.ts"
   ],
   "evidence": "A monitored note-on now starts browser audio when the sampler is 'not-started' (session.ts:1117-1124), and so do the monitorInput and countIn switches (438-441). The sampler state becomes 'loading' synchronously, so pickClock() (1204-1206) flips from 'wall' to 'audio'. On the next tick, tick() calls reanchor() (821), and reanchor calls releaseAll(). That runs sampler.allNotesOff() (1008), which also kills the monitored voice that just started audio. startRun then adds the 50 ms START_LEAD (752), and on the MIDI output it re-strikes held keys. With a real AudioContext, the new run is anchored to currentTime before the context is running, so the stall can be longer.\nRepro /tmp/r2eng/t5.mts (Steady, Sound off, 'Hear my playing' on, playing): the learner presses D4. Output: `on 62 @0`, then `ANO@now=0.025`, and the voice for 62 is `[0, 0.025]`. Marker positions every 20 ms: `0.975 0.975 0.975 0.99 1.01`, so it holds about 50 ms.",
   "failureScenario": "A learner with a silent MIDI keyboard uses Steady steps with Sound off and 'Hear my playing' on. Their first key press of the session is heard only as a 25 ms click, and the scrolling hitches at the same moment. Turning 'Hear my playing' or count-in on mid-run causes the same hitch, and a re-strike on a connected MIDI piano.",
   "suggestedFix": "When only the clock source changes, re-anchor without releaseAll(), or with keepMonitor semantics. Map the run's anchor from the wall clock to the audio clock at the current position, with no START_LEAD and no re-strike. Defer the switch until the context is actually running (after ensureStarted resolves), not merely 'loading'."
  },
  {
   "id": "speed-drag-restrikes",
   "title": "Dragging the speed or step-length slider re-anchors on every input event, so playback stutters with repeated cuts, 50 ms gaps and re-strikes; held keys about to end are re-struck for a few ms",
   "severity": "minor",
   "briefRef": "§8 Listen ('Start at 1× tempo with a slower/faster control'); §16 quality",
   "files": [
    "src/ui/practice/ControlsBar.tsx",
    "src/engine/session.ts"
   ],
   "evidence": "ControlsBar.tsx:209 and 245 call updateSettings on every slider input event. Each call goes to releaseAll() and reanchor(false) (session.ts:432-433 and 453-454). That fades everything out over 50 ms, waits START_LEAD (50 ms), and re-strikes every key held at that point (buildEvents, 714-718), even keys whose press ends a few ms later.\nRepro /tmp/r2eng/t7.mts (held LH chord, a 150 ms drag of 5 input events): `browser allNotesOff 5, C3 re-struck 5x on the sampler, 5x on the MIDI piano (5 all-notes-off)`, and 171 ms with nothing sounding in a 450 ms window.\nRepro /tmp/r2eng/t4.mts (speed change 5 ms before a release): `on 48 @0.05 | on 64 @0.05 | off 48 @0.06 | off 64 @0.06`. These are 10 ms re-strikes that are not in the score.",
   "failureScenario": "A learner slows the music down by dragging the Speed slider while it plays. They hear a machine-gun of re-attacked chords and drop-outs, on the browser and on a connected piano, instead of a smooth tempo change. A change near a release produces short extra attacks.",
   "suggestedFix": "Commit the timing change on slider release, or debounce it (for example, re-anchor after ~150 ms without further input). Or, better, change timing without releasing: keep sounding voices, cancel only scheduled future events, and reschedule from the current position without START_LEAD and without re-striking held keys."
  }
 ]
}


===== verify:security-storage-deploy =====
{
 "verdicts": [
  {
   "id": "security-storage-deploy:mxl-two-directories-bypass-size-limit",
   "verdict": "confirmed",
   "reason": "I reproduced this with my own generator (/tmp/vsec/gen.py) and runner (/tmp/vsec/run.mts). fflate 0.8.3 unzipSync (node_modules/fflate/esm/index.mjs, unzipSync) reads the entry count and directory offset from the zip64 end record whenever a locator sits at EOCD-20. centralDirectory() in src/core/mxl.ts:116-128 reads only the classic EOCD. readEntry (mxl.ts:213) compares only the names in the two listings, then calls inflateBounded with its own dir[index].originalSize, which allocates `new Uint8Array(limit)` at line 194 and inflates into it. Results: a control archive with one directory declaring 200 MB gives too-large in 0 ms at 93 MB RSS. The same 194 KB archive with a zip64 end record pointing to a directory that declares 1000 bytes passes the 60 MB check, then allocates and inflates 200 MB (bad-archive after 903 ms, peak RSS 444 MB). A 972 KB variant whose second directory declares 1 GB took 4309 ms with peak RSS 1.29 GB. So the documented 60 MB maxUncompressedBytes cap is not enforced on the directory actually used to read data. This runs on the main thread from importFile → parseScoreBytes (src/storage/imports.ts:258). Brief §12 requires a readable error for excessive archive sizes. I also checked the proposed equality check in a patched copy (/tmp/vsec/patched/mxl.ts): the 200 MB and 1 GB attack files then fail in about 1 ms at about 100 MB RSS, and all 69 catalog .mxl files in public/scores still extract identically.",
   "refinedFix": "In src/core/mxl.ts readEntry, reject the archive unless both directories agree on sizes as well as names: `if (!dir || dir.length !== entries.length || dir.some((e, i) => e.name !== entries[i].name || e.originalSize !== entries[i].originalSize)) throw new ImportError('bad-archive', ...)`. listEntries already caps the sum of fflate's sizes at maxUncompressedBytes, so this bounds every size readEntry can use. Legitimate archives are unaffected: without a zip64 end record both readers parse the same directory, and real zip64 sentinel archives are already rejected because centralDirectory returns null. As a final guard, pass `limits` through findScorePath/readEntry and call `inflateBounded(raw, Math.min(entry.originalSize, limits.maxUncompressedBytes), name)`. Optionally, also reject archives that have a zip64 locator (0x07064b50 at eocd-20) whose zip64 record's count or CD offset differs from the classic EOCD. Add a regression test to tests/mxl.test.ts that builds an archive with a zip64 locator and end record pointing to directory A (declares a small size) and a classic EOCD pointing to directory B (same name, declares e.g. 1e9). It must throw bad-archive or too-large quickly without allocating the declared size."
  },
  {
   "id": "security-storage-deploy:staves-count-oom-crash",
   "verdict": "confirmed",
   "reason": "I reproduced this with my own script (/tmp/vsec/staves.mts). It uses the real import path, storage/imports parseScoreBytes, on a 661-668 byte file: one Piano part, notes on staff 1 and staff 2, `<staves>N</staves>`. Results: N=2 or 3 takes 5 ms at about 100 MB RSS. N=1,000,000 takes 130 ms at 285 MB. N=10,000,000 takes 1271 ms at 1.83 GB RSS and still reports readiness 'ready', so it would be saved and re-prepared on every open. N=30,000,000 kills the process with 'FATAL ERROR: Ineffective mark-compacts near heap limit ... JavaScript heap out of memory' at 4.6 GB, which no try/catch or ErrorBoundary can intercept. Cause: part.ts:449-451 accepts any integer `<staves>` larger than the current value. mapManyStaves (hands.ts:126-141), dispatched for part.staves >= 3 at hands.ts:82, then allocates `new Array(total+1)` and `total+1` Set objects and loops 1..total. That violates the §12 requirement to give a readable error for malformed content.",
   "refinedFix": "Primary fix, in src/core/model/hands.ts mapManyStaves: stop sizing the work by part.staves. Use `const counts = new Map<number, number>()` and `const measures = new Map<number, Set<number>>()`, filled only for notes with 1 <= n.staff <= total. Build `withNotes = [...counts.keys()].sort((a, b) => a - b)` and compute `busiest` from that list (ties go to the lowest staff, as now). Replace `counts[s]` and `measures[s]` with `.get(s)` (default 0 or an empty set) everywhere, including the ossia-growth loop. `total` stays only in the wording and in the `main.length === total` / `${id}:${total}` logic, so the documented behaviour is unchanged. Defence in depth, in src/core/musicxml/part.ts readAttributes: ignore implausible values, e.g. `if (n !== null && Number.isInteger(n) && n > this.staves && n <= 64) this.staves = n;`. voices.ts already raises the effective staff count to the highest staff that actually carries notes. Add a test that runs `<staves>100000000</staves>` through parseScoreBytes and expects it to finish quickly (e.g. under 200 ms) with a bounded result or a readable ImportError."
  },
  {
   "id": "security-storage-deploy:lockfile-pinned-to-private-registry",
   "verdict": "confirmed",
   "reason": "All 212 `resolved` URLs in package-lock.json point to an internal company npm mirror (`<internal-registry>`), none point to registry.npmjs.org, and the project has no .npmrc. The URLs come from the npm configuration the lockfile was generated with. .github/workflows/deploy.yml runs `npm ci` after actions/setup-node with the default public registry. I proved where npm ci fetches without any network access: in a copy (/tmp/vsec/ci), with registry=https://registry.npmjs.org/ and an empty cache, `npm ci --offline` failed with ENOTCACHED on a request for xmlchars-2.2.0.tgz from the internal mirror. So with GitHub Actions' default config, every tarball is fetched from the internal mirror, because replace-registry-host=npmjs only rewrites registry.npmjs.org URLs. The Pages deploy (§15/§18.2) and every public clone (README `npm ci`) therefore depend on the company mirror being reachable, and an internal hostname is published. One caveat: I did not verify whether GitHub-hosted runners can actually reach the mirror. The dependency and the hostname exposure are certain; the deploy failure is conditional on that.",
   "refinedFix": "Rewrite the lockfile's tarball URLs to the public registry. Integrity hashes stay valid because the tarballs are identical: `sed -i '' 's#https://<internal-registry>/#https://registry.npmjs.org/#g' package-lock.json`. The mirror uses the same path layout as npm, including scoped packages (`@scope/name/-/name-x.tgz`). Do not commit a project .npmrc that forces `registry=https://registry.npmjs.org/`, because it would override a developer's own registry setting and could break installs behind a company mirror. With registry.npmjs.org URLs in the lockfile, npm's default replace-registry-host=npmjs still sends local installs through a configured mirror, and CI uses npmjs. I verified with `npm ci --offline` on the rewritten copy: under a public-registry config it requests https://registry.npmjs.org/xmlchars/-/xmlchars-2.2.0.tgz, and under a mirror config it requests the mirror URL. The reviewer's `npm install --package-lock-only --registry=...` may keep the existing resolved URLs, so the direct rewrite is more reliable. Optionally add a CI step before `npm ci` that fails if any `\"resolved\"` URL in package-lock.json does not start with https://registry.npmjs.org/, and note in the README that the lockfile must keep public registry URLs."
  }
 ]
}


===== review:music =====
{
 "findings": [
  {
   "id": "gymnopedie-ready-rh-plays-lh-chords",
   "title": "A 'ready' built-in Gymnopédie gives the left-hand chords to the right hand, so the RH is asked to strike B3–F#5 (19 semitones) at once",
   "severity": "critical",
   "briefRef": "§10 (a staff is not an infallible hand label; unclear assignments need review), §2/§18 (a ready piece is practisable without reading notation), §11",
   "files": [
    "catalog/metadata.json",
    "src/core/types.ts",
    "src/core/model/hands.ts",
    "src/core/model/prepare.ts",
    "scripts/build-catalog.ts"
   ],
   "evidence": "public/scores/Erik_Satie_-_Gymnopedie_No.1.mxl engraves the beat-2 accompaniment chords on the treble staff in voice 1, with the melody in voice 2 (`src s1 v1 on 1 dur 2 B3/D4/F#4`, `src s1 v2 on 1 dur 1 F#5` in m5). Staff 1 maps to R, so deriveSteps (/tmp/r2/span3.mts) has the RH strike a 3-note chord below C5 in 52 steps. Eleven of those steps put the chord and the melody in one RH attack: `5:R[B3 D4 F#4 F#5] 6:R[A3 C#4 F#4 F#5] 13:R[...] 14:R[...] 36:R[A3 C#4 F#4 A4 D5] 42:R[A3 C4 F4 C5] 44:R[A3 C4 F4 A4 D5]`, plus the second-time repeats. The LH plays only the bass notes.\n\nThe other edition, Gymnopdie_No._1__Satie.mxl, gives the same chords to the LH (`#1 R:F#5 L:+F#4,+D4,+B3`) and has 0 such steps. catalog/metadata.json says the two files match \"exactly\" measure by measure, yet both are `ready` and the Erik_Satie entry has `overrides: null`. ScoreOverrides (types.ts) can only remap whole staves, so no override can move voice 1 of staff 1 to the LH.\n\nSame pattern in Schubert_Serenade_-_Standchen_-_By_Lizst.mxl (ready): m80 `R:D6,F4` (21 semitones), with 14 steps where one hand strikes keys more than 14 semitones apart (/tmp/r2/span.mts). No stage checks whether one hand's simultaneous keys can be played.",
   "failureScenario": "A learner opens the built-in 'Gymnopédie No. 1' (Erik_Satie edition, shown ready) and presses Both hands. From measure 5, every beat-2 column asks the right hand for B3+D4+F#4 together with the F#5 melody, while the left hand only plays the bass on beat 1. The stretch is physically impossible, and Follow me requires it. The duplicate edition in the same library teaches the correct split.",
   "suggestedFix": "Short term: mark this arrangement review, or drop it in favour of Gymnopdie_No._1__Satie.mxl. Add a per-voice hand override to ScoreOverrides (for example `voiceHands: { 'P1:1:1': 'L' }`) and use it in metadata.json for this file. In prepareScore, add a playability check: when one hand's simultaneous attacks span more than about a 10th (16 semitones), add a review warning that lists the measures. The catalog build would then flag such pieces."
  },
  {
   "id": "voice-reused-at-different-times-flips-hand",
   "title": "Files that number voices per staff: a voice id used on both staves at different times is treated as one line, so a whole LH passage goes to the RH",
   "severity": "major",
   "briefRef": "§10, §12 (cross-staff voices: support correctly or label); round-1 fix 'cross-staff-voice-majority-misassigns-hands' is incomplete",
   "files": [
    "src/core/voices.ts"
   ],
   "evidence": "voices.ts:84-100 (inferHomes): a non-MuseScore voice counts as 'reused' only if two of its notes on different staves overlap in time (reusedAcrossStaves, :59-67). Otherwise every note of that voice gets the single busiest staff (:90-94). The only safety net (:159-160) applies when the other staff has no voice of its own.\n\nRepro /tmp/r2/adv2.mts (software 'Some Other Editor'): voice 2 is the RH alto in m1-2 (8 notes on staff 1) and the LH tenor in m3 (E3, G3 on staff 2), never at the same time. LH voice 1 is on staff 2 throughout. Result: `RE3[384,480) ... RG3[480,576)`, so the LH tenor is in the RH, with `cross-staff-notes[3]`.\n\nRepro /tmp/r2/adv3.mts ('Finale v26'): the hands alternate in voice 1 (RH m1, LH m2) and the LH has a voice-2 G2 in m4. Result: `RC3[192,240) RD3 RE3 RF3`, so the whole LH measure 2 is in the RH. The review message says the app gives these notes 'to the hand of the musical line they belong to', which is false here.",
   "failureScenario": "Someone imports a piano score from an editor or OMR tool that starts voice numbers at 1 on each staff. An inner voice uses voice 2 on the treble staff in one section and on the bass staff in another, or the hands alternate in voice 1. The left-hand notes of that section are shown in the RH row and expected from the RH in Follow me. The LH row shows rests. The cross-staff review text tells the beginner the app has assigned them deliberately.",
   "suggestedFix": "Treat a voice id as reused when the part's numbering is per staff. For example: any other voice id is reused across staves, or every staff has its own voice 1. Alternatively, decide the home staff per contiguous run of the voice: a run drawn on another staff counts as cross-staff only if the same voice has notes on its home staff in the same or a neighbouring measure. Add both repros as tests in tests/voices.test.ts."
  },
  {
   "id": "nav-marks-from-first-part-only",
   "title": "Repeat and jump marks come from only the first part that has any mark in a measure, so a D.C., Fine, segno or coda written in a lower part is silently dropped",
   "severity": "major",
   "briefRef": "§12 (common repeats and endings, or a clearly reported limitation), §13",
   "files": [
    "src/core/musicxml/parse.ts"
   ],
   "evidence": "parse.ts:100 `const marks = present.find((c) => c.hasMarks)?.marks;` copies the whole NavMarks of the first part with any mark in that measure. Marks from other parts in the same measure are discarded. Barlines (repeats, endings) are normally written in every part, while words and signs (D.C., Fine, To Coda, segno) are often written under only one part.\n\nRepro /tmp/r2/adv4.mts uses two single-staff parts, Right and Left:\n- case 6: ||: m1 (Fine, upper part) | 1st ending m2 :|| | 2nd ending m3 with 'D.C. al Fine' + `<sound dacapo=\"yes\"/>` in the lower part | m4. Output `case6 order 1 2 1 (2nd time) 3 4 | m3 daCapo? false`, warnings only `hands-from-separate-parts,no-tempo-in-file`. Expected `1 2 1 3 1` (stop at Fine).\n- case 4: Fine written in the lower part on a measure whose upper part has a :|| barline. Output `1 2 1 2 3 4 1 2 3 4`, which plays past Fine; `m2 fine? false`.\nWhen the upper part of that measure has no mark (case 2), the same D.C. works.",
   "failureScenario": "A piano piece stored as RH and LH parts (like several library files), or a song with piano, has its 'D.C. al Fine' written under the bottom part at a 2nd-ending bar. The app never jumps back, or it ignores Fine and plays extra measures. The piece stays ready with no warning, so Listen, Steady and Follow me all practise the wrong form.",
   "suggestedFix": "Merge NavMarks across all present parts of a measure. OR the boolean flags, union the ending marks (deduplicated by type and number), and take the first non-null repeatBackwardTimes (or the maximum). Add a two-part test with D.C./Fine in the lower part on measures whose upper part carries a repeat or ending barline."
  },
  {
   "id": "duplicate-measure-numbers-not-disambiguated",
   "title": "Gnossienne No. 1 (ready) labels all 11 measures \"0\" in the passage selects, the timeline and the status line",
   "severity": "major",
   "briefRef": "§13 (occurrence ids where a measure number alone is not unique; passage selection), §16; round-1 fix 'raw-implicit-measure-labels' is incomplete",
   "files": [
    "src/core/measures.ts",
    "src/core/model/performance.ts"
   ],
   "evidence": "Every measure in public/scores/Gnossienne_No._1.mxl is `<measure number=\"0\" implicit=\"yes\">` (11 times; MuseScore 2.2 export of an unmetered piece). measures.ts:23-26 returns any number that starts with a digit unchanged. The `used` set (:17, :31) only stops generated letter labels from colliding; it does not catch a numeric number that repeats. /tmp/r2/dupnum.mts: `Gnossienne_No._1.mxl dups 0(idx 0,1) 0(idx 0,2) ... 0(idx 0,10)`. These labels feed occurrenceLabel, so all 11 occurrences are labelled '0'. ControlsBar.tsx:270-273 and :291-294 render `m.label` as every option in the From and To selects. Timeline.tsx:332 uses the same label for the measure headers and 'Measure 0: passage options'. The catalog lists the piece as ready, Intermediate, 11 measures.",
   "failureScenario": "A learner opens Gnossienne No. 1 and tries to practise one passage. Both measure lists show eleven identical entries '0'. The timeline headers and the status line also always say measure 0. The learner cannot tell where a passage starts or ends.",
   "suggestedFix": "In measureDisplayNumbers, treat a number already given to an earlier measure as non-unique (especially with implicit=\"yes\"). Label it like the X-ids, e.g. '0', '0a', '0b', or the previous unique number plus a letter. If every measure shares one number, fall back to 1-based positions. Add Gnossienne to tests/measures.test.ts."
  },
  {
   "id": "ossia-size-rule-absolute",
   "title": "3+-staff parts: 'printed smaller' is checked as an absolute size, so uniformly scaled staves drop the top and bottom staves and the LH entirely",
   "severity": "major",
   "briefRef": "§10; regression in the round-1 3+-staff ossia exclusion",
   "files": [
    "src/core/model/hands.ts",
    "src/core/musicxml/part.ts"
   ],
   "evidence": "hands.ts:112 `if (d?.size !== undefined) return 'it is printed smaller than the others';`. part.ts readStaffDetails records any `<staff-size>` below 100. The size is never compared with the other staves. The size test also runs before the exemption for the lowest staff (:113).\n\nRepro /tmp/r2/adv5.mts: a 3-staff MuseScore part (RH staff 1, a busier middle staff 2, LH staff 3), with every staff given `<staff-size>75</staff-size>`. Result: `{\"P1:2\":\"R\"}`, so staves 1 and 3 are dropped, and the warning says 'the top staff: it is printed smaller than the others; the bottom staff: it is printed smaller than the others'. That is untrue, because all three are the same size. Then: 'Only the second staff ... so all of it is given to the right hand'. Without the staff-size elements the same music maps `{\"P1:1\":\"R\",\"P1:3\":\"L\"}`.",
   "failureScenario": "Someone imports a three-staff piano score (common in Debussy, Rachmaninoff and film arrangements) whose staves were all scaled down to fit the page. The app plays only the middle staff, in the right hand. The real treble line and the whole left hand are never played, and the reason given is false.",
   "suggestedFix": "Count a staff as 'printed smaller' only when its size is clearly below the size of the main staves (the busiest staff, or the median, with a missing size meaning 100), not when it merely has a size. Apply the lowest-staff exemption to this rule as well, or require a second hint (very few notes, or notes only in a few measures). Add the uniform-scale case to tests/model.ossia-staves.test.ts."
  },
  {
   "id": "two-instrument-parts-ready-as-hands",
   "title": "Two single-staff parts of different non-piano instruments (e.g. violin + cello) are presented as a ready two-hand piano piece",
   "severity": "major",
   "briefRef": "§10 ('Files containing multiple instruments ... need review or an explicit unsupported state')",
   "files": [
    "src/core/model/hands.ts"
   ],
   "evidence": "hands.ts:245-266 (rule 5): any two remaining single-staff parts become RH and LH by average pitch, with only an info `hands-from-separate-parts`. Part names, `<instrument-name>` and `<midi-program>` are never consulted. Repro /tmp/r2/adv6.mts: parts 'Violin' (midi-program 41) and 'Violoncello' (midi-program 43). Output: `ready two-single-staff-parts [ 'hands-from-separate-parts:info', 'no-tempo-in-file:info' ]`. The library's real piano files in this layout name both parts 'Piano' (Schubert Serenade) or similar, so they could be told apart.",
   "failureScenario": "A user imports a string duet, or a flute-and-guitar piece. The app shows it as ready, with the violin as the right hand and the cello as the left hand, and nothing says it is not a piano piece. Brief §10 asks for review in this case.",
   "suggestedFix": "In rule 5, accept the two parts as hands without review only when both look like keyboard parts: a name or instrument matching piano/keyboard/klavier/pf/RH/LH/right/left, an empty name, or midi-program 1-8. Otherwise add the `multiple-instruments` review warning and keep the pitch-based mapping as a best guess."
  },
  {
   "id": "muted-notes-shown-but-inaudible",
   "title": "Notes the file marks silent (dynamics=\"0\") without a hidden replacement are kept in the notation and Follow me but played at velocity 1",
   "severity": "minor",
   "briefRef": "§7 (shared clock drives sound, highlighting and notation), §12 (do not silently flatten important information)",
   "files": [
    "src/core/musicxml/part.ts",
    "src/core/musicxml/notation.ts",
    "src/core/musicxml/parse.ts"
   ],
   "evidence": "part.ts:510 marks `muted` when `dynamics=\"0\"`. parse.ts replacedByHiddenNotes drops a muted note only when hidden notes overlap it on the same staff. Otherwise the note stays, and part.ts:513 calls dynamicsToVelocity('0.00'), which notation.ts:103-107 clamps to velocity 1 (sampler gain about 0.02, against 0.41 at the default 80). The Entertainer_-_Scott_Joplin.mxl (catalog entry) has m38 `<note ... dynamics=\"0.00\">` E5 + C6 dotted quarter (2nd ending of the B strain). /tmp/r2/hid.mts reports `vel<=1 notes m38:E5 PLAYED m38:C6 PLAYED m92:E4 PLAYED m92:C5 PLAYED`. deriveSteps shows `#0@6432 occ67 R:C6,E5 L:C4`. No warning mentions it.",
   "failureScenario": "In Listen, the timeline and keyboard show an RH chord as 'press now', but it is practically inaudible in the browser, and a connected piano receives velocity 1. Follow me still waits for the chord. The learner hears a gap where the notation shows a chord.",
   "suggestedFix": "Decide one rule and report it. Either leave out notes the file marks silent (velocity 0) with an info or review warning listing the measures, or play them at the surrounding or default velocity. Do not clamp 0 to 1 while still displaying and expecting them."
  }
 ]
}


===== verify:ui =====
{
 "verdicts": [
  {
   "id": "ui:midi-try-again-grabs-other-input",
   "verdict": "confirmed",
   "reason": "Reproduced with the real PracticePage, the real MidiManager and a fake MIDIAccess (/tmp/v1/tests/midi.test.ts). I ran it twice: once with Chrome-like ports that stay in the map as 'disconnected', and once with ports removed from the map.\n\nSetup: inputs \"Yamaha P-125\" and \"Midi Through Port-0\". After Connect the user picks the Yamaha, then it is unplugged.\n- The notice reads \"Your piano was disconnected. Reconnect it, or choose your piano from the list.\" with Try again.\n- After Try again: selected in-t, inputConnected true. The status line reads \"MIDI: Midi Through Port-0 connected\" and Follow me becomes enabled.\n- The wrong device is also saved: the global midiInputName becomes \"Midi Through Port-0\" and the piece's midiInputId becomes \"in-t\".\n- When the Yamaha is plugged back in, the selection stays on in-t.\n- Control without Try again: the Yamaha is re-attached automatically (in-a, connected).\n\nCause: connect() → fallbackInput() returns the only other connected input whatever it is (midiConnection.ts:66-75, 133-137). The round-1 fix made this deliberate (tests/practice.midi.test.ts \"Try again switches to the only connected device\"). It does not tell a device that appeared after the unplug (possibly the piano under a new name) apart from a device the learner already saw in the list and did not choose. That conflicts with brief §9/§16, which ask for disconnection and reconnection to be handled gracefully.",
   "refinedFix": "Keep the round-1 behaviour for a device that appears after the unplug, but never auto-pick an input that was already connected while the chosen piano was connected.\n\n1. In useMidiConnection (src/ui/practice/midiConnection.ts), keep `const knownOthers = useRef(new Set<string>())`. On each render where `midi.inputConnected` is true, add the id of every connected input in `allInputs` to it.\n2. Give fallbackInput an `exclude: ReadonlySet<string>` parameter. Keep the savedInputName match first. Then compute `live = inputs.filter(i => i.connected && i.id !== selectedId && !exclude.has(i.id))` and return `live.length === 1 ? live[0].id : null`. Call it with `knownOthers.current`.\n3. When nothing qualifies, leave the selection unchanged. MidiManager.reconcile then re-attaches the returning piano by id or name, and the device list stays available (ConnectPiano already shows it when phase is 'disconnected' and another input is live).\n\nThe existing round-1 test still passes: \"Digital Piano\" is plugged in after the unplug, so it is not in knownOthers. The never-connected saved-id case also still passes, because knownOthers is empty.\n\nAdd a test with piano plus \"Midi Through Port-0\". After Try again the selection must stay on the piano, nothing about the virtual port may be persisted, and re-plugging the piano must re-attach it."
  },
  {
   "id": "ui:select-keeps-focus-without-change",
   "verdict": "confirmed",
   "reason": "The code is unambiguous. usePointerRelease.release() runs only from each select's onChange (ControlsBar.tsx From/To, ConnectPiano.tsx, MoreMenu.tsx Play through). A pointer press focuses a select in Chrome and Edge. Closing the native list without a new choice fires no change, so nothing releases focus. shortcutFor() then returns null for any focused select (isTextEntry, shortcuts.ts:33-36, 53).\n\nReproduced in jsdom with the project's own Chrome-like pointerClick (mousedown focuses unless prevented), in /tmp/v1/tests/focus.test.ts:\n- focus: SELECT \"From measure\"\n- shortcutFor Space/ArrowRight/Home: null/null/null\n- Step 1 of 275 stays at Step 1 after →, and the Play label stays \"Play\" after Space.\n\nA Chrome-style click on the \"From measure\" <label> (which focuses its control) also leaves focus on the select with no release. The Speed slider's releaseAfterDrag is only on the slider's own pointerdown.\n\nThis contradicts UI_SPEC:186-191 (\"Pointer (mouse or touch) use never leaves focus on a control … so the shortcuts keep working after clicking\") and the Help text \"Clicking the controls with the mouse doesn't get in the way\".\n\nThe exact OS-specific effects (Windows arrows change the value, macOS Space reopens the list) were not checked in a real browser. The core defect does not depend on them.",
   "refinedFix": "In src/ui/common/pointerFocus.ts, keep the pointer mark after a pointer press on a select (and on a <label htmlFor> of a select or slider) until either a change or a deliberate keyboard action.\n\nThen treat a practice shortcut key pressed on a still-marked select as a shortcut:\n- In the zone's onKeyDown, a mark that is still set means focus came from the mouse and the list closed unchanged. While the native list is open, keys don't reach the page.\n- In that case, for ' ', ArrowLeft, ArrowRight or Home without modifiers, call `el.blur()` and flag the event, for example `(e.nativeEvent as any).pointerReleased = true` or a data-attribute check, instead of letting the select handle it.\n- For any other key (Tab, Up/Down), clear the mark as today.\n- In shortcutFor (src/ui/practice/shortcuts.ts), skip the defaultPrevented and isTextEntry rejections for such a flagged event, so the same key press plays or steps.\n\nApply the same marking to the field labels (\"Speed\", \"Seconds per step\", \"From measure\", \"to\"): spread a pointer zone on the <label>, then blur the control after the label's click when the mark is set.\n\nAdd tests:\n- pointer-focus the From select with no change, then Space plays and → steps.\n- a label click leaves focus free.\n- keyboard-focused selects keep their keys."
  },
  {
   "id": "ui:midi-notice-dismissed-forever",
   "verdict": "confirmed",
   "reason": "Reproduced with the real PracticePage and MidiManager (/tmp/v1/tests/midi.test.ts):\n1. Connect with no devices shows \"No piano found … then try again. Try again Dismiss\". The user presses Dismiss.\n2. The piano is plugged in and auto-connects (area \"Yamaha P-125\").\n3. The piano is unplugged. The area shows \"Yamaha P-125disconnected\", there is no notice, no Try again and no Connect piano button. Only the status line says \"MIDI: Yamaha P-125 disconnected\".\n\nControl without Dismiss: the notice \"Your piano was disconnected. Reconnect it and it will be picked up again.\" appears with Try again.\n\nCause: `dismissed` is a single boolean (midiConnection.ts:106). Only connect() clears it (:126), and every notice is gated on `!dismissed` (:150). Dismissing one problem therefore hides a different, later problem. UI_SPEC:217 asks for disconnected with a retry, and brief §16 asks for understandable disconnected states.",
   "refinedFix": "In src/ui/practice/midiConnection.ts, replace the boolean with the phase that was dismissed:\n- `const [dismissedPhase, setDismissedPhase] = useState<MidiPhase | null>(null)`\n- Build the notice only `if (dismissedPhase !== phase)`.\n- `dismissNotice: () => setDismissedPhase(phase)`\n- `connect` calls `setDismissedPhase(null)`.\n- Clear it as soon as the phase moves on: `useEffect(() => { if (dismissedPhase !== null && dismissedPhase !== phase) setDismissedPhase(null); }, [phase, dismissedPhase])`. A later return to the same phase (for example a second disconnect) then shows its notice again.\n\nAdd a test: dismiss the no-devices notice, plug the piano in, unplug it, and expect the disconnected notice with Try again."
  },
  {
   "id": "ui:readiness-reason-dangling-measures",
   "verdict": "confirmed",
   "reason": "warnings.ts:20-23 gives the cross-staff message \"…; check these measures if a hand feels wrong.\" assessReadiness (prepare.ts) turns warnings into bare message strings with no measures. ReadinessChip.tsx:27-30 renders only those strings. It is used on library cards (LibraryCard.tsx:112, 155, from catalog readinessReasons) and in the practice header (PracticePage.tsx:96, from prepared.readinessReasons). Only DiagnosticsDialog adds measureList().\n\nA scan of src/catalog/catalog.json finds this exact reason on 19 of the 20 'review' built-in pieces, for example Arabesque No. 1. The popover therefore tells a beginner to \"check these measures\" and lists none, which goes against the plain-language and clear-readiness aims (brief §4, §16).",
   "refinedFix": "Simplest change, which keeps the catalog schema and the ReadinessChip contract:\n1. Reword the 'cross-staff-notes' message in src/core/musicxml/warnings.ts so it no longer points at a list. For example: \"Some notes are written on the other hand's staff. The app gives them to the hand of the musical line they belong to. If a hand feels wrong, the measures are listed under More → About this arrangement.\"\n2. Update the expectation in tests/parser.test.ts:954.\n3. Regenerate the catalog (`npm run catalog`) so src/catalog/catalog.json and catalog/inventory.json carry the new text for the library cards.\n\nAlternative: carry `{message, measures}` through readinessReasons and the catalog, and render measureList() under each reason in ReadinessChip. This is a schema change across prepare, catalog, storage and UI."
  },
  {
   "id": "ui:space-plays-while-menu-open",
   "verdict": "confirmed",
   "reason": "Reproduced (/tmp/v1/tests/focus.test.ts) with a Chrome-like mouse click on the Measure 1 label:\n- The menu opens with focus on the div role=\"menu\" \"Measure 1\". shortcutFor gives Space='toggle' and ArrowRight/Home=null.\n- Pressing Space is handled as a shortcut: the Play label becomes \"Pause\" while the menu stays open.\n\nWith More opened by mouse, focus is on body: Space='toggle', ArrowRight='next', and → advances from Step 1 to Step 2 while the panel stays open.\n\nUI_SPEC:181-182 says shortcuts apply only when \"no dialog or menu is open\", and UI_SPEC:101 calls More a menu. Help (HelpDialog.tsx:201) says shortcuts don't apply while a menu is open.\n\nThe code is inconsistent too. SPACE_ACTIVATES lacks [role=\"menu\"] while ARROWS_OWNED has it, so a mouse-opened measure menu swallows the arrows but not Space. An existing project test (tests/practice.focus.test.ts \"opening More with the mouse … Space plays\") deliberately asserts the More behaviour, which confirms the contradiction between code and spec/Help.",
   "refinedFix": "Make code, UI_SPEC and Help agree.\n\nFor the measure menu (a real ARIA menu), add `[role=\"menu\"]` to SPACE_ACTIVATES in src/ui/practice/shortcuts.ts. Space on the mouse-focused menu container then does nothing, matching the arrows (already owned via ARROWS_OWNED) and the comment in Timeline.tsx.\n\nFor the More panel (a disclosure, role=\"group\"), choose one of:\n(a) Keep the tested behaviour where Space plays. Change UI_SPEC:182 to \"no dialog or measure menu is open (the More panel does not block shortcuts)\" and reword the Help sentence to match.\n(b) Have MoreMenu suppress shortcuts while open, for example by exposing an `open` flag or a `[data-menu-open]` attribute that shortcutFor checks, and update the focus test accordingly.\n\nOption (a) is the smaller change and keeps the existing round-1 test intact."
  },
  {
   "id": "ui:identical-chip-button-names",
   "verdict": "refuted",
   "reason": "The facts are accurate. The catalog has 20 'review' pieces, each with a \"Needs review: show reasons\" trigger (ReadinessChip.tsx:20). The ⓘ label uses only the title (DifficultyBadge.tsx:141), and titles repeat: Für Elise ×4, Canon in D ×3, several ×2.\n\nHowever, the requirement cited is not violated:\n- Brief §16 asks for \"accessible labels\", and every button has a meaningful one.\n- UI_SPEC:66 requires the cards themselves to be real links with accessible names. They are: the title link has aria-describedby pointing at the arrangement and composer.\n- Each chip and ⓘ sits inside its card's <li> under the card's <h3>, so the context can be determined programmatically.\n- Unique button names are not required by the brief, the UI_SPEC, or WCAG AA (2.4.6 asks that labels describe purpose, which they do).\n\nThis is optional polish (append the title and arrangement to the labels), not a defect against the documented contracts."
  },
  {
   "id": "ui:nothing-to-play-both-hands-wording",
   "verdict": "confirmed",
   "reason": "Reproduced with the real PracticePage on Swan_Lake.mxl (/tmp/v1/tests/empty.test.ts), with the default Both hands and the passage set to measures 28–32:\n- The timeline empty message reads \"There is nothing for either hand to play in these measures. Choose the other hand or a different passage.\"\n- Pressing Play shows the status \"No steps to play\" plus \"There is nothing to play for the chosen hand in these measures.\"\n\nWith both hands selected there is no \"other hand\", and \"the chosen hand\" is wrong too. Both strings come from PracticePage.tsx:40-43 (nothingToPlayText) and session.ts:130 (SESSION_MESSAGES.nothingToPlay). This is a small plain-language and understandable empty-state issue (brief §16).",
   "refinedFix": "In src/ui/practice/PracticePage.tsx nothingToPlayText, handle hands === 'both' separately: \"There is nothing to play in these measures (they are silent). Choose a different passage.\" Keep the R/L wording, which suggests the other hand.\n\nIn src/engine/session.ts, make SESSION_MESSAGES.nothingToPlay hand-neutral: \"There is nothing to play in these measures.\" Alternatively, pick hand-aware text from the session's hands setting at the two use sites (session.ts:476, 1042).\n\nUpdate any test that asserts the old string."
  }
 ]
}


===== verify:traceability =====
{
 "verdicts": [
  {
   "id": "traceability:repeat-first-ending-at-forward-repeat-replayed",
   "verdict": "confirmed",
   "reason": "Reproduced with the real unrollMeasures and ScoreBuilder (/tmp/vf/rep.mts). Current code: H1 (m1 | ||:[1. m2 :|| | [2. m3 | m4) gives 1, 2, 2 (2nd time), 4. H2 gives 1, 2, 2 (2nd time), 4, 5. H3 gives 1, 1 (2nd time), 3. H4 gives 1, 2, 3, 2 (2nd time), 3 (2nd time), 5. warnings=[] in every case. The pre-fix copy (/tmp/fx/base) gives 1 2 3 4 / 1 2 3 4 5 / 1 2 3 / 1 2 3 4 5, so this is a regression: on arrival back at the ||: the exemption at performance.ts:238 skips the ending check even when the span at i is the section's own 1st ending. The 2nd ending is never played and nothing is reported, which breaks §12 ('common repeats and endings, or a clearly reported limitation'). The existing case-L order is unchanged by the fix below.\n\nSeverity caveat: none of the 65 catalog pieces has ||: and an ending start on the same measure (scanned with /tmp/vf/catrep.mts). The bug only reaches imported files, and this notation is unusual, so 'critical' overstates it; major or minor is closer.",
   "refinedFix": "In simulate() (src/core/model/performance.ts ~L237-238), exempt the ending check on arrival only when the span starting at i is a later bracket of a volta group that began before i, i.e. an ending of the section that closed earlier:\n\n  const closesEarlierSection = entering !== undefined && spans.some((s) => s.group === entering.group && s.start < entering.start);\n  if (entering && !(arrived && m.repeatForward && i === sectionStart && closesEarlierSection)) {\n\nUpdate the comment to match. I verified this on a /tmp copy: H1-H4 give 1 2 3 4 / 1 2 3 4 5 / 1 2 3 / 1 2 3 4 5, case L stays 1 2 1(2nd) 3 4 3(2nd) 4(2nd) 5, and tests/model.repeats.test.ts plus the e2e library tests pass (196/196). Add H1-H4 next to the case-L tests in tests/model.repeats.test.ts. Also add an e2e fixture (||:[1. D :|| [2. E) through prepareScore and deriveSteps that asserts RH attacks C4 D4 E4 F4."
  },
  {
   "id": "traceability:ornaments-dropped-but-ready",
   "verdict": "confirmed",
   "reason": "Reproduced with the real catalog files, loadSourceScore and prepareScore with overrides (/tmp/vf/orn.mts). Eight pieces are 'ready' and carry 'ornament-not-played' at severity info: 12-variations (21, m15,23,66…), bella-ciao-la-casa-de-papel (m32), chopin-nocturne-op-9-no-2 (m2,5,13,21,26,27,30), chopin-spring-waltz, minuet-in-g-major-bach (Beginner; m3,5,11,13,30), nocturne-in-c-sharp-minor, sonata-no-16 K.545 (m70) and waltz-in-a-minor. The ornament flag is used only to emit the warning (parse.ts:182). Nothing in src/ui renders the ornament, so the notation and audio show a plain held note. UI_SPEC shows no readiness chip for ready pieces.\n\nThe brief §12 names trills and says to 'support them correctly or label affected pieces/passages as needing review'. Playing only the main note is not correct support, and an info line under 'About this arrangement' is not a needs-review label. The code is also inconsistent: 'tremolo-not-expanded' is the same kind of simplification (one held note instead of fast repeated notes) and is 'review'. The info choice is deliberate (ARCHITECTURE.md:165, app-builder-reports.md:407, and a pinned e2e test), but it contradicts the authoritative brief. Severity major is fair.",
   "refinedFix": "In src/core/musicxml/warnings.ts, change 'ornament-not-played' to severity 'review'. Use wording that still reads well as a readiness reason, e.g. 'Trills, mordents and turns are played as their main note only; check these measures.' Keep 'grace-notes-approximated' at info, since those notes are played. (The alternative is to expand trills, mordents and turns into notes.)\n\nThen update ARCHITECTURE.md (Ornaments bullet, ~L165). Update the tests that pin the old policy; I verified on a /tmp copy that these are exactly the ones that fail: tests/parser.test.ts 'warns with the documented severities', tests/e2e.regressions.test.ts 'a trill with no hidden notes keeps its main note…', tests/e2e.library.test.ts 'grace notes, ornaments… are information only' and the readiness counts (they become 47 ready / 22 review in that run), and tests/catalog.test.ts reproducibility. Finally, regenerate the catalog, inventory and CATALOG_REPORT with npm run catalog. The readiness change can affect build-catalog duplicate choices ('ready over review'), so re-check the duplicates table."
  },
  {
   "id": "traceability:uniform-staff-size-drops-left-hand",
   "verdict": "confirmed",
   "reason": "Reproduced with the real detectHandMapping (/tmp/vf/oss.mts) on a 3-staff part (top 8 notes, middle 6, bottom 4):\n- No staffDetails: {P1:1:R, P1:3:L}.\n- All staves size 80: {P1:1:R}. The middle and bottom staves are excluded with 'it is printed smaller than the others', followed by 'Only the top staff … given to the right hand'.\n- Sizes 80/70/80: also R only, so the true LH is dropped.\nThe pre-round-1 copy maps R=1, L=3 in all of these cases. The cause is hands.ts:112, which tests `d?.size !== undefined`. The parser records any size below 100 (part.ts:485), so the check is absolute, not relative, and the `lowest` exemption only covers the few-notes rule. Readiness stays 'review', so the change is not silent. But the left hand is lost and the stated reason is false. The scenario is rare (3+ staff parts with every staff given a staff-size), so minor is right.",
   "refinedFix": "In mapManyStaves (src/core/model/hands.ts), compute the normal size as the largest size among staves with notes, counting a missing size as 100:\n\n  const normalSize = Math.max(...withNotes.map((s) => part.staffDetails?.[s]?.size ?? 100), 0);\n\nPass it to alternativeStaffReason and replace line 112 with:\n\n  if ((d?.size ?? 100) < normalSize) return 'it is printed smaller than the others';\n\nI verified this on a /tmp copy: all-80 gives R=1, L=3 with only the unclear-hand-mapping warning. 80/70/80 excludes only the middle staff (R=1, L=3). tests/model.ossia-staves.test.ts, tests/model.hands.test.ts and tests/e2e.library.test.ts all pass (126/126), and f14b still excludes its small ossia staff. Add a uniform-size test and a mixed 80/70/80 test to tests/model.ossia-staves.test.ts. An extra lowest-staff exemption from the size rule is not needed for this case."
  },
  {
   "id": "traceability:difficulty-verification-inconsistent",
   "verdict": "confirmed",
   "reason": "Unambiguous from the data (docs/dev/difficulty-research-raw.json against catalog/difficulty.json):\n- Every verify pass with confirmed:false led to the record's removal (Unrated). This covers Arabesque, Ave Maria, the PianoXML Bach_Minuet_in_G_Major_BWV_Anh._114 (rejected only because musescore.com returned 403), DANSE_VILLAGEOISE and K.331. Ode to Joy instead moved to a different, in-file basis.\n- The only exception is Prelude_I_in_C_major_BWV_846. Its verify:batch3 verdict was confirmed:false and said 'the file should stay Unrated'. It is still Beginner/source in difficulty.json.\n- The batch-2 MuseScore-tag records (Minuet_in_G_Major_Bach, Fur_Elise…for_beginner_piano, Happy_Birthday_To_You_Piano) never had a verify pass. There is no verify:batch2.\n- build-catalog.ts:423/441/460 calls `rated` (which only means a source or in-file record exists) 'a verified difficulty label'. That wording reaches catalog/inventory.json:23 and CATALOG_REPORT.md:86/94/202.\n\nThe label decides the Minuet duplicate. On a /tmp copy, I removed only the Minuet_in_G_Major_Bach record and re-ran build-catalog. The PianoXML copy is then kept instead, 'because it has an explicit rights statement'.\n\nThe round-1 verifier judged MuseScore level tags to be legitimate in principle, so the batch-2 Beginner labels are not themselves wrong. The confirmed defects are the Prelude exception to the applied rule (§14: inaccessible classification means Unrated) and the false 'verified' provenance wording.",
   "refinedFix": "1. scripts/build-catalog.ts: change the `rated` doc comment (L423), the comparePreference comment (L441), whyKept (L460) and the report text (L1208) from 'verified difficulty label' to 'a difficulty label' (or 'a sourced difficulty label').\n2. catalog/difficulty.json: remove the Prelude_I_in_C_major_BWV_846 record so it becomes Unrated, matching how every other failed verification was handled. The MuseScore 'easy' hint can stay in its note or arrangement line.\n3. Pick one rule for the unverified batch-2 MuseScore-tag records. Either run a verify pass for them, or treat MuseScore-tag evidence the same in both Minuet copies: give the PianoXML Bach_Minuet_in_G_Major_BWV_Anh._114 the equivalent source record, or leave both unrated, so the label preference no longer decides the duplicate.\n4. Regenerate with npm run catalog. That updates src/catalog/catalog.json, catalog/inventory.json and docs/CATALOG_REPORT.md. Then update the catalog tests that pin counts or reasons."
  },
  {
   "id": "traceability:follow-mode-lost-on-return",
   "verdict": "confirmed",
   "reason": "Reproduced with a jsdom PracticePage test that reuses the FakeMidi harness from tests/practice.page.test.ts (run in a /tmp copy). I seeded the stored piece settings with mode 'follow' and rendered with no piano:\n- Listen is selected.\n- After 800 ms, localStorage holds mode 'listen'.\n- After Connect piano with one device, Follow me is enabled but Listen stays selected, and storage still says 'listen'.\nThe causes:\n- restoreSettings (settings.ts:33) is called with midi.inputConnected, which is always false on a fresh load. MIDI connects only from the Connect piano click, and midiConnection.ts has no auto-connect.\n- usePieceStateSaver saves the fallback 600 ms after mount.\n- No code switches back to 'follow' (grep shows 'follow' is set only via the ControlsBar options).\nThis breaks §4 step 8 ('resume the piece and saved settings') and the function's own documented intent ('falls back to Listen until the piano is connected again'). Severity minor.",
   "refinedFix": "Keep the stored mode separate from the effective one:\n\n(a) In SessionHost, record `wantsFollow = saved?.settings?.mode === 'follow' && settings.mode !== 'follow'` and pass it to PracticeView.\n\n(b) In PracticeView, keep `pendingFollow` state, initialised from wantsFollow. Add an effect:\n- if the user changes the mode away from the fallback, clear pendingFollow;\n- else if snapshot.midiInputConnected, clear it and call session.updateSettings({ mode: 'follow' }).\n\n(c) Give usePieceStateSaver the pendingFollow flag. While it is set, save `{ ...settings, mode: 'follow' }`, so the fallback is never persisted. Add pendingFollow to the effect's dependencies.\n\nI prototyped this on a /tmp copy. With it, storage keeps 'follow' while no piano is connected, Follow me is selected after Connect piano, and all 7 tests in tests/practice.page.test.ts plus the repro test pass. restoreSettings and its contract stay unchanged. Add a PracticePage test: saved follow, no piano, wait past SAVE_DELAY_MS (storage is still 'follow'), connect, then Follow me is checked."
  }
 ]
}


===== verify:follow-midi =====
{
 "verdicts": [
  {
   "id": "follow-midi:echo-guard-misses-cc64-and-reset-noteoffs",
   "verdict": "confirmed",
   "reason": "Reproduced. Running /tmp/r2fm/t1b.mts with the real MidiManager and PracticeSession, an echoing port gives pedalDown false after the Follow loop restart while the foot is still down, and sampler.noteOff fires for the pedal-held monitored C4 and D4. /tmp/r2fm/t2.mts (Listen, then Pause) drops the learner's held C4: physicalDown goes from [60] to [], and the monitored voice gets a noteOff.\n\nMy own manager-only check (/tmp/vfm/m1.mts) shows the mechanism directly. After the app plays and releases C4, and the learner then presses the pedal and C4, allNotesOff sends [128,60,0], [176,123,0], [176,64,0]. The echoes come back as 'noteoff:60' and 'sustain:0', both delivered as player input. A second allNotesOff with nothing played since still sends CC123 and CC64=0, and the echoed sustain:0 is delivered again.\n\nCause in code:\n- handleMessage (manager.ts:384-405) guards only note-on and note-off, so CC64 always passes.\n- appNotes keeps keys that were already released (:128-129, :300), so allNotesOff re-sends their offs. Those echoes have no swallowed note-on to pair with, so they are delivered.\n\nThis conflicts with brief §9: 'Prevent MIDI echo/feedback loops', 'Track physical pressed keys separately from ... app-generated playback events' and 'CC64 sustain state is separate'. It also re-opens the round-1 releaseall-cuts-monitored-input bug for echoing devices.\n\nCaveats:\n- Sending CC123/CC64 in Follow me is contract-mandated: APP_CONTRACTS says 'The MIDI output is still released', and engine.test.ts:1934-1935 pins it.\n- The claim that a non-echoing piano's local damper could be cut is device-dependent and unreproduced.\n- The reviewer's fix item 1 would break that contract and test.\n- Fix item 2 as worded ('remove a key once its note-off has been sent') is unsafe. Scheduler note-offs are sent about 40 ms ahead with future timestamps, and where clear() exists it would withdraw them, leaving a stuck note.\n- Fix item 3, an unconditional CC64 drop, would swallow a real pedal release that lands within 80 ms of a release burst.\n\nI prototyped the refined fix below in /tmp/vfm/proto/manager.ts:\n- t1b: pedalDown stays true with and without echo.\n- t2: the learner's C4 stays held and the monitored voice gets no noteOff.\n- Full suite via alias: 1089/1090 pass. The one failure is tests/midi.test.ts 'allNotesOff sends note-offs for every app-sent note, CC123 and sustain off', which pins the redundant [0x80,60,0]. That redundancy is described in core-builder-reports ('some note-offs are redundant') and is not a requirement.",
   "refinedFix": "Keep PracticeSession.releaseAll and the APP_CONTRACTS Follow-me rule ('The MIDI output is still released') as they are. Fix it in src/midi/manager.ts:\n\n1. Skip note-offs for keys already released. Add `private readonly lastSent = new Map<number, { type: NoteKind; at: number }>()`.\n   - Set it in sendNoteOn and sendNoteOff (at = atMs ?? now()).\n   - In allNotesOff, skip the explicit note-off for a key whose last sent message is a note-off with at <= now. It is already released, and nothing is queued to withdraw.\n   - Keep the explicit off for keys whose last message is a note-on, or a note-off still queued (at > now), because clear() may have withdrawn it.\n   - Clear lastSent together with appNotes.\n   - Do NOT drop keys from appNotes in sendNoteOff itself.\n\n2. Echo-guard the release burst.\n   - In allNotesOff, record the CC123 and CC64=0 it sends: `sentCc.push({cc:123,value:0,at:now},{cc:64,value:0,at:now})`, pruned with SENT_RECORD_TTL_MS.\n   - In handleMessage, before decoding: a raw CC123 on any channel that matches a recorded CC123 within ECHO_WINDOW_MS sets `ccEchoAt = time`, consumes the record, and returns.\n   - After decoding: drop a 'sustain' event whose value matches a recorded CC64 within ECHO_WINDOW_MS only when `time - ccEchoAt <= ECHO_WINDOW_MS`, and consume the record.\n   - A non-echoing piano never sends CC123, so a genuine pedal-up right after Pause or a loop restart is still delivered.\n\n3. Tests.\n   - Update the first expectation in tests/midi.test.ts 'allNotesOff sends note-offs…' to [[0x80,64,0],[0xb0,123,0],[0xb0,64,0]].\n   - Add loopback tests with a port that echoes everything 3 ms later:\n     (a) Follow me with loop and monitorInput, pedal held through the loop restart: pedalDown stays true and the pedal-held voices keep sounding.\n     (b) Listen, Pause while holding a key the app played earlier: physicalDown keeps it and its monitored voice is not released.\n     (c) Non-echoing port: a real CC64=0 arriving 10 ms after allNotesOff is still delivered.\n\n4. Docs.\n   - ARCHITECTURE §5: allNotesOff sends 'a note-off for every note the app has not already released'. Add the CC64 echo rule to the echo-guard paragraph.\n   - core-builder-reports: replace 'some note-offs are redundant'."
  },
  {
   "id": "follow-midi:connect-piano-keyboard-focus-lost",
   "verdict": "confirmed",
   "reason": "Reproduced by running the reviewer's jsdom tests (/private/tmp/r2fm/focus*.test.ts) with the real MidiManager, useMidiConnection, ConnectPiano and MidiNotice:\n- One device: focus before true, after BODY.\n- Two devices: after BODY, and the 'Your piano' select is rendered but not focused.\n- Try again after a re-plug: after BODY, connected true.\n\nThe code confirms it:\n- ConnectPiano.tsx:12-67 replaces the button with a chip or select when the phase becomes connected, choose or disconnected.\n- MidiNotice unmounts Try again once the notice clears.\n- Nothing calls focus(), and onClick={conn.connect} ignores isKeyboardClick.\n\nThis breaks the app's own pattern. LibraryPage.tsx:92-98 explicitly refocuses when a removed control left focus on <body>. MoreMenu, Timeline and Dialog move and return focus for keyboard use, and UI_SPEC says a control reached with the keyboard keeps its focus behaviour. Brief §16 requires keyboard access.\n\nOne part of the failure scenario is overstated. In Chrome and Edge the sequential focus navigation starting point stays where the removed button was, so the next Tab usually lands on the new select rather than restarting from the top of the page. The real impact is that focus and its announcement are lost, and Space or Enter then goes to the page shortcuts (play/pause). Minor severity is right.",
   "refinedFix": "1. Pass the activation source through.\n   - In ConnectPiano and MidiNotice, use onClick={(e) => conn.connect(isKeyboardClick(e))}.\n   - In useMidiConnection, connect(fromKeyboard = false) stores a refocusPending flag (ref plus refresh) when fromKeyboard is true.\n   - Do the same for Dismiss: (e) => { conn.dismissNotice(); if (isKeyboardClick(e)) request refocus }.\n\n2. Restore focus in ConnectPiano.\n   - Add refs for the select, the Connect button and the chip. Give the chip tabIndex={-1} and an accessible name such as aria-label=`${name}, ${dotLabel}`.\n   - In a useEffect keyed on phase and refocusPending: if refocus is pending and document.activeElement is null or document.body, focus selectRef ?? buttonRef ?? chipRef, then clear the flag.\n   - This mirrors LibraryPage's refocusAfterDelete pattern, so pointer use (keepFocusOnMouse) is unaffected.\n\n3. Tests in tests/practice.focus.test.ts. Keyboard-activate (click with detail 0):\n   - Connect piano with two inputs: activeElement is the 'Your piano' select.\n   - Connect piano with one input: activeElement is the connection chip, not body.\n   - Try again after re-plugging under a new id: activeElement is not body.\n   - A mouse click leaves focus as it is today."
  },
  {
   "id": "follow-midi:saved-input-never-connected-shown-as-disconnected",
   "verdict": "confirmed",
   "reason": "Reproduced. The reviewer's /tmp/r2fm/t6.mts gives phase 'disconnected' with 'Your piano was disconnected…' for a piece with a saved id, and 'no-devices' for a piece never practised.\n\nMy jsdom test (/private/tmp/vfm/ui/saved.test.ts) uses the real useMidiConnection, ConnectPiano and MidiNotice, with savedInputId 'usb-id' and savedInputName 'Digital Piano':\n- After Connect with the piano off, the notice is always 'Your piano was disconnected. Reconnect it and it will be picked up again.' The no-devices and still-no-devices texts never appear.\n- The piano comes back with the same id: it connects automatically.\n- The piano comes back with a new id and the SAME saved name: not connected; notice 'Your piano was disconnected. Reconnect it, or choose your piano from the list.' This is worse than the reviewer stated. selectInput(savedId) runs before access exists, so the manager stores name null and its by-name re-find cannot match.\n- New id and new name: same, not connected.\n- A piece without a saved id auto-connects the late piano.\n\nCauses:\n- midiPhase returns 'disconnected' for any non-null selection (midiConnection.ts:43).\n- reconcile's mayAutoSelect is only true on first connect or with no selection (manager.ts:364).\n- fallbackInput runs only inside connect().then.\n\nThis conflicts with brief §9 ('no devices … reconnection gracefully') and UI_SPEC, which lists 'no devices' as its own state. Round 1 marked the wording part 'Optional', but the defect is real and minor.\n\nThe reviewer's first fix option is flawed: clearing the selection with selectInput(null) sets inputDeclined, which disables the manager's sole-input auto-select.\n\nI prototyped the fix below in /private/tmp/vfm/ui/midiConnection.proto.ts. All 1090 project tests pass with it aliased in (alias confirmed loaded). Scenarios:\n- 'No piano found…', then 'Still no piano found…' after Try again.\n- Same id, new id with the same name, and new id with a new name all connect automatically.\n- Two unknown devices show the choose text.",
   "refinedFix": "Keep the MidiManager contract (a missing selection is waited for). Change src/ui/practice/midiConnection.ts:\n\n1. Remember the pre-selection.\n   - Add `const preselected = useRef<string | null>(null)`.\n   - In connect(), when pre-selecting, set `preselected.current = savedInputId` after `midi.selectInput(savedInputId)`.\n\n2. Detect a saved id that never connected. After computing selectedInputId:\n   - `if (midi.inputConnected || selectedInputId !== preselected.current) preselected.current = null;`\n   - `const neverSeen = phase === 'disconnected' && selectedInputId !== null && preselected.current === selectedInputId;`\n\n3. Auto-pick a late piano. Add `useEffect(() => { if (!neverSeen) return; const pick = fallbackInput(midi.inputs(), midi.selectedInputId, optsRef.current.savedInputName); if (pick) midi.selectInput(pick); });`. A piano switched on later, under any id or name (saved name first, else the only connected input), is then attached as on a never-practised piece.\n\n4. Fix the notice. In case 'disconnected', when neverSeen:\n   - no connected inputs: `{ text: attempts > 1 ? MIDI_TEXT.stillNoDevices : MIDI_TEXT.noDevices, canRetry: true }`;\n   - otherwise: `{ text: MIDI_TEXT.choose, canRetry: false }`.\n   Keep the existing disconnected texts for a piano that really was connected in this session.\n\n5. Do not clear the selection with selectInput(null): it sets inputDeclined and disables auto-select.\n\n6. Add a jsdom test with a saved midiInputId:\n   - piano off at Connect: 'No piano found…'; Try again: 'Still no piano found…';\n   - piano switched on with a new id: inputConnected is true without user action;\n   - same id: still re-attached."
  }
 ]
}


===== verify:engine =====
{
 "verdicts": [
  {
   "id": "engine:play-after-finish-plays-nothing",
   "verdict": "confirmed",
   "reason": "Reproduced independently in /tmp/verify_eng/f1.mts. The score is R C4/D4/E4 plus L C3/G2, and its steps are 0, 4, 8 and 16 (16 is the closing release).\n(A) Reopen: day 1 finishes at idx 3, and usePieceStateSaver (PracticePage.tsx:130) saves tick 16. stepIndexForTick returns 3, and seek(3) leaves the status 'stopped' at idx 3. The first Play gives 0 note-ons and the session is 'finished' 200 ms later. The second Play gives 5 note-ons.\n(B) Finished, then {mode:'steady'} / {hands:'R'} / {hands:'L'}: haltPlayback (session.ts:655-663) sets 'stopped' and keeps the marker on the final release. Play then gives 0 note-ons and ends 'finished'. A range change happens to stay 'finished' and works.\n(C) Control: Restart then Play plays all 5 notes.\n(D) A manual seek to the last step while stopped, then Play, also plays nothing.\nRoot cause: play() (session.ts:493-495) resets to step 0 only when status === 'finished'. startRun(times[n-1]) builds no events, because buildEvents has nothing starting at or held across the closing release. The run then lasts only the lead, plus any trailing rest and count-in. beginFollow (line 1049) already has the matching rule via attackAtOrAfter.\nThis conflicts with brief §8 (play / stop-restart must work) and §15 (the restored position must be usable). The second Play recovers, so it is not data loss; I would rate it between minor and major.",
   "refinedFix": "src/engine/session.ts, play(), in the final mutate (lines 491-496) replace the fromStart/finished logic with:\n```ts\nconst restart = this.status === 'finished' || !this.attackAtOrAfter(this.stepIndex);\nconst fromStart = restart || this.status === 'stopped';\nif (restart) this.stepIndex = 0;\nthis.startRun(this.startRelFor(this.stepIndex), fromStart && this.settings.countIn);\n```\nThis mirrors beginFollow's 'nothing left to strike' rule. It covers:\n- a restored final tick on reopen;\n- finish followed by a mode, hands or range change (haltPlayback leaves 'stopped' at the last step);\n- a pause during the trailing rest;\n- a manual seek to the closing release.\nhaltPlayback and the saver do not need to change. Add one line to APP_CONTRACTS Listen/Steady: \"play() from a marker with nothing left to strike (the closing release) starts at step 0, with count-in if on\". Add engine tests:\n- finish, then updateSettings({mode:'steady'}) and ({hands:'R'}), then play: notes from step 0;\n- a new session with seek(stepCount-1), then play: plays from 0, with count-in clicks before the notes when countIn is on;\n- pause in the trailing rest, then play: plays from 0."
  },
  {
   "id": "engine:midi-out-late-under-main-thread-load",
   "verdict": "confirmed",
   "reason": "Reproduced in /tmp/verify_eng/f2.mts: 16 eighth notes, output on, a stall swept over 250 phases.\n- Worst MIDI lateness: 0 ms at a 20 ms stall, 4 ms at 30, 24 ms at 50, 54 ms at 80, 94 ms at 120.\n- Sampler lateness is 0 ms in every case.\nThe first chord is structurally exposed. START_LEAD_SEC (0.05) is greater than MIDI_LOOKAHEAD_SEC (0.04), so startRun's own advanceRun hands over 0 MIDI note-ons (measured: 'MIDI ons dispatched inside play(): 0'). The chord waits for the next timer tick, which runs after the React commit that the Play click or seek triggers. Busy 60 ms → MIDI at +60 ms while the sampler is at +50 ms. Busy 100 ms → +100 ms versus +50 ms.\nThe 40 ms lookahead itself is documented (APP_CONTRACTS Clock, ARCHITECTURE §7) as a deliberate trade-off against Chrome's missing clear(). Its consequence, roughly 15-40 ms of stall tolerance instead of the sampler's ~125 ms, is not documented. It contradicts ARCHITECTURE §7's 'Visual work never blocks audio timing' and brief §16. Round 1 accepted ~125 ms as the tolerance standard, so this is a regression for the MIDI path. Severity is minor: the anchor does not drift, and individual notes are late only during stalls over ~25 ms.",
   "refinedFix": "Keep the documented 40 ms MIDI lookahead and fix only the structural first-chord exposure. In startRun (session.ts:743-789), after advanceRun(run), when this.outputActive() && !withCountIn, immediately hand the MIDI output every event of the new run with run.anchor + ev.t <= run.startAt + EPS: the first strike and the re-struck held keys. For example, give dispatchDue an optional midiHorizon and call it with max(now + MIDI_LOOKAHEAD_SEC, run.startAt). This is safe because `lead` already puts startAt after midiQueuedUntilMs + MIDI_QUEUE_MARGIN_SEC. The uncancellable window grows from 40 to about 50 ms for that one chord only. With count-in, leave it as is: the chord is seconds ahead.\nAlso document in ARCHITECTURE §7 and APP_CONTRACTS Clock that during playback the MIDI output tolerates only about 15-40 ms of main-thread stall (the browser sampler about 125 ms). Qualify 'Visual work never blocks audio timing' accordingly. Add a MIDI stall test like the sampler's: clock.stall(60) right after play() and after a seek while playing, then assert the first MIDI note-on's atMs >= its send time and equals the intended time."
  },
  {
   "id": "engine:follow-me-sends-sustain-off-to-piano",
   "verdict": "uncertain",
   "reason": "The emission reproduces (/tmp/verify_eng/f3.mts, real MidiManager, output without clear(), Follow me with loop). Nothing is sent during the run. The loop restart 1 s after the final chord sends 'b0 7b 0' and 'b0 40 0'. pause(), a hands change and a Sound toggle each send the same pair. The app never sends a sustain-on (CC_SUSTAIN is used only at manager.ts:288 with value 0). In Follow me no app notes can be outstanding: preview() returns early, there is no run, and a mode change already does a full release. So these messages release nothing the app generated.\nHowever, this is the documented contract, not an oversight:\n- APP_CONTRACTS 'No stuck notes' says of the Follow me exception: 'The MIDI output is still released.'\n- ARCHITECTURE §5 says allNotesOff sends CC123 and sustain off on channel 1.\n- Round 1's verifier deliberately kept midi.allNotesOff() in the keepMonitor paths.\nThe brief (§9) requires releasing app-generated notes; it does not forbid extra controller messages. The audible harm needs a real instrument that applies received CC64=0/CC123 to the locally pedalled sound while the learner's foot is down. That is plausible for many tone generators but device-dependent, and I could not reproduce it without hardware.\nIf the orchestrator decides to act, the low-risk change is: in the keepMonitor paths (tick loop restart at line 816, pauseInternal at line 645, updateSettings at line 433 when prev.mode === 'follow'), skip midi.allNotesOff(), because nothing app-generated can be outstanding in Follow me. Also update the APP_CONTRACTS and ARCHITECTURE §7 Follow me exception text."
  },
  {
   "id": "engine:clock-switch-cuts-first-monitored-note",
   "verdict": "confirmed",
   "reason": "Reproduced in /tmp/verify_eng/f4.mts. The fake sampler goes to 'loading' synchronously, like PianoSampler.startLoading. The setup is Steady, Sound off, monitorInput on and playing, so the run is on the wall clock.\n- The learner presses a key that is not in the score. onMidiEvent starts audio (line 1120); pickClock() flips to 'audio' because audioUsable() accepts 'loading'.\n- The next tick calls reanchor() (line 821), then releaseAll(), then sampler.allNotesOff(). The monitored voice is [0, 0.013 s] although the key was held 580 ms.\n- Control: with audio already running, the same key sounds [0, 0.58].\n- The marker holds at 0.975 for about 50 ms (START_LEAD).\n- With an output selected, the MIDI piano gets allNotesOff, then on48 on60 off60 on62. This re-strikes held keys; on60 lasts only until the step about 13 ms later.\nIn a real browser, ctx.currentTime stays at 0 until resume() resolves, so the run anchored at the tick can freeze the marker longer.\nThe MIDI re-strike on a clock switch is a known deviation in the round-1 report ('Count-in turned on during silent playback…'). Cutting the learner's first monitored note is not documented, and it contradicts APP_CONTRACTS ('If browser audio has not started yet, a monitored note-on starts it') and brief §9 ('hear input through the browser'). Minor.",
   "refinedFix": "src/engine/session.ts:\n1. In tick() (line 821), do not call reanchor() for a clock-source change. Move the run onto the new clock in place:\n   - offset = clockNow(new) − clockNow(old);\n   - add the offset to anchor, startAt and clicks[] of the run and of any chained run.next;\n   - set clock;\n   - keep nextEvent, nextMidiEvent and nextClick;\n   - do not call releaseAll().\n   Nothing is cut, no START_LEAD gap is added, and nothing is re-struck on the MIDI output. MIDI timestamps live in the nowMs domain and are unaffected. On the wall clock no sampler events or clicks were sent, so none are lost that should have sounded.\n2. Make that switch only once the AudioContext is actually running: use this.audioStarted, which is set when ensureStarted() resolves after ctx.resume(), instead of sampler.state === 'loading'. Otherwise the run is mapped onto a frozen currentTime.\nKeep the existing reanchor(false) for an explicit Sound on, where a re-strike is expected.\nMinimal fallback if (1) is too invasive: in tick() use `this.releaseAll(true); this.reanchor(false);` for a wall→audio switch, so monitored voices are kept.\nAdd tests:\n- Steady, sound off, monitorInput on, playing, a sampler that goes to 'loading': press a key, advance 500 ms. The monitored voice is still sounding, allNotesOffCount() is 0, and getVisualPosition() advances monotonically without a ~50 ms hold.\n- With an output selected, no allNotesOff and no re-strike are sent at the switch."
  },
  {
   "id": "engine:speed-drag-restrikes",
   "verdict": "confirmed",
   "reason": "Reproduced in /tmp/verify_eng/f5.mts: Listen, with LH C3 held across the measure and output on. A drag of 5 slider steps (1.0→0.75):\n- events every 30 ms: 5 sampler allNotesOff calls, 5 C3 note-ons on the sampler and 5 on the MIDI output; C3 silent for 170 of 350 ms;\n- events every 60 ms: silent for 250 of 500 ms;\n- a single change: one 50 ms gap (control).\nIn Steady, a stepSeconds change 5 ms before a release gives 'noteOn 60 @0.05 | noteOff 60 @0.0555': a 5.5 ms re-strike that is not in the score.\nCause: ControlsBar.tsx lines 209 and 245 call updateSettings from React onChange, which fires on every 'input' event during a drag. Each call goes through releaseAll() and reanchor(false) (session.ts:432-433, 453-454), adds START_LEAD and re-strikes held keys (buildEvents 716-717).\nEach single release-and-re-strike is the documented engine contract (APP_CONTRACTS 'No stuck notes' lists speed and stepSeconds, and 'Starting or seeking … re-sounds'). The defect is that a drag commits one such change per input event, so the learner hears a stutter instead of one clean change (brief §8 slower/faster control, §16 quality). Minor. It can be fixed in the UI without touching the engine contract.",
   "refinedFix": "src/ui/practice/ControlsBar.tsx, Speed (line ~209) and Seconds-per-step (line ~245) sliders:\n- Keep a local draft value. onChange updates only the draft, which drives the input's value, the <output> text and aria-valuetext.\n- Commit with session.updateSettings({speed|stepSeconds}) once the change is finished: on pointerup, keyup or blur, or about 150 ms after the last input event (debounce, cleared and flushed on pointerup). Then clear the draft. A native 'change' listener attached via a ref also works; it fires on drag release.\n- One drag then causes one re-anchor. Single keyboard steps still apply about 150 ms later, and held-arrow auto-repeat is coalesced.\n- The engine is unchanged, so the documented release-on-speed-change contract stays intact.\nOptional engine polish for the near-release artefact: in buildEvents' re-strike branch (session.ts:716), skip the re-strike when te − startRel is below about 0.03 s. Note that this slightly narrows 'keys held at that point sound again', so document it if adopted.\nAdd a test: 5 updateSettings calls through the debounced handler produce 1 allNotesOff and 1 re-strike."
  }
 ]
}


===== verify:music =====
{
 "verdicts": [
  {
   "id": "music:gymnopedie-ready-rh-plays-lh-chords",
   "verdict": "confirmed",
   "reason": "Reproduced. A separate read of public/scores/Erik_Satie_-_Gymnopedie_No.1.mxl (MuseScore 1.3) gives m5 `s1 v1 on 1 dur 2 B3/D4/F#4 | s1 v2 on 1 F#5 | s2 v5 G2`: the beat-2 accompaniment chords are voice 1 of the treble staff. Because the file is a MuseScore export, voices.ts gives voice 1 the home staff 1, so the chords go to the RH. /tmp/r2/span3.mts gives 11 RH attacks wider than 14 semitones (5:R[B3 D4 F#4 F#5] = 19 semitones; 36 and 44: A3..D5 = 17) and 52 steps where the RH strikes a 3-note chord below C5. The other edition (Gymnopdie_No._1__Satie.mxl, MuseScore 3.6.2) has the same chords on staff 2 (v5) and gives 0 such steps. Both are `ready` in src/catalog/catalog.json and `included` in inventory.json, and the Erik_Satie entry has `overrides: null`. ScoreOverrides (types.ts:529) has only excludeParts and staffHands, so no override can move a voice. No stage checks hand span (grep finds no such code). §10 requires per-arrangement overrides for verified exceptions and says a staff is not an infallible hand label. One caveat on the suggested fix: voice 1 of P1 also carries the RH-only chords in m38-39 and m46-47 (C4/E4/A4/C5, D4/F#4/A4/D5, with only the bass on staff 2). A whole-voice `P1:1 -> L` override would give those RH chords to the LH, so the override must be limited to measures. The Schubert m80/m86 R[F4 D6] case is also real, but it is Liszt's echo voice written in the RH part. It is secondary, and only a span check, not a hand remap, would address it.",
   "refinedFix": "1) Short term, in catalog/metadata.json: stop listing Erik_Satie_-_Gymnopedie_No.1.mxl as ready. Either remove its record (assignStatuses then marks it 'review': 'Awaiting review'), or add a curated status that forces review. Gymnopdie_No._1__Satie.mxl already teaches the correct split. 2) For a real fix, extend ScoreOverrides with a measure-scoped voice override, e.g. `voiceHands?: { part: string; voice: string; hand: Hand; measures?: [number, number][] }[]` (0-based written-measure ranges). Validate it in build-catalog parseMetadata. Apply it in performance.ts handOf before the staff/home-staff lookup, and report it in HandMapping.description. Use `{part:'P1', voice:'1', hand:'L', measures:[[0,36],[39,44]]}` for this file, which keeps m38-39 and m46-47 in the RH. 3) Optionally, prepareScore can add a review warning (new code, e.g. 'hand-span-too-wide') listing the measures where one hand's simultaneous attacks span more than 16 semitones. Use >16, not >14, so ordinary 10ths (Canon, Waltz of the Flowers, Bella Ciao LH) stay ready while Gymnopédie (17-19) and Schubert m80/m86 (21) are flagged. 4) Regenerate the catalog and add a library regression test that no ready entry has a one-hand attack wider than the threshold."
  },
  {
   "id": "music:voice-reused-at-different-times-flips-hand",
   "verdict": "confirmed",
   "reason": "Reproduced both repros. In adv2 ('Some Other Editor'), voice 2 has 8 notes on staff 1 (m1-2) and 2 on staff 2 (m3), never overlapping in time. reusedAcrossStaves returns false, busiestStaves gives staff 1, so presses `RE3[384,480) ... RG3[480,576)` put the LH tenor in the RH. The safety net (voices.ts:159-160) does not fire because staff 2 owns voice 1. In adv3 ('Finale v26'), all of LH m2 (C3-F3) becomes RH. The code matches the documented contract in ARCHITECTURE.md (majority home, reuse only when notes on two staves overlap in time), so this is a gap in that contract. It is the part of round-1's suggested fix ('decide per contiguous run ... otherwise use the staff it is drawn on') that was not implemented. Two things reduce the impact, and the reported severity overstates it. First, both cases come out readiness 'review' with `cross-staff-notes[3]` / `[2]` naming the measures, which partly meets §12 ('or label ... as needing review'). Second, all 69 library files are MuseScore exports, which use block numbering, so only imports are affected. Still, the hand mapping is wrong for an ordinary two-staff score (§10), and the warning text asserts the notes were given 'to the hand of the musical line they belong to', which is false here.",
   "refinedFix": "In src/core/voices.ts, for parts without block numbering: (a) If any voice id in the part passes reusedAcrossStaves, or every staff that has notes has its own voice '1', treat the part as numbered per staff and keep every inferred note on the staff it is drawn on (home = n.staff). (b) Otherwise, in inferHomes, after choosing the majority home H, count a note drawn on staff S≠H as cross-staff only if the same voice also has a note drawn on H in the same measure or an adjacent one (measureIndex ±1); otherwise set home = n.staff. Keep the existing 'staff never left without a voice' net. Update the cross-staff paragraph in docs/ARCHITECTURE.md to match. Soften the cross-staff-notes message to say the hand assignment is a guess. Add adv2 (voice 2 alto in m1-2, tenor in m3) and adv3 (alternating hands in voice 1) as cases in tests/voices.test.ts, expecting E3/G3 and C3-F3 on L. The library is unaffected because every file is a MuseScore export."
  },
  {
   "id": "music:nav-marks-from-first-part-only",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r2/adv4.mts. parse.ts:100 `const marks = present.find((c) => c.hasMarks)?.marks;` takes the NavMarks of the first part with any mark in the measure and drops the rest. Case 4: Fine is in the lower part at m2, where the upper part has a backward repeat. The result is `m2 fine? false` and the order `1 2 1 2 3 4 1 2 3 4`, which plays past Fine. Case 6: D.C. is in the lower part at the 2nd-ending bar, where the upper part carries the ending marks. The result is `m3 daCapo? false` and the order `1 2 1 3 4` (expected 1 2 1 3 1). The only warnings are hands-from-separate-parts and no-tempo-in-file, and readiness stays ready. The control (case 2, no marks in the upper part) jumps correctly. A scan of the 4 multi-part library files found no measure where marks differ between parts, so only imports are affected. §12 requires common repeats and jumps, or a clearly reported limitation.",
   "refinedFix": "In buildMeasures (src/core/musicxml/parse.ts), merge NavMarks over all `present` cells instead of taking the first: repeatForward/segno/coda/fine/daCapo/dalSegno/toCoda = present.some(c => c.marks.<flag>); repeatBackwardTimes = the first non-null value (or the max); endings = the union of all cells' endings, deduplicated by `${type}:${numbers.join(',')}` and kept in first-seen order. Add tests to tests/model.repeats.test.ts (or parser.test.ts) with two single-staff parts: Fine in the lower part on a measure whose upper part has :|| (expect stop at Fine), and 'D.C. al Fine' + <sound dacapo=\"yes\"/> in the lower part of a 2nd-ending bar whose upper part carries the ending (expect 1 2 1 3 1)."
  },
  {
   "id": "music:duplicate-measure-numbers-not-disambiguated",
   "verdict": "confirmed",
   "reason": "Reproduced. Gnossienne_No._1.mxl (MuseScore 2.2.0) has 11 `<measure number=\"0\" implicit=\"yes\">`. measureDisplayNumbers returns any number starting with a digit unchanged, and the `used` set only stops generated letter labels from colliding. prepareScore gives readiness 'ready' and 11 occurrences, all with label '0' (occ 0..10). ControlsBar.tsx:270-294 renders `m.label` as the text of every From/To option. The values are occ indices, so selection still works, but every entry reads '0'. Timeline.tsx:332 uses the same label for the measure headers and the menu. The catalog lists the piece as ready, Intermediate, 11 measures. §13/§16 require usable passage selection by measure, and round 1's readable-labels fix did not cover a repeated numeric number.",
   "refinedFix": "In src/core/measures.ts measureDisplayNumbers: first count the written numeric numbers. If there is more than one measure and every non-empty written number is the same (Gnossienne: 11 × '0'), return 1-based positions (String(index + 1)) for all measures. Otherwise, when a numeric `raw` was already returned for an earlier measure, label it like an internal id: nextLabel(base, extra++) with the usual `used` collision loop, giving '12', '12a', and so on. Keep returning the first occurrence of each number unchanged. Add a Gnossienne-style case (all '0', implicit) and a single-repeat case (…, '12', '12', …) to tests/measures.test.ts. Regenerate the catalog."
  },
  {
   "id": "music:ossia-size-rule-absolute",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r2/adv5.mts. Every staff of a 3-staff MuseScore part is given <staff-size>75</staff-size>. part.ts:484-485 records any size below 100. hands.ts:112 `if (d?.size !== undefined) return 'it is printed smaller than the others'` never compares it with the other staves and runs before the lowest-staff exemption. The result is `{\"P1:2\":\"R\"}`: staves 1 and 3 are dropped with the false reason 'printed smaller than the others' for both, and the whole part goes to the RH. Without the size elements the mapping is `{\"P1:1\":\"R\",\"P1:3\":\"L\"}`. Readiness is 'review' either way, since a 3-staff part always gets unclear-hand-mapping. The harm is therefore a much worse mapping (LH and the real treble line never played) plus a false reason, not a silently ready piece. Only imports are affected; no library file has 3+ staves with sizes.",
   "refinedFix": "In src/core/model/hands.ts, pass the busiest staff number into alternativeStaffReason, not only its count. Treat a staff as 'printed smaller' only relative to it: `const ref = part.staffDetails?.[busiestStaff]?.size ?? 100; const size = d?.size ?? 100; if (size < ref * 0.9) return 'it is printed smaller than the others';`. Optionally, also skip the size rule for the lowest staff with notes unless a second hint holds (few notes, or notes only in some measures). Add a uniform-scale case (all three staves at 75) to tests/model.ossia-staves.test.ts, expecting {P1:1:R, P1:3:L} and no alternative-part-excluded warning. Keep the existing case where only the ossia staff is small."
  },
  {
   "id": "music:two-instrument-parts-ready-as-hands",
   "verdict": "confirmed",
   "reason": "Reproduced with /tmp/r2/adv6.mts. Parts 'Violin' (midi-program 41) and 'Violoncello' (43) give `ready two-single-staff-parts [hands-from-separate-parts:info, no-tempo-in-file:info]`. hands.ts rule 5 (automaticMapping, `main.length === 2 && main.every(p => p.staves <= 1)`) consults only average pitch and clef. SourcePart (types.ts:88-106) does not carry instrument names, sounds or MIDI programs, so the core cannot tell. The isPianoPart check exists only in scripts/build-catalog.ts, which protects built-ins. User imports go through src/storage/imports.ts → prepareScore with no instrument check. §10 says files with multiple instruments need review or an explicit unsupported state. The library's two-part files would still pass a keyboard check: Chopin Ballade ('Piano'/'Grand Piano'), Schubert ('Piano'), and the 2014 Entertainer (empty names but midi-program 1).",
   "refinedFix": "Have the parser record per-part instrument data from <score-part>: `SourcePart.instrumentNames?: string[]`, `midiPrograms?: number[]`, `instrumentSounds?: string[]` (additive optional fields). Move the KEYBOARD_NAME / 'keyboard.' sound / GM program 1-8 test from scripts/build-catalog.ts isPianoPart into a core helper and reuse it in both places. In hands.ts rule 5, treat the two parts as hands without review only when both look like keyboard parts: the keyboard helper matches, or the name matches /\\b(RH|LH|right|left|r\\.?h\\.?|l\\.?h\\.?|main droite|main gauche)\\b/i, or the part has an empty name and no instrument data. Otherwise also add the 'multiple-instruments' review warning, and keep the pitch-based mapping as a best guess. Add tests: violin+cello → review; the unnamed midi-program-1 pair and the 'Piano'/'Piano' pair stay ready."
  },
  {
   "id": "music:muted-notes-shown-but-inaudible",
   "verdict": "confirmed",
   "reason": "Reproduced. In The_Entertainer_-_Scott_Joplin.mxl (MuseScore 1.3), P1 has printed notes with dynamics=\"0.00\" in m38 (E5+C6) and m92 (E4+C5). They are the 2nd-ending chords that continue the tie from m36/m90, which the editor muted. No hidden notes overlap them, so replacedByHiddenNotes keeps them. part.ts:510 sets muted, and part.ts:513 dynamicsToVelocity('0.00') clamps to 1 (notation.ts:103-107). /tmp/r2/hid.mts gives `m38:E5 PLAYED m38:C6 PLAYED m92:E4 PLAYED m92:C5 PLAYED`. In deriveSteps, step #451 `R:C6,E5 L:C4` and #974 `R:C5,E4 L:C4,C3` show them as RH presses that Follow me waits for. session.ts:713-717/922/937 send that velocity to both the sampler and MIDI out. velocityToGain(1) is about 0.02, against about 0.58 for the f-level LH chord in the same step, so the chord is effectively silent in Listen. No warning mentions it (warnings: octave-text-not-applied, other:info). This is minor: the timing stays in sync, but sound and notation disagree, and §12 asks not to silently hide important information.",
   "refinedFix": "In part.ts, store the running context velocity on the draft (e.g. `draft.contextVelocity = this.velocity`). In parse.ts buildNotes, for a draft with `d.muted` that is not in `replaced`, use `d.contextVelocity ?? undefined` (falling back to the default play velocity) instead of the clamped 1. Also add an info warning (new WarningCode, e.g. 'silent-notes-played', with a message like 'Some notes the file marks as silent are played at the normal loudness.') with d.measureIndex. Add the code to WARNING_NOTES in scripts/build-catalog.ts so the catalog note can mention it. This keeps sound, notation and Follow me consistent. Treating these 2nd-ending chords as held tie continuations would be more faithful musically, but it is a separate tie-into-ending feature. Add a parser test: a printed dynamics=\"0\" note with no hidden overlap keeps its pitch, gets the surrounding velocity and raises the info warning. The existing hidden-replacement test should still drop the muted note."
  }
 ]
}


===== fix:catalog-deploy =====
**traceability:difficulty-verification-inconsistent: fixed.** I applied one rule to all five MuseScore "easy"-tag labels. I re-checked each one, and a tag counts only if it shows again on the same upload. All five passed, so all five are Beginner. That means the Prelude BWV 846 stays Beginner, which differs from refinedFix step 2.

**How I re-checked.** musescore.com still returns HTTP 403 to a direct fetch (I tried score 117279). A web search limited to musescore.com does return each page's title with the level tag at the end, which is what the earlier checks could not see:
- **PianoXML Minuet (2086106):** "Bach: Minuet in G Major (BWV Anh. 114) … (Solo) easy". The score ID matches the file's own source link. Its earlier check (`verify:batch1`) failed only because of the 403.
- **ClassicMan Minuet (62312):** "Minuet BWV Anhang 114 in G Major … easy". Matching ID.
- **Prelude BWV 846 (117279):** "Prelude I in C major, BWV 846 - Well Tempered Clavier [First Book] … easy". Matching ID. Its earlier check (`verify:batch3`) also failed only because of the 403.
- **Für Elise for beginner piano (dundeepiano):** "… for beginner piano … easy". Title and arranger credit match. One caveat: the file's own source link points to a different upload (`classicman/scores/33816`). I recorded that in the verdict.
- **Happy Birthday (5282628):** "Happy Birthday To You Piano … easy". Matching ID.

The Prelude's earlier Unrated recommendation rested only on the page being unreachable, and it is now reachable this way. If you still want it Unrated, delete its record in `catalog/difficulty.json` and run `npm run catalog`; the new tests pass either way.

**Effect on the Minuet duplicate.** Both copies are now Beginner, so the label no longer decides which one is kept. The PianoXML copy is kept "because it has an explicit rights statement". It has a tempo in the file and no ornament warnings. Its catalog id is `bach-minuet-in-g-major-bwv-anh-114`, replacing `minuet-in-g-major-bach`. Saved progress or links under the old id won't carry over; I didn't check how the app handles an unknown id (not my area). Counts are unchanged: 65 entries, Beginner 8, source 13.

**Files changed:**
- `/Users/gapp/Desktop/Piano/docs/dev/difficulty-research-raw.json`: added a `verify:musescore-level-tags` pass with the method and one verdict per file.
- `/Users/gapp/Desktop/Piano/catalog/difficulty.json`: added a Beginner/source record for `Bach_Minuet_in_G_Major_BWV_Anh._114.mxl`.
- `/Users/gapp/Desktop/Piano/scripts/build-catalog.ts`:
  - The `rated` comment now says the flag only means a level is recorded, not that it was verified.
  - The duplicate reason now reads "it has a difficulty label and this copy is Unrated".
  - The report text says "a difficulty label (over Unrated)".
  - A new report bullet says a MuseScore tag counts only once it has been re-checked, and points to the log.
- Regenerated with `npm run catalog`: `/Users/gapp/Desktop/Piano/src/catalog/catalog.json`, `/Users/gapp/Desktop/Piano/catalog/inventory.json` and `/Users/gapp/Desktop/Piano/docs/CATALOG_REPORT.md`.
- `/Users/gapp/Desktop/Piano/docs/dev/app-builder-reports.md`: added a note under the old "Minuet duplicate" decision saying how it was resolved.

**Tests:**
- New `/Users/gapp/Desktop/Piano/tests/catalog.difficulty-evidence.test.ts` (6 tests; 5 failed before the fix and pass after). It checks `catalog/difficulty.json` against the research log:
  - A label whose latest check failed must be Unrated, or "in-file" at the same level.
  - Every MuseScore-tag label needs a confirming check at the same level.
  - Every other sourced label needs one too, apart from four listed exceptions that may only shrink.
  - Both Minuet copies get the same level, and the dropped copy's reason doesn't mention a label.
  - No generated file or the script says "verified difficulty label".
- `/Users/gapp/Desktop/Piano/tests/catalog.test.ts`: the keep-order test now expects the new wording and fails if "verified" appears.
- `npx vitest run tests/catalog.test.ts tests/catalog.difficulty-evidence.test.ts`: 43/43 pass, including the test that regenerates the catalog and compares it with the committed files.
- `npx tsc --noEmit`: clean.
- Full suite: 1115 of 1116 pass. The one failure is in `tests/engine.test.ts` ("switching sound on while playing…"). `src/engine/session.ts` and that test were changed by another fixer at 07:27, and the test doesn't touch catalog data.

**Not fixed, outside this item:** four other labels from the same research batch rest on third-party listings and have never been re-checked: `Fur_Elise.mxl` and `Gymnopdie_No._1__Satie.mxl` (LaSolSheet), `Gnossienne_No._1.mxl` and `Liebestraum_No._3_in_A_Major.mxl` (Scribd). They are the four exceptions listed in the new test. A spot check today found:
- Gymnopédie still listed by LaSolSheet as ClassicMan, Beginner, 78 measures.
- The LaSolSheet Für Elise page is now an empty listing, the same state that made Ave Maria Unrated. Under the same rule, `Fur_Elise.mxl`'s Intermediate label would become Unrated.

Those four need a separate re-check pass.


===== fix:ui =====
Seven of the eight items are fixed. The lockfile item is not: `package-lock.json` is outside the files I own. Typecheck passes. All the UI test files pass (13 files, 213 tests). The full suite has 1143 passing and 6 failing, all in parser, catalog and library tests (`tests/parser.test.ts`, `tests/catalog.test.ts`, `tests/e2e.library.test.ts`, `tests/e2e.regressions.test.ts`). Those cover parser and catalog code that other fixers were editing during my run. I didn't change that code, so I'm treating the failures as theirs, but I did not prove it. I ran every new regression test against a copy of the original code: each one failed before the fix and passes now. The tests that check unchanged behaviour (mouse clicks, keyboard-reached controls) pass both before and after.

**1. follow-midi:connect-piano-keyboard-focus-lost — fixed**
- **Files:** `src/ui/practice/ConnectPiano.tsx`, `src/ui/practice/midiConnection.ts`
- **What changed:**
  - When Connect piano, Try again or Dismiss is pressed from the keyboard, the app remembers that button.
  - If focus is then lost to the page body after connecting finishes, focus goes back to that button if it is still there. Otherwise it goes to the "Your piano" list, else Connect piano, else the piano chip.
  - The chip can now take focus from code (`tabIndex=-1`) and is announced as "Your piano: <name>, <state>".
  - Moving on with Tab, a click or a mouse press cancels the pending refocus.
  - Dismiss now also keeps focus off itself on a mouse click, like the other buttons.
- **Tests** (`tests/practice.midi.test.ts`, real MidiManager): two inputs puts focus on the list; one input puts it on the chip; no piano keeps it on Connect piano; Try again after a re-plug lands on the chip; keyboard Dismiss lands on Connect piano; a mouse click leaves focus on the body.

**2. ui:midi-try-again-grabs-other-input — fixed**
- **Files:** `src/ui/practice/midiConnection.ts`
- **What changed:**
  - The hook records every input seen connected at the same time as the chosen piano.
  - `fallbackInput` takes a new `exclude` set. A match on the saved name still wins. Otherwise only a sole live input that is not in that set qualifies.
  - When nothing qualifies, the selection is left alone, so the piano is re-attached when it comes back.
  - The round-1 case (a new device appearing after the unplug) still switches to that device.
- **Tests:** piano plus "Midi Through Port-0", in two versions (unplugged port removed from the list, or kept as disconnected). After Try again the selection stays on the piano, nothing about the virtual port is saved, and re-plugging re-attaches the piano. There is also a `fallbackInput` unit test with `exclude`.

**3. ui:select-keeps-focus-without-change — fixed**
- **Files:** `src/ui/common/pointerFocus.ts`, `src/ui/practice/shortcuts.ts`, `src/ui/practice/ControlsBar.tsx`, `src/ui/practice/MoreMenu.tsx`
- **What changed:**
  - A list clicked open and closed without a new choice stays marked as mouse-focused. The next Space, ←, → or Home then makes the list let go of focus, and `shortcutFor` treats that key press as a shortcut.
  - Any other key, or focus leaving the list, clears the mark, so keyboard use keeps the list's own keys.
  - From and To now each have their own tracker (one list losing focus no longer clears the other's mark).
  - New `keepFocusOffFromLabel`: a mouse click on the "Speed", "Seconds per step", "From measure", "to" or "Play through connected piano" label no longer focuses the control.
- **Tests** (`tests/practice.focus.test.ts`): after a look at the list with no change, → steps and Space plays; Home restarts; ↑/↓ keeps the list's keys; a list reached later with the keyboard keeps its keys; label clicks leave focus free.

**4. ui:midi-notice-dismissed-forever — fixed**
- **Files:** `src/ui/practice/midiConnection.ts`
- **What changed:** Dismiss now remembers which problem was dismissed instead of setting one flag for the whole visit. The memory clears when the problem changes, so a later disconnect shows its notice and Try again again.
- **Tests:** dismiss "No piano found", plug, unplug: the disconnected notice and Try again appear. A dismissed disconnect notice also comes back for the next disconnect.

**5. ui:space-plays-while-menu-open — fixed, using option (a)**
- **Files:** `src/ui/practice/shortcuts.ts`, `src/ui/notation/Timeline.tsx`, `src/ui/help/HelpDialog.tsx`
- **What changed:**
  - Space does nothing while a measure menu is open. When the menu was opened with the mouse, the menu now absorbs Space so the page doesn't scroll away.
  - The More panel still doesn't block shortcuts, so the existing round-1 test is unchanged.
  - The Help sentence now says shortcuts don't apply while "a dialog or a measure's menu is open", and that they keep working while the More panel is open.
- **Tests:** a mouse-opened measure menu: Space doesn't play, the menu stays open, → is not a shortcut.

**6. traceability:follow-mode-lost-on-return — fixed**
- **Files:** `src/ui/practice/PracticePage.tsx` (`settings.ts` unchanged)
- **What changed:**
  - When a saved Follow me falls back to Listen, the page remembers it is waiting for the piano. While waiting, the saved mode stays Follow me, so the fallback is never written to storage.
  - Follow me is switched back on when the piano connects.
  - It gives up waiting if the learner picks another mode or starts Listen playback first. I added that playback rule myself so connecting a piano mid-playback doesn't stop the music.
- **Tests** (`tests/practice.page.test.ts`): with a saved Follow me, storage still says Follow me after 800 ms, and Follow me is selected after connecting. Picking Steady steps first keeps Steady steps.

**7. queued:soft-hold-visibility — fixed**
- **Files:** `src/ui/theme.css`, `src/ui/keyboard/Keyboard.tsx`, `src/ui/keyboard/keyboard.css`
- **What changed:**
  - "Keep holding" fills are stronger: right hand `#c4b5fd` (1.85:1 on white), left hand `#4ade80` (1.74:1).
  - Keep-holding keys also get an inset outline in the full hand colour (3px on white keys, 2.5px on black).
  - A key held by both hands gets an outline that is purple on one half and green on the other.
  - The legend swatches show the outline. The legend text "Light = keep holding" is unchanged.
- **Tests** (`tests/keyboard.render.test.ts`): outline present on held keys (white and black) and absent on press-now and unused keys; the both-hands outline uses both colours; the theme's keep-holding colours are at least 1.6:1 on white and clearly lighter than the press-now colours.

**8. security-storage-deploy:lockfile-pinned-to-private-registry — not fixed (outside my files)**
The fix for the owner of `package-lock.json`:
`sed -i '' 's#https://<internal-registry>/#https://registry.npmjs.org/#g' package-lock.json`
Then check that every `resolved` URL in package-lock.json starts with https://registry.npmjs.org/. Don't add a project `.npmrc`. Optionally, have CI fail if any `resolved` URL isn't on registry.npmjs.org.

**Doc changes for the docs owner.** None of these are needed to run the fixes; they keep `docs/UI_SPEC.md` matching the new behaviour:
- **Lines 16 and 18 (colour table):** `--rh-soft` becomes `#c4b5fd` and `--lh-soft` becomes `#4ade80`. Add: "keep-holding keys also get an inset outline in the full hand colour".
- **Lines 161-162:** add "plus an inset `--rh` outline" for continuing keys.
- **Lines 181-182:** change "no dialog or menu is open" to "no dialog or measure menu is open (the More panel does not block them)".
- **Lines 186-191:** add that a list opened with the mouse and closed without a new choice hands Space, ←/→ and Home back to the page, and that clicking a field's text label does not focus its control.
- **Line 217 (optional):** add that Try again never switches to a device that was already connected beside the piano, and that dismissing a notice hides only that problem.


===== fix:runtime =====
I fixed 5 of the 7 items and partly fixed the other 2. The rest of those two (one MIDI notice, one slider) needs small changes in `src/ui/practice`, which I don't own. Every new or updated regression test fails against the original `session.ts`/`manager.ts` (20 of them, checked through an alias config in /tmp/engfix2) and passes now; the one control test passes on both. Typecheck is clean. The full suite has 1178 passing and 2 failing: `tests/catalog.test.ts` (catalog is reproducible) and `tests/e2e.library.test.ts` (47 ready / 22 review). Neither imports engine, MIDI or audio code, and `src/core` was being edited by other fixers during my run, so I believe they belong to that work. I did not edit any docs; the text they need is listed at the end.

**engine:play-after-finish-plays-nothing — fixed** (`src/engine/session.ts`)
- `play()` now starts from step 0 when the passage is finished, or when nothing would sound from the marker.
- "Nothing would sound" is a new check, `soundsFrom(k)`. I used it instead of the suggested `attackAtOrAfter`: a marker on a release-only step where a key is still held keeps resuming there.
- A restart from step 0 counts as a start, so the count-in plays if it is on.
- No change was needed in `haltPlayback` or the position saver.
- Reviewer repros t9, t8b and f1 now play from step 0 on the first press.
- Tests in `tests/engine.test.ts`, block "Play from the end of the passage":
  - after the end, then mode Steady, hands R or hands L (each with and without count-in);
  - a piece reopened on the closing release;
  - a pause in the trailing rest;
  - a control: a step with a held key resumes there.

**engine:midi-out-late-under-main-thread-load — fixed for the first chord** (`session.ts`)
- The MIDI dispatch loop is split out as `dispatchMidi(run, now, horizon)`.
- Without a count-in, `startRun` now hands the MIDI output the first strike and the re-struck held keys immediately, timed for the end of the 50 ms start lead.
- The 40 ms lookahead is unchanged. Later notes still tolerate only about 15–40 ms of main-thread stall; only the code comment on `MIDI_LOOKAHEAD_SEC` says so.
- t1c now gives +50 ms on the piano for 10–100 ms stalls.
- Tests, block "MIDI output when the main thread is busy": a stall after Play, and a stall after a seek while playing.

**engine:clock-switch-cuts-first-monitored-note — fixed** (`session.ts`)
- When browser audio starts during silent playback, `tick()` now calls a new `switchClock()` instead of `reanchor()`.
- It moves the run onto the audio clock in place. Nothing is released, nothing waits for the start lead, and nothing is struck again on the MIDI output.
- On the wall clock nothing reached the browser sound, so its queue and the count-in clicks restart from now. With Sound on, the keys held at that moment start sounding then.
- Audio this session starts itself is only used as the clock once `ensureStarted()` has resolved (new `audioPending` flag). Before that, the AudioContext clock is frozen.
- One existing test ("switching sound on while playing…") now waits one microtask so the start can resolve before it advances the clock.
- Tests, block "Browser audio starting while silent playback runs". They use a `SuspendedSampler` fake that goes to 'loading' at once and whose clock is frozen until resumed:
  - the learner's first monitored note keeps sounding, with no all-notes-off, a steady marker, and no MIDI sends;
  - Sound turned on mid-run: the marker keeps moving, then the held keys join in.

**engine:speed-drag-restrikes — partly fixed**
- Engine part done: a re-anchor at the current position (speed, step length, sound, output or input change) no longer strikes a key again if it ends within 30 ms. Seeking or starting at a step still re-sounds every held key.
- Tests, block "Speed or step-length change just before a release": speed 0.5, speed 1.5 and step length 2 s, each 5 ms before a release.
- Not fixed: the stutter while dragging the slider. t7 and f5 still show 5 all-notes-off for 5 drag events. This needs the debounce in `src/ui/practice/ControlsBar.tsx` exactly as the item's suggested fix describes, with 5 rapid changes producing one re-anchor.

**follow-midi:echo-guard-misses-cc64-and-reset-noteoffs — fixed** (`src/midi/manager.ts`)
- I followed the verifier's design.
  - `allNotesOff` no longer sends a note-off for a key whose note-off has already taken effect. A note-off still queued for later still gets the explicit one.
  - The All Notes Off and sustain-off it sends are recorded. An echoed All Notes Off is swallowed, and so is a matching sustain-off arriving within 80 ms after it. A piano that does not echo still gets its real pedal release through.
- Reviewer repros: t1b now keeps the pedal down, and t2 keeps the learner's C4 held after Pause.
- Updated test in `tests/midi.test.ts`: the "allNotesOff sends note-offs…" expectation no longer has the redundant note-off.
- New tests:
  - `tests/midi.test.ts`, block "release burst and echoes": a queued release still gets an explicit note-off; echoed burst ignored; a real pedal release still delivered.
  - `tests/engine.test.ts`, block "Play through a connected piano that echoes", using the real `MidiManager`: Follow me loop restart with the pedal held; Listen Pause while holding a key the app played earlier.

**follow-midi:saved-input-never-connected-shown-as-disconnected — partly fixed** (`manager.ts`)
- New getter `inputSeen`: true once the selected input has been connected during this session.
- A remembered id that has never connected now gives way to the only connected input whenever one appears, not just at Connect. A piano that has connected is still waited for.
- With the verifier's jsdom flow (/tmp/vfm/ui/saved.test.ts), a piano switched on later under the same id, a new id, or a new id and name now connects automatically.
- Tests: `tests/midi.test.ts`, block "a remembered input that has not turned up" (three tests).
- Not fixed (UI): after Connect with the piano off, the notice still says "Your piano was disconnected". In `src/ui/practice/midiConnection.ts`:
  - add `readonly inputSeen?: boolean` to `MidiControl`;
  - in `midiPhase` under 'ready', return 'disconnected' only when `m.selectedInputId !== null && m.inputSeen !== false`; otherwise fall through to 'choose' / 'no-devices'.
  - Do not call `selectInput(null)` here: it would turn auto-select off.

**ui:nothing-to-play-both-hands-wording — engine half fixed** (`session.ts`)
- `SESSION_MESSAGES.nothingToPlay` is now "There is nothing to play in these measures."
- Test: silent measures with both hands give a message that names no hand.
- Not fixed (UI): the both-hands wording in `nothingToPlayText` in `src/ui/practice/PracticePage.tsx`.

**Doc updates for the docs owner**
- APP_CONTRACTS, Listen/Steady: "play() from a marker where nothing is left to sound (the closing release, or the trailing rest) starts at step 0, with the count-in if on."
- APP_CONTRACTS, Clock, and ARCHITECTURE §7:
  - the first strike of a run is handed to the MIDI output when the run starts; later MIDI messages tolerate about 15–40 ms of main-thread stall (browser sound about 125 ms), so qualify "Visual work never blocks audio timing";
  - silent playback moves onto the audio clock in place once `ensureStarted()` resolves, with no release and no MIDI re-strike.
- APP_CONTRACTS, speed or step-length change: "Held keys are re-sounded, except those released within 30 ms."
- ARCHITECTURE §5:
  - `allNotesOff` sends "a note-off for every note the app has not already released";
  - add the All Notes Off / sustain-off echo rule;
  - add the remembered-input rule and `inputSeen`.
- Now stale:
  - `docs/dev/core-builder-reports.md:268` ("some note-offs are redundant");
  - the known-deviation line in `docs/dev/review-round1.md:858` about the count-in clock switch re-striking on the MIDI output;
  - `docs/dev/app-builder-reports.md:88`, which still mentions the old "chosen hand" message.

Files changed:
- /Users/gapp/Desktop/Piano/src/engine/session.ts
- /Users/gapp/Desktop/Piano/src/midi/manager.ts
- /Users/gapp/Desktop/Piano/tests/engine.test.ts
- /Users/gapp/Desktop/Piano/tests/midi.test.ts

Originals are backed up in /tmp/engfix2/orig.


===== fix:core =====
All 12 items are fixed in src/core. Typecheck is clean, and the suite runs 1188 passed, 1 failed. The one failure is tests/catalog.test.ts "is reproducible", which will keep failing until the catalog is regenerated (`npm run catalog`). I did not run that, since another fixer owns the catalog. I checked that the new tests fail against an unmodified copy of src/core; on the old code the staves test runs out of memory instead of failing normally.

**Per item** (all paths under /Users/gapp/Desktop/Piano)

- **traceability:repeat-first-ending-at-forward-repeat-replayed: fixed.**
  - `src/core/model/performance.ts`: when playback goes back to a `||:`, the 1st-ending check is skipped only if that bracket closes an earlier section. The existing case-L tests are unchanged.
  - Tests: 4 cases (H1–H4) in `tests/model.repeats.test.ts`, plus an end-to-end case in `tests/e2e.regressions.test.ts` that checks RH attacks C4 D4 E4 F4.

- **music:nav-marks-from-first-part-only: fixed.**
  - `src/core/musicxml/parse.ts` (`mergeMarks`): marks are now merged across all parts of a measure. Flags are combined, endings are combined without duplicates, and the first repeat count wins. The comment in `types.ts` is updated.
  - Tests: new `tests/parser.navmarks.test.ts` (Fine in the lower part, D.C. in the lower part of a 2nd ending giving 1 2 1 3 1, segno in the lower part, repeat count).

- **music:duplicate-measure-numbers-not-disambiguated: fixed.**
  - `src/core/measures.ts`: when every measure has the same number, measures are numbered by position. A number that repeats gets a letter ("12", then "12a"); restarted numbering reads "1a", "2a".
  - Tests: `tests/measures.test.ts`, including Gnossienne labelled 1–11.

- **music:ossia-size-rule-absolute and traceability:uniform-staff-size-drops-left-hand: fixed.**
  - `src/core/model/hands.ts`: "printed smaller" now means smaller than the largest staff that has notes, with a missing size counting as 100.
  - Tests: `tests/model.ossia-staves.test.ts` covers all staves at 75 or 80 (left hand kept) and sizes 80/70/80 (only the middle staff left out).

- **security-storage-deploy:staves-count-oom-crash: fixed.**
  - `hands.ts`: the 3+-staff mapping now uses Maps over the staves that actually have notes, not arrays sized by `<staves>`.
  - `src/core/musicxml/part.ts`: a `<staves>` value above 64 is ignored, and the highest staff that carries notes is used instead.
  - Tests: 1e8 staves via the builder, and a parsed file declaring 1e8 staves (finishes quickly, maps R and L correctly). The old code crashes with a heap out-of-memory error on the first test.

- **security-storage-deploy:mxl-two-directories-bypass-size-limit: fixed.**
  - `src/core/mxl.ts`:
    - The directory the reader uses must match fflate's listing on name, both sizes and compression method.
    - If a zip64 end record exists, it must point to the same directory as the classic end record.
    - The inflate size is capped at `maxUncompressedBytes`.
  - Tests: `tests/mxl.test.ts` has a two-directory archive (fails fast with bad-archive) and a legitimate archive with a matching zip64 record (still reads).

- **music:voice-reused-at-different-times-flips-hand: fixed.**
  - `src/core/voices.ts`, for files that do not number voices in MuseScore's blocks of four:
    - A part counts as numbered per staff when some voice sounds on two staves at once, or voice 1 is on each staff alone for some measure. In such a part every note stays with the staff it is drawn on.
    - Otherwise, a note on the other staff counts as cross-staff only if its voice is on its home staff in the same or a neighbouring measure.
  - The library is unaffected, because every file is a MuseScore export.
  - Tests: the adv2 and adv3 repros plus two locality cases in `tests/voices.test.ts`.

- **music:two-instrument-parts-ready-as-hands: fixed.**
  - The parser now records `instrumentNames`, `instrumentSounds` and `midiPrograms` on `SourcePart` (optional fields, only set when present).
  - New `src/core/instruments.ts` has `isKeyboardPart` (same logic as the catalog script's `isPianoPart`) and `couldBeOneHand`.
  - Hand rule 5 adds a review `multiple-instruments` warning unless both parts look like keyboard parts, hand-named parts, or are unnamed with nothing declared.
  - Tests: `tests/model.hands.test.ts` and `tests/parser.test.ts`. One existing test's part names changed from "Upper"/"Lower" to "Piano 1"/"Piano 2".

- **music:muted-notes-shown-but-inaudible: fixed.**
  - A printed note with `dynamics="0"` that has no hidden replacement now plays at the loudness around it, with a new info warning `silent-notes-played`.
  - A note that is both hidden and silent is now left out, with an info note. Otherwise the velocity change would have made it audible.
  - Files: `part.ts`, `parse.ts`, `warnings.ts`, `types.ts`.
  - Tests: `tests/e2e.regressions.test.ts`, including The Entertainer m38 and m92.

- **ui:readiness-reason-dangling-measures: fixed.**
  - The cross-staff message now reads "…The app guesses which hand plays them from the musical line they belong to. If a hand feels wrong, the measures are listed under More → About this arrangement."
  - No core message says "check these measures" any more. The expectation in `tests/parser.test.ts` is updated.

- **traceability:ornaments-dropped-but-ready: fixed.**
  - `ornament-not-played` is now a review warning. The new text has no measure reference.
  - Tests updated in `parser.test.ts`, `e2e.regressions.test.ts` and `e2e.library.test.ts`. The library readiness count is now 37 ready / 32 review, a deliberate change with a comment explaining it.

- **music:gymnopedie-ready-rh-plays-lh-chords: fixed in core.** The catalog part is someone else's.
  - New `ScoreOverrides.voiceHands`: rules of the form `{part, voice, hand, measures?: [first, last][]}`, using 0-based written-measure indexes, inclusive.
  - The rules are checked in `hands.ts`, carried on `HandMapping.voiceHands`, and described in the hand-mapping description. `voiceHandOf` in `performance.ts` applies them before the staff lookup.
  - New review warning `hand-span-too-wide` in `prepare.ts`: one hand strikes keys more than 16 semitones apart at the same moment.
  - Tests: `model.hands.test.ts`, `model.prepare.test.ts`, and a library test in `e2e.regressions.test.ts`.

**For the catalog fixer**

- **Gymnopédie override.** Put this in `catalog/metadata.json` for `Erik_Satie_-_Gymnopedie_No.1.mxl`:
  `{"voiceHands":[{"part":"P1","voice":"1","hand":"L","measures":[[0,17],[31,35],[39,43]]}]}`
  With it, every one of the 78 occurrences matches `Gymnopdie_No._1__Satie.mxl` exactly (hand, key and beat), and the piece is ready.
  - Do not use the suggested `[[0,36],[39,44]]`. It would give the right-hand melody E4 in m19 and the right-hand chords in m37 and m45 to the left hand.
  - Without any override the file is now review.
- **`scripts/build-catalog.ts`:**
  - Validate `overrides.voiceHands` in `parseMetadata`.
  - List `voiceHands` in the "Hand overrides" report section.
  - Optionally make `isPianoPart` reuse `isKeyboardPart` from `src/core/instruments.ts`.
  - Optionally add a `WARNING_NOTES` entry for `silent-notes-played`.
- **Regenerate the catalog** (catalog.json, inventory.json, CATALOG_REPORT.md). Expected changes:
  - Becoming review because of ornaments: 12 Variations, Bella Ciao (Casa de Papel), Chopin Nocturne Op. 9 No. 2, Spring Waltz, Minuet in G (Bach), Nocturne in C♯ minor, K. 545 (`Sonata_No._16_1st_Movement_K._545.mxl`), Waltz in A minor.
  - Becoming review because of the span check: Schubert Serenade (m80, 86, 94, 98, 103), even with its existing override, and the Erik Satie Gymnopédie unless the override above is added.
  - Gaining a hand-span reason, already review: Bach Toccata, Beethoven 5, Ballade 1, Nocturne Op. 9 No. 1, both Clair de lune files, La Campanella, Liebestraum, Mariage d'Amour, `moonlight_sonata_3rd_movement.mxl`.
  - Gnossienne labels become 1–11.
  - The Entertainer and the fingered Turkish March get the `silent-notes-played` info and new velocities.
  - The cross-staff wording changes on 19 pieces.
  - The duplicate choices may change, since the rule prefers ready over review.

**Doc changes needed** (docs/ is outside my area, so I did not edit it). In `docs/ARCHITECTURE.md`:
- Cross-staff (~L125–153): the per-staff numbering rule, the neighbouring-measure rule, and the new message wording.
- Navigation marks (~L154): marks are merged across parts.
- Velocity (~L110): silent notes use the surrounding loudness; hidden and silent notes are dropped.
- Ornaments (~L165): `ornament-not-played` is now review.
- MXL (~L188): both directories must agree.
- Hands rule 1: `voiceHands`.
- Hands rule 4: "printed smaller" is relative; `<staves>` above 64 is ignored.
- Hands rule 5: non-keyboard parts get `multiple-instruments` review.
- Measure numbers (~L271): repeated numbers and all-same numbers.
- `simulate()` (~L278): the `||:` on a 1st-ending rule.
- Readiness (~L324): the new `hand-span-too-wide` (review) and `silent-notes-played` (info) codes.


===== integrate:final =====
Integration is finished and everything passes: typecheck is clean, `npx vitest run` gives 1202 of 1202 tests passing in 42 files, and `npm run build` succeeds. I re-ran `npm run catalog` at the end and it changed nothing.

**dist/index.html uses relative asset paths only:** `./assets/index-Bap4C6E_.js` and `./assets/index-BOF9ck01.css`, with no root-absolute (`/…`) references. The favicon is an inline data URI. The CSS has no `url()` references, and all 69 scores are in `dist/scores`.

**What I changed**

1. **Catalog (handoff from the core fixer):**
   - `scripts/build-catalog.ts` now validates `overrides` in `parseMetadata`:
     - unknown keys are rejected;
     - `excludeParts`, `staffHands` keys and hands, and each `voiceHands` rule (part, voice, hand, `[first, last]` ranges) are checked.
   - The "Hand overrides" report section lists `voiceHands`. `isPianoPart` now calls `isKeyboardPart`, and `silent-notes-played` has a library-card note.
   - `catalog/metadata.json`: added the Gymnopédie override (`P1` voice 1 → left hand in `[[0,17],[31,35],[39,43]]`) with a plain-language reason, evidence and a note.
   - After regenerating, the catalog has 64 entries (36 ready, 28 review) and 5 duplicates. The ornament and hand-span review changes match what the core fixer predicted.
   - **The Erik Satie Gymnopédie is now dropped as a duplicate.** With the override its notes match `Gymnopdie_No._1__Satie.mxl` 100% (it was 52% because of the hand bug), so the id `erik-satie-gymnopedie-no-1` leaves the catalog.
   - The Minuet duplicate is now kept "because it is ready to practise and this copy needs review".

2. **Saved piano that never connected (`midiConnection.ts`, `ConnectPiano.tsx`):**
   - Added `inputSeen` to `MidiControl`. `midiPhase` returns 'disconnected' only when the input has actually been seen, so the learner now gets "No piano found" / "Still no piano found", or is asked to choose.
   - A remembered input that has not turned up is left out of the piano list, which then shows "Choose your piano…" instead of an unnamed disconnected device.
   - 4 new tests in `tests/practice.midi.test.ts`; 3 of them fail on the old code.

3. **Speed / Seconds-per-step slider debounce:**
   - New `src/ui/practice/settledSlider.ts`, used in `ControlsBar.tsx`. The slider shows each value at once but sends it to playback only after 150 ms without movement, or on pointer-up or blur. A pending value is still sent if the controls go away, and Reset gives 1× even right after a drag.
   - New `tests/practice.slider.test.ts` (8 tests; 4 fail on the old code). Five quick drag events now make one change.

4. **Empty-passage wording:** `nothingToPlayText` moved to `src/ui/practice/text.ts`. With both hands it now reads "There is nothing to play in these measures (they are silent). Choose a different passage."

5. **Lockfile:** all 212 `resolved` URLs in `package-lock.json` now point to `https://registry.npmjs.org/`.
   - New guard test `tests/deploy.lockfile.test.ts`, which fails on the old lockfile, plus a README note.
   - If npm is configured to use a company mirror, npm's default `replace-registry-host` rewrites registry.npmjs.org URLs to that mirror, so local installs still go through it.

6. **Docs:**
   - `docs/ARCHITECTURE.md`: every core and runtime change the fixers listed, plus the new core modules in the directory layout.
   - `docs/APP_CONTRACTS.md`: clock, Play from the end, the 30 ms re-strike exception, the slider rule, and Follow me being restored.
   - `docs/UI_SPEC.md`: colours and outline, slider, shortcuts and labels, MIDI notices, empty passage.
   - `README.md`: counts are now 64 and 5. I removed the claim that every difficulty label was verified and named the four labels never re-checked.
   - I added notes to the three stale lines in `docs/dev/`.

**Still unresolved**
- `README.md` links `docs/IMPLEMENTATION_REPORT.md` (the brief's §19 implementation report), which does not exist yet.
- Four difficulty labels have never been re-checked (Für Elise, Gymnopédie No. 1, Gnossienne No. 1, Liebestraum No. 3). The LaSolSheet page for Für Elise is now an empty listing, so under the same rule that label would become Unrated.
- MIDI output under main-thread load is only fixed for the first chord of a run. Later notes still tolerate only about 15–40 ms of stall.
- Two catalog ids are gone (`minuet-in-g-major-bach` and `erik-satie-gymnopedie-no-1`), so saved progress or links under those ids won't carry over.
- Schubert Serenade is now review because of the hand-span check (m80, 86, 94, 98, 103) even with its override. I did not check whether those are real Liszt stretches or wrongly assigned hands.
- The Prelude BWV 846 stays Beginner, the catalog fixer's call, which differs from step 2 of the planned difficulty fix.
- The slider and MIDI notice changes have only been tested in jsdom; they still need your browser check.

New files:
- /Users/gapp/Desktop/Piano/src/ui/practice/settledSlider.ts
- /Users/gapp/Desktop/Piano/tests/practice.slider.test.ts
- /Users/gapp/Desktop/Piano/tests/deploy.lockfile.test.ts

Backups of the pre-regeneration catalog outputs and the original lockfile are in /tmp/integ.
