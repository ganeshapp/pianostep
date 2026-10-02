# UI specification

Desktop-first. A usable fallback for smaller windows is enough. The design is
light: white or near-white surfaces with a near-black foreground. Plain
language throughout, with no developer terms, parser names or internal ids in
normal flows (§16).

## Colours (CSS custom properties in `src/ui/theme.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--fg` | `#111827` | Normal "replace" tokens, text |
| `--add` | `#c81e1e` | Red "add / re-press" tokens only |
| `--release` | `#1d4ed8` | Blue "release only" tokens only |
| `--rh` | `#7c3aed` | Right-hand purple: keyboard highlights, R row tab |
| `--rh-soft` | `#c4b5fd` | RH held-but-not-just-struck fill (keep-holding keys also get an inset outline in the full hand colour) |
| `--lh` | `#15803d` | Left-hand green: keyboard highlights, L row tab |
| `--lh-soft` | `#4ade80` | LH held-but-not-just-struck fill (keep-holding keys also get an inset outline in the full hand colour) |
| `--wrong` | `#b45309` (amber) | Wrong-key feedback: dashed outline + ✕ badge. Never red. |
| `--physical` | `#0f172a` | Physical "pressed" dot on keys |

Red and blue are never used for hands. Purple and green are never used for
notation actions. Check contrast on white (WCAG AA for text).

## Routes

- `#/` is the library, shown immediately with no landing page.
- `#/piece/<catalogId>` is a built-in piece.
- `#/piece/local-<uuid>` is an imported piece.

Unknown routes fall back to the library. Refreshing any route works.

## Library page

The top bar shows the app name ("Piano Steps"), a short line ("Follow key names
instead of sheet music"), and **Import MusicXML…** (accepts `.musicxml,.xml,.mxl`).
A help link opens the help dialog.

Controls:
- Search box filtering by title, composer, and arrangement text
  (case-insensitive, accent-insensitive).
- Difficulty filter chips: All, Beginner, Intermediate, Advanced, Unrated. Each
  chip shows its count.
- A "Show pieces that need review" checkbox, checked by default.

Sections:
1. **Your imported pieces**, shown only when there are any. Each card has a
   delete button with a confirm step.
2. **Built-in library** with N pieces.

Each card or row shows:
- The title (bold).
- The arrangement line (e.g. "Easy arrangement by Torby Brand",
  "Original piano version", "Piano transcription by Liszt").
- The composer.
- A difficulty badge. Its label is the level, or "Unrated". When
  `basis = in-file` it gets a small qualifier: "Beginner · per score". A
  discreet ⓘ button opens a popover with the basis, original label, source
  name, a link to the source URL (`target=_blank rel=noopener`), and the date
  checked.
- A readiness chip: nothing when ready, "Needs review" (amber) with a tooltip or
  popover listing the reasons, or "Can't be used" (grey, card disabled) with
  the reason.
- Small stats: measures, length (m:ss at file tempo), and key range ("C3–G5").

Clicking a card opens the piece. Cards are real buttons or links with
accessible names.

The footer says: "Imported pieces and your settings are stored only in this
browser. Clearing this site's data removes them." It also links to
"About & credits", a dialog with the MIT notices, Salamander attribution,
library provenance, and per-file rights notes.

States: loading the catalog, an empty search result ("No pieces match"),
import progress, and import errors (a plain message from `ImportError`).

## Practice page

From top to bottom:

1. **Header**: "← Library", the title, the arrangement line, the difficulty
   badge, and a help (?) button.
2. **Controls bar**, compact and wrapping on small widths:
   - Mode segmented control: **Listen** | **Steady steps** | **Follow me**.
     Follow me is disabled, with a tooltip, until a MIDI input is connected.
     The tooltip reads "Connect a digital piano by MIDI to use Follow me".
   - Hands segmented control: **Both hands** | **Right hand** | **Left hand**.
   - Transport: Restart (⏮), Previous step (◀), Play/Pause (▶/⏸), Next step
     (▶|), Stop (⏹).
   - Mode-specific controls:
     - Listen: a Speed slider from 0.25× to 2× in 0.05 steps with a numeric
       label, defaulting to 1×.
     - Steady steps: a "Seconds per step" slider from 0.3 to 4 s, defaulting
       to 1 s.
     - Both sliders and their labels follow a drag at once, but the new value
       reaches playback only when the drag rests for 150 ms or ends (pointer
       up, or focus leaves the slider), so dragging during playback does not
       cut and re-strike the music on every movement.
   - Passage: "From measure [select] to [select]" listing occurrence labels,
     a "Whole piece" button, and a **Repeat** toggle. A tiny hint reads
     "A measure is a numbered section of the piece."
   - Sound on/off, and a Count-in toggle.
   - **Connect piano** button. After connecting it shows the device name, or a
     select if there are several inputs, and a status dot.
   - The ⋯ "More" menu holds: "Hear my playing through the browser" (monitor
     input, off by default), "Play through connected piano" (output select,
     off by default), and "About this arrangement" (the diagnostics panel).
3. **Mode note**: one short line.
   - Listen: "Plays the piece at its written rhythm."
   - Steady steps: "Movement practice: every step gets the same time — this is
     not the piece's rhythm."
   - Follow me: "Waits for the right keys on your piano. It checks notes, not
     timing or pedalling."
4. **Instruction timeline**: two rows, RH above LH.
   - A row tab on the left: "R" in purple and "L" in green, with the
     accessible names "Right hand" and "Left hand".
   - When only one hand is selected, only that row is shown.
   - Equal-width columns, 72px by default. Tokens use a monospace font at
     about 20px, are stacked vertically (highest first), never overlap, and
     never truncate octave digits.
   - Row height fits the tallest stack in the passage.
   - A fixed play marker (a vertical band) sits about 28% from the left. The
     current column sits under it, upcoming columns to its right, and past
     columns to its left (dimmed).
   - Measure numbers appear above the first column of each measure occurrence,
     with a thin measure boundary line.
   - Clicking a column seeks to that step. Clicking a measure number opens a
     tiny menu: "Start passage here" / "End passage here".
   - The viewport clips its strip (`overflow: clip`, with `hidden` as the
     fallback); it never scrolls. Any scroll of it (an engine without
     `clip`) is put back to 0 at once, and every focus call in the timeline
     uses `preventScroll`, so focusing a control can never move the columns
     away from the play marker.
   - Tab order: only the current column is a tab stop among the columns, and
     a focused column follows the current step as it moves. A measure number
     is in the tab order only while it is inside the viewport; numbers
     rendered in the overscan beyond either edge get `tabIndex = -1`.
   - Tokens:
     - Normal `press` tokens use the foreground colour.
     - `add` tokens are red with a small **filled dot** directly beneath the
       label.
     - `release` tokens are blue with a small **hollow circle** directly
       beneath the label.
     - Carried tokens (the starting setup) have a subtle dotted underline and
       the title "Already held when this passage starts".
   - `hold` cells show "—" centred and muted. `rest` cells show a large "·"
     centred in the cell itself, not under a note, so it is distinct from the
     add mark.
   - Accessible labels per token: "Right hand: press C4" / "add E4, keep other
     keys held" / "press E4 again, keep other keys held" / "release E4 only";
     per cell: "Left hand: no change" / "Left hand: release all keys".
   - Virtualized: only the columns in view ± 20 are rendered, via a single
     absolutely-positioned strip moved with `transform: translateX`. The strip
     is updated from a `requestAnimationFrame` loop that reads
     `session.getVisualPosition()`; React does not re-render every frame.
   - Reduced motion (`prefers-reduced-motion: reduce`): snap to whole steps
     instead of interpolating.
5. **Virtual keyboard**: large and tall. White keys are at least 180px tall,
   with black keys at about 62% of that height.
   - Geometry is correct (black keys sit between the right white keys at the
     correct offsets).
   - Framing: the range is `min/max` of `seq.usedKeys` (carried keys included),
     plus 2 white keys of context each side, snapped so the edges are white
     keys. At least 2 octaves are shown, and the range never goes beyond A0–C8.
     Out-of-range keys get a notice above the keyboard.
   - The framing is computed when the sequence (passage/hands) changes and
     never during playback. A "Fit: Passage | Whole piece" toggle switches
     between fitting the passage and fitting the whole piece.
   - Labels: every key in `usedKeys` shows its full address ("C#4") at the
     bottom of the key. Unused keys are unlabelled. Black-key labels are white
     text on the black key. C4 always gets a "Middle C" marker when visible: a
     small caption under the key or a dot.
   - Highlights (expected state = `heldAfter` of the marker step):
     - An RH key gets a purple fill: strong `--rh` if struck at this step,
       `--rh-soft` plus an inset `--rh` outline if continuing (3px on white
       keys, 2.5px on black). A continuing key held by both hands gets an
       outline that is purple on one half and green on the other.
     - An LH key does the same with green.
     - A key expected in both hands is split diagonally, half purple and half
       green.
     - A small "R" or "L" letter appears on highlighted keys, so colour is not
       the only cue.
   - Physical input: a dark dot near the bottom of each physically held key.
     Wrong keys get an amber dashed outline and an ✕ badge.
   - Physically held keys and pedal-sustained sound are kept separate. A
     "Pedal ▾ down" chip is shown when CC64 is down; keys are never shown as
     held because of the pedal.
   - A legend under the keyboard reads: "Purple = right hand · Green = left
     hand · Strong = press now · Light = keep holding · ● = your key ·
     ✕ = not expected". Only the parts relevant to the mode are shown.
6. **Status line**: "Step 12 of 340 · Measure 5 (2nd time) · MIDI: Yamaha
   P-125 connected", plus Follow-me messages ("Waiting for: C4 E4" /
   "Not expected: F4 — release it and try again"), or "Finished — passage
   complete". The MIDI part agrees with the notice under the controls: a
   piano remembered from an earlier visit that has not turned up yet reads
   "MIDI: no piano found"; only a piano that was connected in this visit and
   then lost reads "MIDI: <name> disconnected".

Keyboard shortcuts apply when focus is not in an input, select or textarea,
and no dialog or measure menu is open (the More panel does not block them; a
measure menu opened with the mouse takes Space itself so the page does not
scroll):
- Space: play/pause.
- ←/→: previous/next step.
- Home: restart.

A control reached with the keyboard keeps its own keys: Space activates a
focused button, radio, switch or menu item instead of play/pause, and the
arrows and Home move within a focused radio group, slider or menu. Pointer
(mouse or touch) use never leaves focus on a control: buttons don't take focus
on a mouse click, and radios, switches, sliders and selects let go of focus
after a pointer change, so the shortcuts keep working after clicking. A list
clicked open and closed without a new choice hands the next Space, ←/→ or
Home back to the page (the list lets go of focus); any other key keeps the
list's own keys. Clicking a field's text label ("Speed", "Seconds per step",
"From measure", "to", "Play through connected piano") does not focus its
control.

Keyboard focus is never dropped to the page body when the focused control
goes away or stops working:
- Reset (shown next to Speed while it is not 1×), used from the keyboard,
  sets 1× and moves focus to the Speed slider. A mouse click leaves focus
  free.
- Previous step, Next step and Stop hand focus to Play when they become
  disabled under focus (first step, last step, stopped); "Whole piece" hands
  it to the "From measure" list. Enter still held from the disabled button
  (key repeats) does not go on to press Play; the next fresh press does.
- Choosing "Start passage here" or "End passage here" from the keyboard
  moves focus, once the new passage has rendered, to that measure's number
  if it is in view, otherwise to the current column (never to whichever
  measure now occupies the old button). Esc closes the menu and returns
  focus to its measure number. A keyboard-opened menu that closes because
  its measure number scrolled out of view sends focus to the current
  column.
- A focused column or measure number that is removed from the rendered
  window, or comes to show another measure, hands focus to its own measure's
  number if that is in view, otherwise to the current column.
- Connect piano, Try again and Dismiss, used from the keyboard, move focus to
  the piano control (the list when a choice is needed, else the button or
  the piano's name) when they go away.

Show the shortcuts in help.

The help dialog explains the five instructions with live-rendered examples
using the same token components, including the worked example from §6. It
also covers the three modes, the forgiving behaviour of Follow me
(release-only steps advance by themselves, and holds are not checked), MIDI
setup and browser support (Chrome and Edge support Web MIDI; Firefox needs
permission; Safari has no Web MIDI), and local storage.

"About this arrangement" (diagnostics) shows the source file, composer,
arranger, rights text, the catalog's notes about this version ("About this
version"), difficulty provenance, hand-mapping description, warnings grouped
by severity (a checked hand setting already shown under Hands is not
repeated), each with the measures it affects ("Measures 18, 19, 20, 21"; at
most 20 are listed, and "and others" is added only when the list was cut
short, `ScoreWarning.measuresTruncated`, never because several notes share
a measure), measure and occurrence counts, tempo source (file or default), and
a link to the original file. This content is never
required for practice.

Error and loading states:
- "Loading piece…"
- A failed load with a "Back to library" button.
- "Sound is loading…" (playback can start with the fallback voice).
- MIDI unsupported: "This browser can't connect to a MIDI piano. Listen,
  Steady steps and manual stepping still work."
- MIDI denied, no devices, and disconnected, each with a retry. A piano
  remembered from an earlier visit that has not turned up yet is reported as
  "No piano found" (or the list asks for a choice), never as disconnected, and
  it is attached when it is switched on: under its saved id, under a new id
  with its remembered name, or as the only device that turns up after
  Connect. A device that was already connected when Connect was pressed
  (Linux's "Midi Through Port-0", an IAC or loopMIDI port, an audio
  interface's MIDI In, another keyboard) is never attached in its place,
  reported as connected, or saved as the piano. With other devices on, the
  notice reads "The piano you used last time wasn't found. Switch it on and
  it will be picked up, or choose your piano from the list." (it never
  claims that several devices were found when only one is). Loopback ports
  ("Midi Through") are never picked automatically, and when they are the
  only inputs the notice is "No piano found". "Try again" never switches to
  a device that was already connected beside the piano. Dismissing a notice
  hides only that problem; a new problem shows its notice again.
- "Play through connected piano" keeps its device across a USB re-plug or a
  new visit: a device the browser lists under a new id with the same name is
  found by name (the name saved in the preferences), and the menu then shows
  it and the piece saves it.
- An empty passage: with one hand, "There is nothing for the right hand to
  play in these measures. Choose the other hand or a different passage."; with
  both hands, "There is nothing to play in these measures (they are silent).
  Choose a different passage."
