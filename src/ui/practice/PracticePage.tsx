import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { midi, sampler } from '../../app/services';
import { isAbortError, loadPiece, type LoadedPiece } from '../../catalog/loader';
import type { PracticeSettings, PreparedScore } from '../../core/types';
import { PracticeSession } from '../../engine/session';
import { loadGlobalPrefs, loadPieceState, saveGlobalPrefs, savePieceState } from '../../storage/prefs';
import { Badge } from '../common/Badge';
import { keepFocusOnMouse } from '../common/pointerFocus';
import { DifficultyBadge, DifficultyInfoButton } from '../common/DifficultyBadge';
import { ReadinessChip } from '../common/ReadinessChip';
import { HelpDialog } from '../help/HelpDialog';
import { Keyboard } from '../keyboard/Keyboard';
import { Timeline } from '../notation/Timeline';
import { ControlsBar } from './ControlsBar';
import { MidiNotice } from './ConnectPiano';
import { DiagnosticsDialog } from './DiagnosticsDialog';
import { useMidiConnection } from './midiConnection';
import { passageEndingAt, passageStartingAt, restoreSettings, stepIndexForTick } from './settings';
import { usePracticeShortcuts } from './shortcuts';
import { ModeNote, StatusLine } from './StatusLine';
import { nothingToPlayText } from './text';
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

function PageHeader({ piece, onHelp }: { piece: LoadedPiece; onHelp: () => void }) {
  const { prepared, entry } = piece;
  const sub = [piece.arrangement, piece.composer].filter((s): s is string => Boolean(s && s.trim()));
  return (
    <header className="ps-header">
      <a className="ps-back" href="#/">
        <span aria-hidden="true">←</span> Library
      </a>
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

  usePracticeShortcuts(
    {
      toggle: () => session.togglePlay(),
      prev: () => session.prev(),
      next: () => session.next(),
      restart: () => session.restart(),
    },
    !helpOpen && !aboutOpen,
  );

  const wholeKeys = useMemo(() => wholePieceKeys(prepared), [prepared]);
  const getPosition = useCallback(() => session.getVisualPosition(), [session]);
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

  return (
    <main className="ps-page">
      <PageHeader piece={piece} onHelp={() => setHelpOpen(true)} />

      <ControlsBar
        session={session}
        settings={settings}
        status={snapshot.status}
        stepIndex={snapshot.stepIndex}
        stepCount={snapshot.stepCount}
        canFollow={snapshot.midiInputConnected}
        measures={prepared.measures}
        midi={conn}
        onOutputChange={onOutputChange}
        onOpenAbout={() => setAboutOpen(true)}
        defaultTempoQpm={prepared.tempo.defaulted ? (prepared.tempo.points[0]?.qpm ?? 120) : null}
      />
      <MidiNotice conn={conn} />

      <div className="ps-main">
        <ModeNote mode={settings.mode} />
        <Timeline
          sequence={sequence}
          measures={prepared.measures}
          stepIndex={snapshot.stepIndex}
          getPosition={getPosition}
          onSeek={onSeek}
          onPassageStart={onPassageStart}
          onPassageEnd={onPassageEnd}
          emptyMessage={nothingToPlayText(settings)}
        />
        <Keyboard
          frameKeys={fitWholePiece ? wholeKeys : sequence.usedKeys}
          labelKeys={sequence.usedKeys}
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
        />
      </div>

      <StatusLine snapshot={snapshot} />

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
      <a className="ps-back" href="#/">
        <span aria-hidden="true">←</span> Library
      </a>
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
