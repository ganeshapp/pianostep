# Application-layer contracts (engine, storage, catalog, UI)

These complement `ARCHITECTURE.md` (core) and `UI_SPEC.md` (visual and UX
rules). Several engineers build these modules concurrently, so implement the
signatures exactly. Additive optional fields are fine.

## Engine — `src/engine/session.ts` (owner: engine)

```ts
import type { PreparedScore, PracticeSettings, StepSequence, Hand, MidiInputEvent } from '../core/types';
import type { AudioState } from '../audio/sampler';
import type { MidiState } from '../midi/manager';

export type SessionStatus = 'stopped' | 'count-in' | 'playing' | 'paused' | 'waiting' | 'finished';

export interface SessionSnapshot {
  status: SessionStatus;
  settings: PracticeSettings;
  sequence: StepSequence;
  /** Marker step (0..stepCount-1); 0 when stepCount === 0. */
  stepIndex: number;
  stepCount: number;
  /** Label of the marker step's measure occurrence, e.g. "12 (2nd time)". */
  measureLabel: string;
  /** heldAfter of the marker step for included hands ([] for excluded hands). */
  expected: Record<Hand, number[]>;
  /** attacks of the marker step ("press now"). */
  struck: Record<Hand, number[]>;
  /** Physical MIDI input state — never includes app playback. */
  physicalDown: number[];
  pedalDown: boolean;
  /** Follow me only. */
  wrong: number[];
  waitingFor: number[];
  countInRemaining: number | null;
  audioState: AudioState;
  midiState: MidiState;
  /** Null while a remembered piano has not turned up (see midiInputNotFound). */
  midiInputName: string | null;
  midiInputConnected: boolean;
  /**
   * MIDI is ready and the selected input is a piano remembered from an
   * earlier visit that has not turned up this session (`midi.inputSeen`
   * false): the status line says "MIDI: no piano found", never "disconnected".
   */
  midiInputNotFound: boolean;
  /** Plain-language transient message (e.g. "Piano disconnected — playback paused"). */
  message: string | null;
}

export interface SamplerLike {
  readonly state: AudioState;
  readonly currentTime: number;
  ensureStarted(): Promise<void>;
  onStateChange(fn: (s: AudioState) => void): () => void;
  /**
   * `owner` (default 'app') keeps the learner's monitored notes ('input')
   * and the app's playback apart: a strike or release by one never ends the
   * other's voice on the same key. allNotesOff silences both.
   */
  noteOn(midi: number, velocity?: number, when?: number, owner?: 'app' | 'input'): void;
  noteOff(midi: number, when?: number, owner?: 'app' | 'input'): void;
  allNotesOff(fadeSec?: number): void;
  click(when: number, accent?: boolean): void;
}

export interface MidiLike {
  readonly state: MidiState;
  readonly selectedInputId: string | null;
  readonly selectedOutputId: string | null;
  readonly inputConnected: boolean;
  /**
   * False while the selected input has not been connected at all this
   * session (a piano remembered from an earlier visit that is still off).
   * Absent means unknown, treated as seen.
   */
  readonly inputSeen?: boolean;
  inputs(): { id: string; name: string; connected: boolean }[];
  onEvent(fn: (ev: MidiInputEvent) => void): () => void;
  onChange(fn: () => void): () => void;
  /** `rememberedName`: the saved device's name, so it is found again under a new id. */
  selectOutput(id: string | null, rememberedName?: string | null): void;
  sendNoteOn(midi: number, velocity: number, atMs?: number): void;
  sendNoteOff(midi: number, atMs?: number): void;
  allNotesOff(): void;
}

export interface SessionDeps {
  sampler: SamplerLike;
  midi: MidiLike;
  /** Injected for tests; default performance.now(). */
  nowMs?: () => number;
  /** Injected for tests; default window.setInterval / clearInterval. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Where 'pagehide' is listened for. Default `window` when present; null disables it. */
  pageEvents?: { addEventListener(type: 'pagehide', fn: () => void): void; removeEventListener(type: 'pagehide', fn: () => void): void } | null;
  /** The output name saved in the global prefs (`midiOutputName`), passed on with `settings.midiOutputId`. */
  midiOutputName?: string | null;
}

export class PracticeSession {
  constructor(score: PreparedScore, settings: PracticeSettings, deps: SessionDeps);
  subscribe(fn: () => void): () => void;
  /** Stable identity until something changes (for useSyncExternalStore). */
  getSnapshot(): SessionSnapshot;
  /** Fractional step index for smooth scrolling; read every animation frame. */
  getVisualPosition(): number;
  updateSettings(patch: Partial<PracticeSettings>): void;
  /** Call from a user gesture. Starts audio when needed, then plays (Listen/Steady) or waits for input (Follow). */
  play(): Promise<void>;
  pause(): void;
  /** Pause and return to the passage start. */
  stop(): void;
  togglePlay(): void;
  /** Go to step 0. If playing, keep playing from there. */
  restart(): void;
  next(): void;
  prev(): void;
  seek(stepIndex: number): void;
  dispose(): void;
}
```

### Behaviour

- **Sequence.** It is `deriveSteps(score, handsOf(settings.hands), settings.range)`.
  Recompute it when `hands` or `range` change. On recompute, keep the marker at
  the first step with `tick ≥` the old marker tick, or 0. Recomputing stops
  playback.
- **Clock.**
  - With sound on, time comes from `sampler.currentTime`.
  - In silent modes it comes from `nowMs() / 1000`.
  - Scheduling uses a lookahead loop: every 25 ms it hands the browser
    sampler the events due within the next 150 ms. MIDI output has its own
    cursor and a 40 ms lookahead (`MIDI_LOOKAHEAD_SEC`), shorter than the
    50 ms start lead, because Chrome and Edge cannot withdraw a queued
    message. A new run starts after anything still queued on the output.
    Without a count-in, the run's first strike (and the keys held at the
    start point) goes to the MIDI output as soon as the run starts, timed for
    the end of the start lead. Later MIDI messages tolerate about 15–40 ms of
    main-thread stall, browser sound about 125 ms.
  - Silent playback moves onto the audio clock in place once browser audio
    has started (`ensureStarted()` resolved): nothing is released, there is
    no start lead, and nothing is struck again on the MIDI output.
  - The sampler is shared across pages, so a new session may find it in
    `'error'` (some samples failed to load on an earlier page; the fallback
    voice still plays). The learner's gestures that need sound (a preview
    with Sound on, "Hear my playing" on, Sound or Count-in on during
    playback) call `ensureStarted()` from `'not-started'` or `'error'`, which
    retries the load. A run already on the audio clock stays there when the
    sampler goes to `'error'`; it is not moved to wall time and silenced.
  - The scheduler moves past each event before handing it to the sampler and
    skips an event the sampler throws on, so one bad event never stalls a run.
  - Rendering is decoupled from the clock.
- **Listen.**
  - Times: `listenStepTimes(seq, score.tempo, speed)`. The passage length is
    `passageDurationListen`, which includes trailing rests.
  - Events: one note-on at each press start and one note-off at each press end
    of `seq.presses`, with velocity `press.velocity ?? 80`. At equal times,
    note-offs go before note-ons.
  - Starting or seeking at step *k* re-sounds the presses with
    `start < tick_k < end` at the moment playback starts. These are the keys
    already held at that point.
- **Listen and Steady: Play from the end.** `play()` from a marker where
  nothing is left to sound (the closing release, the trailing rest, or a
  finished passage) starts at step 0, with the count-in if it is on. A marker
  on a release-only step while a key is still held resumes there.
- **Steady steps.**
  - Times: `steadyStepTimes(seq, stepSeconds)`. A press sounds from the time
    of the step where it starts to the time of the step where it ends.
  - The passage lasts `steps.length * stepSeconds`.
- **Follow me.**
  - `play()` sets status to `waiting` and starts a `FollowMatcher` at the
    marker step. Matcher advances move the marker.
  - When the matcher reports finished, the status becomes `finished`. With loop
    on, the engine restarts at step 0 after 1 s. During that gap, `play()`
    (and the play button) restarts at step 0 at once; Start after a pause or
    a disconnect in the gap also begins at step 0.
  - `next`/`prev` skip steps with nothing to strike for the included hands
    (release-only steps, and steps whose only notes are beyond A0–C8), in the
    direction of travel, because the matcher never waits on them.
  - Requires `midi.inputConnected`. Otherwise `play()` sets a message and does
    nothing.
  - Browser sound for input plays only when `monitorInput` is on.
  - App playback never reaches the matcher.
- **Physical input.**
  - The engine subscribes to `midi.onEvent` in *all* modes and tracks
    `physicalDown` and `pedalDown` for display. The sustain pedal never adds to
    `physicalDown`.
  - With `monitorInput` on, input note-on and note-off events go to the
    sampler immediately, with owner `'input'`: they are separate voices from
    the app's playback, so the learner holding a key past the app's release,
    or tapping a key the app is playing, never cuts the other's sound, and
    key-up, pedal-up or turning `monitorInput` off release only the learner's
    notes. If browser audio has not started yet, a monitored note-on starts
    it; if that fails, the message `SESSION_MESSAGES.monitorNoSound` is
    shown.
  - `midiInputName` is the selected input's name, except while a remembered
    piano has not turned up this session (`midi.inputSeen === false` and not
    connected): then it is null and `midiInputNotFound` is true. A piano that
    was connected and then unplugged keeps its name and is reported as
    disconnected.
- **MIDI output.**
  - Active when `settings.midiOutputId` is non-null. Call
    `midi.selectOutput(id)` whenever the setting changes; the constructor
    passes `deps.midiOutputName` as the remembered name, so a saved output
    that the browser now lists under another id is found by name.
  - When the manager re-finds the selected output under a new id (same
    name), `settings.midiOutputId` follows it without releasing anything (it
    is the same device), so the output menu shows it, Off works, and the
    piece saves the new id.
  - Listen and Steady events are sent with `atMs` timestamps converted from
    the audio clock.
  - Browser sound is controlled independently by `settings.sound`.
- **Count-in.** With count-in on, four clicks play before Listen or Steady
  starts from stopped and before every loop restart. The interval is
  `stepSeconds` in Steady. In Listen it is one beat at the start tempo
  divided by speed, where the beat follows the time signature in force at
  the start tick: a dotted quarter in compound meters (6/8, 9/8, 12/8), an
  eighth in other x/8 meters (3/8), a half note in x/2, and a quarter note in
  x/4 or with no time signature. `countInRemaining` counts down. A pause or
  page hide during a count-in (before the music has begun) is remembered,
  and the next `play()` counts in again from the same step; a pause after the
  music has begun resumes without one. Seeking or changing the speed during
  a count-in starts it again. Turning count-in on during playback starts
  browser audio for the clicks.
- **End and loop.**
  - When the passage time ends:
    - With loop on and count-in off: the next pass is scheduled inside the
      lookahead, anchored exactly at the passage end, with no release-all and
      no start lead, so the loop is seamless. (If Repeat is turned off in
      roughly the last 0.15 s of a pass, the already-scheduled next pass plays
      once more, then stops.)
    - With loop on and count-in on: release everything, then re-anchor at
      step 0 with a count-in.
    - With loop off: status becomes `finished` and the marker stays on the
      last step.
- **Manual stepping and seeking.**
  - `next`/`prev` while not playing move the marker by one step. With sound on
    and mode ≠ follow, they preview the new step's struck keys for 0.5 s, then
    release them. On the MIDI output only the preview's note-on is sent at
    once; its note-off is sent by the timer when due, never queued ahead, and
    a pending preview is released before playback starts.
  - Through an opening rest the marker stays on step 0, matching the reported
    step and the stopped position.
  - `seek` while stopped or paused is silent.
  - `seek` while playing (Listen/Steady) re-anchors and re-sounds held keys.
  - In Follow me, `seek`/`next`/`prev` restart the matcher at the new step.
- **No stuck notes.** On pause, stop, seek while playing, loop restart with
  count-in, any `updateSettings` call that changes the mode, hands, range,
  speed, stepSeconds, sound or output, a MIDI disconnect, page hide, or
  `dispose`, call:
  - `sampler.allNotesOff()`;
  - `midi.allNotesOff()` (only if an output is selected);
  - and clear every queued event.

  Exception for Follow me, which plays no app sound: the loop restart, pause,
  and settings changes other than the mode do not call
  `sampler.allNotesOff()`, so the learner's own monitored notes keep sounding
  until their note-off. The MIDI output is still released. Stop, a mode
  change, a disconnect, page hide and `dispose` release everything.
- **Page hide.** On `pagehide` (reload, tab close, leaving the site) the
  session pauses and releases everything, because Web MIDI sends no note-offs
  of its own when a page goes away. It does not dispose, so a page restored
  from the back/forward cache keeps a working, paused session. The listener is
  removed on `dispose`.
- **Speed or step-length change while playing.** Re-anchor at the current
  position. Held keys are re-sounded, except those released within 30 ms.
  The controls send a slider's value once a drag rests for 150 ms or ends,
  so one drag is one change.
- **MIDI input disconnect during Follow me.** Pause and set the message
  "Piano disconnected — reconnect it to continue."
- **dispose.** Clear the interval, unsubscribe from MIDI and the sampler,
  release all notes, and drop listeners.

## Storage — `src/storage/` (owner: library-ui)

```ts
// prefs.ts  (localStorage; keys prefixed "pianosteps:v1:"; tolerate corrupt JSON)
export interface GlobalPrefs { lastPieceId: string | null; midiInputName: string | null; midiOutputName: string | null; fitWholePiece: boolean }
export function loadGlobalPrefs(): GlobalPrefs;
export function saveGlobalPrefs(patch: Partial<GlobalPrefs>): void;
export interface PieceState { settings: PracticeSettings; stepTick: number | null }
export function loadPieceState(pieceId: string): PieceState | null;
export function savePieceState(pieceId: string, state: PieceState): void;
export function clearAllLocalData(): Promise<void>; // prefs + imports

// imports.ts  (IndexedDB via idb-keyval createStore('piano-steps','imports'); metadata and bytes stored under separate keys)
export interface ImportedPieceMeta { id: string /* "local-<uuid>" */; fileName: string; title: string; composer: string | null; addedAt: string; sizeBytes: number; readiness: Readiness; readinessReasons: string[]; measures: number; durationSec: number; tempoDefaulted?: boolean /* the file gives no tempo: durationSec is at the app's default speed */ }
export function listImports(): Promise<ImportedPieceMeta[]>;
export function getImportBytes(id: string): Promise<Uint8Array | null>;
export function getImportMeta(id: string): Promise<ImportedPieceMeta | null>;
/** Validates and parses first (throws ImportError with a plain message); stores only valid scores. */
export function importFile(file: File): Promise<ImportedPieceMeta>;
export function deleteImport(id: string): Promise<void>;
```

`GlobalPrefs.midiInputName` and `midiOutputName` are the names of the input
and output devices last connected or chosen. The practice page passes them
on with the piece's saved `midiInputId` / `midiOutputId`
(`selectInput(id, name)`, `SessionDeps.midiOutputName`), so a device the
browser now lists under another id is still found by name. A device that
was only present beside a switched-off piano is never connected in its
place, so its name is never saved over the piano's.

A piece saved in Follow me opens in Listen while no piano is connected. That
fallback is never written back: the saved mode stays Follow me, and Follow me
is switched on again when the piano connects, unless the learner has picked
another mode or started Listen playback in the meantime.

## Catalog runtime — `src/catalog/` (owner: library-ui)

```ts
// loader.ts
export function getCatalog(): CatalogEntry[];          // from the generated catalog.json (static import)
export function getCatalogEntry(id: string): CatalogEntry | undefined;
export interface LoadedPiece {
  id: string;
  kind: 'builtin' | 'import';
  title: string;
  arrangement: string | null;
  composer: string | null;
  entry?: CatalogEntry;          // builtin
  importMeta?: ImportedPieceMeta; // import
  prepared: PreparedScore;
  fileUrl?: string;              // builtin: resolved URL of the .mxl
}
/** Fetches (BASE_URL + entry.file) or reads IndexedDB, parses, prepares (with entry.overrides). Throws ImportError / Error with plain message. */
export function loadPiece(id: string, signal?: AbortSignal): Promise<LoadedPiece>;
```

`src/catalog/catalog.json` is generated by `npm run catalog`, which runs
`scripts/build-catalog.ts`. It is committed to the repo, so the app never
needs to scrape or parse the whole library at runtime.

`CatalogEntry.stats.tempoDefaulted` is `true` (and present only then) when the
file gives no tempo, so library cards label the length "at default speed".
`CatalogEntry.notes` are shown in "About this arrangement" under "About this
version".

## UI modules

- **library-ui** owns:
  - `src/main.tsx`, `src/App.tsx`, and the router (`src/ui/router.ts`).
  - `src/ui/theme.css` and `src/ui/library/*`.
  - `src/ui/common/*`: Dialog, Popover, Badge, and a DifficultyBadge that
    exports `DifficultyBadge({ info }: { info: DifficultyInfo })`.
  - `src/ui/about/AboutDialog.tsx`.
  - `src/storage/*` and `src/catalog/loader.ts`.
- **practice-ui** owns `src/ui/practice/*`, `src/ui/notation/*`,
  `src/ui/keyboard/*` and `src/ui/help/HelpDialog.tsx`.
  - It exports `PracticePage({ pieceId }: { pieceId: string })` from
    `src/ui/practice/PracticePage.tsx`.
  - It exports `HelpDialog({ open, onClose }: { open: boolean; onClose: () => void })`.
  - Both pages share the singletons from `src/app/services.ts`, which
    library-ui writes:

```ts
// src/app/services.ts
export const sampler: PianoSampler;   // one per app
export const midi: MidiManager;       // one per app
```

The router is `#/` → `LibraryPage`, `#/piece/:id` → `PracticePage`. Unknown
routes fall back to the library. `PracticePage` must dispose its session on
unmount or route change.
