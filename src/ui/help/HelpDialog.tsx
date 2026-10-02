import type { ReactNode } from 'react';
import type { HandCell, NoteToken } from '../../core/types';
import { Dialog } from '../common/Dialog';
import { Cell } from '../notation/Cell';
import { Token } from '../notation/Token';
import '../notation/notation.css';
import '../practice/practice.css';

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const t = (midi: number, label: string, action: NoteToken['action'], extra: Partial<NoteToken> = {}): NoteToken => ({
  midi,
  label,
  action,
  ...extra,
});

/** The worked example from the brief: one held C4 under a moving right-hand line. */
const WORKED_EXAMPLE: { cell: HandCell; held: string }[] = [
  { cell: { kind: 'replace', tokens: [t(60, 'C4', 'press')] }, held: 'C4' },
  { cell: { kind: 'change', tokens: [t(64, 'E4', 'add')] }, held: 'C4 E4' },
  { cell: { kind: 'change', tokens: [t(67, 'G4', 'add'), t(64, 'E4', 'release')] }, held: 'C4 G4' },
  { cell: { kind: 'change', tokens: [t(67, 'G4', 'release'), t(65, 'F4', 'add')] }, held: 'C4 F4' },
  { cell: { kind: 'rest', tokens: [] }, held: 'nothing' },
];

function Example({ children }: { children: ReactNode }) {
  return <span className="help-example">{children}</span>;
}

function Rule({ example, title, children }: { example: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="help-rule">
      <Example>{example}</Example>
      <div>
        <p className="help-rule__title">{title}</p>
        <p className="help-rule__text">{children}</p>
      </div>
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="help-kbd">{children}</kbd>;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="How to read and practise" size="large" className="help-dialog">
      <section className="help-section" aria-labelledby="help-rows">
        <h3 id="help-rows">Two rows, one for each hand</h3>
        <p>
          The <span className="help-hand help-hand--R">R</span> row is your right hand and the{' '}
          <span className="help-hand help-hand--L">L</span> row is your left hand. Read from left to right. Everything
          in one column happens at the same moment, and notes stacked in one cell are pressed together. Each
          instruction only affects its own hand.
        </p>
        <p>
          Keys are named by letter and octave: <span className="help-mono">C4</span> is middle C, the octave number
          goes up at every C, and black keys are written with a sharp, like <span className="help-mono">C#4</span>.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-five">
        <h3 id="help-five">The five instructions</h3>
        <ul className="help-rules">
          <Rule title="Dark note — play these instead" example={<Cell hand="R" cell={{ kind: 'replace', tokens: [t(67, 'G4', 'press'), t(60, 'C4', 'press')] }} />}>
            Let go of every key this hand is holding, then press the keys shown.
          </Rule>
          <Rule title="Red note with a dot — add" example={<Token hand="R" token={t(64, 'E4', 'add')} />}>
            Press this key and keep holding the others. If you are already holding it, lift it and press it again.
          </Rule>
          <Rule title="Blue note with a circle — let go of this one" example={<Token hand="R" token={t(64, 'E4', 'release')} />}>
            Lift only this key. Keep holding the rest.
          </Rule>
          <Rule title="Dash — no change" example={<Cell hand="L" cell={{ kind: 'hold', tokens: [] }} />}>
            Keep this hand exactly as it is: keep holding what you hold, or stay silent.
          </Rule>
          <Rule title="Big dot — rest" example={<Cell hand="L" cell={{ kind: 'rest', tokens: [] }} />}>
            Let go of every key in this hand and stay silent until the next instruction.
          </Rule>
        </ul>
        <p className="help-note">
          A cell can mix blue and red notes: lift the blue ones first, then press the red ones. A note with a dotted
          underline, like{' '}
          <span className="help-inline-token">
            <Token hand="R" token={t(55, 'G3', 'press', { carried: true })} />
          </span>
          , is already held when the chosen passage starts — press it to get ready.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-worked">
        <h3 id="help-worked">An example: one key held while the others move</h3>
        <div className="help-worked">
          <div className="nt-mini" role="group" aria-label="Example: right hand, five steps">
            {WORKED_EXAMPLE.map((col, i) => (
              <div key={i} className="nt-mini__col">
                <div className="nt-mini__head">Step {i + 1}</div>
                <div className="nt-mini__cell">
                  <Cell hand="R" cell={col.cell} />
                </div>
                <div className="nt-mini__held">
                  <span className="visually-hidden">Held afterwards: </span>
                  {col.held}
                </div>
              </div>
            ))}
          </div>
          <ol className="help-steps">
            <li>Press C4.</li>
            <li>Add E4 — now you hold C4 and E4.</li>
            <li>Lift E4 and add G4 — C4 and G4.</li>
            <li>Lift G4 and add F4 — C4 and F4.</li>
            <li>Let go of everything.</li>
          </ol>
        </div>
        <p className="help-note">The grey line under each step shows the keys held afterwards.</p>
      </section>

      <section className="help-section" aria-labelledby="help-keyboard">
        <h3 id="help-keyboard">The keyboard</h3>
        <p>
          Keys light up <strong className="help-rh">purple</strong> for the right hand and{' '}
          <strong className="help-lh">green</strong> for the left hand, with a small R or L on the key. A strong colour
          means press it now; a light colour means keep holding it. A key both hands hold is split in two. Every key the
          passage uses has its name on it, and middle C is marked.
        </p>
        <p>
          With a piano connected, a dark dot shows each key you are holding. In Follow me, a key you should not be
          pressing gets an amber dashed outline and a ✕. The pedal is shown separately and never counts as holding a
          key.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-modes">
        <h3 id="help-modes">Three ways to practise</h3>
        <dl className="help-modes">
          <dt>Listen</dt>
          <dd>
            Plays the piece at its written rhythm while the instructions scroll. Use Speed to slow it down. Long notes
            make the scrolling pause.
          </dd>
          <dt>Steady steps</dt>
          <dd>
            Every step gets the same amount of time, set by Seconds per step. This is for learning the movements — it
            is not the piece’s rhythm.
          </dd>
          <dt>Follow me</dt>
          <dd>
            Needs a digital piano connected by MIDI. It waits until you press the right keys, then moves on. You can
            press the keys of a chord one after another; they just need to be down together. If you press a wrong key,
            lift it and carry on — there is no need to start again. Steps that only let go of keys move on by
            themselves, and holding or releasing a little early or late is not checked. It checks the notes you press,
            not your timing or pedalling.
          </dd>
        </dl>
        <p>
          In any mode you can step through by hand with the arrow buttons, or click a column to jump to it. Click a
          measure number above the instructions to start or end your passage there, and turn on Repeat to loop it.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-midi">
        <h3 id="help-midi">Connecting your piano</h3>
        <ol className="help-list">
          <li>Connect the piano to this computer, usually with a USB cable, and switch it on.</li>
          <li>Click Connect piano and allow access if the browser asks.</li>
          <li>If more than one device appears, choose your piano from the list.</li>
        </ol>
        <p>
          Chrome and Edge can connect to a MIDI piano. Firefox asks for permission first. Safari can’t connect to MIDI
          pianos, but Listen, Steady steps and stepping by hand all work without one.
        </p>
        <p>
          Your piano makes its own sound, so the browser stays quiet while you play. To hear your playing through the
          computer, or to send playback to the piano, use More.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-keys">
        <h3 id="help-keys">Keyboard shortcuts</h3>
        <dl className="help-shortcuts">
          <dt>
            <Kbd>Space</Kbd>
          </dt>
          <dd>Play or pause</dd>
          <dt>
            <Kbd>←</Kbd> <Kbd>→</Kbd>
          </dt>
          <dd>Previous or next step</dd>
          <dt>
            <Kbd>Home</Kbd>
          </dt>
          <dd>Back to the start of the passage</dd>
        </dl>
        <p className="help-note">
          Shortcuts don’t apply while a dialog or a measure’s menu is open, or while a control you moved to with the
          Tab key is highlighted — Space or the arrows may work that control instead. Clicking the controls with the
          mouse doesn’t get in the way, and they keep working while the More panel is open.
        </p>
      </section>

      <section className="help-section" aria-labelledby="help-storage">
        <h3 id="help-storage">Your settings and pieces</h3>
        <p>
          Imported pieces and your settings are stored only in this browser. Clearing this site’s data removes them.
          Nothing you play is sent anywhere.
        </p>
      </section>
    </Dialog>
  );
}
