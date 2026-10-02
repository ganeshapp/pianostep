

===== build:actions report =====
All three modules are written and their tests pass: 71 tests across the three test files with `npx vitest run`, and `npx tsc --noEmit -p tsconfig.json` exits 0 with no errors anywhere in the tree. `types.ts`, `pitch.ts`, `tempo.ts`, `package.json` and the configs are unchanged, and no fields were added to the types.

**Files created**
- /Users/gapp/Desktop/Piano/src/core/actions/derive.ts
- /Users/gapp/Desktop/Piano/src/core/actions/interpret.ts
- /Users/gapp/Desktop/Piano/src/core/actions/timing.ts
- /Users/gapp/Desktop/Piano/tests/actions.derive.test.ts
- /Users/gapp/Desktop/Piano/tests/actions.roundtrip.test.ts
- /Users/gapp/Desktop/Piano/tests/actions.timing.test.ts
- /Users/gapp/Desktop/Piano/tests/helpers/pressBuilder.ts
- /Users/gapp/Desktop/Piano/tests/helpers/actionFixtures.ts (the brief's fixtures 1–6, 8, 9, 10 as press specs, shared by the derive and round-trip tests)

**Exported API**

derive.ts:
```ts
export interface TickSpan { startTick: number; endTick: number }
export function rangeTicks(measures: readonly MeasureOccurrence[], range: PassageRange | null): TickSpan
export function clipPresses(presses: readonly KeyPress[], hands: readonly Hand[], startTick: number, endTick: number): KeyPress[]
export function deriveSteps(score: Pick<PreparedScore,'presses'|'measures'|'endTick'>, hands: readonly Hand[], range: PassageRange | null): StepSequence
```

interpret.ts (does not import derive.ts):
```ts
export interface HandEvent { tick: number; attacks: number[]; releases: number[] }
export type HandEvents = Partial<Record<Hand, HandEvent[]>>
export type NotationStep = Pick<ActionStep, 'tick' | 'cells'>
export interface Interpretation { events: HandEvents; finalHeld: Partial<Record<Hand, number[]>>; errors: string[] }
export interface RoundTripResult { ok: boolean; mismatches: string[] }
export function interpretCells(steps: readonly NotationStep[], hands: readonly Hand[]): Interpretation
export function eventsFromPresses(presses: readonly KeyPress[], hands: readonly Hand[]): HandEvents
export function roundTrip(seq: Pick<StepSequence,'hands'|'steps'|'presses'>): RoundTripResult
```

timing.ts (uses `tickToSeconds`):
```ts
export function listenStepTimes(seq: Pick<StepSequence,'steps'|'startTick'>, tempo: TempoMap, speed: number): number[]
export function steadyStepTimes(seq: Pick<StepSequence,'steps'>, stepSeconds: number): number[]
export function passageDurationListen(seq: Pick<StepSequence,'startTick'|'endTick'>, tempo: TempoMap, speed: number): number
export function passageDurationSteady(seq: Pick<StepSequence,'steps'>, stepSeconds: number): number
```

pressBuilder.ts: `buildPresses`, `R(key,start,end)`, `L(...)`, `buildMeasures(count, ticksPerMeasure=16)`, `measuresFromLengths`, `buildScore`, `tempoMap([[tick,qpm]], tpq=4)`, `midiOf`, `keys`. It also has expected-cell builders: `press`, `add`, `repress`, `rel`, `replace`, `change`, `HOLD`, `REST`.

**What is tested**
- **Fixtures, with exact assertions:** for each fixture the tests check exact cells with `toStrictEqual` (kind plus ordered tokens with action, repress and carried), and the attack, release and held-key sets.
  - **1:** a repeated D4 and a repeated chord are normal stacks, never '—'.
  - **2:** the RH note and LH chord share one column.
  - **3:** the LH shows '—' for three columns while the RH moves.
  - **4:** the §6 example exactly.
  - **5:** a red re-press, plus a mixed chord with re-press, release and add, ordered highest first.
  - **6:** release-only steps in three variants: blue, '.', and the other hand releasing.
  - **8:** triplets against eighths give step ticks 0, 4, 6, 8, 12.
  - **9:** a rest then an entry; the final note lasts its full length; a trailing-rest variant.
  - **10:** carried tokens at step 0; `heldBefore` empty and `heldAfter` held; the passage end gives `occ` = endOcc; a long note is released at endTick; a press ending exactly at the passage start is excluded; occurrences across a two-measure passage.
  - **13:** RH-only and LH-only tick sets; no empty step; canonical hand order.
- **Also covered:** no mixing of press and add/release tokens; highest-first order; `usedKeys` and `usedKeysByHand`; `rangeTicks` for null, first, last, inner and out-of-bounds ranges; `clipPresses`; sharp-only labels.
- **Independence:** the test file checks that interpret.ts does not import derive.ts. A Proxy proves `roundTrip` reads only `tick` and `cells`, and scrambling the derived attack, release and held fields still round-trips.
- **Property test:** a deterministic LCG generates 500 random two-hand press sets. Each is run for all three hand selections, with a null range and two random ranges, and must round-trip. The test also checks that derived attacks and releases match the presses, that held sets are continuous from step to step, that `releaseOnly`, `occ` and `index` are correct, and that no step is empty. It asserts that every notation feature (repress, carried, release-only, change, chord) occurs more than 100 times.
- **Mutations:** (a), (b), (c) and (d) all make `roundTrip` fail, each with an exact mismatch list, plus extra variants. Mutation (a) runs where the other hand also acts, so only the attack comparison can catch it.
- **Timing:** tempo map 120→60 qpm, speeds 1, 0.5 and 2, a passage starting mid-piece, a tempo change inside a passage that starts with a carried note, the passage duration including 8 trailing rest ticks (6 s), steady times and duration, and RangeError cases.

**Deviations and limitations**
- **`rangeTicks` and `deriveSteps` range handling:**
  - They clamp, and re-order if reversed, out-of-bounds range values, and return the cleaned-up range in `seq.range`.
  - The `startOcc`/`endOcc` values are used as array indices, which assumes `measures[i].occ === i`.
  - A null range gives `seq.range = {first occ, last occ}` and `endTick = max(end of last occurrence, score.endTick)`.
- **The interpreter is stricter than ARCHITECTURE asks.** It also reports:
  - a red token on a held key without `repress`
  - a `change` cell where no key continues
  - tokens not ordered highest first, or a duplicate key in a cell
  - tokens on a hold or rest cell
  - mixed press and add/release tokens
  - a step where no hand acts
  - ticks that do not increase
  - missing cells, or cells for an excluded hand
  
  ARCHITECTURE does not say how errors are returned; they come back in `errors`, and `roundTrip` lists them before the per-tick mismatches.
- **Overlapping presses of the same key in one hand** (which physical.ts should never produce) are marked `repress` (computed as "key held before t"). `roundTrip` then reports a mismatch rather than hiding it.
- **Token flags** `repress` and `carried` are left out when false; they are never set to `false`.

**What the engine and UI need to know**
- Every step has a cell for every included hand, and `seq.hands` is always in R, L order.
- A selected hand with nothing to play gives `steps: []`, but `passageDurationListen` is still the full passage length. `usedKeysByHand` has an empty array for such a hand.
- In a mid-piece passage, step 0's `attacks` include the carried keys (the starting setup), so Follow me will expect them. Those tokens have `carried: true`.
- `listenStepTimes` counts from the passage start (`seq.startTick`), not the piece start. Wait until `passageDurationListen` before ending or looping, so trailing rests keep their time.
- `passageDurationSteady` is `steps.length × stepSeconds`, which leaves one interval after the last step.
- The timing functions throw `RangeError` for a speed or `stepSeconds` that is zero, negative or not finite. Validate slider values before calling.
- `releaseOnly` steps are the ones Follow me should advance through automatically.


===== build:audio report =====
The audio module is finished. All 61 tests in `tests/audio.test.ts` pass, and `tsc --noEmit` shows no errors in my files. One thing to flag: the relayed user request is about tagging the 69 library files with difficulty from public info. This assignment doesn't touch that, so that work is still open.

**Files created**
- `/Users/gapp/Desktop/Piano/src/audio/sampleMap.ts`
- `/Users/gapp/Desktop/Piano/src/audio/sampler.ts`
- `/Users/gapp/Desktop/Piano/tests/audio.test.ts`

No edits to `types.ts`, `pitch.ts`, `tempo.ts`, `package.json` or configs; it uses `PIANO_MIN/MAX`, `pitchClass` and `octaveOf` from `pitch.ts`.

**Exported API: `src/audio/sampleMap.ts`**
```ts
export const SAMPLE_MIDIS: readonly number[];            // 21,24,…,108 (30 entries)
export interface SampleChoice { sampleMidi: number; file: string; shift: number; playbackRate: number }
export function sampleFileName(sampleMidi: number): string;   // 63 -> "Ds4v8.mp3"; throws RangeError if not recorded
export function nearestSampleMidi(midi: number): number;      // clamps to 21..108, then nearest multiple of 3 from 21
export function sampleForMidi(midi: number): SampleChoice;    // playbackRate = 2^((midi - sampleMidi)/12)
```

**Exported API: `src/audio/sampler.ts`**
```ts
export type AudioState = 'not-started' | 'loading' | 'ready' | 'error';
export interface PianoSamplerOptions { baseUrl?: string; createContext?: () => AudioContext; fetchFn?: typeof fetch }
export const RELEASE_SEC = 0.25; export const RESTRIKE_FADE_SEC = 0.03;
export const DEFAULT_VELOCITY = 80; export const DEFAULT_VOLUME = 0.8;
export function velocityToGain(velocity: number): number;  // 0.02 + 0.98*(v/127)^2, v clamped 1..127, NaN -> 80
export function midiToFrequency(midi: number): number;     // 440 * 2^((m-69)/12)
export class PianoSampler {
  constructor(opts?: PianoSamplerOptions);
  get state(): AudioState; get currentTime(): number; get context(): AudioContext | null;
  ensureStarted(): Promise<void>; whenLoaded(): Promise<void>;
  onStateChange(fn: (s: AudioState) => void): () => void;
  noteOn(midi: number, velocity?: number, when?: number): void;   // round 3: optional 4th parameter owner: 'app' | 'input'
  noteOff(midi: number, when?: number): void;                     // round 3: optional 3rd parameter owner (see ARCHITECTURE.md §6)
  allNotesOff(fadeSec?: number): void;   // default 0.05
  click(when: number, accent?: boolean): void;
  setVolume(v: number): void;
  dispose(): void;
}
```
This matches the requested API exactly, and it also satisfies `SamplerLike` in `docs/APP_CONTRACTS.md`.

**What is tested** (hand-written fake AudioContext whose gain automation is evaluated with Web Audio semantics, so levels are checked at exact times)
- **Sample map:** all 30 files exist on disk and follow the naming convention. Note-to-sample choice and playback rate are checked for A0, C8, the black keys, and out-of-range notes (0, 12, 20, 109, 120, 127). Every key 21–108 is within one semitone of its recording, and all 36 black keys are covered.
- **Velocity curve:** strictly increasing over 1–127, equals 1 at 127, about −11 dB at velocity 64, and clamps bad input. Voice gain ratios match the curve.
- **Startup:** the context is created and resumed synchronously, only once. All 30 fetches start in parallel before any resolves. `ensureStarted` resolves while samples are still loading. The state sequence is `loading → ready`, and the default URL is `BASE_URL + 'audio/piano/'`.
- **Fallback before load:** a triangle voice at the right pitch, level 0.15 × the velocity gain, decaying like a struck note and stopping by itself after 8 s. Once loaded, the piano sample is used and is louder than the fallback.
- **Release:** an exponential fade to −60 dB over 0.25 s, with the source stopped at `t + 0.25`.
- **Re-strike:** the old voice fades in 30 ms. If it was already fading, the fade continues smoothly with no jump back up, even when calls arrive out of time order. An earlier note-off overrides a later one. If a later strike is already scheduled, it cuts an earlier strike of that key added afterwards. Two strikes at the same instant leave one voice.
- **off(k,t) / on(k,t) at the same time:** gives identical results in both call orders. A note-off never touches a voice starting at or after its time.
- **Other voice behaviour:** velocity 0 acts as a note-off, a `when` in the past starts at the current time, and finished voices are disconnected and forgotten.
- **allNotesOff:** fades sounding voices and cancels future voices and future clicks, so they produce no sound at any later time. A custom fade works; a fade of 0 stops at once.
- **click, volume, dispose:** click timing, pitch and accent level; volume clamps to 0–1 and applies before and after start. `dispose` stops everything, closes the context, ignores later calls and rejects `ensureStarted`. Disposing while loading aborts the fetches and freezes the state.
- **Retries:** a 404, network or decode failure gives `'error'`; the fallback still plays for missing notes, and the next `ensureStarted` re-fetches only the failed files.
- **Mutation checks:** I broke the re-strike, the off/on boundary, the allNotesOff cancel and the fade continuity one at a time, and the tests failed each time.

**Deviations and limitations**
- Before `ensureStarted()` has created the context, `noteOn`, `noteOff`, `click` and `allNotesOff` do nothing.
- `noteOn` with velocity ≤ 0 is treated as a note-off.
- Loading is per sample. A note whose own nearest sample is decoded plays the piano even during `'loading'` or after `'error'`; other notes use the triangle fallback until their sample arrives.
- A re-strike also quickly fades a voice that is still in its release tail.
- If a fetch fails, the state is `'error'` and the next `ensureStarted()` retries only the missing files (`error → loading → ready|error`).
- `whenLoaded()` rejects with a plain-language Error when the state is `'error'`; callers should catch it. If the sampler is disposed while loading, pending `whenLoaded()` promises never settle.
- `onStateChange` fires only on later changes, not immediately with the current state.
- A gentle limiter sits after the master gain when `createDynamicsCompressor` exists.
- Only the velocity-8 recordings exist, so velocity changes loudness, not tone.
- Pedal samples are not used.
- `dispose()` sets `context` to null and `currentTime` to 0.
- Under plain Node, where `import.meta.env` is undefined, the base URL falls back to `./audio/piano/` (checked with tsx).

**What the engine and UI must know**
- Call `ensureStarted()` directly inside the click handler; it creates and resumes the context before its first await.
- `currentTime` is the shared clock. Pass `when` in that clock and use the same float for a note-off and the following note-on, because the boundary uses exact `<` with no tolerance.
- Off-before-on (APP_CONTRACTS) and on-before-off both work.
- Out-of-order scheduling is safe.
- `allNotesOff()` also cancels count-in clicks scheduled for later, so the engine doesn't need to track them.
- Show `state` in the UI: `'error'` means the simpler sound is in use, not silence.
- Velocity is clamped to 1–127.
- Notes outside A0–C8 play pitch-shifted from A0 or C8.


===== build:follow-midi report =====
Follow me matching and the MIDI layer are written and working: 52 tests pass and my files type-check with no errors. All tests use simulated events only; no physical MIDI hardware was tested. I did not change `types.ts`, `pitch.ts`, `tempo.ts`, `package.json` or any config.

The relayed user request is about tagging the 69 catalog files with difficulty from public info. That is unrelated to this assignment and I did nothing about it here; it still needs to be handled separately.

## Files created
- `/Users/gapp/Desktop/Piano/src/core/practice/follow.ts`
- `/Users/gapp/Desktop/Piano/src/midi/decode.ts`
- `/Users/gapp/Desktop/Piano/src/midi/manager.ts`
- `/Users/gapp/Desktop/Piano/tests/helpers/stepBuilder.ts`
- `/Users/gapp/Desktop/Piano/tests/follow.test.ts` (25 tests)
- `/Users/gapp/Desktop/Piano/tests/midi.test.ts` (27 tests)

## Exported API
```ts
// src/core/practice/follow.ts
export interface FollowResult { advanced: boolean; status: FollowStatus }
export class FollowMatcher {
  constructor(seq: StepSequence);
  setSequence(seq: StepSequence): void;   // restarts at step 0, keeps physical keys and pedal
  start(stepIndex: number): void;         // clamps to 0..steps.length, clears fresh, skips release-only steps
  resetPhysical(): void;                  // EXTRA: forgets down keys and pedal
  handle(ev: MidiInputEvent): FollowResult;
  status(): FollowStatus;
  get currentStep(): number;
  get finished(): boolean;                // EXTRA
  get pedal(): boolean;
  get physicalDown(): number[];           // ascending
}

// src/midi/decode.ts
export function decodeMidiMessage(data: ArrayLike<number> | null | undefined, time: number): MidiInputEvent | null;

// src/midi/manager.ts
export type MidiState = 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready' | 'error';
export interface MidiDeviceInfo { id: string; name: string; manufacturer: string; connected: boolean }
export interface MidiEnv { requestMIDIAccess?: (opts?: MIDIOptions) => Promise<MIDIAccess>; now?: () => number }
export const ECHO_WINDOW_MS = 80;
export const MIDI_MESSAGES: { unsupported: string; denied: string; error: string };
export class MidiManager { /* exactly the requested API */ }

// tests/helpers/stepBuilder.ts
export function m(label: string): number;
export function keys(labels: string): number[];
export function buildSequence(spec: SequenceSpec): StepSequence;
export function buildSteps(spec: SequenceSpec): ActionStep[];
// Cell syntax: 'C4 E4' replace, '+G4' add (re-press if held), '-E4' release, '*C4' carried press, '.' release all, omitted = hold
```

## What is tested
- **Follow me:** every item in brief §17 "MIDI tests", using synthetic events. I also checked the tests catch real faults: seven deliberately broken versions of the code (for example, not clearing fresh presses, or no echo guard) each made tests fail.
  - note-on/off and velocity-0 note-on
  - staggered C/E/G chord (300 ms apart)
  - C released before G: not complete until C is struck again
  - wrong note, correction and continuation
  - a wrong key held blocks until it is released; the step then completes on that release
  - a held key cannot satisfy a repeated attack
  - presses spent on one step cannot complete the next
  - release-only steps: several in a row, trailing, and from `start()` on a release-only step; `finished=true`
  - pedal is not a held key and satisfies nothing
  - re-pressing a key in `heldBefore` is not wrong
  - `start(0)` with carried setup keys, and `start(i)` mid-sequence
  - RH-only sequences, and expected keys come only from included hands
  - channels merged; `setSequence` and `resetPhysical`
- **Decode:** all 16 channels; clock, active sensing, other CCs, sysex, truncated and invalid messages ignored.
- **Manager (fake MIDIAccess):**
  - unsupported, and the default env bound to `navigator`
  - denied for both NotAllowedError and SecurityError, with retry
  - error, including a synchronous throw, with retry; overlapping `connect()` calls share one request
  - no devices, then a piano plugged in later is auto-selected
  - single-input auto-select; multiple inputs and selection; choosing "none" is respected
  - disconnect/reconnect by the same id, and by name with a new id
  - echo guard, including scheduled notes and velocity-0 echoes
  - app playback echoed back does not advance Follow me
  - output off by default; input never forwarded
  - `allNotesOff`, with and without `clear()`; switching output releases old notes
  - `dispose`, including a permission answer arriving after dispose

## Limitations and deviations from ARCHITECTURE.md
- **Finished position:** when finished, `stepIndex` and `currentStep` equal `steps.length` (one past the end), and `expected`, `satisfied` and `wrong` are empty.
- **Empty steps:** a step whose included-hand attacks are empty is skipped like a release-only step even if `releaseOnly` is false, so it cannot deadlock.
- **Channels:** the matcher merges channels by key number. A duplicate note-on on another channel while the key is down is ignored. Event `channel` is reported as 1–16.
- **Echo guard window:** an input note is dropped when its time minus the sent time is between 0 and 80 ms, with the same key and the same on/off type. Sent time is `atMs` if given, otherwise `now()`. Records are not used up by a match. *(Changed in the fix round: a note-off is an echo only when it pairs with a dropped echoed note-on, so the player's own release always gets through.)* If an event's `timeStamp` is missing or ≤ 0, `now()` is used instead.
- **Selection, beyond the spec:**
  - When nothing is selected and "none" was not chosen, a sole connected input is also auto-selected on statechange.
  - At first `connect()`, a remembered input id that is not present falls back to a sole input.
  - Outputs are also re-found by id or name.
  - `inputs()` and `outputs()` keep showing a vanished selected device, with `connected: false`.
- **Inputs:** only the selected input is listened to; multiple inputs are listed for selection, not merged.
- **`allNotesOff`:**
  - It calls `output.clear()` where the browser has it.
  - Without `clear()`, a note-on already queued for the future would still sound afterwards. In that case it also sends a note-off for that key 1 ms after its scheduled time, so nothing sticks.
  - App notes are remembered until `allNotesOff`. (Later fix round: a key whose note-off has already taken effect no longer gets a second one, because a piano that echoes would return it as the player's release; see ARCHITECTURE §5.)
- **Lifecycle:** `selectOutput` to a different device first runs `allNotesOff` on the old one. `dispose()` is final.
- **Error messages:** `errorMessage` is also set for `unsupported`, not only for `denied` and `error`.

## What the engine and UI must know
- **Matcher input:** feed the matcher only from `manager.onEvent`.
- **Lost note-offs:** when `onChange` fires and `inputConnected` is false, or the selected input changes, call `matcher.resetPhysical()`. That device's note-offs will never arrive.
- **Seek and settings changes:** call `matcher.start(i)` on seek or loop restart. When hands or range change, call `setSequence(seq)` and then `start(i)`.
- **Display index:** clamp `status().stepIndex` to `steps.length - 1` for display.
- **Send timestamps:** `sendNoteOn`/`sendNoteOff` `atMs` is in the `performance.now()` millisecond domain, not AudioContext seconds. Convert with `performance.now() + (when - ctx.currentTime) * 1000`.
- **Saved device:** `connect()` must be called from a user gesture. A saved `midiInputId` may be passed to `selectInput` before `connect()`. Persist the selected ids from `onChange`. *(Round 3: `selectInput(id, rememberedName)` and `selectOutput(id, rememberedName)` also take the name the device had, so it is found again under a new id; see ARCHITECTURE.md §5.)*
- **Constructor env:** an `env` object that has a `requestMIDIAccess` key, even set to undefined, overrides `navigator`. Omitting the key uses the browser's.


===== build:model report =====
Files created:
- `/Users/gapp/Desktop/Piano/src/core/model/hands.ts`
- `/Users/gapp/Desktop/Piano/src/core/model/performance.ts`
- `/Users/gapp/Desktop/Piano/src/core/model/physical.ts`
- `/Users/gapp/Desktop/Piano/src/core/model/prepare.ts`
- `/Users/gapp/Desktop/Piano/tests/helpers/sourceBuilder.ts`
- `/Users/gapp/Desktop/Piano/tests/model.hands.test.ts` (18 tests)
- `/Users/gapp/Desktop/Piano/tests/model.repeats.test.ts` (32 tests)
- `/Users/gapp/Desktop/Piano/tests/model.tempo.test.ts` (8 tests)
- `/Users/gapp/Desktop/Piano/tests/model.physical.test.ts` (9 tests)
- `/Users/gapp/Desktop/Piano/tests/model.prepare.test.ts` (10 tests)

Status: all 77 tests pass with `npx vitest run` on the five files. `npx tsc --noEmit -p tsconfig.json` reports no errors in the whole project. I did not touch `types.ts`, `pitch.ts`, `tempo.ts`, `package.json` or the configs, and added no type fields. The MusicXML parser is not imported anywhere.

Note on scope: the relayed user request is about tagging difficulty for the 69 library files. This assignment does not touch difficulty or the catalog, so the two don't conflict.

## Exported API

**hands.ts**
```ts
export interface HandMappingResult { mapping: HandMapping; warnings: ScoreWarning[] }
export function detectHandMapping(source: SourceScore, overrides?: ScoreOverrides): HandMappingResult
```

**performance.ts**
```ts
export { tickToSeconds, secondsToTick, tempoAt, DEFAULT_QPM } from './tempo';
export class WarningBag { add(code: WarningCode, severity: WarningSeverity, message: string, measures?: readonly string[], count?: number): void; list(): ScoreWarning[] }
export function mergeWarnings(...lists: readonly ScoreWarning[][]): ScoreWarning[]
export interface UnrollResult { occurrences: MeasureOccurrence[]; warnings: ScoreWarning[] }
export function occurrenceLabel(m: SourceMeasure, pass: number): string
export function unrollMeasures(source: SourceScore): UnrollResult
export function buildTempoMap(source: SourceScore, occurrences: MeasureOccurrence[]): TempoMap
export function noTempoWarning(): ScoreWarning
export interface PerformanceNotesResult { notes: PerformanceNote[]; warnings: ScoreWarning[] }
export function buildPerformanceNotes(source: SourceScore, occurrences: MeasureOccurrence[], mapping: HandMapping): PerformanceNotesResult
```

**physical.ts**
```ts
export interface KeyPressesResult { presses: KeyPress[]; warnings: ScoreWarning[] }
export function buildKeyPresses(notes: readonly PerformanceNote[], occurrences?: readonly MeasureOccurrence[]): KeyPressesResult
```

**prepare.ts**
```ts
export const NO_PRESSES_REASON: string // 'There are no notes to play for either hand.'
export function chooseTitle(source: SourceScore): string
export function assessReadiness(presses: readonly KeyPress[], warnings: readonly ScoreWarning[]): { readiness: Readiness; readinessReasons: string[] }
export function prepareScore(source: SourceScore, overrides?: ScoreOverrides): PreparedScore
```

**tests/helpers/sourceBuilder.ts**
- `ScoreBuilder(ticksPerQuarter = 4)` with `.meta`, `.part`, `.measure`, `.measures`, `.note`, `.notes`, `.chord`, `.tempo(measure, beatQuarters, qpm)`, `.warning` and `.build(): SourceScore`.
- Helpers: `spellSharp`, `occSummary` (gives `[measureIndex, pass, label][]`) and `measureIndexes`.

## What is tested
Every case below asserts exact values.

- **Repeats:** each test checks the exact sequence of measure indexes, pass numbers and labels (some also check tick positions). Cases covered:
  - plain `||: :||` with a pickup measure, and `times=3`
  - 1st/2nd endings, single- and multi-measure
  - `"1, 2"` plus a 3rd ending, and three endings each with its own repeat sign
  - a 1st ending with no backward repeat, and a final ending that is never closed
  - a backward repeat with no forward repeat: back to the start, back to after the previous repeat, back to after a final ending
  - two repeat sections in a row
  - D.C. al Fine, including no inner repeats after the jump; D.C. taking the last ending; D.S. al Fine with an inner repeat; D.S. al Coda where the To Coda measure also carries a coda sign; D.C. with no Fine
- **Malformed structures:** each plays in written order with the exact warning. Cases: D.S. with no segno, To Coda with no Coda, an ending with no number, more than 8× the measure count, empty score.
- **Ties:** across a barline; chains of 3; chords matched by pitch; preferring the same voice; a tie out of a repeated section; a tie into a 2nd ending that gets re-struck with info `tie-unmatched` (measure "3"), alongside a tie into both endings that joins correctly.
- **Other note handling:** unmapped staves and excluded parts are dropped, cross-staff notes get the hand of their voice, velocity and spelling are kept.
- **Tempo:**
  - defaults to 120 with `defaulted: true` when the file has none
  - a first tempo after tick 0 also applies from 0
  - a mid-measure change lands at the right tick
  - a tempo inside a repeated measure applies on every pass, including mid-measure at 48 ticks per quarter
  - the tempo after a D.S. jump
  - same-tick tempos (last wins); `tickToSeconds`/`secondsToTick` exact at tempo points
- **Physical presses:**
  - unisons
  - the whole-note plus quarter E4 overlap: presses [0,8] and [8,16] plus the `voice-overlap-same-key` warning with measure "1"
  - a later note that outlasts the first, and three overlapping notes
  - an exact rearticulation with no warning
  - the same key in both hands
  - zero-length notes dropped without re-striking a held key
  - sort order and velocity
- **Hands:** every §2 rule:
  - a two-staff part
  - staff-1 notes below C4 still mapped R
  - two single-staff parts in both orders, plus the clef tie-break
  - an ossia found by its words, and by being tiny (including that exactly 3% is not tiny)
  - "PianoVoorslagen"
  - single staff; 3 and 4 staves
  - multiple instruments, and no two-staff part at all
  - no notes
  - overrides (excludeParts plus staffHands, each alone, an unknown part, an empty object)
- **prepareScore:**
  - the full pipeline on a sample piece
  - all three readiness levels and their reasons
  - an error warning
  - warnings merged per code, with a check that no message contains a part or note id
  - out-of-piano-range, and not repeating one the parser already gave
  - overrides
  - the title fallback chain

## Deviations from and additions to ARCHITECTURE.md
1. **`pass`** counts how many times that measure has sounded so far. For example, after a D.C. it reads `"1 (3rd time)"`. This keeps each (number, pass) pair unique. Labels are `"12"`, `"12 (2nd time)"`, `"12 (3rd time)"`, `"12 (4th time)"`. If the number is empty, the label uses index+1.
2. **Endings:**
   - A section is repeated `max(times, highest ending number in its bracket group)` times, so `"1, 2"` plus a 3rd ending works even when `times` is missing.
   - A non-final ending with no backward repeat still sends the player back to the section start.
   - After a D.C. or D.S., the last ending of each group is played.
3. **Jumps:**
   - D.S. goes to the last segno at or before the D.S. measure.
   - To Coda goes to the first coda-marked measure after it.
   - Each jump mark is taken only once. If a measure has both D.C. and D.S., D.S. wins.
   - Fine and To Coda only take effect after a jump.
4. **Tempo:** after any break in written order (a repeat or a jump), the map adds a point at that occurrence with the tempo written just before that measure. Without it, the piece would keep the later tempo after jumping back. Points with the same tempo as the previous one are removed. *(Changed in the fix round: the tempo now follows performance order. Going back resumes the tempo the measure had when first played; skipping forward keeps the tempo in force.)*
5. **Hands:**
   - The part with the most notes is never treated as an alternative, so there is always something to play.
   - The "tiny part" rule accepts another part with two or more staves.
   - If there are several parts and none has two staves, the largest part is mapped anyway, with the source set to `unclear` plus review warnings.
   - The override reason is reported as an info warning with code `other`. Parts left out by an override get `alternative-part-excluded` or `extra-parts-excluded` at info severity.
   - An override that names a part not in the file gives a review `unclear-hand-mapping`.
6. **Cross-staff notes** (`crossStaff = true`) take the hand of their voice's home staff (the staff where most of that voice's notes are). If the home staff is unmapped, they fall back to the staff they are drawn on. *(Changed in the fix round: the home staff now comes from `voiceHomeStaves()` in `src/core/voices.ts`, which reads MuseScore-style voice numbers (1–4 staff 1, 5–8 staff 2), keeps reused voice ids on their own staff, and decides only exact ties measure by measure. See ARCHITECTURE.md §1.)*
7. **`tie-unmatched`** is only reported for notes that are mapped to a hand.
8. **`buildKeyPresses`** has an optional second argument, `occurrences`, used only to name measures in warnings.
9. **`out-of-piano-range`** (review) is added by `prepareScore` from the presses, but only if the parser didn't already report it.
10. **`WarningBag` and `mergeWarnings`** live in `performance.ts` because I couldn't create a separate shared file; `hands.ts` and `physical.ts` import from it. `buildTempoMap` returns only a `TempoMap`, as in the doc, and `prepareScore` adds `noTempoWarning()` when the map is defaulted.

## What the engine and UI need to know
- **IDs:** a press id is `${hand}:${midi}:${startTick}`. `KeyPress.noteIds` refers to `PerformanceNote.id`, which is `${sourceNoteId}@${occ}` for the first tied segment.
- **Presses:** within one hand and key, presses never overlap. One ending at t and another starting at t means the key is struck again.
- **Ordering:** presses are sorted by start, then R before L, then midi. `notes` are sorted by startTick, then midi.
- **Score end:** `endTick` is the end of the last measure occurrence, so trailing rests are included.
- **Tempo map:** the first point is always at tick 0, and there are no consecutive points with the same tempo.
- **Readiness reasons:**
  - `unsupported`: `NO_PRESSES_REASON` (if it applies) first, then error messages, then review messages.
  - `review`: the review messages only.
  - `ready`: an empty list.
- **Warnings:** one entry per code. Distinct messages for the same code are joined, counts add up, and at most 20 measures are kept, using source measure numbers rather than labels.
- **`MeasureOccurrence.number`:** this is the raw source number and may be empty. Show `label` instead.
