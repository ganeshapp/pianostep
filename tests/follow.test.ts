import { describe, expect, it } from 'vitest';
import { FollowMatcher } from '../src/core/practice/follow';
import type { MidiInputEvent } from '../src/core/types';
import { buildSequence, keys, m } from './helpers/stepBuilder';

let clock = 0;
function on(label: string, opts: { velocity?: number; channel?: number; at?: number } = {}): MidiInputEvent {
  clock = opts.at ?? clock + 10;
  return { type: 'noteon', midi: m(label), velocity: opts.velocity ?? 80, channel: opts.channel ?? 1, time: clock };
}
function off(label: string, channel = 1): MidiInputEvent {
  clock += 10;
  return { type: 'noteoff', midi: m(label), channel, time: clock };
}
function pedal(down: boolean): MidiInputEvent {
  clock += 10;
  return { type: 'sustain', down, value: down ? 127 : 0, channel: 1, time: clock };
}
/** Feeds events in order; returns how many of them advanced the step. */
function feed(f: FollowMatcher, ...events: MidiInputEvent[]): number {
  return events.filter((ev) => f.handle(ev).advanced).length;
}

describe('FollowMatcher: note-on / note-off', () => {
  it('advances on the expected note-on and tracks physical keys', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: 'D4' }, { R: '.' }] }));
    expect(f.status()).toEqual({ stepIndex: 0, expected: [60], satisfied: [], wrong: [], finished: false });

    const r1 = f.handle(on('C4'));
    expect(r1.advanced).toBe(true);
    expect(r1.status).toEqual({ stepIndex: 1, expected: [62], satisfied: [], wrong: [], finished: false });
    expect(f.physicalDown).toEqual([60]);

    const r2 = f.handle(off('C4'));
    expect(r2.advanced).toBe(false);
    expect(f.physicalDown).toEqual([]);

    // Step 2 only releases D4, so finishing step 1 also finishes the passage.
    const r3 = f.handle(on('D4'));
    expect(r3.advanced).toBe(true);
    expect(r3.status).toEqual({ stepIndex: 3, expected: [], satisfied: [], wrong: [], finished: true });
    expect(f.currentStep).toBe(3);
    expect(f.finished).toBe(true);
  });

  it('treats a velocity-0 note-on as a note-off', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: 'C4' }, { R: '.' }] }));
    expect(feed(f, on('C4'))).toBe(1);
    expect(f.currentStep).toBe(1);

    // A second note-on without a release is not a new strike.
    expect(feed(f, on('C4'))).toBe(0);
    expect(f.status().satisfied).toEqual([]);

    expect(feed(f, on('C4', { velocity: 0 }))).toBe(0);
    expect(f.physicalDown).toEqual([]);

    expect(feed(f, on('C4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('merges channels: a key pressed on one channel is released by a note-off on another', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'E4 G4', L: 'C3' }, { R: '.', L: '.' }] }));
    expect(f.status().expected).toEqual([48, 64, 67]);
    feed(f, on('C3', { channel: 2 }), on('E4', { channel: 1 }));
    expect(f.status().satisfied).toEqual([48, 64]);
    feed(f, off('C3', 10));
    expect(f.physicalDown).toEqual([64]);
    expect(f.status().satisfied).toEqual([64]);
    expect(feed(f, on('C3', { channel: 16 }), on('G4', { channel: 3 }))).toBe(1);
    expect(f.status().finished).toBe(true);
  });
});

describe('FollowMatcher: chords', () => {
  const chord = (): FollowMatcher =>
    new FollowMatcher(buildSequence({ steps: [{ R: 'C4 E4 G4' }, { R: 'F4' }, { R: '.' }] }));

  it('accepts staggered presses and completes only when all are down together', () => {
    const f = chord();
    let r = f.handle(on('C4', { at: 1000 }));
    expect(r.advanced).toBe(false);
    expect(r.status.satisfied).toEqual([60]);

    r = f.handle(on('E4', { at: 1300 }));
    expect(r.advanced).toBe(false);
    expect(r.status.satisfied).toEqual([60, 64]);
    expect(r.status.expected).toEqual([60, 64, 67]);

    r = f.handle(on('G4', { at: 1650 }));
    expect(r.advanced).toBe(true);
    expect(r.status.stepIndex).toBe(1);
    expect(r.status.expected).toEqual([65]);
  });

  it('does not complete when C was released before G was pressed, until C is struck again', () => {
    const f = chord();
    expect(feed(f, on('C4'), on('E4'), off('C4'), on('G4'))).toBe(0);
    expect(f.status()).toEqual({ stepIndex: 0, expected: [60, 64, 67], satisfied: [64, 67], wrong: [], finished: false });
    expect(f.physicalDown).toEqual([64, 67]);

    expect(feed(f, on('C4'))).toBe(1);
    expect(f.currentStep).toBe(1);
  });
});

describe('FollowMatcher: wrong keys', () => {
  const seq = buildSequence({ steps: [{ R: 'C4' }, { R: 'D4' }, { R: '.' }] });

  it('marks a wrong note without advancing; releasing it clears the mark and play continues', () => {
    const f = new FollowMatcher(seq);
    let r = f.handle(on('E4'));
    expect(r.advanced).toBe(false);
    expect(r.status).toEqual({ stepIndex: 0, expected: [60], satisfied: [], wrong: [64], finished: false });

    r = f.handle(off('E4'));
    expect(r.status.wrong).toEqual([]);
    expect(r.status.stepIndex).toBe(0);

    expect(feed(f, on('C4'))).toBe(1);
    expect(feed(f, on('D4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('does not advance while a wrong key is held, even with every right key down', () => {
    const f = new FollowMatcher(seq);
    feed(f, on('E4'));
    let r = f.handle(on('C4'));
    expect(r.advanced).toBe(false);
    expect(r.status.satisfied).toEqual([60]);
    expect(r.status.wrong).toEqual([64]);

    // Lifting the wrong key is the correction; the right key is still down.
    r = f.handle(off('E4'));
    expect(r.advanced).toBe(true);
    expect(r.status.stepIndex).toBe(1);
    expect(r.status.wrong).toEqual([]);
  });

  it('does not mark a re-press of a key the score holds as wrong', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: '+E4' }, { R: '.' }] }));
    feed(f, on('C4'));
    expect(f.currentStep).toBe(1);
    expect(f.status().expected).toEqual([64]);

    // Lifted early, then put back down: forgiven, because C4 is held in the score.
    feed(f, off('C4'), on('C4'));
    expect(f.status().wrong).toEqual([]);

    // A key the score does not hold is still wrong.
    feed(f, on('D4'));
    expect(f.status().wrong).toEqual([62]);
    feed(f, off('D4'));

    expect(feed(f, on('E4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('does not mark keys held over from an earlier step as wrong (late holds are forgiven)', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: 'D4' }, { R: 'E4' }, { R: '.' }] }));
    feed(f, on('C4'), on('D4'));
    // C4 is no longer in the score but was struck before this step began.
    expect(f.currentStep).toBe(2);
    expect(f.physicalDown).toEqual([60, 62]);
    expect(f.status().wrong).toEqual([]);
    expect(feed(f, on('E4'))).toBe(1);
  });
});

describe('FollowMatcher: re-striking what the score just let go of', () => {
  it('re-striking the previous note of a legato melody is wrong and does not complete the step', () => {
    // C4 is held right up to D4, so the D4 step releases it.
    const seq = buildSequence({ steps: [{ R: 'C4' }, { R: 'D4' }, { R: '.' }] });
    expect(seq.steps[1].heldBefore.R).toEqual([60]);
    expect(seq.steps[1].releases.R).toEqual([60]);
    const f = new FollowMatcher(seq);
    feed(f, on('C4'), off('C4'));
    expect(f.currentStep).toBe(1);

    // The learner plays C4 again instead of D4.
    feed(f, on('C4'));
    expect(f.status().wrong).toEqual([60]);
    // Adding D4 while the wrong C4 is still down does not advance.
    expect(feed(f, on('D4'))).toBe(0);
    expect(f.currentStep).toBe(1);
    // Letting go of the wrong key is the correction.
    expect(feed(f, off('C4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('re-striking the previous chord on a chord change is wrong; a cluster of both chords does not complete', () => {
    const seq = buildSequence({ steps: [{ R: 'C4 E4 G4' }, { R: 'D4 F4 A4' }, { R: '.' }] });
    const f = new FollowMatcher(seq);
    feed(f, on('C4'), on('E4'), on('G4'), off('C4'), off('E4'), off('G4'));
    expect(f.currentStep).toBe(1);

    feed(f, on('C4'), on('E4'), on('G4'));
    expect(f.status().wrong).toEqual([60, 64, 67]);
    expect(feed(f, on('D4'), on('F4'), on('A4'))).toBe(0);
    expect(f.status().satisfied).toEqual([62, 65, 69]);
    expect(feed(f, off('C4'), off('E4'))).toBe(0);
    expect(feed(f, off('G4'))).toBe(1);
  });

  it('a key the score keeps holding through the step may still be put down again', () => {
    // C4 is held under the whole melody.
    const seq = buildSequence({ steps: [{ R: 'C4 E4' }, { R: '-E4 +F4' }, { R: '-F4 +G4' }, { R: '.' }] });
    const f = new FollowMatcher(seq);
    feed(f, on('C4'), on('E4'));
    expect(f.currentStep).toBe(1);
    feed(f, off('C4'), on('C4'));
    expect(f.status().wrong).toEqual([]);
    // E4 is the key this step releases: striking it again is wrong.
    feed(f, off('E4'), on('E4'));
    expect(f.status().wrong).toEqual([64]);
    feed(f, off('E4'));
    expect(feed(f, on('F4'))).toBe(1);
  });
});

describe('FollowMatcher: notes beyond the 88 keys', () => {
  it('expects only the keys a piano has; the others are reported, not waited for', () => {
    // As in Mariage d'Amour: an octave D7 + D8 with D8 above C8, and a low G#0 below A0.
    const seq = buildSequence({ steps: [{ R: 'D7 D8' }, { L: 'G#0 G#1' }, { R: '.', L: '.' }] });
    const f = new FollowMatcher(seq);
    expect(f.status()).toEqual({ stepIndex: 0, expected: [98], satisfied: [], wrong: [], beyondPiano: [110], finished: false });
    expect(feed(f, on('D7'))).toBe(1);
    expect(f.status()).toEqual({ stepIndex: 1, expected: [32], satisfied: [], wrong: [], beyondPiano: [20], finished: false });
    expect(feed(f, on('G#1'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('a step whose only notes are beyond the piano is skipped like a release-only step', () => {
    const seq = buildSequence({ steps: [{ R: 'C4' }, { R: 'D8' }, { R: 'E4' }, { R: '.' }] });
    const f = new FollowMatcher(seq);
    expect(feed(f, on('C4'))).toBe(1);
    expect(f.currentStep).toBe(2);
    expect(f.status().expected).toEqual([64]);
    expect(feed(f, on('E4'))).toBe(1);
    expect(f.status().finished).toBe(true);

    // The same when a passage starts on it.
    f.start(1);
    expect(f.currentStep).toBe(2);
  });

  it('a device that can send a note beyond C8 is not told it is wrong for sending the written one', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'D7 D8' }, { R: '.' }] }));
    feed(f, on('D8'));
    expect(f.status().wrong).toEqual([]);
    expect(feed(f, on('D7'))).toBe(1);
  });
});

describe('FollowMatcher: repeated attacks and spent events', () => {
  it('a held key cannot satisfy a later repeated attack; a new note-on is needed', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: 'C4' }, { R: '.' }] }));
    feed(f, on('C4'));
    expect(f.status()).toEqual({ stepIndex: 1, expected: [60], satisfied: [], wrong: [], finished: false });

    // Duplicate note-on (same key, another channel) while still down: not a new strike.
    expect(feed(f, on('C4', { channel: 2 }), pedal(true), pedal(false))).toBe(0);
    expect(f.status().satisfied).toEqual([]);

    expect(feed(f, off('C4'))).toBe(0);
    expect(feed(f, on('C4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('a repeated note while another note stays held needs its own fresh strike', () => {
    const f = new FollowMatcher(
      buildSequence({ steps: [{ R: 'C4 E4' }, { R: '+E4' }, { R: '.' }] }),
    );
    feed(f, on('C4'), on('E4'));
    expect(f.currentStep).toBe(1);
    expect(f.status().expected).toEqual([64]);
    expect(feed(f, off('E4'))).toBe(0);
    expect(feed(f, on('E4'))).toBe(1);
  });

  it('events used to complete one step cannot complete the next', () => {
    // Step 1 only releases E4, so it is skipped and step 2 asks for E4 again.
    const seq = buildSequence({ steps: [{ R: 'C4 E4' }, { R: '-E4' }, { R: '+E4' }, { R: '.' }] });
    expect(seq.steps[1].releaseOnly).toBe(true);
    const f = new FollowMatcher(seq);

    expect(feed(f, on('C4'), on('E4'))).toBe(1);
    expect(f.status()).toEqual({ stepIndex: 2, expected: [64], satisfied: [], wrong: [], finished: false });

    // Unrelated events re-run the completion check; E4's old strike must not count.
    expect(feed(f, pedal(true), off('C4'), on('C4'))).toBe(0);
    expect(f.currentStep).toBe(2);

    expect(feed(f, off('E4'), on('E4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });
});

describe('FollowMatcher: release-only steps', () => {
  const seq = buildSequence({
    steps: [
      { R: 'C4 E4 G4', L: 'C3' },
      { R: '-G4' },
      { R: '-E4' },
      { L: '.' },
      { R: '+D4' },
      { R: '-D4' },
      { R: '.' },
    ],
  });

  it('skips several release-only steps in a row and the trailing ones, then finishes', () => {
    expect(seq.steps.map((s) => s.releaseOnly)).toEqual([false, true, true, true, false, true, true]);
    const f = new FollowMatcher(seq);

    expect(feed(f, on('C3'), on('C4'), on('E4'), on('G4'))).toBe(1);
    expect(f.status()).toEqual({ stepIndex: 4, expected: [62], satisfied: [], wrong: [], finished: false });

    const r = f.handle(on('D4'));
    expect(r.advanced).toBe(true);
    expect(r.status).toEqual({ stepIndex: 7, expected: [], satisfied: [], wrong: [], finished: true });
  });

  it('does not need the releases to happen (forgiving holds)', () => {
    const f = new FollowMatcher(seq);
    feed(f, on('C3'), on('C4'), on('E4'), on('G4'), on('D4'));
    expect(f.finished).toBe(true);
    expect(f.physicalDown).toEqual([48, 60, 62, 64, 67]);
  });

  it('start() on a release-only step moves on to the next attack', () => {
    const f = new FollowMatcher(seq);
    f.start(1);
    expect(f.currentStep).toBe(4);
    f.start(5);
    expect(f.status().finished).toBe(true);
    expect(f.currentStep).toBe(7);
  });

  it('an empty sequence is finished immediately', () => {
    const f = new FollowMatcher(buildSequence({ hands: ['R'], steps: [] }));
    expect(f.status()).toEqual({ stepIndex: 0, expected: [], satisfied: [], wrong: [], finished: true });
    expect(f.handle(on('C4')).advanced).toBe(false);
    expect(f.physicalDown).toEqual([60]);
  });
});

describe('FollowMatcher: sustain pedal', () => {
  it('keeps the pedal separate from physical keys and never satisfies anything with it', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4 E4' }, { R: '.' }] }));
    let r = f.handle(pedal(true));
    expect(r.advanced).toBe(false);
    expect(f.pedal).toBe(true);
    expect(f.physicalDown).toEqual([]);
    expect(r.status.satisfied).toEqual([]);

    // C4 sounds on through the pedal but is physically up, so it does not count.
    feed(f, on('C4'), off('C4'));
    expect(f.physicalDown).toEqual([]);
    r = f.handle(on('E4'));
    expect(r.advanced).toBe(false);
    expect(r.status.satisfied).toEqual([64]);

    expect(feed(f, pedal(false), pedal(true))).toBe(0);
    expect(feed(f, on('C4'))).toBe(1);
    expect(f.pedal).toBe(true);
    feed(f, pedal(false));
    expect(f.pedal).toBe(false);
  });
});

describe('FollowMatcher: start, setSequence and hands', () => {
  // A passage that begins while C4 (RH) and C3 (LH) are already held from earlier music.
  const passage = buildSequence({
    steps: [
      { R: '*C4 G4', L: '*C3' },
      { R: '-G4 +A4' },
      { R: '.', L: '.' },
    ],
  });

  it('start(0) expects the carried setup keys as fresh presses', () => {
    expect(passage.steps[0].cells.R?.tokens.map((t) => [t.label, t.action, t.carried ?? false])).toEqual([
      ['G4', 'press', false],
      ['C4', 'press', true],
    ]);
    const f = new FollowMatcher(passage);
    feed(f, on('C3'), on('C4'));
    expect(f.status().satisfied).toEqual([48, 60]);

    // Restart the passage while still holding C3 and C4: those strikes are forgotten.
    f.start(0);
    expect(f.physicalDown).toEqual([48, 60]);
    expect(f.status()).toEqual({ stepIndex: 0, expected: [48, 60, 67], satisfied: [], wrong: [], finished: false });

    expect(feed(f, on('G4'))).toBe(0);
    expect(f.status().satisfied).toEqual([67]);
    expect(feed(f, off('C4'), on('C4'))).toBe(0);
    expect(feed(f, off('C3'), on('C3'))).toBe(1);
    expect(f.currentStep).toBe(1);
  });

  it('start(i) mid-sequence expects that step and accepts the score-held setup keys', () => {
    const f = new FollowMatcher(passage);
    f.start(1);
    expect(f.status()).toEqual({ stepIndex: 1, expected: [69], satisfied: [], wrong: [], finished: false });

    // Putting the setup (C4, G4, C3) down is fine; B4 is not.
    feed(f, on('C3'), on('C4'), on('G4'));
    expect(f.status().wrong).toEqual([]);
    feed(f, on('B4'));
    expect(f.status().wrong).toEqual([71]);
    feed(f, off('B4'));

    expect(feed(f, on('A4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('start() clamps out-of-range indices', () => {
    const f = new FollowMatcher(passage);
    f.start(99);
    expect(f.status().finished).toBe(true);
    expect(f.currentStep).toBe(3);
    f.start(-4);
    expect(f.currentStep).toBe(0);
  });

  it('setSequence resets progress but keeps physical keys and pedal', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'D4' }, { R: 'C4' }, { R: '.' }] }));
    feed(f, on('D4'), pedal(true), on('C4'));
    expect(f.finished).toBe(true);

    f.setSequence(buildSequence({ steps: [{ R: 'C4' }, { R: '.' }] }));
    expect(f.currentStep).toBe(0);
    expect(f.physicalDown).toEqual([60, 62]);
    expect(f.pedal).toBe(true);
    // C4 is down but was struck under the old sequence.
    expect(f.status()).toEqual({ stepIndex: 0, expected: [60], satisfied: [], wrong: [], finished: false });
    expect(feed(f, off('C4'), off('D4'), on('C4'))).toBe(1);
  });

  it('resetPhysical forgets keys and pedal (for a disconnected input)', () => {
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4 E4' }, { R: '.' }] }));
    feed(f, on('C4'), on('D4'), pedal(true));
    expect(f.status().wrong).toEqual([62]);
    f.resetPhysical();
    expect(f.physicalDown).toEqual([]);
    expect(f.pedal).toBe(false);
    expect(f.status().wrong).toEqual([]);
    expect(f.status().satisfied).toEqual([]);
    expect(feed(f, on('C4'), on('E4'))).toBe(1);
  });

  it('RH only: expects right-hand keys only and treats other keys as wrong', () => {
    const rh = buildSequence({ hands: ['R'], steps: [{ R: 'E4' }, { R: 'F4 A4' }, { R: '.' }] });
    expect(rh.hands).toEqual(['R']);
    const f = new FollowMatcher(rh);

    feed(f, on('C3'));
    expect(f.status()).toEqual({ stepIndex: 0, expected: [64], satisfied: [], wrong: [48], finished: false });
    expect(feed(f, on('E4'))).toBe(0);
    expect(feed(f, off('C3'))).toBe(1);

    expect(f.status().expected).toEqual([65, 69]);
    expect(feed(f, on('F4'), on('A4'))).toBe(1);
    expect(f.status().finished).toBe(true);
  });

  it('expected keys come only from the included hands', () => {
    const both = buildSequence({
      steps: [{ R: 'E4', L: 'C3' }, { L: 'G2' }, { R: 'F4' }, { R: '.', L: '.' }],
    });
    expect(new FollowMatcher(both).status().expected).toEqual([48, 64]);

    // Same steps viewed with only the right hand included: the LH-only step has nothing to strike.
    const f = new FollowMatcher({ ...both, hands: ['R'] });
    expect(f.status().expected).toEqual([64]);
    expect(feed(f, on('E4'))).toBe(1);
    expect(f.status()).toEqual({ stepIndex: 2, expected: [65], satisfied: [], wrong: [], finished: false });
    expect(feed(f, on('F4'))).toBe(1);
    expect(f.finished).toBe(true);
  });
});

describe('stepBuilder sanity', () => {
  it('derives cells, held state and release-only flags like the canonical rules', () => {
    const seq = buildSequence({
      steps: [{ R: 'C4' }, { R: '+E4' }, { R: '-E4 +G4' }, { R: '-G4 +F4' }, { R: '.' }],
    });
    expect(seq.steps.map((s) => s.cells.R?.kind)).toEqual(['replace', 'change', 'change', 'change', 'rest']);
    expect(seq.steps[2].cells.R?.tokens.map((t) => `${t.action}:${t.label}`)).toEqual(['add:G4', 'release:E4']);
    expect(seq.steps.map((s) => s.heldAfter.R)).toEqual([[60], [60, 64], [60, 67], [60, 65], []]);
    expect(seq.steps[4].releases.R).toEqual(keys('C4 F4'));
    expect(seq.steps.map((s) => s.releaseOnly)).toEqual([false, false, false, false, true]);
    expect(seq.usedKeys).toEqual(keys('C4 E4 F4 G4'));
  });
});
