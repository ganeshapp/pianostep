import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_HREF, isCanonicalHash, navigate, parseHash, pieceHref, routePath, useRoute } from '../src/ui/router';
import type { Route } from '../src/ui/router';

const library: Route = { name: 'library' };
const piece = (id: string): Route => ({ name: 'piece', id });

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(async () => {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  await nextTask();
});

describe('parseHash', () => {
  it('maps the empty and root hashes to the library', () => {
    expect(parseHash('')).toEqual(library);
    expect(parseHash('#')).toEqual(library);
    expect(parseHash('#/')).toEqual(library);
  });

  it('reads built-in and imported piece ids', () => {
    expect(parseHash('#/piece/fur-elise')).toEqual(piece('fur-elise'));
    expect(parseHash('#/piece/canon-in-d-3')).toEqual(piece('canon-in-d-3'));
    expect(parseHash('#/piece/local-0f8fad5b-d9cb-469f-a165-70867728950e')).toEqual(
      piece('local-0f8fad5b-d9cb-469f-a165-70867728950e'),
    );
  });

  it('tolerates a trailing slash, a missing leading slash and a query', () => {
    expect(parseHash('#/piece/fur-elise/')).toEqual(piece('fur-elise'));
    expect(parseHash('#piece/fur-elise')).toEqual(piece('fur-elise'));
    expect(parseHash('#/piece/fur-elise?from=library')).toEqual(piece('fur-elise'));
    expect(parseHash('/piece/fur-elise')).toEqual(piece('fur-elise'));
  });

  it('decodes percent-encoded ids', () => {
    expect(parseHash('#/piece/fur%2Delise')).toEqual(piece('fur-elise'));
  });

  it('falls back to the library for anything unknown', () => {
    for (const hash of [
      '#/piece',
      '#/piece/',
      '#/pieces/fur-elise',
      '#/piece/fur-elise/extra',
      '#/settings',
      '#/piece/%E0%A4%A',
      '#/piece/%3Cscript%3E',
      '#/piece/..',
      '#/piece/-leading-dash',
      '#/piece/has space',
      '#//',
    ]) {
      expect(parseHash(hash), hash).toEqual(library);
    }
  });
});

describe('route paths', () => {
  it('builds hrefs that parse back to the same route', () => {
    for (const id of ['fur-elise', 'local-0f8fad5b-d9cb-469f-a165-70867728950e', 'a.b_c~d']) {
      expect(parseHash(pieceHref(id))).toEqual(piece(id));
    }
    expect(routePath(library)).toBe('/');
    expect(LIBRARY_HREF).toBe('#/');
    expect(pieceHref('fur-elise')).toBe('#/piece/fur-elise');
  });

  it('recognises canonical hashes', () => {
    expect(isCanonicalHash('#/')).toBe(true);
    expect(isCanonicalHash('#/piece/fur-elise')).toBe(true);
    expect(isCanonicalHash('#/piece/fur-elise/')).toBe(false);
    expect(isCanonicalHash('#/nowhere')).toBe(false);
    expect(isCanonicalHash('#piece/fur-elise')).toBe(false);
  });
});

describe('navigate', () => {
  it('sets the hash from a path or a hash', () => {
    navigate('/piece/fur-elise');
    expect(window.location.hash).toBe('#/piece/fur-elise');
    navigate('#/');
    expect(window.location.hash).toBe('#/');
    navigate('piece/canon');
    expect(window.location.hash).toBe('#/piece/canon');
  });

  it('can replace the current history entry and still notifies listeners', () => {
    navigate('/piece/one');
    const length = window.history.length;
    let notified = 0;
    const onChange = () => notified++;
    window.addEventListener('hashchange', onChange);
    navigate('/piece/two', { replace: true });
    window.removeEventListener('hashchange', onChange);
    expect(window.location.hash).toBe('#/piece/two');
    expect(window.history.length).toBe(length);
    expect(notified).toBe(1);
  });
});

describe('useRoute', () => {
  it('re-renders when the hash changes', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: Route[] = [];
    function Probe() {
      const route = useRoute();
      seen.push(route);
      return createElement('span', null, route.name === 'piece' ? `piece:${route.id}` : 'library');
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(container.textContent).toBe('library');

    await act(async () => {
      window.location.hash = '#/piece/fur-elise';
      await nextTask();
    });
    expect(container.textContent).toBe('piece:fur-elise');

    await act(async () => {
      navigate('/nowhere', { replace: true });
      await nextTask();
    });
    expect(container.textContent).toBe('library');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});
