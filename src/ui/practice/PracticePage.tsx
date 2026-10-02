import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { midi, sampler } from '../../app/services';
import { isAbortError, loadPiece, type LoadedPiece } from '../../catalog/loader';
import { deriveSteps } from '../../core/actions/derive';
import type { Hand, PracticeSettings, PreparedScore, StepSequence } from '../../core/types';
import { PracticeSession } from '../../engine/session';
import { loadGlobalPrefs, loadPieceState, saveGlobalPrefs, savePieceState } from '../../storage/prefs';
import { Badge } from '../common/Badge';
import { LogoMark } from '../common/Logo';
import { keepFocusOnMouse } from '../common/pointerFocus';
import { DifficultyBadge, DifficultyInfoButton } from '../common/DifficultyBadge';
import { ReadinessChip } from '../common/ReadinessChip';
import { HelpDialog } from '../help/HelpDialog';
import { KeyAudition } from '../keyboard/audition';
import { Keyboard } from '../keyboard/Keyboard';
import { NotationLegend } from '../notation/Legend';
import { Timeline } from '../notation/Timeline';
import { ControlsBar } from './ControlsBar';
import { MidiNotice } from './ConnectPiano';
import { DiagnosticsDialog } from './DiagnosticsDialog';
import { useMidiConnection } from './midiConnection';
import { playWillStart, revealScroll } from './practiceFocus';
import { passageEndingAt, passageStartingAt, restoreSettings, stepIndexForTick } from './settings';
import { SetupPanel } from './SetupPanel';
import { usePracticeShortcuts } from './shortcuts';
import {
  NOT_PRACTISING,
  nothingToPlayText,
  setupSummary,
  startingSetup,
  startingSetupHandText,
  STARTING_SETUP_NOTE,
} from './text';
import { TransportBar, type TransportActions } from './TransportBar';
import './practice.css';

const SAVE_DELAY_MS = 600;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; piece: LoadedPiece };

function errorText(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return 'This piece could not be opened.';
}

/** Every key the piece uses, so "Whole piece" framing never moves while practising. */
function wholePieceKeys(prepared: Pick<PreparedScore, 'presses'>): number[] {
  return [...new Set(prepared.presses.map((p) => p.midi))].sort((a, b) => a - b);
}

/**
 * The passage with both hands, whichever hands are being practised. The
 * keyboard is framed and labelled from it, and the timeline's rows are sized
 * from it, so choosing a hand changes only what is shown in them, never the
 * layout.
 */
function useBothHandsSequence(
  prepared: PreparedScore,
  sequence: StepSequence,
  range: PracticeSettings['range'],
): StepSequence {
  return useMemo(
    () => (sequence.hands.length >= 2 ? sequence : deriveSteps(prepared, ['R', 'L'], range)),
    [prepared, sequence, range],
  );
}

/**
 * Whether the practice settings are open. Remembered across pieces and
 * visits; they fold away by themselves when playback or Follow me starts.
 * Connecting a piano that needs a choice from the list, or a keyboard-used
 * piano notice whose focus must land on the piano control, opens them.
 */
function useSetupOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => !loadGlobalPrefs().setupCollapsed);
  const current = useRef(open);
  const change = useCallback((next: boolean) => {
    if (current.current === next) return;
    current.current = next;
    setOpen(next);
    saveGlobalPrefs({ setupCollapsed: !next });
  }, []);
  return [open, change];
}

/**
 * The starting setup line above the notes, when the passage begins with keys
 * already held. It is read from the passage with both hands (`bothHands`), so
 * it never comes and goes, or rewraps, as hands are switched: a hand that is
 * not being practised keeps its place and words, only muted (and read out as
 * "not practising"), like its empty row in the notes.
 */
function StartingSetup({ bothHands, practising }: { bothHands: StepSequence; practising: readonly Hand[] }) {
  const setup = startingSetup(bothHands);
  if (setup.length === 0) return null;
  const anyPractised = setup.some((s) => practising.includes(s.hand));
  return (
    <p className={`ps-start-setup${anyPractised ? '' : ' is-off'}`} role="note">
      <strong className="ps-start-setup__label">Starting setup</strong>
      {' — '}
      <span className="ps-start-setup__keys">
        {setup.map((entry, i) => {
          const on = practising.includes(entry.hand);
          const text = startingSetupHandText(entry);
          const at = text.indexOf(':');
          return (
            <Fragment key={entry.hand}>
              {i > 0 && ' · '}
              <span
                className={`ps-start-setup__hand${on ? '' : ' is-off'}`}
                data-hand={entry.hand}
                title={on ? undefined : 'Not practising this hand'}
              >
                {text.slice(0, at)}
                {!on && <span className="visually-hidden">{NOT_PRACTISING}</span>}
                {text.slice(at)}
              </span>
            </Fragment>
          );
        })}
      </span>
      .{' '}
      <span className="ps-start-setup__note">{STARTING_SETUP_NOTE}</span>
    </p>
  );
}

/**
 * Saves settings and the current step shortly after they change, and once
 * more on leaving. While a saved Follow me is waiting for the piano
 * (`pendingFollow`), Follow me stays the saved mode: the Listen fallback is
 * never stored over it.
 */
function usePieceStateSaver(
  pieceId: string,
  shown: PracticeSettings,
  stepTick: number | null,
  pendingFollow: boolean,
): void {
  const settings = useMemo(
    () => (pendingFollow && shown.mode !== 'follow' ? { ...shown, mode: 'follow' as const } : shown),
    [shown, pendingFollow],
  );
  const latest = useRef({ settings, stepTick });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    savePieceState(pieceId, latest.current);
  }, [pieceId]);

  useEffect(() => {
    latest.current = { settings, stepTick };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      savePieceState(pieceId, latest.current);
    }, SAVE_DELAY_MS);
  }, [pieceId, settings, stepTick]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);
}

/** The small mark and "Library": the way back from every practice screen. */
function BackToLibrary() {
  return (
    <a className="ps-back" href="#/" title="Back to the library">
      <LogoMark size={28} className="ps-back__mark" />
      <span className="ps-back__text">Library</span>
    </a>
  );
}

function PageHeader({ piece, onHelp }: { piece: LoadedPiece; onHelp: () => void }) {
  const { prepared, entry } = piece;
  const sub = [piece.arrangement, piece.composer].filter((s): s is string => Boolean(s && s.trim()));
  return (
    <header className="ps-header">
      <BackToLibrary />
      <div className="ps-header__titles">
        <h1 className="ps-title">{piece.title}</h1>
        {sub.length > 0 && <p className="ps-subtitle">{sub.join(' · ')}</p>}
      </div>
      <div className="ps-header__badges">
        {entry ? (
          <span className="ps-header__difficulty">
            <DifficultyBadge info={entry.difficulty} />
            <DifficultyInfoButton info={entry.difficulty} pieceTitle={piece.title} />
          </span>
        ) : (
          <Badge tone="plain">Imported</Badge>
        )}
        <ReadinessChip readiness={prepared.readiness} reasons={prepared.readinessReasons} />
      </div>
      <button
        type="button"
        className="ps-help-btn"
        onMouseDown={keepFocusOnMouse}
        onClick={onHelp}
        aria-label="Help: how to read and practise"
      >
        ?
      </button>
    </header>
  );
}

interface PracticeViewProps {
  pieceId: string;
  piece: LoadedPiece;
  session: PracticeSession;
  /** The piece was saved in Follow me but opened in Listen because no piano is connected yet. */
  wantsFollow: boolean;
}

/**
 * A saved Follow me that fell back to Listen (no piano yet) comes back as soon
 * as the piano connects, unless the learner chose another mode or started
 * Listen playback in the meantime. Returns true while it is still waiting.
 */
function usePendingFollow(
  session: PracticeSession,
  wantsFollow: boolean,
  mode: PracticeSettings['mode'],
  running: boolean,
  pianoConnected: boolean,
): boolean {
  const [pending, setPending] = useState(wantsFollow);
  useEffect(() => {
    if (!pending) return;
    if (mode !== 'listen' || running) {
      setPending(false);
    } else if (pianoConnected) {
      setPending(false);
      session.updateSettings({ mode: 'follow' });
    }
  }, [pending, mode, running, pianoConnected, session]);
  return pending;
}

function PracticeView({ pieceId, piece, session, wantsFollow }: PracticeViewProps) {
  const subscribe = useCallback((fn: () => void) => session.subscribe(fn), [session]);
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const { settings, sequence } = snapshot;
  const prepared = piece.prepared;
  const occCount = prepared.measures.length;

  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [fitWholePiece, setFitWholePiece] = useState(() => loadGlobalPrefs().fitWholePiece);
  const [savedInputName] = useState(() => loadGlobalPrefs().midiInputName);
  const [setupOpen, setSetupOpen] = useSetupOpen();
  /** Bumped by every transport action, which brings the notes back to the marker. */
  const [recenterKey, setRecenterKey] = useState(0);
  /** Bumped when practice starts: the practice area is scrolled into view once the settings have folded. */
  const [revealKey, setRevealKey] = useState(0);
  const practiceRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const area = practiceRef.current;
    if (revealKey === 0 || !area) return;
    const by = revealScroll(area.getBoundingClientRect(), window.innerHeight);
    if (by <= 0) return;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' });
  }, [revealKey]);

  const pendingFollow = usePendingFollow(
    session,
    wantsFollow,
    settings.mode,
    snapshot.status === 'playing' || snapshot.status === 'count-in',
    snapshot.midiInputConnected,
  );
  usePieceStateSaver(pieceId, settings, sequence.steps[snapshot.stepIndex]?.tick ?? null, pendingFollow);

  const conn = useMidiConnection(midi, {
    savedInputId: settings.midiInputId,
    savedInputName,
    onConnected: (id, name) => {
      saveGlobalPrefs({ midiInputName: name });
      if (session.getSnapshot().settings.midiInputId !== id) session.updateSettings({ midiInputId: id });
    },
  });

  // The piano list (several devices) and the piano control that keyboard focus
  // returns to after Connect / Try again / Dismiss live in the settings.
  useEffect(() => {
    if (conn.phase === 'choose' || conn.focusFrom) setSetupOpen(true);
  }, [conn.phase, conn.focusFrom, setSetupOpen]);

  const actions = useMemo<TransportActions>(() => {
    const recenter = (): void => setRecenterKey((k) => k + 1);
    return {
      togglePlay: () => {
        // Starting playback or Follow me folds the settings away and brings
        // the notes and keyboard into view. When Play cannot start (nothing
        // to play, or Follow me without a piano) the settings stay open: the
        // message points at them.
        if (playWillStart(session.getSnapshot())) {
          setSetupOpen(false);
          setRevealKey((k) => k + 1);
        }
        recenter();
        session.togglePlay();
      },
      restart: () => {
        recenter();
        session.restart();
      },
      prev: () => {
        recenter();
        session.prev();
      },
      next: () => {
        recenter();
        session.next();
      },
      stop: () => {
        recenter();
        session.stop();
      },
    };
  }, [session, setSetupOpen]);

  usePracticeShortcuts(
    {
      toggle: actions.togglePlay,
      prev: actions.prev,
      next: actions.next,
      restart: actions.restart,
    },
    !helpOpen && !aboutOpen,
  );

  const wholeKeys = useMemo(() => wholePieceKeys(prepared), [prepared]);
  const bothHands = useBothHandsSequence(prepared, sequence, settings.range);
  const audition = useMemo(() => new KeyAudition(sampler), []);
  useEffect(() => () => audition.releaseAll(), [audition]);

  const getPosition = useCallback(() => session.getVisualPosition(), [session]);
  const getPassageTime = useCallback(() => session.getPassageTime(), [session]);
  const onSeek = useCallback((i: number) => session.seek(i), [session]);
  const onPassageStart = useCallback(
    (occ: number) =>
      session.updateSettings({ range: passageStartingAt(session.getSnapshot().settings.range, occ, occCount) }),
    [session, occCount],
  );
  const onPassageEnd = useCallback(
    (occ: number) =>
      session.updateSettings({ range: passageEndingAt(session.getSnapshot().settings.range, occ, occCount) }),
    [session, occCount],
  );

  const onOutputChange = (id: string | null): void => {
    session.updateSettings({ midiOutputId: id });
    saveGlobalPrefs({ midiOutputName: id === null ? null : (conn.outputs.find((o) => o.id === id)?.name ?? null) });
  };

  const onFitChange = (whole: boolean): void => {
    setFitWholePiece(whole);
    saveGlobalPrefs({ fitWholePiece: whole });
  };

  const playing = snapshot.status === 'playing' || snapshot.status === 'count-in';

  return (
    <main className="ps-page">
      <PageHeader piece={piece} onHelp={() => setHelpOpen(true)} />

      <SetupPanel
        expanded={setupOpen}
        onExpandedChange={setSetupOpen}
        summary={setupSummary(settings, prepared.measures)}
      >
        <ControlsBar
          session={session}
          settings={settings}
          canFollow={snapshot.midiInputConnected}
          measures={prepared.measures}
          midi={conn}
          onOutputChange={onOutputChange}
          onOpenAbout={() => setAboutOpen(true)}
          defaultTempoQpm={prepared.tempo.defaulted ? (prepared.tempo.points[0]?.qpm ?? 120) : null}
        />
      </SetupPanel>
      <MidiNotice conn={conn} />

      <div ref={practiceRef} className="ps-practice">
        <section className="ps-notes" aria-label="Notes">
          <div className="ps-notes__head">
            <NotationLegend />
          </div>
          <StartingSetup bothHands={bothHands} practising={sequence.hands} />
          <Timeline
            sequence={sequence}
            layoutSequence={bothHands}
            measures={prepared.measures}
            stepIndex={snapshot.stepIndex}
            getPosition={getPosition}
            onSeek={onSeek}
            onPassageStart={onPassageStart}
            onPassageEnd={onPassageEnd}
            emptyMessage={nothingToPlayText(settings)}
            browsable={!playing}
            recenterKey={recenterKey}
          />
        </section>

        <TransportBar snapshot={snapshot} actions={actions} getPassageTime={getPassageTime} />

        <Keyboard
          frameKeys={fitWholePiece ? wholeKeys : bothHands.usedKeys}
          labelKeys={bothHands.usedKeys}
          expected={snapshot.expected}
          struck={snapshot.struck}
          physicalDown={snapshot.physicalDown}
          wrong={snapshot.wrong}
          pedalDown={snapshot.pedalDown}
          hands={sequence.hands}
          showPhysical={snapshot.midiInputConnected}
          showWrong={settings.mode === 'follow'}
          fitWholePiece={fitWholePiece}
          onFitChange={onFitChange}
          audition={audition}
        />
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <DiagnosticsDialog open={aboutOpen} onClose={() => setAboutOpen(false)} piece={piece} />
    </main>
  );
}

/** Creates one session per loaded piece and disposes it when the page goes away. */
function SessionHost({ pieceId, piece }: { pieceId: string; piece: LoadedPiece }) {
  const [started, setStarted] = useState<{ session: PracticeSession; wantsFollow: boolean } | null>(null);

  useEffect(() => {
    const saved = loadPieceState(pieceId);
    const settings = restoreSettings(saved?.settings, piece.prepared.measures.length, midi.inputConnected);
    const s = new PracticeSession(piece.prepared, settings, {
      sampler,
      midi,
      // The saved output is found again by name if the browser now lists it under another id.
      midiOutputName: loadGlobalPrefs().midiOutputName,
    });
    const start = stepIndexForTick(s.getSnapshot().sequence.steps, saved?.stepTick ?? null);
    if (start > 0) s.seek(start);
    setStarted({ session: s, wantsFollow: saved?.settings?.mode === 'follow' && settings.mode !== 'follow' });
    return () => s.dispose();
  }, [pieceId, piece]);

  if (!started) return <PageMessage title="Getting ready…" />;
  return <PracticeView pieceId={pieceId} piece={piece} session={started.session} wantsFollow={started.wantsFollow} />;
}

function PageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="ps-page ps-page--message">
      <BackToLibrary />
      <div className="ps-message" role="status">
        <p className="ps-message__title">{title}</p>
        {children}
      </div>
    </main>
  );
}

export function PracticePage({ pieceId }: { pieceId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadPiece(pieceId, controller.signal).then(
      (piece) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', piece });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState({ status: 'error', message: errorText(err) });
      },
    );
    return () => controller.abort();
  }, [pieceId, attempt]);

  if (state.status === 'loading') return <PageMessage title="Loading piece…" />;

  if (state.status === 'error') {
    return (
      <PageMessage title="This piece could not be opened">
        <p className="ps-message__text">{state.message}</p>
        <p className="ps-message__actions">
          <a className="btn btn-primary" href="#/">
            Back to library
          </a>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      </PageMessage>
    );
  }

  const { piece } = state;
  if (piece.prepared.readiness === 'unsupported') {
    return (
      <PageMessage title="This piece can’t be used for practice">
        <ul className="ps-message__reasons">
          {(piece.prepared.readinessReasons.length > 0
            ? piece.prepared.readinessReasons
            : ['The app could not find anything to play in this score.']
          ).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p className="ps-message__actions">
          <a className="btn btn-primary" href="#/">
            Back to library
          </a>
        </p>
      </PageMessage>
    );
  }

  return <SessionHost key={pieceId} pieceId={pieceId} piece={piece} />;
}
