# UI specification

Desktop-first. A usable fallback for smaller windows is enough. The look is a
warm practice studio: cream paper surfaces on a slightly darker cream page,
warm grey text and borders, and one brand colour, a deep ink, for primary
actions, selected controls, focus rings and the logo. Plain language
throughout, with no developer terms, parser names or internal ids in normal
flows (§16).

## Colours (CSS custom properties in `src/ui/theme.css`)

Notation, hands and feedback:

| Token | Value | Use |
| --- | --- | --- |
| `--fg` | `#22201c` | Normal "replace" tokens, text (near-black warm ink) |
| `--add` | `#c81e1e` | Red "add / re-press" tokens only |
| `--release` | `#1d4ed8` | Blue "release only" tokens only |
| `--rh` | `#7c3aed` | Right-hand purple: keyboard highlights, R row tab |
| `--rh-soft` | `#c4b5fd` | RH held-but-not-just-struck fill (keep-holding keys also get an inset outline in the full hand colour) |
| `--lh` | `#15803d` | Left-hand green: keyboard highlights, L row tab |
| `--lh-soft` | `#4ade80` | LH held-but-not-just-struck fill (keep-holding keys also get an inset outline in the full hand colour) |
| `--wrong` | `#b45309` (amber) | Wrong-key feedback: dashed outline + ✕ badge. Never red. |
| `--physical` | `#1c1915` | Physical "pressed" dot on keys |

Red and blue are never used for hands. Purple and green are never used for
notation actions. Amber is only for wrong keys and "needs review".

Brand and surfaces (all near-neutral, so they never read as a notation, hand
or warning colour):

| Token | Value | Use |
| --- | --- | --- |
| `--ink` / `--ink-hover` | `#22201c` / `#3b362f` | Brand: primary buttons, Play, selected chips and segments, switches, the logo tile |
| `--on-ink` | `#fffdf9` | Text and icons on ink |
| `--page` | `#f5f0e6` | Page background (cream) |
| `--bg` | `#fffdf9` | Paper: cards, the notes card, transport bar, dialogs, popovers, buttons |
| `--surface` | `#faf6ee` | Tints inside paper: row tabs, dialog header and footer, starting setup |
| `--surface-2` | `#f0e9dd` | Hover, recessed tracks (fit toggle, scrubber) |
| `--border` / `--border-strong` | `#e6dfd2` / `#b3a998` | Hairlines / button and chip outlines |
| `--border-input` | `#8f8574` | Search field and list outlines; the scrubber track's outline |
| `--muted` / `--subtle` | `#585148` / `#6c6458` | Secondary / tertiary text |
| `--kb-body`, `--kb-body-deep` | `#2b2622`, `#1f1b18` | The keyboard's dark body (gradient) |
| `--kb-felt`, `--kb-caption` | `#5a4b3f`, `#d6cdbf` | The felt strip above the keys; "Middle C" on the body |
| `--key-white`, `--key-black` | `#ffffff`, `#1d1a17` | Keys: crisp white and warm black |
| `--focus-ring` / `--focus-ring-on-dark` | `#22201c` / `#fbf8f2` | Focus outline (with a `--focus-ring-inner` cream halo) / on black keys |

### Contrast (WCAG AA, checked by `tests/theme.brand.test.ts`)

| Pair | Ratio |
| --- | --- |
| `--fg` on `--page` / `--bg` / `--surface-2` | 14.3 / 16.0 / 13.5 |
| `--muted` on `--page` / `--bg` / `--surface-2` | 6.9 / 7.7 / 6.5 |
| `--subtle` on `--page` / `--bg` / `--surface-2` | 5.1 / 5.7 / 4.8 |
| `--add` on `--bg` / under the play marker | 5.7 / 5.0 |
| `--release` on `--bg` / under the play marker | 6.6 / 5.8 |
| White on `--rh` / `--lh` (row tabs) | 5.7 / 5.0 |
| `--on-ink` on `--ink` / `--ink-hover` | 16.0 / 11.8 |
| `--review-fg` on `--review-bg` | 6.4 |
| `--kb-caption` on `--kb-body` / `--kb-body-deep` | 9.5 / 10.9 |
| `--border-input` on `--bg` / `--page` (non-text, 3:1) | 3.6 / 3.2 |
| Scrubber thumb (`--fg` at 55%, 70% on hover) on its `--surface-2` track (3:1) | 3.5 / 5.5 |
| `--fg` current-step mark on the scrubber thumb (3:1) | 3.8 |
| `--focus-ring` on `--page`; `--focus-ring-on-dark` on `--key-black` (3:1) | 14.3; 16.3 |

### Typography

- Headings (the wordmark, page and piece titles, section headings, card
  titles, dialog titles, help and "About this arrangement" section headings,
  popover titles): `--font-display`, a book serif from the system only:
  "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia,
  serif.
- Body and controls: the system sans (`--font-sans`).
- Note labels: the monospace stack (`--font-mono`), large and bold.
- No web fonts and no external requests: no `@font-face`, `@import` or
  remote `url()` anywhere.

### Logo

`src/ui/common/Logo.tsx`: `LogoMark` is four white keys climbing like steps,
with a black key between each pair, on a rounded ink tile (32×32 grid, legible
at 16px). `Wordmark` is "Piano" in the serif, bold, and "Steps" lighter
(italic, muted); it reads as the plain text "Piano Steps". The mark is
decorative (`aria-hidden`); the heading or link it sits in carries the name.
`index.html` inlines the same shapes as the favicon (an SVG data URI).

## Routes

- `#/` is the library, shown immediately with no landing page.
- `#/piece/<catalogId>` is a built-in piece.
- `#/piece/local-<uuid>` is an imported piece.

Unknown routes fall back to the library. Refreshing any route works.

## Library page

The top bar shows the logo mark beside the wordmark heading ("Piano Steps", the
page's `h1`), a short line ("Follow key names instead of sheet music"), and
**Import MusicXML…** (accepts `.musicxml,.xml,.mxl`). A help link opens the
help dialog. "Continue: <title>" (the last piece opened) is a paper banner
with an ink edge.

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

Cards are paper on the cream page with a soft shadow, about four to a row at
desktop width (`minmax(17.5rem, 1fr)`); on hover the outline darkens and the
shadow deepens (nothing moves). Each card or row shows:
- The title (bold, in the serif).
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
- Small stats: measures, length (m:ss at file tempo), and key range ("C3–G5"),
  under a dashed hairline at the foot of the card.

Clicking a card opens the piece. Cards are real buttons or links with
accessible names.

The footer says: "Imported pieces and your settings are stored only in this
browser. Clearing this site's data removes them." It also links to
"About & credits", a dialog with the MIT notices, Salamander attribution,
library provenance, and per-file rights notes.

States: loading the catalog, an empty search result ("No pieces match"),
import progress, and import errors (a plain message from `ImportError`).

## Practice page

The page has two areas: **setup** (the settings, at the top) and **practice**
(notes, transport, keyboard). While practising, only the practice area needs
to be on screen.

- In an **800px-tall viewport** with the settings folded, no starting setup
  line and no notice, the header, the notes, the transport bar and the whole
  keyboard fit without scrolling when both rows are at their 50px minimum
  (stacks of one note): the keyboard ends at about 640px.
- Each row is max(50, 28 × its tallest stack + 12) px, so every further
  stacked note adds 28px to that row; the starting setup line adds about
  37px. Passages with large chords (Gymnopédie, Clair de lune, the
  Toccata…) are taller than an 800px viewport, and a real 1280×800 laptop
  window leaves only about 700px of viewport once the browser's own bars
  are counted, so many whole pieces need the page scrolled.
- That is why starting practice (Play or Space, when it really starts
  something) scrolls the page down just enough to bring the keyboard's
  bottom into view (`revealScroll` in `practiceFocus.ts`, smooth unless the
  learner prefers reduced motion). It never scrolls past the top of the
  notes card and never scrolls up, so a learner who has placed the page
  themselves is left alone, and the page can always be scrolled by hand.

From top to bottom:

1. **Header**: the small logo mark with "Library" (a link back to the
   library, named "Library"), the title (serif), the arrangement line, the
   difficulty badge, and a help (?) button.
2. **Setup** (`section` "Practice settings"), visually secondary to the notes
   and keyboard: a recessed tray with no shadow, and a quiet dashed outline
   with muted text when folded. A bar with either the heading
   "Practice settings" and **Hide settings** (open), or a one-line summary
   and **Adjust settings** (folded). The toggle is a disclosure button
   (`aria-expanded`, `aria-controls`).
   - The summary reads like the settings: "Listen · Both hands · 1× ·
     Measures 1–78 · Repeat off" (Steady steps: "1.0 s per step"; Follow me
     shows no speed; "Sound off" and "Count-in on" are added only when they
     apply and are not the default).
   - It folds by itself when Play or Space really starts playback or
     Follow me (`playWillStart` in `practiceFocus.ts`), and the learner can
     open it at any time, also while playing. When Play has nothing to start
     (nothing for the chosen hands in the passage, or Follow me without a
     piano), it stays open: the message then points at the Hands, passage or
     piano controls inside it.
     Open or folded is remembered (`GlobalPrefs.setupCollapsed`). It opens by
     itself when the piano list needs a choice, or when keyboard focus must
     return to the piano control after Connect piano / Try again / Dismiss.
   - Keyboard focus inside the settings when they fold goes to
     **Adjust settings**, never to the page body.
   - The settings themselves, compact and wrapping on small widths:
     - Mode segmented control: **Listen** | **Steady steps** | **Follow me**.
       Follow me is disabled, with a tooltip, until a MIDI input is connected.
       The tooltip reads "Connect a digital piano by MIDI to use Follow me".
     - Hands segmented control: **Both hands** | **Right hand** | **Left hand**.
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
   - A MIDI notice (below) sits under the setup and stays visible when it is
     folded.
3. **Notes card** (`section` "Notes"), the page's main surface: paper with a
   soft shadow on the cream page.
   - A legend line, always shown, drawn with the real token styles: "Dark:
     replace · Red ●: add / press again · Blue ○: release · —: no change ·
     ·: rest". Red covers both meanings of the red token: a key added to
     those held, and a held key struck again.
   - **Starting setup**: when the passage's first step has carried tokens
     (keys already held when the passage starts), a banner above the notes:
     "Starting setup — right hand: F#4 · left hand: D2. These keys are
     already held when this passage begins; press them first." There is no
     banner when nothing is carried.
     - It is read from the passage **with both hands**, whichever hands are
       practised, so it never appears, disappears or rewraps when hands are
       switched: its words on screen stay the same.
     - A hand that is not being practised keeps its place and words in the
       line, only muted (`--subtle`, like its empty row), and is read out as
       "left hand (not practising): C2". When no practised hand holds a key,
       the whole line is muted.
   - The instruction timeline (4 below) and, under it, its scrubber. The
     scrubber's row is always there: when the chosen hand has nothing to play
     in the passage it is an empty, inert track (hidden from assistive
     technology, not a tab stop), so the card keeps its height.
4. **Instruction timeline**: two rows, RH above LH.
   - A row tab on the left: "R" in purple and "L" in green, with the
     accessible names "Right hand" and "Left hand".
   - Both rows are always shown, whichever hands are selected. The row of a
     hand that is not being practised stays in place, blank (no tokens, no
     "—"), with a muted tab named "Left hand (not practising)" and a small
     "Left hand: not practising" hint in the row.
   - Equal-width columns, 72px by default. Tokens use a monospace font at
     about 20px, are stacked vertically (highest first), never overlap, and
     never truncate octave digits.
   - Row height fits the tallest stack **of either hand** in the passage (it is
     computed from the passage with both hands), so switching hands never
     changes the row heights.
   - The columns are the steps of the hands being practised (Steady steps
     and Follow me step through exactly those), so switching hands changes
     the number of columns and where each measure falls: a moment where only
     the other hand changes is not a column of its own. The rows, the
     starting setup line, the scrubber, the transport and the keyboard stay
     where they are. (Keeping the both-hands columns and only blanking a
     hand would need Steady steps and Follow me to step over a shared grid;
     not done.)
   - A play marker (a vertical band) sits about 28% from the left. The
     current column sits under it, upcoming columns to its right, and past
     columns to its left (dimmed).
   - Measure numbers appear above the first column of each measure occurrence,
     with a thin measure boundary line.
   - Clicking a column seeks to that step. Clicking a measure number opens a
     tiny menu: "Start passage here" / "End passage here".
   - **Looking through the notes.** While not playing (stopped, paused,
     finished, or Follow me waiting for the piano) the notes can be panned
     left and right without moving the marker step:
     - a sideways wheel or trackpad swipe (`deltaX`), or Shift + wheel;
     - a drag on the notes: a press only becomes a drag after it has moved
       6px, so a plain click still seeks or opens a measure menu, and the click
       that ends a drag does not seek;
     - the scrubber under the notes: a slim track for the whole passage, whose
       thumb is the part in view and whose dark mark is the current step.
       Clicking the track centres the view there, the thumb can be dragged,
       and from the keyboard (it is a `slider`, "Look through the passage")
       ←/→ move one column, Page Up/Down a screen, Home/End to the ends.
     The marker moves with the notes (it stays on the current step), and the
     view never goes beyond the first or last column under the marker's
     place. While the view is moved, **Back to current step** appears next to
     the scrubber. Play, any seek, Previous/Next, Restart, Stop, Home, a hand
     or passage change, keyboard focus on the current column, or that button
     bring the view back to the marker (from the keyboard, the button hands
     focus to the current column).
     During Listen / Steady playback the view follows the marker and panning
     is ignored; a sideways swipe is still kept from the browser (no page
     scroll or history swipe), and the scrubber is `aria-disabled` and out of
     the tab order. An upright wheel always scrolls the page.
   - The viewport clips its strip (`overflow: clip`, with `hidden` as the
     fallback); it never scrolls. Any scroll of it (an engine without
     `clip`) is put back to 0 at once, and every focus call in the timeline
     uses `preventScroll`, so focusing a control can never move the columns
     away from the play marker. Panning is an offset in the same
     transform-based strip.
   - Tab order: only the current column is a tab stop among the columns, and
     a focused column follows the current step as it moves. The current
     column stays mounted while the notes are panned away from it. A measure
     number is in the tab order only while it is inside the viewport (as
     panned); numbers rendered in the overscan beyond either edge get
     `tabIndex = -1`.
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
   - Virtualized: only the columns in view ± 20 are rendered (around the
     panned position when panned), via a single absolutely-positioned strip
     moved with `transform: translateX`. The strip is updated from a
     `requestAnimationFrame` loop that reads `session.getVisualPosition()`;
     React does not re-render every frame.
   - Reduced motion (`prefers-reduced-motion: reduce`): snap to whole steps
     instead of interpolating.
5. **Transport bar**, directly under the notes (about 58px tall, a paper
   pill):
   - Restart (⏮), Previous step (◀), a large Play/Pause (▶/⏸, "Start Follow
     me" in Follow me; a 48px ink circle), Next step (▶|), Stop (⏹).
   - A facts line: in Listen and Steady steps the passage time "0:07 / 4:22"
     (elapsed / total at the current speed or step length, from
     `session.getPassageTime()`, redrawn every animation frame while
     playing), then "Step 6 of 189", "Measure 5 (2nd time)" and the MIDI
     status ("MIDI: Yamaha P-125 connected"). Follow me shows the step count
     instead of a time. The MIDI part agrees with the notice under the
     settings: a piano remembered from an earlier visit that has not turned
     up yet reads "MIDI: no piano found"; only a piano that was connected in
     this visit and then lost reads "MIDI: <name> disconnected".
   - One message line (`aria-live="polite"`): the current message when there
     is one — Follow me's "Waiting for: C4 E4" / "Not expected: F4 — release
     it and try again", "Get ready… 3", "Finished — passage complete", sound
     loading — otherwise the mode note:
     - Listen: "Plays the piece at its written rhythm."
     - Steady steps: "Movement practice: every step gets the same time — this
       is not the piece's rhythm."
     - Follow me: "Waits for the right keys on your piano. It checks notes,
       not timing or pedalling."
6. **Virtual keyboard**: large. White keys are 160px tall, with black keys at
   about 62% of that height.
   - The keys sit in the piano's **body**, a warm dark frame (`.kb__body`):
     a 12px lip above the keys with a felt strip, 12px at the sides
     (`BODY_PAD_X`; the keys get the stage width less that on each side),
     and "Middle C" in a light caption below. A small range keeps its body
     hugging the keys, centred. The keys stay crisp (pure white and a warm
     black) so the light and strong hand colours read clearly. The
     fit toggle, legend and pedal chip sit under the body, on the page.
   - Geometry is correct (black keys sit between the right white keys at the
     correct offsets).
   - Framing: the range is `min/max` of the passage's used keys **for both
     hands** (carried keys included), whichever hands are selected, plus 2
     white keys of context each side, snapped so the edges are white keys. At
     least 2 octaves are shown, and the range never goes beyond A0–C8.
     Out-of-range keys get a notice above the keyboard.
   - The framing is computed when the passage changes and never during
     playback; switching hands never changes the range or the key sizes. A
     "Fit: Passage | Whole piece" toggle switches between fitting the passage
     and fitting the whole piece (also both hands).
   - Labels: every key either hand uses in the passage shows its full address
     ("C#4") at the bottom of the key. Unused keys are unlabelled. Black-key
     labels are white text on the black key. C4 always gets a "Middle C"
     marker when visible: a small caption under the key or a dot.
   - Highlights (expected state = `heldAfter` of the marker step, for the
     selected hands only):
     - An RH key gets a purple fill: strong `--rh` if struck at this step,
       `--rh-soft` plus an inset `--rh` outline if continuing (3px on white
       keys, 2.5px on black). A continuing key held by both hands gets an
       outline that is purple on one half and green on the other.
     - An LH key does the same with green.
     - A key expected in both hands is split diagonally, half purple and half
       green.
     - No letters are drawn on the keys: purple and green, strong and light,
       carry the meaning.
   - Physical input: a dark dot near the bottom of each physically held key.
     Wrong keys get an amber dashed outline and an ✕ badge.
   - Physically held keys and pedal-sustained sound are kept separate. A
     "Pedal ▾ down" chip is shown when CC64 is down; keys are never shown as
     held because of the pedal.
   - **Click to hear**: pressing a key with the mouse (or touch) plays it
     through the browser sampler until it is let go or the pointer leaves it
     (at least 0.25 s). `sampler.ensureStarted()` is called within the
     gesture. It sounds whether or not Sound is on, as its own voice owner
     (`'audition'`), and never counts as MIDI input, never affects Follow me
     or the step, and is never sent to the MIDI output. A mouse press does not
     focus the key.
   - The keys are one keyboard group (`role="toolbar"`, still named "Keyboard
     from C3 to C6. …"): one Tab stop (middle C when shown), ←/→ (and ↑/↓)
     move between keys, Home/End to the ends, Enter or Space plays the focused
     key while held. Each key is a `button` named like "C sharp 4". A focused
     key gets an ink ring on white keys and a light ring on black keys. The page's
     Space, ←/→ and Home shortcuts do not apply while focus is in the group.
   - A legend under the keyboard reads: "Purple = right hand · Green = left
     hand · Strong = press now · Light = keep holding · ● = your key ·
     ✕ = not expected". Both hand colours are always listed; "your key" and
     "not expected" only when they apply to the mode.

Keyboard shortcuts apply when focus is not in an input, select or textarea,
and no dialog or measure menu is open (the More panel does not block them; a
measure menu opened with the mouse takes Space itself so the page does not
scroll):
- Space: play/pause.
- ←/→: previous/next step.
- Home: restart.

A control reached with the keyboard keeps its own keys: Space activates a
focused button, radio, switch or menu item instead of play/pause, and the
arrows and Home move within a focused radio group, slider, menu or the
keyboard's key group. A widget marked `aria-disabled` (the scrubber during
playback) does not take them. Pointer
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
  the piano's name) when they go away; the settings open for it if folded.
- Focus inside the settings when they fold goes to **Adjust settings**.
- **Back to current step**, used from the keyboard, moves focus to the
  current column.

Pointer use of the notes and keyboard follows the same rule: a drag on the
notes, a press on the scrubber and a press on an on-screen key never leave
focus on them.

Show the shortcuts in help.

The help dialog explains the five instructions with live-rendered examples
using the same token components, including the worked example from §6. It
also covers the three modes, the forgiving behaviour of Follow me
(release-only steps advance by themselves, and holds are not checked), MIDI
setup and browser support (Chrome and Edge support Web MIDI; Firefox needs
permission; Safari has no Web MIDI), and local storage. It says "Click a key
on the keyboard to hear it.", explains looking through the notes while not
playing and the folding settings, and mentions the "Starting setup" line.

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
