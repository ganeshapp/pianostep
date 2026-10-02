import { useEffect, useLayoutEffect } from 'react';
import { getCatalogEntry } from './catalog/loader';
import { getImportMeta, isImportId } from './storage/imports';
import { saveGlobalPrefs } from './storage/prefs';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { LibraryPage } from './ui/library/LibraryPage';
import { PracticePage } from './ui/practice/PracticePage';
import { LIBRARY_HREF, isCanonicalHash, navigate, routePath, useRoute } from './ui/router';

const APP_NAME = 'Piano Steps';

export function App() {
  const route = useRoute();
  const pieceId = route.name === 'piece' ? route.id : null;

  // Unknown or unusually spelled hashes are rewritten to the route actually shown.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && !isCanonicalHash(hash)) navigate(routePath(route), { replace: true });
  }, [route]);

  useEffect(() => {
    if (pieceId && (getCatalogEntry(pieceId) || isImportId(pieceId))) saveGlobalPrefs({ lastPieceId: pieceId });
  }, [pieceId]);

  // A piece always opens at the top; the library restores its own scroll position.
  useLayoutEffect(() => {
    if (pieceId) window.scrollTo(0, 0);
  }, [pieceId]);

  useEffect(() => {
    document.title = APP_NAME;
    if (!pieceId) return;
    const entry = getCatalogEntry(pieceId);
    if (entry) {
      document.title = `${entry.title} · ${APP_NAME}`;
      return;
    }
    if (!isImportId(pieceId)) return;
    let cancelled = false;
    getImportMeta(pieceId)
      .then((meta) => {
        if (!cancelled && meta) document.title = `${meta.title} · ${APP_NAME}`;
      })
      .catch(() => {
        // The practice page reports storage problems itself.
      });
    return () => {
      cancelled = true;
    };
  }, [pieceId]);

  return (
    <ErrorBoundary
      key={pieceId ?? 'library'}
      fallback={() => <CrashScreen onPiece={pieceId !== null} />}
    >
      {pieceId ? <PracticePage key={pieceId} pieceId={pieceId} /> : <LibraryPage />}
    </ErrorBoundary>
  );
}

function CrashScreen({ onPiece }: { onPiece: boolean }) {
  return (
    <main className="page-message" role="alert">
      <h1>Something went wrong</h1>
      <p>This page stopped working unexpectedly. Your settings and imported pieces are safe.</p>
      <p>
        {onPiece && (
          <>
            <a className="btn btn-primary" href={LIBRARY_HREF}>
              Back to library
            </a>{' '}
          </>
        )}
        <button type="button" className={onPiece ? 'btn' : 'btn btn-primary'} onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </p>
    </main>
  );
}
