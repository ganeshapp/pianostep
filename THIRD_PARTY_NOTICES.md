# Third-party notices

Piano Steps is a personal, non-commercial practice tool. Code licensing is
separate from the provenance of the bundled musical scores and audio samples.
The MIT license on this repository covers the application code only. It does
not license any musical arrangement.

## MuseTrainer (design reference, MIT)

The feature set (measure-range looping, speed control, MIDI practice, built-in
library) and the piano sample set come from MuseTrainer:
https://github.com/musetrainer/source (inspected at commit d394a95, v1.8.0).
No MuseTrainer application code is copied. Its notice is reproduced here
because its bundled samples and library are reused.

```
MIT License

Copyright (c) 2021 Rodrigo Jorge Vilar de Linares

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Piano samples — Salamander Grand Piano V3 (CC BY 3.0)

`public/audio/piano/*.mp3` are Salamander Grand Piano V3 samples by
Alexander Holm, licensed under Creative Commons Attribution 3.0:
https://archive.org/details/SalamanderGrandPianoV3. They are the
velocity-8 subset distributed with `@tonejs/piano` (MIT) and bundled by
MuseTrainer.

## Built-in scores — musetrainer/library

`public/scores/*.mxl` (69 files) are copied unchanged from
https://github.com/musetrainer/library (commit 9128876, 2024-11-29). That
repository describes itself as a "public domain MusicXML library" but has no
license file. Most files are MuseScore exports of user-made arrangements. The
compositions are mostly old and public domain, but several *arrangements* are
modern works by named arrangers. Some files carry rights text that conflicts
with the "public domain" description, and at least one arrangement's MuseScore
page reports a copyright claim. Each file's rights text and any licensing
caveat is listed per file in [`docs/CATALOG_REPORT.md`](docs/CATALOG_REPORT.md)
and shown in the app's "About this arrangement" panel. If you publish this site
publicly, review those notes and remove any file you are not comfortable
redistributing (see README → "Removing a built-in piece").

## JavaScript dependencies

- React / React DOM: MIT
- fflate: MIT
- idb-keyval: Apache-2.0
- Vite, Vitest, TypeScript, jsdom, @xmldom/xmldom, tsx: build and test only
  (MIT, MIT, Apache-2.0, MIT, MIT, MIT)
