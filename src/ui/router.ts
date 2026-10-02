import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routing: `#/` is the library and `#/piece/<id>` a piece. Anything else
 * falls back to the library. The hash never reaches the server, so every route
 * survives a refresh on GitHub Pages.
 */

export type Route = { name: 'library' } | { name: 'piece'; id: string };

export const LIBRARY_ROUTE: Route = { name: 'library' };

/** Ids are catalog slugs or "local-<uuid>"; anything else is not a route we know. */
const PIECE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Parses a location hash ("#/piece/abc", "#/", "") into a route. */
export function parseHash(hash: string): Route {
  let path = hash.startsWith('#') ? hash.slice(1) : hash;
  const query = path.search(/[?#]/);
  if (query >= 0) path = path.slice(0, query);
  if (!path.startsWith('/')) path = `/${path}`;
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 2 && segments[0] === 'piece') {
    const id = safeDecode(segments[1]);
    if (id && PIECE_ID.test(id)) return { name: 'piece', id };
  }
  return LIBRARY_ROUTE;
}

/** The canonical path for a route, e.g. "/piece/fur-elise" (no leading "#"). */
export function routePath(route: Route): string {
  return route.name === 'piece' ? `/piece/${encodeURIComponent(route.id)}` : '/';
}

export function pieceHref(id: string): string {
  return `#${routePath({ name: 'piece', id })}`;
}

export const LIBRARY_HREF = '#/';

/** True when the hash is already the canonical spelling of its route. */
export function isCanonicalHash(hash: string): boolean {
  return hash === `#${routePath(parseHash(hash))}`;
}

/** Navigates to a path such as "/", "/piece/<id>" or "#/piece/<id>". */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === target) return;
  if (options.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(window.history.state, '', url);
    // replaceState does not fire hashchange; tell subscribers ourselves.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function getHash(): string {
  return window.location.hash;
}

function getServerHash(): string {
  return '';
}

/** The current route; re-renders on hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => parseHash(hash), [hash]);
}
