/**
 * The GitHub Pages workflow runs `npm ci` on a GitHub runner, which can only
 * be relied on to reach the public npm registry. Every package in the
 * lockfile must therefore be fetched from registry.npmjs.org. (npm rewrites
 * those URLs to a locally configured mirror on its own, so a developer behind
 * a company mirror still installs through it.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const lock = JSON.parse(readFileSync(join(__dirname, '..', 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { resolved?: string; link?: boolean }>;
};

describe('package-lock.json', () => {
  it('resolves every package from the public npm registry', () => {
    const entries = Object.entries(lock.packages).filter(([path, p]) => path !== '' && !p.link);
    expect(entries.length).toBeGreaterThan(0);
    const elsewhere = entries
      .filter(([, p]) => !p.resolved?.startsWith('https://registry.npmjs.org/'))
      .map(([path, p]) => `${path}: ${p.resolved ?? '(no resolved URL)'}`);
    // To fix: replace the mirror's base URL with https://registry.npmjs.org/ in package-lock.json.
    expect(elsewhere).toEqual([]);
  });
});
