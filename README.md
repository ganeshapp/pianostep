# Piano Steps

A personal piano-practice web app for people who don't read sheet music.
Pick a piece from the built-in library and practise one or both hands by
following **scrolling key-name instructions** (RH row above LH row) and a
**large labelled keyboard**. You can listen to the piece, step through it
evenly, or connect a digital piano over MIDI and let the app wait for the
right keys (**Follow me**).

It is a static site with no server, account, analytics or tracking. It runs
on GitHub Pages.

- Requirements brief: [piano-practice-app-requirements.md](piano-practice-app-requirements.md)
- Implementation report (what works, what was tested, limitations): [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md)
- Built-in catalog inventory, difficulty provenance and licensing notes: [docs/CATALOG_REPORT.md](docs/CATALOG_REPORT.md)

## Quick start

Requires Node.js 20.19+ or 22.12+ (22 LTS recommended).

```bash
npm ci
```

`package-lock.json` fetches every package from the public npm registry
(`registry.npmjs.org`), which the GitHub Pages workflow can always reach. An npm
configured to use a company mirror fetches through that mirror automatically.
If a dependency update writes a mirror's URLs into the lockfile, change them back
to `https://registry.npmjs.org/`; a test (`tests/deploy.lockfile.test.ts`) checks this.

```bash
npm run dev
```

Open the printed local address (for example `http://localhost:5173/`).

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the full test suite with Vitest. It covers musical correctness, round trips, the engine, MIDI, audio, catalog and UI smoke tests, and takes about 1 minute. |
| `npm run typecheck` | TypeScript strict check. |
| `npm run build` | Type-checks, then builds the static site into `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm run catalog` | Regenerates the built-in catalog from `public/scores/*.mxl`, `catalog/metadata.json` and `catalog/difficulty.json`. |

## Using the app

1. **Library.** It opens immediately. Search by title, composer or arrangement,
   or filter by difficulty: All, Beginner, Intermediate, Advanced or Unrated.
   - The ⓘ next to a level shows where it came from: a public listing of that
     exact arrangement, or the arrangement's own title ("per score").
   - "Needs review" marks pieces where the app had to make an assumption,
     such as notes written on the other hand's staff. They still play. The
     reasons are listed on the card and in **More → About this arrangement**.
2. **Import MusicXML…** adds your own `.musicxml`, `.xml` or `.mxl` file.
   Files are processed entirely in your browser and stored only there, in
   IndexedDB. Imported pieces get no difficulty tag.
3. **Practice page.**
   - **Hands**: Both hands / Right hand / Left hand.
   - **Passage**: "From measure … to …", or click a measure number in the
     instructions to start or end a passage there. **Repeat** loops it.
   - **Listen** plays the piece at its written rhythm, with speed from
     0.25× to 2×.
   - **Steady steps** gives every step the same time (default 1 s). This is
     movement practice, not the piece's rhythm.
   - **Follow me** (needs a MIDI piano) waits until you press the expected
     keys. Chords can be pressed one key at a time. Wrong keys get an amber ✕
     and the app waits until you release them.
     - It checks *notes*, not timing or pedalling.
     - Steps where a hand only lets go of keys advance by themselves.
   - **◀ / ▶** move one step; clicking a column jumps to it.
   - Shortcuts (when you're not typing in a field): Space play/pause, ←/→
     previous/next step, Home restart.
4. **Your place and settings** for each piece are remembered in this browser.

### The instructions

| Display | Meaning |
| --- | --- |
| Dark note or stack | Let go of everything this hand holds, then press these keys. |
| **Red** note, dot beneath | Press this key and keep the others held. If it's already held, lift it and press again. |
| **Blue** note, circle beneath | Let go of only this key. |
| `—` | No change for this hand. |
| `·` (big dot in the cell) | Let go of everything and stay silent. |

Notes stacked in one cell, and RH/LH cells in one column, happen together.
Keys use scientific names, sharps only: middle C is **C4**, and C#4 is the
black key just above it.

On the keyboard, **purple** means right hand and **green** means left hand
(with a small R or L on the key). Strong colour means press now; light colour
means keep holding. With a piano connected, a dark dot shows each key you're
holding. The sustain pedal is shown separately and never counts as a held
key.

### Connecting a digital piano

Connect the piano by USB (or a USB-MIDI interface), then click **Connect
piano** and allow MIDI access. If several MIDI inputs exist, choose yours.

- By default the browser does **not** play what you press, because your piano
  makes its own sound. **More → Hear my playing through the browser** turns it
  on.
- **More → Play through connected piano** sends the app's playback to the
  piano. It is off by default and needs you to choose an output device.

Web MIDI support depends on the browser:

| Browser | MIDI |
| --- | --- |
| Chrome and Edge (desktop) | Supported |
| Firefox | Supported in recent versions after a permission prompt |
| Safari | Not supported |

Without MIDI, Listen, Steady steps and manual stepping all still work.

### Tested environments

- **Browser:** the Chromium 152-based browser built into the Claude desktop
  app, at a 1280×800 laptop size, on macOS. Everything was exercised with the
  development server: library, search and filters, import, Listen, Steady
  steps, hands, passages, help and the diagnostics panel.
- **Automated tests:** run in Node (jsdom).
- **MIDI:** tested only with **simulated** MIDI events in automated tests. It
  has **not** been tested with physical MIDI hardware.
- **Other browsers:** Firefox, Safari and Edge have not been tested by hand.

## Deploying to GitHub Pages

The build uses relative asset paths (`base: './'`) and hash routing
(`#/piece/…`). The same build therefore works at
`https://<user>.github.io/<repo>/` or at a custom domain, and refreshing any
page works.

1. Create an empty GitHub repository (for example `piano-steps`).
2. In the repository, open **Settings → Pages → Build and deployment** and set
   **Source** to **GitHub Actions**.
3. Push this folder:

   ```bash
   git init -b main
   ```

   ```bash
   git add -A && git commit -m "Piano Steps"
   ```

   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   ```

   ```bash
   git push -u origin main
   ```

4. The workflow in `.github/workflows/deploy.yml` installs dependencies, runs
   the tests, builds, and publishes `dist/`. The site appears at
   `https://<user>.github.io/<repo>/` once the "Deploy to GitHub Pages" action
   finishes.

A GitHub Pages site is publicly reachable even if you only use it yourself.
Read the licensing notes below before publishing.

## Built-in library

The 69 MusicXML files in `public/scores/` come unchanged from
[musetrainer/library](https://github.com/musetrainer/library) (commit
`9128876`).

- 64 are in the catalog (36 ready to practise, 28 marked "Needs review").
- 5 were left out as content duplicates.
- Every file's status, difficulty source and rights note is listed in
  [docs/CATALOG_REPORT.md](docs/CATALOG_REPORT.md).

The catalog is generated, so the app never scrapes or parses the whole
library at runtime:

- `catalog/metadata.json` holds curated titles, arrangement descriptions and
  hand/part overrides (for example, leaving out an ossia part).
- `catalog/difficulty.json` holds difficulty labels with their sources, each
  for that exact arrangement, found while preparing the catalog; missing means
  Unrated. The research and re-check log is
  `docs/dev/difficulty-research-raw.json`. Every sourced label was re-checked
  by a later verification pass, which found the same level. This includes the
  labels taken from third-party listings of the same arrangement (LaSolSheet,
  and Scribd copies of MuseScore pages), re-checked on 2026-10-02. Where a
  listing page could not be opened directly, the level was read from
  search-engine copies of it.
- `npm run catalog` combines these with each parsed file into
  `src/catalog/catalog.json`, `catalog/inventory.json` and
  `docs/CATALOG_REPORT.md`.

### Removing a built-in piece

1. Delete the file from `public/scores/`.
2. Delete its entry from `catalog/metadata.json` (and `catalog/difficulty.json`
   if present).
3. Run `npm run catalog` and commit the regenerated files.

## Project structure

```
src/core/       MusicXML/MXL import, musical model (repeats, tempo, hands,
                key presses), action notation + independent interpreter,
                Follow-me matcher. Pure TypeScript, no browser APIs.
src/audio/      Web Audio piano sampler (Salamander samples) + fallback voice
src/midi/       Web MIDI access, message decoding, echo guard
src/engine/     PracticeSession: shared clock, scheduling, modes, looping
src/ui/         React UI (library, practice page, timeline, keyboard, dialogs)
src/storage/    localStorage preferences, IndexedDB imports
scripts/        build-catalog.ts
catalog/        curated metadata, difficulty provenance, inventory
tests/          Vitest suites and MusicXML fixtures
docs/           architecture, contracts, UI spec, catalog report, implementation report
```

## Privacy and local data

Nothing leaves your browser. The app makes no analytics or third-party
requests, and MIDI input is never transmitted anywhere.

Preferences, per-piece settings and imported pieces are stored in this
browser only, in localStorage and IndexedDB. Clearing the site's data, or
using **About & credits → Clear local data**, removes them.

## Licensing

- **Application code:** MIT ([LICENSE](LICENSE)). The design follows
  [MuseTrainer](https://github.com/musetrainer/source) (MIT), whose notice is
  kept in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Piano samples:** Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0.
- **Scores:** the source library calls itself "public domain" but has no
  license file. Many files are modern arrangements by named arrangers, and
  some carry conflicting rights text. One arrangement (Ode to Joy, Torby
  Brand) was removed from MuseScore after a copyright claim. The app's MIT
  license does **not** license these arrangements. Review
  [docs/CATALOG_REPORT.md](docs/CATALOG_REPORT.md) before publishing.
