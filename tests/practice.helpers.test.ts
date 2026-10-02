import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { prepareScore } from '../src/core/model/prepare';
import { loadSourceScore } from '../src/core/musicxml/parse';
import { DiagnosticsDialog } from '../src/ui/practice/DiagnosticsDialog';
import { DEFAULT_SETTINGS, type PracticeSettings, type ScoreWarning } from '../src/core/types';
import type { SessionSnapshot } from '../src/engine/session';
import { formatDuration, groupWarnings, measureList, tempoDescription } from '../src/ui/practice/diagnostics';
import { midiPhase } from '../src/ui/practice/midiConnection';
import {
  formatSpeed,
  formatStepSeconds,
  passageEndingAt,
  passageStartingAt,
  restoreSettings,
  stepIndexForTick,
  validRange,
} from '../src/ui/practice/settings';
import { shortcutFor, type ShortcutKeyEvent } from '../src/ui/practice/shortcuts';
import { statusMessage } from '../src/ui/practice/text';

describe('restoreSettings', () => {
  it('starts from the defaults', () => {
    expect(restoreSettings(null, 10, false)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps saved choices and drops a passage that no longer fits', () => {
    const saved: Partial<PracticeSettings> = { mode: 'steady', hands: 'L', speed: 0.5, range: { startOcc: 2, endOcc: 4 } };
    expect(restoreSettings(saved, 10, false)).toMatchObject(saved);
    expect(restoreSettings({ range: { startOcc: 2, endOcc: 12 } }, 10, false).range).toBeNull();
    expect(restoreSettings({ range: { startOcc: 5, endOcc: 3 } }, 10, false).range).toBeNull();
  });

  it('falls back from Follow me to Listen until a piano is connected', () => {
    expect(restoreSettings({ mode: 'follow' }, 10, false).mode).toBe('listen');
    expect(restoreSettings({ mode: 'follow' }, 10, true).mode).toBe('follow');
  });

  it('clamps speeds to the slider limits', () => {
    expect(restoreSettings({ speed: 9, stepSeconds: 0.01 }, 10, false)).toMatchObject({ speed: 2, stepSeconds: 0.3 });
    expect(restoreSettings({ speed: Number.NaN }, 10, false).speed).toBe(1);
  });
});

describe('passage helpers', () => {
  it('treats a passage covering every measure as the whole piece', () => {
    expect(validRange({ startOcc: 0, endOcc: 9 }, 10)).toBeNull();
    expect(validRange({ startOcc: 0, endOcc: 8 }, 10)).toEqual({ startOcc: 0, endOcc: 8 });
  });

  it('moves the other end along when the start passes the end, or the end passes the start', () => {
    expect(passageStartingAt(null, 3, 10)).toEqual({ startOcc: 3, endOcc: 9 });
    expect(passageStartingAt({ startOcc: 1, endOcc: 4 }, 6, 10)).toEqual({ startOcc: 6, endOcc: 6 });
    expect(passageStartingAt({ startOcc: 1, endOcc: 4 }, 2, 10)).toEqual({ startOcc: 2, endOcc: 4 });
    expect(passageEndingAt(null, 5, 10)).toEqual({ startOcc: 0, endOcc: 5 });
    expect(passageEndingAt({ startOcc: 4, endOcc: 8 }, 2, 10)).toEqual({ startOcc: 2, endOcc: 2 });
    expect(passageEndingAt({ startOcc: 0, endOcc: 4 }, 9, 10)).toBeNull();
  });

  it('resumes at the first step at or after the saved tick', () => {
    const steps = [{ tick: 0 }, { tick: 48 }, { tick: 96 }];
    expect(stepIndexForTick(steps, null)).toBe(0);
    expect(stepIndexForTick(steps, 48)).toBe(1);
    expect(stepIndexForTick(steps, 50)).toBe(2);
    expect(stepIndexForTick(steps, 500)).toBe(2);
    expect(stepIndexForTick([], 10)).toBe(0);
  });

  it('formats slider values', () => {
    expect(formatSpeed(1)).toBe('1×');
    expect(formatSpeed(0.75)).toBe('0.75×');
    expect(formatSpeed(1.2000000001)).toBe('1.2×');
    expect(formatStepSeconds(1)).toBe('1.0 s');
  });
});

describe('shortcutFor', () => {
  const ev = (key: string, target: EventTarget | null, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
    key,
    target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  });

  it('maps Space, arrows and Home on the page', () => {
    expect(shortcutFor(ev(' ', document.body), document)).toBe('toggle');
    expect(shortcutFor(ev('ArrowLeft', document.body), document)).toBe('prev');
    expect(shortcutFor(ev('ArrowRight', document.body), document)).toBe('next');
    expect(shortcutFor(ev('Home', document.body), document)).toBe('restart');
    expect(shortcutFor(ev('a', document.body), document)).toBeNull();
    expect(shortcutFor(ev(' ', document.body, { metaKey: true }), document)).toBeNull();
  });

  it('ignores keys typed into inputs, selects and text areas', () => {
    for (const tag of ['input', 'select', 'textarea']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(shortcutFor(ev('ArrowRight', el), document)).toBeNull();
      expect(shortcutFor(ev(' ', el), document)).toBeNull();
      el.remove();
    }
  });

  it('leaves Space to a focused button and arrows to a radio group', () => {
    const button = document.createElement('button');
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    const radio = document.createElement('span');
    group.appendChild(radio);
    document.body.append(button, group);
    expect(shortcutFor(ev(' ', button), document)).toBeNull();
    expect(shortcutFor(ev('ArrowRight', button), document)).toBe('next');
    expect(shortcutFor(ev('ArrowRight', radio), document)).toBeNull();
    button.remove();
    group.remove();
  });

  it('does nothing while a dialog is open', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    expect(shortcutFor(ev(' ', document.body), document)).toBeNull();
    dialog.remove();
    expect(shortcutFor(ev(' ', document.body), document)).toBe('toggle');
  });
});

describe('midiPhase', () => {
  const m = (state: 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready' | 'error', sel: string | null, connected: boolean, inputs: boolean[]) => ({
    state,
    selectedInputId: sel,
    inputConnected: connected,
    inputs: () => inputs.map((c) => ({ connected: c })),
  });

  it('follows the connection flow', () => {
    expect(midiPhase(m('unsupported', null, false, []))).toBe('unsupported');
    expect(midiPhase(m('idle', null, false, []))).toBe('idle');
    expect(midiPhase(m('denied', null, false, []))).toBe('denied');
    expect(midiPhase(m('ready', null, false, []))).toBe('no-devices');
    expect(midiPhase(m('ready', null, false, [true, true]))).toBe('choose');
    expect(midiPhase(m('ready', 'a', true, [true]))).toBe('connected');
    expect(midiPhase(m('ready', 'a', false, [false]))).toBe('disconnected');
  });
});

describe('statusMessage', () => {
  const snap = (patch: Partial<SessionSnapshot>): SessionSnapshot =>
    ({
      status: 'stopped',
      message: null,
      wrong: [],
      waitingFor: [],
      countInRemaining: null,
      settings: DEFAULT_SETTINGS,
      audioState: 'ready',
      stepCount: 10,
      ...patch,
    }) as SessionSnapshot;
  const follow = { ...DEFAULT_SETTINGS, mode: 'follow' as const };

  it('shows Follow me feedback with key names', () => {
    expect(statusMessage(snap({ settings: follow, status: 'waiting', waitingFor: [60, 64] }))?.text).toBe(
      'Waiting for: C4 E4',
    );
    expect(statusMessage(snap({ settings: follow, status: 'waiting', waitingFor: [60], wrong: [65] }))).toEqual({
      text: 'Not expected: F4 — release it and try again',
      tone: 'wrong',
    });
  });

  it('tells the learner how to begin Follow me', () => {
    expect(statusMessage(snap({ settings: follow, status: 'stopped' }))?.text).toBe(
      'Press Start, then play the keys shown in colour.',
    );
    expect(statusMessage(snap({ settings: follow, status: 'stopped', stepCount: 0 }))).toBeNull();
  });

  it('reports the end of the passage, count-in and sound loading', () => {
    expect(statusMessage(snap({ status: 'finished' }))?.text).toBe('Finished — passage complete');
    expect(statusMessage(snap({ status: 'count-in', countInRemaining: 3 }))?.text).toBe('Get ready… 3');
    expect(statusMessage(snap({ audioState: 'loading' }))?.text).toBe('Sound is loading…');
    expect(statusMessage(snap({}))).toBeNull();
  });

  it('puts engine messages first', () => {
    expect(statusMessage(snap({ message: 'Piano disconnected — reconnect it to continue.', status: 'finished' }))?.text).toBe(
      'Piano disconnected — reconnect it to continue.',
    );
  });
});

describe('arrangement details', () => {
  const w = (
    severity: ScoreWarning['severity'],
    code: ScoreWarning['code'],
    measures?: string[],
    count?: number,
    measuresTruncated?: boolean,
  ): ScoreWarning => ({
    code,
    severity,
    message: code,
    measures,
    count,
    ...(measuresTruncated ? { measuresTruncated } : {}),
  });

  it('groups warnings by severity, most serious first', () => {
    const groups = groupWarnings([w('info', 'pedal-not-modelled'), w('review', 'cross-staff-notes'), w('info', 'other')]);
    expect(groups.map(([sev, list]) => [sev, list.length])).toEqual([
      ['review', 1],
      ['info', 2],
    ]);
  });

  it('lists the measures a warning affects', () => {
    expect(measureList(w('info', 'other', ['3']))).toBe('Measure 3');
    // `count` counts notes, not measures: many notes in two measures is not "and others".
    expect(measureList(w('info', 'other', ['3', '5'], 9))).toBe('Measures 3, 5');
    // Only a list cut at 20 measures says "and others".
    expect(measureList(w('info', 'other', ['3', '5'], 9, true))).toBe('Measures 3, 5 and others');
    expect(measureList(w('info', 'other'))).toBeNull();
  });

  it('"About this arrangement" lists complete measure lists without "and others", and cut ones with it', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const file = 'Mozart_-_Piano_Sonata_No._16_-_Allegro.mxl';
    const prepared = prepareScore(
      loadSourceScore(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'scores', file))), file),
    );
    const cross = prepared.warnings.find((x) => x.code === 'cross-staff-notes');
    // Several notes in each of four measures: every affected measure is listed.
    expect(cross?.count).toBeGreaterThan(cross?.measures?.length ?? Infinity);
    expect(cross?.measuresTruncated).toBeUndefined();
    const cut: ScoreWarning = {
      code: 'pedal-not-modelled',
      severity: 'info',
      message: 'Pedal marks are not played.',
      count: 40,
      measures: Array.from({ length: 20 }, (_, i) => String(i + 1)),
      measuresTruncated: true,
    };
    const piece = {
      id: 'mozart',
      kind: 'builtin' as const,
      title: 'Sonata No. 16',
      arrangement: null,
      composer: null,
      prepared: { ...prepared, warnings: [...prepared.warnings, cut] },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(DiagnosticsDialog, { open: true, onClose: () => undefined, piece })));
    const lists = [...document.querySelectorAll('.ps-diag__measures')].map((el) => el.textContent ?? '');
    expect(lists).toContain(`Measures ${cross?.measures?.join(', ')}`);
    expect(lists.filter((t) => t.endsWith('and others'))).toEqual([`Measures ${cut.measures?.join(', ')} and others`]);
    act(() => root.unmount());
    host.remove();
  });

  it('says whether the speed came from the file', () => {
    expect(tempoDescription({ tempo: { ticksPerQuarter: 48, points: [{ tick: 0, qpm: 120 }], defaulted: true } })).toBe(
      'Not given in the file — the app plays it at 120 quarter notes per minute.',
    );
    expect(
      tempoDescription({
        tempo: { ticksPerQuarter: 48, points: [{ tick: 0, qpm: 96 }, { tick: 96, qpm: 80 }], defaulted: false },
      }),
    ).toBe('From the file: starts at 96 quarter notes per minute, with 1 change.');
    expect(formatDuration(91.4)).toBe('1:31');
  });
});
