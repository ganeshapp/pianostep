import { useMemo, useState } from 'react';
import { getCatalog } from '../../catalog/loader';
import { clearAllLocalData } from '../../storage/prefs';
import { ConfirmDialog, Dialog } from '../common/Dialog';
import './about.css';

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
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
SOFTWARE.`;

function mitNotice(copyright: string): string {
  return `MIT License\n\n${copyright}\n\n${MIT_TERMS}`;
}

const APP_COPYRIGHT = 'Copyright (c) 2026 Piano Steps contributors';
const MUSETRAINER_COPYRIGHT = 'Copyright (c) 2021 Rodrigo Jorge Vilar de Linares';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after "Clear local data" succeeds, so pages can refresh what they show. */
  onDataCleared?: () => void;
}

export function AboutDialog({ open, onClose, onDataCleared }: AboutDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<{ ok: boolean; message: string } | null>(null);

  const rightsNotes = useMemo(
    () =>
      getCatalog()
        .filter((e) => (e.licenseNote && e.licenseNote.trim()) || (e.rightsInFile && e.rightsInFile.trim()))
        .map((e) => ({ id: e.id, title: e.title, arrangement: e.arrangement, note: e.licenseNote, rights: e.rightsInFile }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [],
  );

  const close = () => {
    setClearResult(null);
    onClose();
  };

  const clearData = async () => {
    setClearing(true);
    try {
      await clearAllLocalData();
      setClearResult({ ok: true, message: 'Your settings and imported pieces have been removed from this browser.' });
      onDataCleared?.();
    } catch (e) {
      setClearResult({
        ok: false,
        message: e instanceof Error && e.message ? e.message : 'Some local data could not be removed.',
      });
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={close} title="About & credits" size="large" className="about-dialog">
        <section aria-labelledby="about-what">
          <h3 id="about-what">What this is</h3>
          <p>
            Piano Steps helps you learn piano pieces by following key names, such as C4 or F#3, instead of reading sheet
            music. Each step shows which keys to press, hold and release, with a large labelled keyboard underneath. It can
            play a piece for you, move through it at a steady pace, or wait for you to play the right keys on a digital
            piano connected by MIDI.
          </p>
          <p>
            The key-by-key instructions are a practical reading of the written notes, not professional fingering or an
            expressive performance.
          </p>
        </section>

        <section aria-labelledby="about-privacy">
          <h3 id="about-privacy">Privacy</h3>
          <p>
            There are no accounts, no analytics and no tracking. Everything happens in this browser: files you import are
            read on this device and never uploaded, and the notes you play on a connected piano never leave the browser.
          </p>
        </section>

        <section aria-labelledby="about-data">
          <h3 id="about-data">Your data</h3>
          <p>
            Imported pieces and your settings are stored only in this browser. Clearing this site’s data removes them, and
            they are not shared with your other browsers or devices.
          </p>
          <div className="about-clear">
            <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={clearing}>
              Clear local data…
            </button>
            {clearResult && (
              <p role={clearResult.ok ? 'status' : 'alert'} className="about-clear-result">
                {clearResult.message}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="about-midi">
          <h3 id="about-midi">Connecting a digital piano</h3>
          <p>A piano connected by USB or Bluetooth MIDI works in browsers that support Web MIDI:</p>
          <ul>
            <li>Chrome and Edge: supported.</li>
            <li>Firefox: supported in recent versions; it asks for your permission first.</li>
            <li>Safari: not supported. Listen, Steady steps and manual stepping still work.</li>
          </ul>
        </section>

        <section aria-labelledby="about-pieces">
          <h3 id="about-pieces">Built-in pieces</h3>
          <p>
            The built-in pieces are MusicXML files copied unchanged from the{' '}
            <ExternalLink href="https://github.com/musetrainer/library">MuseTrainer library</ExternalLink>, which
            describes itself as a public domain MusicXML library. Most are arrangements shared by MuseScore users. The
            compositions are mostly old and in the public domain, but individual arrangements may carry their own rights.
            See “About this arrangement” on each piece for its rights text and any notes.
          </p>
          <p>The app’s MIT licence covers its code only. It does not license any musical arrangement.</p>
          {rightsNotes.length > 0 && (
            <details className="about-details">
              <summary>Rights notes for individual pieces ({rightsNotes.length})</summary>
              <ul className="about-rights-list">
                {rightsNotes.map((n) => (
                  <li key={n.id}>
                    <strong>{n.title}</strong>
                    {n.arrangement && <span className="muted"> — {n.arrangement}</span>}
                    {n.rights && n.rights.trim() && <p>Rights text in the file: “{n.rights.trim()}”</p>}
                    {n.note && n.note.trim() && <p>{n.note.trim()}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section aria-labelledby="about-sound">
          <h3 id="about-sound">Piano sound</h3>
          <p>
            Piano samples from the Salamander Grand Piano V3 by Alexander Holm, licensed under{' '}
            <ExternalLink href="https://creativecommons.org/licenses/by/3.0/">
              Creative Commons Attribution 3.0 (CC BY 3.0)
            </ExternalLink>
            . Source:{' '}
            <ExternalLink href="https://archive.org/details/SalamanderGrandPianoV3">
              archive.org/details/SalamanderGrandPianoV3
            </ExternalLink>
            . The app uses the single-velocity subset distributed with the Tone.js Piano package (MIT) and bundled by
            MuseTrainer.
          </p>
        </section>

        <section aria-labelledby="about-licences">
          <h3 id="about-licences">Licences</h3>
          <p>
            Piano Steps is released under the MIT License. Its design (measure-range looping, speed control, MIDI practice
            and a built-in library) was informed by{' '}
            <ExternalLink href="https://github.com/musetrainer/source">MuseTrainer</ExternalLink> (MIT); no MuseTrainer
            application code is copied. Its notice is reproduced because its piano samples and library are reused.
          </p>
          <details className="about-details">
            <summary>Piano Steps licence (MIT)</summary>
            <pre className="license-text">{mitNotice(APP_COPYRIGHT)}</pre>
          </details>
          <details className="about-details">
            <summary>MuseTrainer licence (MIT)</summary>
            <pre className="license-text">{mitNotice(MUSETRAINER_COPYRIGHT)}</pre>
          </details>
          <p>
            Also used: React and React DOM (MIT), fflate (MIT) and idb-keyval (Apache License 2.0).
          </p>
        </section>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        title="Clear local data?"
        confirmLabel={clearing ? 'Clearing…' : 'Clear local data'}
        busy={clearing}
        onConfirm={() => void clearData()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          This removes all your imported pieces and saved settings from this browser. Built-in pieces stay available. This
          can’t be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
