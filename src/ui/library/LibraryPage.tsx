import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImportError } from '../../core/xml';
import { getCatalog, getCatalogEntry } from '../../catalog/loader';
import { deleteImport, importFile, isImportId, listImports } from '../../storage/imports';
import type { ImportedPieceMeta, ImportStage } from '../../storage/imports';
import { loadGlobalPrefs, removePieceState, saveGlobalPrefs } from '../../storage/prefs';
import { ConfirmDialog } from '../common/Dialog';
import { AboutDialog } from '../about/AboutDialog';
import { HelpDialog } from '../help/HelpDialog';
import { parseHash, pieceHref } from '../router';
import { DIFFICULTY_FILTERS, filterCatalog, matchesQuery, passesReadiness } from './filter';
import type { DifficultyFilter } from './filter';
import { countText } from './format';
import { BuiltinCard, ImportCard } from './LibraryCard';
import './library.css';

export const IMPORT_ACCEPT = '.musicxml,.xml,.mxl';

type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'working'; fileName: string; stage: ImportStage }
  | { kind: 'done'; meta: ImportedPieceMeta }
  | { kind: 'error'; fileName: string; message: string };

const STAGE_TEXT: Record<ImportStage, string> = {
  reading: 'Reading the file…',
  checking: 'Checking the score…',
  saving: 'Saving it in this browser…',
};

/** Search and filters survive a visit to a piece (not a reload). */
const viewMemory = {
  query: '',
  difficulty: 'All' as DifficultyFilter,
  showReview: true,
  scrollY: 0,
};

function importErrorMessage(e: unknown): string {
  if (e instanceof ImportError) return e.message;
  return 'Something went wrong while importing this file. Please try again.';
}

function plainErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function LibraryPage() {
  const catalog = getCatalog();
  const searchId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importsHeadingRef = useRef<HTMLHeadingElement>(null);
  const refocusAfterDelete = useRef(false);

  const [query, setQuery] = useState(viewMemory.query);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>(viewMemory.difficulty);
  const [showReview, setShowReview] = useState(viewMemory.showReview);

  const [imports, setImports] = useState<ImportedPieceMeta[] | null>(null);
  const [importsError, setImportsError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ kind: 'idle' });
  const [pendingDelete, setPendingDelete] = useState<ImportedPieceMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [lastPieceId, setLastPieceId] = useState<string | null>(() => loadGlobalPrefs().lastPieceId);

  useEffect(() => {
    viewMemory.query = query;
    viewMemory.difficulty = difficulty;
    viewMemory.showReview = showReview;
  }, [query, difficulty, showReview]);

  const refreshImports = useCallback(async () => {
    try {
      setImports(await listImports());
      setImportsError(null);
    } catch (e) {
      setImports([]);
      setImportsError(plainErrorMessage(e, 'Imported pieces could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    void refreshImports();
  }, [refreshImports]);

  // The deleted card took the focused Delete button with it; keep keyboard users in place.
  useEffect(() => {
    if (!refocusAfterDelete.current) return;
    refocusAfterDelete.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    (importsHeadingRef.current ?? importButtonRef.current)?.focus();
  }, [imports]);

  // Return to where the reader was in the list once everything above it has rendered.
  const restoredScroll = useRef(false);
  useLayoutEffect(() => {
    if (restoredScroll.current || imports === null) return;
    restoredScroll.current = true;
    if (viewMemory.scrollY > 0) window.scrollTo(0, viewMemory.scrollY);
  }, [imports]);
  useEffect(() => {
    const onScroll = () => {
      // Ignore the jump to the top that happens when a piece opens.
      if (parseHash(window.location.hash).name === 'library') viewMemory.scrollY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const result = useMemo(() => filterCatalog(catalog, query, difficulty, showReview), [catalog, query, difficulty, showReview]);

  // Imports have no difficulty, so they only show under "All".
  const visibleImports = useMemo(() => {
    if (!imports || difficulty !== 'All') return [];
    return imports.filter(
      (m) => passesReadiness(m.readiness, showReview) && matchesQuery([m.title, m.composer, m.fileName], query),
    );
  }, [imports, difficulty, showReview, query]);

  const continueTarget = useMemo(() => {
    if (!lastPieceId) return null;
    if (isImportId(lastPieceId)) {
      const meta = imports?.find((m) => m.id === lastPieceId);
      return meta && meta.readiness !== 'unsupported' ? { id: meta.id, title: meta.title, detail: null } : null;
    }
    const entry = getCatalogEntry(lastPieceId);
    return entry && entry.readiness !== 'unsupported'
      ? { id: entry.id, title: entry.title, detail: entry.arrangement || null }
      : null;
  }, [lastPieceId, imports]);

  const filtersActive = query.trim() !== '' || difficulty !== 'All' || !showReview;
  const nothingMatches = result.entries.length === 0 && visibleImports.length === 0;

  const clearFilters = () => {
    setQuery('');
    setDifficulty('All');
    setShowReview(true);
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires a change.
    input.value = '';
    if (!file) return;
    setImportStatus({ kind: 'working', fileName: file.name, stage: 'reading' });
    try {
      const meta = await importFile(file, {
        onProgress: (stage) => setImportStatus({ kind: 'working', fileName: file.name, stage }),
      });
      setImportStatus({ kind: 'done', meta });
      await refreshImports();
    } catch (err) {
      setImportStatus({ kind: 'error', fileName: file.name, message: importErrorMessage(err) });
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteImport(target.id);
      removePieceState(target.id);
      if (lastPieceId === target.id) {
        saveGlobalPrefs({ lastPieceId: null });
        setLastPieceId(null);
      }
      setDeleteError(null);
      refocusAfterDelete.current = true;
      if (importStatus.kind === 'done' && importStatus.meta.id === target.id) setImportStatus({ kind: 'idle' });
    } catch (err) {
      setDeleteError(plainErrorMessage(err, 'The piece could not be deleted.'));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
      await refreshImports();
    }
  };

  const onDataCleared = () => {
    setLastPieceId(null);
    setImportStatus({ kind: 'idle' });
    void refreshImports();
  };

  const working = importStatus.kind === 'working';

  return (
    <div className="library">
      <header className="app-header">
        <div className="brand">
          <h1 className="brand-name">Piano Steps</h1>
          <p className="brand-tagline">Follow key names instead of sheet music</p>
        </div>
        <div className="header-actions">
          <button
            ref={importButtonRef}
            type="button"
            className="btn btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={working}
          >
            Import MusicXML…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => void onFileChosen(e)}
          />
          <button type="button" className="btn btn-quiet" onClick={() => setHelpOpen(true)}>
            <span aria-hidden="true" className="help-icon">
              ?
            </span>
            Help
          </button>
        </div>
      </header>

      <main className="library-main" id="main">
        {continueTarget && (
          <p className="continue">
            <a className="continue-link" href={pieceHref(continueTarget.id)}>
              Continue: {continueTarget.title}
            </a>
            {continueTarget.detail && <span className="continue-detail">{continueTarget.detail}</span>}
          </p>
        )}

        <ImportStatusView
          status={importStatus}
          onDismiss={() => setImportStatus({ kind: 'idle' })}
          onRetry={() => fileRef.current?.click()}
        />

        <section className="library-controls" aria-label="Find a piece">
          <div className="search-field">
            <label htmlFor={searchId}>Search</label>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder="Title, composer or arrangement"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="difficulty-filter" role="group" aria-label="Difficulty">
            {DIFFICULTY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="chip"
                aria-pressed={difficulty === f}
                onClick={() => setDifficulty(f)}
              >
                {f}
                <span className="chip-count">
                  <span className="visually-hidden">, </span>
                  {result.counts[f]}
                  <span className="visually-hidden">{result.counts[f] === 1 ? ' piece' : ' pieces'}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="review-toggle">
            <input type="checkbox" checked={showReview} onChange={(e) => setShowReview(e.target.checked)} />
            Show pieces that need review
          </label>
        </section>

        {importsError && (
          <p className="library-notice" role="status">
            {importsError}
          </p>
        )}
        {deleteError && (
          <p className="library-notice" role="alert">
            {deleteError}
          </p>
        )}

        {visibleImports.length > 0 && (
          <section className="library-section" aria-labelledby="imports-heading">
            <h2 id="imports-heading" className="section-heading" ref={importsHeadingRef} tabIndex={-1}>
              Your imported pieces
              <span className="section-count">{countText(visibleImports.length, 'piece')}</span>
            </h2>
            <ul className="card-grid">
              {visibleImports.map((m) => (
                <ImportCard key={m.id} meta={m} onDelete={setPendingDelete} />
              ))}
            </ul>
          </section>
        )}

        <section className="library-section" aria-labelledby="builtin-heading">
          <h2 id="builtin-heading" className="section-heading">
            Built-in library
            <span className="section-count">
              {result.entries.length === catalog.length
                ? countText(catalog.length, 'piece')
                : `Showing ${result.entries.length} of ${countText(catalog.length, 'piece')}`}
            </span>
          </h2>
          {catalog.length === 0 ? (
            <p className="empty-state">The built-in library is empty.</p>
          ) : nothingMatches ? (
            <div className="empty-state" role="status">
              <p>No pieces match.</p>
              {filtersActive && (
                <button type="button" className="btn btn-small" onClick={clearFilters}>
                  Clear search and filters
                </button>
              )}
            </div>
          ) : result.entries.length === 0 ? (
            <p className="empty-state">No built-in pieces match.</p>
          ) : (
            <ul className="card-grid">
              {result.entries.map((entry) => (
                <BuiltinCard key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <p>
          Imported pieces and your settings are stored only in this browser. Clearing this site’s data removes them.
        </p>
        <button type="button" className="link-btn" onClick={() => setAboutOpen(true)}>
          About &amp; credits
        </button>
      </footer>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} onDataCleared={onDataCleared} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : 'Delete piece?'}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          This removes the piece and its saved practice settings from this browser. The file on your computer is not
          affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function ImportStatusView({
  status,
  onDismiss,
  onRetry,
}: {
  status: ImportStatus;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  // The live region stays mounted so screen readers announce changes inside it.
  return (
    <div className="import-status-region" role="status" aria-live="polite">
      {status.kind === 'working' && (
        <div className="import-status">
          <span className="spinner" aria-hidden="true" />
          <p>
            Importing <span className="import-file">{status.fileName}</span>. {STAGE_TEXT[status.stage]}
          </p>
        </div>
      )}
      {status.kind === 'done' && (
        <div className="import-status import-status-done">
          <p>
            Added “{status.meta.title}” to your imported pieces.{' '}
            {status.meta.readiness === 'review' && 'Some parts may not play exactly as written. '}
            <a href={pieceHref(status.meta.id)}>Open it</a>
          </p>
          <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="import-status import-status-error">
          <p>
            <strong>
              “<span className="import-file">{status.fileName}</span>” could not be imported.
            </strong>{' '}
            {status.message}
          </p>
          <div className="import-status-actions">
            <button type="button" className="btn btn-small" onClick={onRetry}>
              Choose another file
            </button>
            <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
