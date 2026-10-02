

===== app:catalog =====
The catalog generator is written, I ran it on the real inputs, and its 28 tests pass. Running it twice gives byte-identical output. `npx tsc --noEmit -p tsconfig.json` shows no errors in my files; the remaining errors are in other people's files (`src/App.tsx`, `src/engine/session.ts`, `src/ui/library/LibraryPage.tsx`, `tests/engine.test.ts`).

## Files
- `/Users/gapp/Desktop/Piano/scripts/build-catalog.ts` (run with `npm run catalog`, about 13 s)
- `/Users/gapp/Desktop/Piano/src/catalog/catalog.json` (65 entries)
- `/Users/gapp/Desktop/Piano/catalog/inventory.json` (69 rows)
- `/Users/gapp/Desktop/Piano/docs/CATALOG_REPORT.md`
- `/Users/gapp/Desktop/Piano/tests/catalog.test.ts`

## Summary counts
| | Count |
|---|---|
| Files | 69 |
| Included | 65 (47 ready, 18 needs review) |
| Duplicate | 4 |
| Unsupported | 0 |
| Not solo piano | 0 |
| Awaiting review | 0 |

- **Difficulty of included pieces by level:** Beginner 10, Intermediate 6, Advanced 2, Unrated 47.
- **By basis:** source 12, in-file 6, estimated 0, none 47.
- **Report date:** 2026-10-02, taken from the latest `checkedOn` in `difficulty.json`.

## Duplicates (by note content)
- `WA_Mozart_Marche_Turque_Turkish_March_fingered.mxl` matches `Piano_Sonata_No._11_K._331_3rd_Movement_Rondo_alla_Turca.mxl` at 100%; the sonata file is kept because it has fuller credits.
- `Passacaglia2.mxl` matches `Passacaglia.mxl` at 100%; `Passacaglia.mxl` is kept because only it has a MuseScore link in the file.
- `Prlude_Opus_28_No._4_in_E_Minor__Chopin.mxl` matches the other Chopin prelude file at 98.3%; the other is kept because it is ready and this one needs review.
- `Minuet_in_G_Major_Bach.mxl` matches `Bach_Minuet_in_G_Major_BWV_Anh._114.mxl` at 98.0%; the BWV file is kept because it has a rights statement.
- `G_Minor_Bach.mxl` and `G_Minor_Bach_Original.mxl` match at 95.5%. Both stay in, and each gets the note "Another edition in this library has nearly the same notes (95.5% match)".

## Exported API (`scripts/build-catalog.ts`)
- **Pure functions:** `fingerprint`, `similarity`, `formatSimilarity`, `assignStatuses`, `comparePreference`, `resolveArrangements`, `stripAnotherCopy`, `buildEntry`, `scoreStats`, `derivedNotes`, `mergeNotes`.
- **Reading inputs and files:** `parseMetadata`, `parseDifficulty`, `difficultyFor`, `readPartList`, `isPianoPart`, `findMuseScoreUrl`, `creditInfo`, `catalogDate`.
- **Small helpers:** `slugFromFileName`, `upstreamUrl`.
- **Whole run:** `generateCatalog(paths, env)` returns the catalog, inventory, report text, summary and problems without writing anything.
- **Constants:** `LIBRARY_COMMIT`, `DUPLICATE_THRESHOLD`, `SIMILAR_THRESHOLD`, `MAX_NOTES`, `UNRATED`.
- `main()` installs xmldom's DOMParser and then loads the parser. It only runs when the script is executed directly.

## What is tested
- The pure functions on small made-up inputs: fingerprint, similarity, statuses, arrangement lines, entry building, notes, difficulty checks, piano detection, MuseScore link lookup and slugs.
- Every `catalog.json` entry has the required fields with the right types, ids are unique and sorted, and every file exists in `public/`.
- Every `public/scores` file appears exactly once in `inventory.json`, and the included rows match `catalog.json`.
- A test regenerates the catalog and checks it equals the committed files. It fails whenever core code, `metadata.json` or `difficulty.json` changes and nobody re-ran `npm run catalog`. It takes 13–45 s.

## Decision for you: the Minuet duplicate loses its Beginner label
`Minuet_in_G_Major_Bach.mxl` has a sourced Beginner label but is left out as a duplicate, so the kept copy shows as Unrated. I followed your keep order exactly, and the label is not copied across because labels belong to one arrangement. If you want the labelled copy kept instead, the change is to add "has a sourced difficulty label" to the keep order in `comparePreference`. The report lists this under "Data checks".

**Later resolution (review round 2).** The label preference was added to `comparePreference`. However, the PianoXML copy had no label only because its verification could not reach musescore.com (HTTP 403), while the ClassicMan copy's label had never been verified. A later pass (`verify:musescore-level-tags` in `docs/dev/difficulty-research-raw.json`) re-checked every MuseScore level-tag label under one rule. Both Minuet uploads (and the Prelude BWV 846, Für Elise for beginner piano and Happy Birthday) show the "easy" tag, so both copies are Beginner. The label no longer decides between them, and `Bach_Minuet_in_G_Major_BWV_Anh._114.mxl` is kept again because it has an explicit rights statement. Its catalog id is `bach-minuet-in-g-major-bwv-anh-114`, which replaces `minuet-in-g-major-bach`. The keep-order wording is now "a difficulty label", not "a verified difficulty label": the flag only means `difficulty.json` records a level.

## Deviations and judgement calls
- **"More complete credits"** is my own definition, because none was given. It counts how many of title, composer, arranger and source link the file states, then the number of distinct credit lines on the score.
- **Similarity percentages** are rounded down, so a near-copy never shows as 100%.
- **"(another copy)" removed in 2 entries:** Passacaglia and the kept Chopin prelude, because the copy they referred to is no longer listed.
- **12 curated notes removed:** they named other `.mxl` files, which would put file names into the app (§16). The report lists them so whoever maintains `metadata.json` can reword them.
- **`rightsInFile`** comes from the file itself; it matches `metadata.json` in every case.
- **Status 'review'** is only used for a file with no `metadata.json` record (none today).

## Integrator notes and known gaps
- **Inventory file names:** `inventory.json` uses bare file names, not `scores/...`. `catalogId` is set only on included rows.
- **Difficulty records:** `arrangementUrl` from `difficulty.json` becomes `originalSourceUrl` and is removed from `difficulty`.
- **MuseScore links:** links from the files are kept exactly as written, so some are `http://` or `api.musescore.com/score/N` addresses that may not open a normal page.
- **Override reasons:** the reasons in `metadata.json` contain part ids (P1, P2) and a file name, and they appear in the diagnostics panel.
- **Duplicate detection is strict:** it compares exact timing, so curator-suspected copies with shifted measures stay listed (for example the two Clair de lune files match only 20%). The report compares every curator hint with the computed similarity.


===== app:engine =====
The practice engine is finished. `src/engine/session.ts` implements `PracticeSession` and every bullet of the "Engine → Behaviour" section in `docs/APP_CONTRACTS.md`. All 69 tests in `tests/engine.test.ts` pass, and `npx tsc --noEmit -p tsconfig.json` reports no errors anywhere in the tree.

The full suite also passed (713 tests in 24 files), but vitest printed one internal "Timeout calling onTaskUpdate" error. The engine tests pass cleanly when run alone, so this looks like the machine being busy rather than a failing test. I did not change `package.json`, any config, or anyone else's files, and nothing is missing from the dependencies.

## Files
- `/Users/gapp/Desktop/Piano/src/engine/session.ts`
- `/Users/gapp/Desktop/Piano/tests/helpers/fakes.ts`:
  - `FakeSampler` has a settable `currentTime`, records every call with its time, and copies the real sampler's voice rules so stuck notes can be detected.
  - `FakeMidi` can send input events, disconnect and reconnect, and records everything sent to the output.
  - `FakeClock` is a fake interval timer that moves the wall clock and the audio clock together, starting from different origins.
- `/Users/gapp/Desktop/Piano/tests/engine.test.ts`

## Exported API
- The contract types and class exactly as written: `SessionStatus`, `SessionSnapshot`, `SamplerLike`, `MidiLike`, `SessionDeps` and `PracticeSession`.
- Extra constants: `SCHEDULER_INTERVAL_MS` (25), `LOOKAHEAD_SEC` (0.15), `START_LEAD_SEC` (0.05), `PREVIEW_SEC`, `FOLLOW_LOOP_DELAY_MS`, `COUNT_IN_BEATS`, `DEFAULT_PLAY_VELOCITY`, `SPEED_MIN/MAX`, `STEP_SECONDS_MIN/MAX`.
- `SESSION_MESSAGES` holds every user-facing message:
  - "Piano disconnected — reconnect it to continue."
  - "Connect a digital piano by MIDI to use Follow me."
  - A message for when there is nothing to play in the passage (now hand-neutral: "There is nothing to play in these measures.").
  - A message for when browser sound cannot start.

## What is tested
Everything on the required list is covered:
- **Listen:** exact note-on/off times at speed 1 and 0.5 across a tempo change; note-offs before note-ons at the same time; trailing rests count towards the end; the marker moves at the right times; the visual position interpolates and dwells on a long note.
- **Seeking and stepping:** seeking while playing re-sounds held keys with nothing stale; seeking while stopped or paused is silent; next/prev preview the struck keys and release them within 0.5 s.
- **No stuck notes:** checked for pause, stop, dispose, loop restart, and changes of mode, hands, range, speed, step length, sound and output. A 400-action random run is also checked, for both browser sound and MIDI output.
- **Loop with count-in:** clicks, then a restart with the carried keys.
- **Steady steps:** equal intervals; long keys hold across steps; sound off plays no notes.
- **Follow me:** all listed cases.
- **MIDI output:** no sends when off; timestamps when on; all-notes-off on stop.
- **Snapshot:** keeps the same object until something changes.

To check the tests catch real faults, I broke the code on purpose in 33 different ways, one at a time. All 33 were caught. One more break, skipping the re-feed of already-held keys when Follow me starts, made no visible difference, because the reset that matters already happens there.

## Behaviour choices beyond the contract
- **Start delay:** playback starts 50 ms after "now", so the first chord is never late. Before that moment the marker stays on the start step.
- **Resume after pause:** it restarts from the start of the marker step and sounds the held keys again. It does not resume from the exact point inside the step.
- **Statuses after changes:**
  - Changing hands, range or mode leaves the status at `stopped` (or keeps `paused`) and keeps the marker near where it was.
  - Seeking after the piece has finished sets the status to `paused`.
- **Count-in:**
  - The beat is a quarter note at the tempo where playback starts, divided by the speed. *(Superseded in review round 3: in Listen the beat now follows the time signature in force there, a dotted quarter in 6/8, 9/8 and 12/8, an eighth in 3/8, a half in x/2; a pause or page hide during a count-in counts in again. See APP_CONTRACTS.md, Count-in.)*
  - Seeking or changing the speed during a count-in starts the count-in again.
  - Clicks need browser audio, so `play()` starts it whenever count-in is on, even with sound off.
- **Previews** also go to the MIDI output when one is chosen.
- **Same key in both hands:** it is treated as one key. Each hand's strike sounds, but the key is released only when the last hand lets go.
- **`waitingFor`** lists only the expected keys not yet pressed; `struck` has the full set.
- **Disconnects:**
  - During Follow me, the session pauses and shows the message.
  - During Listen or Steady steps, it releases everything and carries on from the same point.
  - If a different keyboard is chosen, the old keyboard's keys are forgotten and Follow me keeps waiting.
- **Hearing my own playing:** the pedal keeps those notes sounding until it is lifted, though the pedal never counts as a held key. A very quick tap still gets released.
- **Errors:** if browser sound fails to start, playback continues silently on wall-clock time with a message. If the sequence is empty, `play()` shows a message instead of starting.

## What integrators must know
- **Passing methods directly:** `subscribe`, `getSnapshot`, `getVisualPosition`, `play`, `pause`, `stop`, `togglePlay`, `restart`, `next` and `prev` are bound, so they can go straight to `useSyncExternalStore`, `requestAnimationFrame` or `onClick`.
- **Call these from a click or key handler (browser audio may only start from one):**
  - `play()`.
  - `updateSettings` when it turns `monitorInput` on, or turns sound on while playing.
  - `next()`/`prev()` while sound is on.
- **Choosing the input keyboard is not done by the engine.** `MidiLike` has no `selectInput`, so the UI must call `MidiManager.selectInput` itself; `settings.midiInputId` is only stored.
- **MIDI output follows the session.** The constructor sets the MIDI output to match `settings.midiOutputId` whenever they differ.
- **Dispose on leave.** `PracticePage` must call `dispose()` on unmount; it releases all notes and drops every listener.

## Known gaps
- Browsers slow timers down in background tabs, so notes there may play late. The 150 ms look-ahead does not cover that.
- If browser sound is started while a silent run is already playing, playback switches to the audio clock and may pause briefly until the browser resumes audio.


===== app:library-ui =====
The app shell, library screen, storage, catalog loader and About dialog are done, and they already work with the practice-ui engineer's real `PracticePage`. The full suite passes (24 files, 713 tests) and `npx tsc --noEmit -p tsconfig.json` reports no errors anywhere in the tree. My own new tests are 73 of those 713.

I also ran it in a browser:
- **Dev server:** checked cards, popovers, search, the empty state, the About dialog, "Clear local data" with confirm, importing a damaged file, a valid `.musicxml` and an `.mxl`, delete with confirm, and the "Continue" link. A built-in piece loaded by fetch and an imported piece loaded from IndexedDB, both on the real practice page.
- **Production build under a subpath:** served at `/repo/`, a direct link to a piece and a refresh both work, scores load from `/repo/scores/…`, and an unknown hash is rewritten to `#/`.
- **Phone width (375px):** no horizontal overflow (checked with a script; the pane was hidden, so no screenshot).

The build went to `/tmp`; temp servers, temp files and the test data in the preview browser were removed. `package.json` and the configs are untouched.

**Files (all under /Users/gapp/Desktop/Piano)**
- `index.html`, `src/main.tsx` (StrictMode), `src/App.tsx`, `src/ui/router.ts`, `src/app/services.ts`
- `src/ui/theme.css`
- `src/ui/common/`: `Dialog.tsx`, `Popover.tsx`, `Badge.tsx`, `DifficultyBadge.tsx`, `ReadinessChip.tsx`, `ErrorBoundary.tsx`
- `src/ui/library/`: `LibraryPage.tsx`, `LibraryCard.tsx`, `filter.ts`, `format.ts`, `library.css`
- `src/ui/about/AboutDialog.tsx`, `src/ui/about/about.css`
- `src/storage/prefs.ts`, `src/storage/imports.ts`, `src/catalog/loader.ts`
- `tests/storage.test.ts` (33), `tests/router.test.ts` (10), `tests/library.filter.test.ts` (19), `tests/catalog.loader.test.ts` (11, an extra file of my own)

**APIs.** Everything in APP_CONTRACTS is implemented with the exact signatures. Additions:
- **prefs.ts:** `sanitizeSettings`, `removePieceState`, `DEFAULT_GLOBAL_PREFS`, `STORAGE_PREFIX`, `SPEED_LIMITS`, `STEP_SECONDS_LIMITS`.
- **imports.ts:**
  - `importFile(file, { onProgress? })` reports `'reading' | 'checking' | 'saving'`.
  - `ImportedPieceMeta` gains optional `lowest` / `highest`.
  - Also exported: `isImportId`, `newImportId`, `clearImports`, `readBlobBytes`, `parseScoreBytes`, `buildImportMeta`.
- **loader.ts:** `builtinFileUrl(entry)`, `isAbortError(e)` (PracticePage already uses this).
- **router.ts:** `Route`, `parseHash`, `routePath`, `pieceHref`, `LIBRARY_HREF`, `isCanonicalHash`, `navigate(path, { replace? })`, `useRoute()`.
- **common:**
  - `Dialog` (props: `open`, `onClose`, `title`, `footer`, `size`, `initialFocusRef`, `role`), plus `ConfirmDialog`.
  - `Popover`, `Badge`.
  - `DifficultyBadge({ info })`, `DifficultyInfoButton({ info, pieceTitle })`, `DifficultyDetails`, `difficultyLabel`, `safeExternalUrl`, `formatCheckedDate`.
  - `ReadinessChip({ readiness, reasons })`, `ErrorBoundary`.
- **AboutDialog:** `({ open, onClose, onDataCleared? })`.

**What is tested**
- **Storage (`prefs.ts`):**
  - corrupt or non-object JSON
  - field-by-field fallback to defaults
  - `getItem` throwing, `setItem` throwing (quota), the `localStorage` getter itself throwing, and no `localStorage` at all
  - "Clear local data" removes only this app's keys plus all imports
- **Imports (`imports.ts`, IndexedDB mocked):**
  - damaged XML, non-MusicXML, entity declarations, a broken zip, an empty file and a score with nothing to play are each rejected with an `ImportError`, and nothing is stored
  - a save failure gives a plain message
  - a valid import stores data and bytes under separate keys, and the progress stages are reported in order
  - `.mxl` files import; a file with no title is named from its file name
  - listing is newest first and skips damaged records
  - delete removes both keys
  - IndexedDB missing vs. unreadable is handled
- **Router:** hash parsing and unknown routes, link building, `navigate` with and without replace, and `useRoute` re-rendering.
- **Library filter:** accent- and case-insensitive search, apostrophes, multiple words, composer and arrangement text, chip counts, the review checkbox, and sort order.
- **Card text:** length, key range and difficulty labels; non-http(s) links are blocked.
- **Loader:** the URL uses `BASE_URL`, `null` overrides are normalised, hand overrides are applied, 404 and network errors give plain messages, `ImportError` passes through, unknown and unusable pieces are refused, cancelling works, and imported pieces load from storage.

**Decisions and deviations**
- Unchecking "Show pieces that need review" also hides pieces marked "Can't be used".
- Imported pieces show no difficulty badge. They appear only under the "All" chip, and chip counts cover built-in pieces only.
- A file that parses but has nothing playable is rejected at import, with the reason quoted, rather than stored as unusable.
- A saved speed or seconds-per-step outside the slider limits falls back to the default rather than being clamped. A saved passage range is checked for shape only; PracticePage's own `validRange` clamps it to the piece.
- `loadPiece` refuses catalog entries marked "Can't be used" (there are none today). For imports, the arrangement line is "Arranged by X" if the file names an arranger, otherwise empty.
- Dialogs focus their Close button when they open; confirm dialogs focus Cancel.
- Clicking outside a popover closes it without also opening the card underneath.
- The library remembers search, filters and scroll position when you open a piece and come back.
- The About dialog also lists the per-piece rights notes from the catalog, as UI_SPEC asks.

**Integrators must know**
- `App` sets `document.title` (piece title · Piano Steps), so `PracticePage` should not set it as well.
- `App` saves `lastPieceId` only for known catalog ids or `local-` ids.
- Shared classes in `theme.css`: `.btn`, `.btn-primary`, `.btn-quiet`, `.btn-small`, `.icon-btn`, `.link-btn`, `.chip` (uses `aria-pressed`), `.badge`, `.visually-hidden`, `.note-label`, `.mono`, `.page-message`.
- StrictMode is on, so effects run twice in development.

**Known gaps**
- No component tests for the UI pages, because no React testing library is installed; the pages were checked by hand in the browser.
- There is no drag-and-drop import.
- In browsers without the native modal dialog, my fallback traps focus and closes on Esc, but the page behind it stays reachable.

**Catalog data notes (not my files)**
- The catalog has 65 entries for 69 score files.
- The Toccata's key range shows "G#0", which is below the piano's lowest key (A0).
- One difficulty note says "(file name)", which reads like developer wording.


===== core:parser-tests =====
I finished the importer tests: 3 new test files plus a shared helper, and I fixed the parser problems they turned up. The full suite passes (24 files, 723 tests) and `npx tsc --noEmit -p tsconfig.json` exits 0.

**Files**
- Created:
  - `/Users/gapp/Desktop/Piano/tests/parser.test.ts` (91 tests)
  - `/Users/gapp/Desktop/Piano/tests/mxl.test.ts` (34 tests)
  - `/Users/gapp/Desktop/Piano/tests/parser.xmldom.test.ts` (53 tests)
  - `/Users/gapp/Desktop/Piano/tests/helpers/musicxmlSamples.ts`: small inline MusicXML documents for cases the fixtures don't cover. I didn't add files to `tests/fixtures/`.
- Modified:
  - `/Users/gapp/Desktop/Piano/src/core/xml.ts`
  - `/Users/gapp/Desktop/Piano/tests/library-parse.test.ts`: now one test per file, each starting with `await setTimeout(0)`, and the summary prints at the end.
- `mxl.ts` and the `musicxml/*` files are unchanged.

**Exported API** (unchanged)
- `parseMusicXml(xmlText: string): SourceScore` and `loadSourceScore(bytes: Uint8Array, fileName?: string): SourceScore`, from `src/core/musicxml/parse.ts`. `loadSourceScore` tells a zip from plain XML by its first bytes, not the file extension.
- `class ImportError extends Error { readonly code: ImportErrorCode; readonly detail?: string; constructor(code, message?, detail?) }`, from `src/core/xml.ts`, with `name === 'ImportError'`.
  - `message` is the plain text to show the learner. `detail` holds the technical cause and should only go to logs.
  - `ImportErrorCode` is `'not-musicxml' | 'malformed-xml' | 'bad-archive' | 'too-large' | 'no-score-in-archive' | 'unsafe-content' | 'empty-score' | 'unsupported'`.
- `xml.ts` also exports `decodeXmlBytes`, `looksLikeXml`, `rejectUnsafeXml`, `stripDoctype` and `parseXmlSafely(text): Document`.
- `src/core/mxl.ts` exports:
  - `extractMusicXmlText(bytes, fileName?, limits = MXL_LIMITS): string`. The third parameter is extra, so tests can pass small limits.
  - `isZipArchive(bytes)`
  - `interface MxlLimits { maxArchiveBytes; maxUncompressedBytes; maxEntries }`
  - `MXL_LIMITS` = 20 MB / 60 MB / 200 entries
- Internal helpers are also exported: `WarningSink`, `graceSlotTicks`, `parseEndingNumbers`, `readJumpWords`, `metronomeQpm` and others.

**Fixes in `xml.ts`**
- **Parser agreement:** xmldom silently accepted several broken files that jsdom and browsers reject: a bare `&` in text, control characters (U+0000–U+001F other than tab/LF/CR, plus U+FFFE/FFFF), unquoted attributes, and attributes without a value. All of these now raise `malformed-xml` under both parsers.
  - The first two are caught by a cheap check before parsing.
  - xmldom warnings now count as errors. The one exception is its warning about a stray U+FFFD replacement character, which is valid XML.
- **Leading whitespace:** whitespace before `<?xml` is now accepted. Both parsers used to reject it.
- **Plainer messages:** the `unsafe-content` message no longer says "XML entity declarations"; it is now "This file contains hidden extra definitions that are blocked for safety, so it cannot be opened." The missing-parser message no longer says "XML".
- None of this changes results for the 69 library files: jsdom and xmldom give identical output on all of them, and `tests/catalog.test.ts` (the reproducibility check) still passes.

**What is tested**
- **Every fixture:** exact ticks per quarter, metadata, parts, full measure objects and every note (onset, duration, midi, staff/voice, ties, grace, chord, tuplet, cross-staff, hidden, velocity), plus tempos and warning codes, severities, counts and measures. This includes:
  - the f12 enharmonic spellings and midi numbers;
  - grace time-stealing, including grace chords, the small-principal case, borrowing from the previous note before a rest, and dropped graces;
  - the dotted-quarter metronome conversion;
  - timewise output equal to the partwise equivalent;
  - `<divisions>` changing between measures and mid-measure;
  - transpose (all staves and one staff), cue notes, pickup / short / empty measures, cross-staff notes and every navigation mark;
  - f15 → `malformed-xml`, and f-entity → `unsafe-content` before the parser is even called.
- **DTD and metadata:** a spy shows the text handed to the parser has no DOCTYPE, and neither `fetch` nor `XMLHttpRequest` is called. Titles containing `<script>`, `&lt;b&gt;` or CDATA come back as literal text.
- **MXL:**
  - a valid archive via `META-INF/container.xml`;
  - fallback when the container is missing or broken;
  - truncated and corrupted archives → `bad-archive`, including a checksum-only corruption;
  - each of the three size limits → `too-large`;
  - random bytes, PDF and MIDI files, an HTML `.xml`, a Word file and an empty file → `not-musicxml`;
  - UTF-8 (with and without BOM), UTF-16LE and UTF-16BE (with and without BOM) and ISO-8859-1.
- **Rootfile pointing to a missing entry:** the importer falls back to the first `.xml`/`.musicxml` outside `META-INF/` and `__MACOSX/`. If there is none, it raises `no-score-in-archive`.
- **xmldom vs jsdom:** results are deep-equal on all fixtures, all inline samples and 6 library files: Chopin Ballade, G_Minor_Bach, The_Entertainer_-_Scott_Joplin.mxl, Ave Maria and Moonlight 1st (both tuplet-heavy), and Clair de Lune. A counter confirms xmldom really ran. Error inputs give the same codes under both.

**Where the code differs from ARCHITECTURE.md** (kept on purpose; the doc should be updated)
- **Cue notes** are skipped and warned about, but they do take up their written time, as the MusicXML standard says. The doc says they don't advance the cursor. In Prelude No. 2, La Campanella and Moonlight 3rd, cue notes are followed directly by normal notes, which would land early otherwise.
- **Direction `<offset>`** moves a tempo change even without `sound="yes"`, although the MusicXML default is not to. MuseScore uses it to place ritardando steps: for example, Clair de Lune m66 has offsets −1440 and −720. Without it, both tempos would collapse onto the barline.

**Known gaps**
- xmldom still accepts `]]>` in ordinary text; browsers reject it.
- A `<sound>`'s own `<offset>` child is ignored. No library file uses it.
- A zip whose stated sizes are false can't use extra memory, but it can keep the CPU busy for a long time before failing with `bad-archive`. *(Resolved in the fix round: entries are read from the central directory and inflated in 16 KB slices that stop once the output passes the declared size.)*
- A voice split exactly evenly between two staves gets staff 1 as its home staff. Moonlight 3rd voice 6 is a 32/32 split. *(Resolved in the fix round: MuseScore voice numbers name the staff, so voice 6 belongs to staff 2; in other files an exact tie is decided measure by measure. See `src/core/voices.ts`.)*
- Files that number voices from 1 again on the second staff (as some other notation programs may) would have their whole second staff marked cross-staff. Every library file numbers voices separately per staff, so the library isn't affected. *(Resolved in the fix round: a voice id sounding on two staves at once is treated as reused, and a staff is never left without a voice of its own.)*

**For integrators**
- Show `ImportError.message` to the learner and keep `detail` for logs.
- If parser output ever changes, regenerate the committed catalog, because `tests/catalog.test.ts` compares against it.
- On a heavily loaded machine (load average above 100 while I ran), vitest reported "Timeout calling onTaskUpdate" during long synchronous tests, which makes the run fail. I fixed this in my tests by giving the event loop a turn between library files. The catalog test's long regeneration step may need the same treatment; that file belongs to its owner, so I left it alone.


===== app:practice-ui =====
The practice screen is built and works end to end against the real engine, services, loader, storage and common components. `npx tsc --noEmit -p tsconfig.json` exits 0 for the whole tree, and the full suite (27 files, 758 tests) passes.

I also checked it in a browser at 1280×760 with the real Bach Minuet, Debussy Arabesque and a narrow 800px window. I used Listen and Steady playback, both hands and one hand, passage selects, the measure-label menu, More, About and Help. I rendered the keyboard on its own with a split key, wrong keys, physical dots and the pedal chip. The MIDI flow was tested only with a fake in jsdom: no hardware, and I didn't click Connect piano in the browser, to avoid a permission prompt.

## Files (all under /Users/gapp/Desktop/Piano)
- **practice:** `src/ui/practice/` holds `PracticePage.tsx`, `ControlsBar.tsx`, `ConnectPiano.tsx`, `MoreMenu.tsx`, `DiagnosticsDialog.tsx`, `StatusLine.tsx`, `Segmented.tsx` and `Icons.tsx`. Its pure or hook modules are `settings.ts`, `shortcuts.ts`, `midiConnection.ts`, `text.ts` and `diagnostics.ts`, styled by `practice.css`.
- **notation:** `src/ui/notation/` holds `Token.tsx`, `Cell.tsx` and `Timeline.tsx`, with pure modules `labels.ts`, `timelineWindow.ts` and `timelineLayout.ts`, styled by `notation.css`.
- **keyboard:** `src/ui/keyboard/` holds `Keyboard.tsx`, `layout.ts`, `highlight.ts` and `useElementWidth.ts`, styled by `keyboard.css`.
- **help:** `src/ui/help/HelpDialog.tsx`.
- **tests:** the three assigned files (`keyboard.layout`, `timeline.window`, `notation.render`) plus three of my own: `keyboard.render`, `practice.helpers` and `practice.page`.

## Exported APIs
- `PracticePage({ pieceId })` and `HelpDialog({ open, onClose })`, exactly as in APP_CONTRACTS.
- `Token({ hand, token })`, `Cell({ hand, cell })`, and `Timeline({ sequence, measures, stepIndex, getPosition, onSeek, onPassageStart, onPassageEnd, colWidth?, emptyMessage? })`.
- `Keyboard({ frameKeys, labelKeys, expected, struck, physicalDown, wrong, pedalDown, hands, showPhysical, showWrong, fitWholePiece, onFitChange })`.
- `visibleRange(position, viewportWidth, colWidth, markerFraction, total, overscan)`, plus `stripOffset` and `snapPosition`.
- `computeKeyboardRange(usedKeys, opts?)` returns `{ low, high, outOfRange, hasOutOfRange }`; `keyLayout(range, width, opts?)` returns rectangles for every key.

## What is tested (81 tests)
- **Keyboard math:** C4 position, offsets for C#/D#/F#/G#/A#, white edges, two-octave minimum, clamping to A0–C8, and keys beyond the piano reported rather than clamped.
- **Timeline math:** window and strip offset, row heights, measure starts.
- **Token and Cell rendering:** colour per action, filled dot vs hollow circle, rest and hold glyphs, carried title, and every aria-label.
- **Keyboard rendering:** purple/green fills, the diagonal split, R/L letters, physical dots, the amber wrong-key outline and ✕, the pedal chip, the legend, and that the framing does not move when highlights change.
- **Page smoke tests** (real engine and a real score, with fake MIDI and sampler):
  - loading and error states;
  - stepping with buttons and arrow keys;
  - settings and position saved and restored;
  - session disposed on unmount;
  - Follow me disabled until a piano connects, then the no-devices → retry → connected flow;
  - shortcuts ignored while a dialog is open.

## Deviations
- **Tooltip and status text:**
  - Follow me's tooltip and status messages use plain sentences.
  - Token aria-labels read sharps as "C sharp 4"; naturals match the spec exactly ("Right hand: press C4").
- **Connected dot:** it is green (#16a34a). It is not a hand or notation colour, but say so if you want a neutral colour.
- **Unsupported browser:** that notice offers Dismiss instead of Try again, since retrying cannot help there. The other failure states all have Try again.
- **Saved Follow me:** a piece saved in Follow me reopens in Listen if no piano is connected yet.
- **Whole piece fit:** it frames every key the piece uses, in both hands, so it stays steady across hand changes.
- **Extras:**
  - a Reset link next to Speed;
  - a status hint in Follow me: "Press Start, then play the keys shown in colour."
  - Count-in is disabled in Follow me.
- **Spacing:** the layout was tightened to fit a 1280×800 laptop:
  - white keys are 180px tall, the minimum allowed;
  - the status bar sticks to the bottom of the window.

On a real ~690px-tall browser window, the bar covers the keyboard's fit/legend row until you scroll slightly.

## Known gaps
- **Untested on hardware:** physical MIDI, and Follow me against a real piano.
- **Carried tokens:** their dotted underline was checked only in tests, not in the browser, because I didn't find a passage in the test pieces that starts on a held note.
- **Very wide pieces:** black-key labels get small (about 8px, on two lines) when the keyboard shows 50 or more white keys. "Fit: Passage" avoids this.

## For integrators
- `HelpDialog` imports `practice.css` and `notation.css`; every rule in them is class-scoped.
- The page leaves the document title and `lastPieceId` to `App.tsx`.
- Transport buttons and timeline columns don't take focus on mouse clicks, and they release focus from form fields, so Space and the arrows keep working after clicking. *(Since the fix round this covers all pointer use: every button, radio, switch, slider and select lets go of focus after a mouse or touch change, via `src/ui/common/pointerFocus.ts`.)*


===== core:e2e-integrate =====
The core pipeline now checks out end to end on all 20 fixtures and all 69 library files, after I fixed four problems in `src/core`. The core suite passes (17 files, 598 tests) and `npx tsc --noEmit -p tsconfig.json` exits 0.

**Action needed:** `src/catalog/catalog.json` and `catalog/inventory.json` must be regenerated with `npm run catalog`. Until then the reproducibility test in `tests/catalog.test.ts` will fail. I did not run that test (outside my allowed set), but a dry run of `generateCatalog` showed 16 entries change, for example:
- Fur_Elise: 114 → 127 measures played, 141.2 → 157.5 s.
- moonlight_sonata_3rd_movement: 6479 → 6450 notes.
- K.545: 2748 → 2732 notes.
- Five entries lose the note "Trills and other ornaments are played as the main note".
- Two similarity percentages move: 95.5% → 95.7%.

## Files
- **Created:**
  - `/Users/gapp/Desktop/Piano/tests/e2e.fixtures.test.ts` (46 tests)
  - `/Users/gapp/Desktop/Piano/tests/e2e.library.test.ts` (97 tests, about 15 s; parsing all 69 files through the pipeline takes about 14 s)
  - `/Users/gapp/Desktop/Piano/tests/e2e.regressions.test.ts` (16 tests)
- **Modified:** `src/core/model/performance.ts`, `src/core/model/physical.ts`, `src/core/musicxml/parse.ts`, `src/core/musicxml/part.ts`.
- **APIs:** no exported signature changed. The internal `DraftNote` in `part.ts` gained two fields, `muted` and `ornament`.

## Bugs fixed
Each fix has a regression test, and each of those tests fails against the old code.
1. **Open ending brackets (Fur_Elise.mxl).** Measure 9's 2nd-ending bracket is never closed in the file, so it swallowed the repeat at measures 10–23. It played 0-8, 0-7, 9-105; it now plays 0-8, 0-7, 9-23, 10-22, 24-105, the same as Fur_Elise_fingered. An unclosed bracket now ends just before a forward repeat sign or at a backward repeat. A 1st ending with no 2nd ending used to skip the rest of the piece; that is fixed too.
2. **Ties across a short gap.** These are tied broken chords ("let ring"), ties across `<forward>` gaps, and small rounding gaps. They used to be struck again: 29 times in moonlight_sonata_3rd_movement measures 164–167, 8 in Prelude No. 2, plus a few in other files. A tie now bridges a gap of at most one quarter note, on the same voice or staff, only within the same or the next measure in written order. Any new strike of that key cancels the bridge.
   - Library-wide, unmatched ties dropped from 47 to 5, all of them broken tie markup in the files (Nocturne in C# minor 3, Schubert Serenade 2).
3. **Trills written out with hidden notes were doubled.** Example: K.545 measure 4 struck F5 and G5 together, then overlapped them. A visible note is now left out when hidden notes on the same staff sound during its time and either the visible note is silenced (`dynamics="0"`) or it carries the ornament sign and the hidden notes include its pitch. A tied continuation still covered by the hidden notes is left out as well.
   - A new info warning (code `other`) says: "Where the file spells out a trill or other ornament with hidden notes, those notes are played in place of the main note shown."
   - The "played as main note only" warning (`ornament-not-played`) now fires only for ornament notes that are actually kept.
   - Same-key voice overlaps dropped: K.545 96 → 0, Nocturne No. 20 96 → 0, La Campanella 32 → 10.
4. **Same-key overlap warnings listed measures out of order** (for example "60, 62, 15, 17"). They are now listed in playing order.

## Not in ARCHITECTURE.md yet
Fixes 1–3 above go beyond what ARCHITECTURE.md describes; the doc should be updated. In addition, the "played as main note only" warning is now emitted after parsing, so its position in `SourceScore.warnings` moved. Nothing in the tests depends on that order.

## What is tested
- **Every fixture** (except the two broken-input ones), for both hands, right only and left only:
  - the full piece, every single measure occurrence, every adjacent pair, and occurrences 1 to the end;
  - the independent round trip passes; no step is empty; Listen times strictly increase;
  - each hand's steps are exactly its own press start/end points, and the both-hands steps are their union.
- **Fixture spot assertions:**
  - Exact cells: f01, f02, f03, f04 (plus 1 s per step at quarter = 60), f05, f06, f07, f09 (plus a 6 s passage), f10 (carried C2 at step 0), f-grace, f-backup-forward, f-timewise.
  - Exact step positions: f08, plus the right-only and left-only sets.
  - f12 labels; f14 ossia left out with no duplicates; f-repeats-endings and f-dc-al-fine orders and labels; f-two-parts-hands R/L; f-single-staff needs review; f-tempo-changes Listen times.
- **Broken input:**
  - f15 → `malformed-xml`, f-entity → `unsafe-content`.
  - A truncated .mxl and a damaged .mxl both → `bad-archive`.
  - A valid .mxl gives the same steps as the plain file.
- **All 69 library files:**
  - Both hands, right only and left only on the full piece, plus 3 seeded random passages each, all round-trip.
  - Hand mapping, playing order, readiness counts, warning wording, ties and tempo sources are pinned (details below).

## Library checks
- **Readiness:** 49 ready, 20 need review, 0 unsupported.
  - 16 files need review only because of cross-staff notes.
  - G_Minor_Bach needs review only because its ornament part was left out automatically.
  - Bach Toccata and Mariage d'Amour also have notes outside the 88 keys; Chopin Ballade also has its ossia part left out.
- **Warnings:**
  - Every cross-staff warning lists its measures, and every warning message passes a plain-language check.
  - Grace notes, ornaments, rolled chords and pedal are always information only.
  - I did not reword the cross-staff message ("Check which hand should play them"); `tests/parser.test.ts` and `tests/model.prepare.test.ts`, which I don't own, assert the exact text. It could now also say the app gives these notes to the hand of the line they belong to. *(Resolved in the fix round: the message now says the app gives them to the hand of the musical line they belong to, and to check those measures if a hand feels wrong.)*
- **Hand mapping, with no overrides passed:**
  - Chopin Ballade leaves out P2 and G_Minor_Bach leaves out P1.
  - The Entertainer and the Schubert Serenade map P1 to the right hand and P2 to the left.
  - Every other file is one two-staff piano part.
- **Playing order, compared with the files' barlines:**
  - Bella_Ciao, DANSE_VILLAGEOISE, Maple Leaf Rag, both Für Elise editions, Canon in D (easy), Gymnopédie and Moonlight 3rd all match.
  - Hungarian_Sonata plays 1-31, then 10-14 after the D.S., then 32-49 from the coda.
  - No file falls back to written order, and none plays more than twice its written length (Twinkle is the largest at 325 → 635).
- **Tempo:** a default tempo is used in only 6 files, and each has no tempo mark at all.
- **First 3–4 measures, checked note by note against the XML:**
  - Ode to Joy: melody B4 B4 C5 D5, left hand holds G3-B3-D4, quarter = 140.
  - Für Elise (easy): E5 D#5 after a half rest, then the A minor arpeggio; no tempo in the file.
  - Minuet in G: D5 over a G chord, the eighth-note run, the repeated G4, quarter = 126.
  - Happy Birthday: G G A G with the left-hand chord entering on beat 2.
  - Canon in D (easy): left-hand eighth-note bass pattern only, quarter = 100.

## Remaining limitations
- Hidden notes always sound, as ARCHITECTURE specifies, even when they add pitches not shown in the score (for example Prelude No. 2's hidden arpeggio chords).
- Notes silenced with `dynamics="0"` but not covered by hidden notes are still played (The Entertainer measures 38 and 92, Turkish March fingered measures 24 and 94).
- Very close steps (1/24 of a quarter or less) come from cross-rhythms or tuplet rounding in the files themselves (Ave Maria, Nocturne No. 20 measure 58, Ballade measure 253).
- A tie whose stop is in a different voice and on a different staff from its start is still not joined.

## Per-file summary
Abbreviations: "(R)" = needs review; XSTAFF = cross-staff notes; overlap = same-key voices; hidden-orn = main note replaced by its hidden written-out ornament; len = measure length differs from the time signature; ALT-EXCL = alternative part left out; RANGE = notes outside the 88 keys; tie-unm = unmatched tie; orn = ornament played as main note; arp = rolled chord played as a block chord; cue = cue notes skipped; 2-parts = hands taken from two separate parts.

| File | Readiness | Measures written→played | Presses | Steps (both) | Seconds | Tempo | Warnings |
|---|---|---|---|---|---|---|---|
| 12_Variations_of_Twinkle | ready | 325→635 | 6133 | 4017 | 688.5 | file | orn×21 |
| Arabesque | review | 107→107 | 1455 | 1021 | 214.7 | file | pedal×105 XSTAFF(R)×26 overlap×8 |
| Ave_Maria | ready | 17→30 | 1077 | 756 | 190.8 | file | pedal×61 grace×3 overlap×12 |
| Bach_Minuet_Anh.114 | ready | 32→64 | 408 | 275 | 91.4 | file | - |
| Bach_Toccata | review | 143→143 | 4107 | 2456 | 431.7 | file | pedal×13 grace×2 arp×20 RANGE(R)×1 XSTAFF(R)×29 overlap×6 |
| Beethoven_5 | review | 504→504 | 4266 | 1478 | 392.7 | file | pedal×110 len×1 XSTAFF(R)×6 |
| Bella_Ciao | ready | 38→59 | 1203 | 462 | 117.0 | default | len×1 no-tempo×1 |
| Bella_Ciao_Casa_de_Papel | ready | 74→74 | 1291 | 563 | 131.0 | file | grace×6 len×1 orn×1 |
| Canon_in_D | ready | 102→102 | 1589 | 919 | 244.8 | file | arp×4 |
| Canon_in_D_3 | ready | 53→53 | 765 | 470 | 182.9 | file | pedal×57 grace×1 arp×3 |
| Canon_in_D_easy | ready | 49→53 | 471 | 371 | 127.2 | file | - |
| Carol_of_the_Bells | ready | 65→120 | 1264 | 654 | 121.0 | file | pedal×19 arp×4 |
| Carol_of_the_Bells_easy | ready | 40→40 | 186 | 156 | 60.0 | default | no-tempo×1 |
| Chopin_Ballade_1 | review | 262→262 | 5010 | 2607 | 659.5 | file | pedal×250 arp×29 grace×28 cue×2 len×3 orn×4 XSTAFF(R)×126 ALT-EXCL(R)×1 overlap×9 |
| Chopin_Nocturne_9_1 | review | 86→86 | 1731 | 1150 | 270.9 | file | pedal×164 grace×11 arp×5 len×2 hidden-orn×2 XSTAFF(R)×5 |
| Chopin_Nocturne_9_2 | ready | 38→38 | 1246 | 572 | 213.8 | file | pedal×6 grace×15 len×2 orn×8 |
| Chopin_Spring_Waltz | ready | 84→84 | 1636 | 1115 | 279.2 | file | pedal×83 grace×4 arp×6 orn×4 |
| Clair_de_Lune__Debussy | review | 72→72 | 1517 | 788 | 275.7 | file | pedal×118 grace×1 arp×78 len×1 XSTAFF(R)×124 overlap×21 |
| Clair_de_lune_-_Debussy | review | 72→72 | 1510 | 780 | 254.3 | file | pedal×65 grace×1 arp×49 XSTAFF(R)×146 overlap×13 |
| DANSE_VILLAGEOISE | ready | 61→97 | 1040 | 551 | 96.3 | file | len×1 |
| Sugar_plum_fairy | ready | 53→53 | 1098 | 494 | 90.9 | file | arp×4 |
| Satie_Gymnopedie_1 | ready | 47→78 | 455 | 189 | 184.7 | file | overlap×8 |
| Flight_of_the_Bumblebee | ready | 101→101 | 1134 | 786 | 84.2 | file | arp×46 |
| Fur_Elise | ready | 106→127 | 1040 | 788 | 157.5 | file | pedal×47 grace×3 len×1 |
| Fur_Elise_beginner | ready | 24→32 | 199 | 178 | 51.5 | file | pedal×15 len×1 |
| Fur_Elise_Easy_Piano | ready | 22→22 | 104 | 103 | 33.0 | default | no-tempo×1 |
| Fur_Elise_fingered | ready | 106→127 | 1042 | 789 | 191.2 | file | pedal×85 grace×3 |
| G_Minor_Bach | review | 66→66 | 1804 | 989 | 158.4 | file | grace×6 ALT-EXCL(R)×1 |
| G_Minor_Bach_Original | ready | 66→66 | 1804 | 994 | 175.1 | file | pedal×128 arp×2 grace×5 |
| Gnossienne_1 | ready | 11→11 | 836 | 415 | 190.6 | file | grace×100 |
| Greensleeves | ready | 33→33 | 172 | 112 | 48.5 | file | pedal×30 len×1 |
| Gymnopdie_1__Satie | ready | 78→78 | 455 | 189 | 262.5 | file | - |
| Happy_Birthday_C_Major | ready | 8→8 | 52 | 26 | 12.0 | default | no-tempo×1 |
| Happy_Birthday_Piano | ready | 20→20 | 145 | 62 | 28.5 | default | arp×8 len×1 no-tempo×1 |
| Hungarian_Dance_5 | ready | 102→142 | 1720 | 673 | 162.5 | file | arp×4 grace×2 |
| Hungarian_Sonata | ready | 49→54 | 1117 | 670 | 197.5 | file | pedal×47 |
| Air_on_the_G_String | ready | 37→72 | 877 | 436 | 261.8 | file | grace×1 overlap×4 |
| La_Campanella | review | 150→150 | 4153 | 2271 | 270.3 | file | pedal×118 arp×70 grace×13 cue×2 len×6 hidden-orn×5 orn×2 XSTAFF(R)×115 overlap×10 |
| Lacrimosa | ready | 32→32 | 694 | 350 | 180.0 | file | - |
| Liebestraum_3 | review | 88→88 | 1889 | 1065 | 230.3 | file | pedal×81 arp×73 len×5 XSTAFF(R)×4 overlap×3 |
| Maple_Leaf_Rag | ready | 85→145 | 2568 | 1012 | 173.1 | file | - |
| Mariage_dAmour | review | 83→83 | 1631 | 1117 | 226.4 | file | grace×5 arp×8 orn×4 RANGE(R)×3 XSTAFF(R)×47 overlap×1 |
| Minuet_in_G_Major_Bach | ready | 32→64 | 408 | 277 | 96.0 | default | grace×1 cue×2 orn×5 no-tempo×1 |
| Mozart_Sonata_16_Allegro | review | 73→146 | 2562 | 2010 | 265.5 | file | grace×11 orn×8 XSTAFF(R)×20 |
| Nocturne_20_C_Minor | review | 65→65 | 1000 | 775 | 263.3 | file | pedal×108 grace×8 hidden-orn×10 XSTAFF(R)×10 |
| Nocturne_C_sharp_Minor | ready | 65→65 | 820 | 621 | 233.1 | file | pedal×88 grace×21 len×3 orn×8 tie-unm×3 |
| Nocturne_9_2_Easy | ready | 65→65 | 482 | 242 | 105.3 | file | grace×6 len×1 |
| Ode_to_Joy_Easy | ready | 17→17 | 123 | 63 | 29.1 | file | - |
| Passacaglia | ready | 74→74 | 1030 | 583 | 136.6 | file | pedal×73 |
| Passacaglia2 | ready | 74→74 | 1030 | 583 | 136.6 | file | pedal×3 |
| Rondo_alla_Turca | ready | 137→241 | 2812 | 1511 | 223.5 | file | grace×189 cue×12 arp×30 len×17 |
| Prelude_I_C_major_BWV_846 | ready | 34→34 | 533 | 530 | 119.1 | file | - |
| Prelude_No._2_BWV_847 | review | 38→38 | 1095 | 622 | 73.2 | file | pedal×2 arp×10 cue×6 hidden-orn×2 XSTAFF(R)×98 overlap×1 |
| Prlude_No._4_Op._28 | ready | 26→26 | 604 | 196 | 121.2 | file | pedal×50 grace×2 |
| Prlude_Opus_28_No._4 | review | 26→26 | 604 | 196 | 155.4 | file | grace×2 pedal×2 XSTAFF(R)×4 |
| Schubert_Serenade | ready | 115→115 | 2421 | 921 | 356.9 | file | grace×46 arp×47 len×2 2-parts×1 tie-unm×2 |
| Sonata_16_K._545 | ready | 73→146 | 2732 | 2102 | 265.5 | file | hidden-orn×8 orn×1 |
| Moonlight_1st | review | 69→69 | 1144 | 824 | 376.4 | file | XSTAFF(R)×293 overlap×3 |
| Moonlight_3rd | review | 201→264 | 6417 | 3663 | 405.6 | file | pedal×42 grace×47 cue×84 len×1 orn×6 XSTAFF(R)×320 |
| Pathetique_2nd | ready | 73→73 | 1639 | 751 | 278.1 | file | grace×6 hidden-orn×3 overlap×1 |
| Spring_Waltz_Mariage_dAmour | ready | 84→84 | 1643 | 1122 | 264.0 | file | pedal×157 grace×13 arp×6 |
| Swan_Lake | ready | 32→32 | 326 | 212 | 76.8 | file | - |
| The_Entertainer | ready | 92→152 | 1997 | 978 | 260.6 | file | 2-parts×1 |
| The_Entertainer_1902 | review | 92→152 | 2626 | 978 | 304.0 | file | XSTAFF(R)×13 |
| Turkish_March_fingered | ready | 137→241 | 2812 | 1511 | 223.5 | file | grace×189 arp×24 len×17 |
| Waltz_Op_64_No_2 | review | 194→194 | 1864 | 1007 | 223.4 | file | pedal×146 grace×19 len×2 hidden-orn×3 XSTAFF(R)×35 |
| Waltz_in_A_Minor | ready | 57→81 | 920 | 426 | 120.5 | file | pedal×61 grace×24 len×1 orn×4 |
| Waltz_of_the_Flowers | ready | 80→92 | 918 | 385 | 90.5 | file | - |
| moonlight_sonata_3rd_movement | review | 201→264 | 6450 | 3699 | 375.9 | file | pedal×3 grace×86 XSTAFF(R)×168 |


===== app:integrate =====
Integration is done. TypeScript typecheck is clean, all 925 tests pass in 31 files, and `npm run build` succeeds. The only fix needed was regenerating the committed catalog. I found no mismatches between the UI code and the engine, loader or storage, so no source file changed. Nothing was tested in a real browser or with MIDI hardware: all checks were jsdom, curl and code reading.

**1. What I fixed**
- The one failing test was the catalog reproducibility check in `tests/catalog.test.ts`. The committed catalog was out of date after the core-pipeline fixes.
- I ran `npm run catalog`, which rewrote three generated files:
  - `/Users/gapp/Desktop/Piano/src/catalog/catalog.json`: 14 entries changed (note counts, lengths, played measures, and the "Trills and other ornaments are played as the main note" note); the ids are unchanged.
  - `/Users/gapp/Desktop/Piano/catalog/inventory.json`
  - `/Users/gapp/Desktop/Piano/docs/CATALOG_REPORT.md`: the G minor Bach similarity is now 95.7%.
- The totals are the same: 65 entries (47 ready, 18 needing review), 4 duplicates.
- The UI tests showed no React warnings.

**2. Final test count:** 925 tests in 31 files. That is the previous 918, all passing now, plus 7 new ones.

**3. New smoke test:** `/Users/gapp/Desktop/Piano/tests/app.smoke.test.ts` (7 tests, about 0.8 s, passed 3 runs in a row).
- **Setup:** it renders `<App/>` inside StrictMode, as `main.tsx` does. Saved data is held in memory, and the audio and MIDI services are fakes (one test uses the real ones). Built-in scores are served from `public/` through a stubbed `fetch`, so the real loader, parser and preparer run.
- **Library:**
  - every catalog entry appears as a card linking to `#/piece/<id>` with the right title, and the heading shows "65 pieces";
  - the Beginner chip and accent- and case-insensitive search filter correctly, the "No pieces match." state appears, and "Clear search and filters" restores the list;
  - an unknown route is rewritten to `#/`.
- **Practice page with a mocked score (the brief's §6 worked example):**
  - the header, controls, mode note, passage hint, keyboard with "Middle C", and "Step 1 of 5" all render;
  - the R row is above the L row;
  - every token's accessible label matches the spec: press, add, release in highest-first order, and rest. The add token has the filled dot and the release token the hollow ring;
  - Next step moves the marker.
- **Real built-in piece (Ode to Joy):**
  - it is fetched from `…/scores/Ode_to_Joy_Easy_variation.mxl`, and the title, arrangement, "Beginner · per score" badge and page title are correct;
  - the first column is right hand B4 over a left-hand D4/B3/G3 chord, and choosing Right hand hides the L row;
  - going back to the library disposes the session and shows "Continue: Ode to Joy" with the saved settings;
  - an unknown piece shows a plain message and a "Back to library" link.
- **Real services, in jsdom (which has no browser sound or Web MIDI):**
  - Follow me stays disabled with the exact tooltip;
  - Connect piano shows "This browser can't connect to a MIDI piano…";
  - Play runs silently with the "Browser sound could not start" message, and Pause works.

**4. Build output size:** `dist/` is 10 MB in total.

| File or folder | Size |
|---|---|
| JS | 450 kB (132 kB gzip), plus a 1.67 MB source map |
| CSS | 34 kB (7.5 kB gzip) |
| `index.html` | 1.4 kB |
| `audio/` | 6.5 MB (34 files; the app uses 30) |
| `scores/` | 1.7 MB |

The XML library used by the test scripts is not in the bundle.

**5. Subpath check:**
- `dist/index.html` has no src or href starting with "/"; the assets are `./assets/…`. The built JS and CSS contain no absolute paths.
- Score files load from `BASE_URL + entry.file` and piano samples from `BASE_URL + audio/piano/`; the build's `BASE_URL` is `./`.
- I copied `dist` to `/tmp/pages/piano-steps` and served it with a small Node static server on port 4179:
  - `/piano-steps/` returned index.html (200), and its JS and CSS returned 200;
  - `/piano-steps/scores/Ode_to_Joy_Easy_variation.mxl` returned 200;
  - the sample is `C4v8.mp3`, not `.mxl` as the task said; `/piano-steps/audio/piano/C4v8.mp3` returned 200;
  - all 30 samples the app uses and all 65 catalog scores, fetched through the subpath, returned 200;
  - `/piano-steps` without the slash redirects 301 to `/piano-steps/`, as GitHub Pages does.
- Refreshing a nested route works because routing is in the hash (`#/piece/<id>`), which never reaches the server.
- I stopped the server and deleted the temporary files.

**6. UI_SPEC check (code reading):** every item checked is compliant, so I made no UI changes.
- **Colours:** the theme matches the spec table, the hand colours are only used for hands and the keyboard, red and blue only for notation, and amber for wrong keys and "needs review".
- **Notation:** R is above L, the tabs have accessible names, all token and cell labels match, columns are 72 px with the marker at 28%, and only the visible columns ±20 are rendered.
- **Keyboard:** 180 px white keys, the Middle C marker, the split key for both hands, the R/L letters, the pedal chip and the legend are all there.
- **Help:** it covers the five instructions with live examples, the §6 worked example, the three modes, MIDI and browser support, shortcuts and storage.
- **About & credits:** MIT notices, the piano-sound credit, library origin and per-piece rights notes.
- **About this arrangement:** every field the spec lists.
- **Text and accessibility:** status and error texts and the mode notes match the spec, and controls have accessible names and visible focus rings.

**Still missing or worth deciding:**
- There is no README, which the brief lists as a deliverable. No module owns it, and I did not write one.
- The "connected" piano dot is green (#16a34a), close to the left-hand green. The spec allows it; I left it.
- "About this arrangement" shows the curated hand-setting reasons with internal part names (P1, P2) and a file name. It is a details panel, not a practice screen, but the wording in `catalog/metadata.json` could be made plainer. *(Fixed later: the reasons and difficulty notes were reworded in plain language, the technical detail moved to `overrides.evidence`, and `npm run catalog` now reports part ids or file names in any text the app shows.)*
- The Toccata's card shows a key range starting at "G#0", below the piano's lowest key. That piece is already marked as needing review for it.
- Other engineers' open items are unchanged: no drag-and-drop import, and in browsers without a native dialog the page behind a dialog stays reachable.
- **Before publishing:** test in a real browser and with a real MIDI piano.
