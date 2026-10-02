import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSourceScore } from '../src/core/musicxml/parse';

const SCORES_DIR = join(__dirname, '..', 'public', 'scores');
const files = readdirSync(SCORES_DIR)
  .filter((f) => f.toLowerCase().endsWith('.mxl'))
  .sort();

describe('library MusicXML files', () => {
  const lines: string[] = [];

  afterAll(() => {
    if (lines.length > 0) console.log(lines.join('\n'));
  });

  it('finds the vendored library', () => {
    expect(files.length).toBe(69);
  });

  // One test per file, each starting with a real event-loop turn: a long run of
  // synchronous parsing would otherwise starve the test runner's worker
  // messaging on a busy machine (vitest reports "Timeout calling onTaskUpdate").
  it.each(files)(
    'parses %s',
    async (file) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const started = performance.now();
      const score = loadSourceScore(new Uint8Array(readFileSync(join(SCORES_DIR, file))), file);
      const ms = Math.round(performance.now() - started);

      expect(score.notes.length, file).toBeGreaterThan(0);
      expect(Number.isInteger(score.ticksPerQuarter), file).toBe(true);
      for (const n of score.notes) {
        expect(Number.isInteger(n.onsetTick) && Number.isInteger(n.durationTicks) && n.durationTicks > 0, n.id).toBe(true);
      }
      for (const m of score.measures) {
        expect(Number.isInteger(m.startTick) && Number.isInteger(m.durationTicks), `${file} m${m.number}`).toBe(true);
      }

      const warnings = score.warnings.map((w) => `${w.code}x${w.count ?? 1}`).join(',') || '-';
      const parts = score.parts.map((p) => `${p.id}:${p.name || '?'}(${p.staves}st,${p.pitchedNoteCount})`).join('|');
      lines.push(
        `[library] ${file} | notes=${score.notes.length} measures=${score.measures.length} tpq=${score.ticksPerQuarter}` +
          ` tempos=${score.tempos.length} parts=${parts} warnings=${warnings} ms=${ms}`,
      );
    },
    60_000,
  );
});
