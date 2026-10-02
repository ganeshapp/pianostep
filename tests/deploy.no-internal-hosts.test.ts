/**
 * The README's deploy steps commit the whole folder (`git add -A`) to a GitHub
 * repository, which is public for a free Pages site. No text file that would be
 * committed may name a private package registry or an internal company host:
 * not in the lockfile (tests/deploy.lockfile.test.ts), and not in docs, review
 * logs, scripts or config either.
 *
 * Scanned: every text file in the project except git-ignored output
 * (node_modules, dist, coverage, .vite) and binary assets.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.vite', '.git']);
const TEXT_FILE = /\.(md|json|ts|tsx|mts|cts|js|mjs|cjs|css|html|ya?ml|txt|xml|musicxml|svg)$|^(\.gitignore|\.npmrc|LICENSE)$/i;

const listTextFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return SKIP_DIRS.has(d.name) ? [] : listTextFiles(join(dir, d.name));
    return d.isFile() && TEXT_FILE.test(d.name) ? [join(dir, d.name)] : [];
  });

// This file is left out: its self-check below holds made-up leaks on reserved .test hosts.
const files = listTextFiles(ROOT)
  .filter((path) => path !== __filename)
  .map((path) => ({ rel: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

/** Host names, with an optional scheme and path, that are not part of an e-mail address. */
const HOST = /(?<![@\w.-])(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?![\w-])(\/[^\s"'`)<>\]\\]*)?/gi;

/** URL paths that only a package registry or repository manager serves. */
const REGISTRY_PATH = /^\/repository\/[\w.-]*npm[\w.-]*\/|^\/(?:artifactory|nexus)\/|^\/api\/npm\/|\/-\/[^/]+\.tgz$/i;
const PUBLIC_REGISTRIES = new Set(['registry.npmjs.org']);

/** Labels typical of internal package-mirror or intranet host names, and private-use top-level domains. */
const INTERNAL_LABEL = /^(nexus|artifactory|jfrog|verdaccio|intranet)$/i;
const INTERNAL_TLD = /^(internal|intranet|corp|lan)$/i;

/**
 * Domain labels of the developer's employer, kept only as SHA-256 hashes so
 * that this public test does not itself publish them. Any host name under such
 * a domain is internal infrastructure as far as this repository is concerned.
 */
const EMPLOYER_LABEL_SHA256 = new Set(['154c2b744d9fb3885743303d1bb94a21d3c895452ea260acba65f5f0466ed02a']);
const hashCache = new Map<string, boolean>();
const isEmployerLabel = (label: string): boolean => {
  const key = label.toLowerCase();
  let hit = hashCache.get(key);
  if (hit === undefined) {
    hit = EMPLOYER_LABEL_SHA256.has(createHash('sha256').update(key).digest('hex'));
    hashCache.set(key, hit);
  }
  return hit;
};

/** Leaks found in one file's text, by line. */
const findLeaks = (text: string): string[] => {
  const out: string[] = [];
  // The host itself is not repeated in the message, so a failing CI log does not publish it either.
  const report = (index: number, what: string): void => {
    out.push(`line ${text.slice(0, index).split('\n').length}: ${what}`);
  };
  for (const m of text.matchAll(HOST)) {
    const host = m[1].toLowerCase();
    const path = m[2] ?? '';
    const labels = host.split('.');
    // The last label is the top-level domain; it says nothing about who owns the host.
    const owners = labels.slice(0, -1);
    if (owners.some(isEmployerLabel)) report(m.index, "a host under the employer's domain");
    else if (owners.some((l) => INTERNAL_LABEL.test(l)) || INTERNAL_TLD.test(labels[labels.length - 1])) {
      report(m.index, 'an internal-looking host');
    } else if (REGISTRY_PATH.test(path) && !PUBLIC_REGISTRIES.has(host)) {
      report(m.index, `a package-registry URL on ${host}`);
    }
  }
  for (const m of text.matchAll(/^[ \t]*(?:@[\w-]+:)?registry[ \t]*=[ \t]*(\S+)/gim)) {
    if (!/^https:\/\/registry\.npmjs\.org\/?$/.test(m[1])) report(m.index, 'an npm registry setting');
  }
  return out;
};

describe('no private registry or internal host in the files that get published', () => {
  it('scans the project text files, docs and review logs included', () => {
    const rels = files.map((f) => f.rel);
    expect(rels).toContain('README.md');
    expect(rels).toContain('package-lock.json');
    expect(rels.some((r) => r.startsWith(join('docs', 'dev')))).toBe(true);
    expect(rels.some((r) => r.startsWith('node_modules') || r.startsWith('dist'))).toBe(false);
  });

  it('recognises the kinds of leak it guards against, and leaves public hosts alone', () => {
    expect(findLeaks('see https://pkgs.example.test/repository/npm-all/fflate/-/fflate-0.8.3.tgz')).toHaveLength(1);
    expect(findLeaks('from nexus.example.test (resolves publicly)')).toHaveLength(1);
    expect(findLeaks('registry=https://mirror.example.test/npm/')).toHaveLength(1);
    expect(findLeaks('https://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz')).toEqual([]);
    expect(findLeaks('https://lasolsheet.com/piano-sheet-music/greensleeves/ and musescore.com/classicman')).toEqual([]);
    expect(findLeaks("`sed 's#https://<internal-registry>/#https://registry.npmjs.org/#g'`")).toEqual([]);
    expect(findLeaks('a project subpath such as `https://username.github.io/repository/`')).toEqual([]);
    expect(findLeaks('build-catalog.ts writes catalog.json, .claude/settings.local.json and README.md')).toEqual([]);
    expect(findLeaks('mail gapp@example.org')).toEqual([]);
    expect(findLeaks('pkgs.build.corp/x')).toHaveLength(1);
  });

  it('finds none in any project file', () => {
    const leaks = files.flatMap(({ rel, text }) => findLeaks(text).map((p) => `${rel}: ${p}`));
    // To fix: describe the host generically ("an internal company npm mirror") or use a placeholder such as <internal-registry>.
    expect(leaks).toEqual([]);
  });
});
