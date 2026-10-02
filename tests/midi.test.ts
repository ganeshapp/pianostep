import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowMatcher } from '../src/core/practice/follow';
import type { MidiInputEvent } from '../src/core/types';
import { decodeMidiMessage } from '../src/midi/decode';
import { ECHO_WINDOW_MS, MIDI_MESSAGES, MidiManager, type MidiState } from '../src/midi/manager';
import { buildSequence } from './helpers/stepBuilder';

/* ------------------------------------------------------------------------ */
/* Fake Web MIDI                                                             */
/* ------------------------------------------------------------------------ */

interface FakeMessageEvent {
  data: Uint8Array;
  timeStamp: number;
}

class FakePort {
  state: 'connected' | 'disconnected' = 'connected';
  connection = 'closed';
  version = '1.0';
  onmidimessage: ((ev: FakeMessageEvent) => void) | null = null;
  onstatechange: (() => void) | null = null;
  sent: Array<{ data: number[]; at: number | undefined }> = [];
  /** Called for every message the app sends (used to loop output back into an input). */
  onSend: ((data: number[], at: number | undefined) => void) | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: 'input' | 'output',
    readonly manufacturer = 'Yamaha',
  ) {}

  send(data: number[], at?: number): void {
    this.sent.push({ data: [...data], at });
    this.onSend?.(data, at);
  }

  /** The device sends a message to the computer. */
  emit(data: number[], timeStamp: number): void {
    this.onmidimessage?.({ data: Uint8Array.from(data), timeStamp });
  }
}

class FakeOutputWithClear extends FakePort {
  clears = 0;
  clear(): void {
    this.clears += 1;
  }
}

class FakeAccess {
  readonly inputs = new Map<string, FakePort>();
  readonly outputs = new Map<string, FakePort>();
  readonly sysexEnabled = false;
  onstatechange: ((ev: { port: FakePort }) => void) | null = null;

  constructor(ports: FakePort[] = []) {
    for (const p of ports) this.mapFor(p).set(p.id, p);
  }

  private mapFor(p: FakePort): Map<string, FakePort> {
    return p.type === 'input' ? this.inputs : this.outputs;
  }

  plug(p: FakePort): void {
    p.state = 'connected';
    this.mapFor(p).set(p.id, p);
    this.onstatechange?.({ port: p });
  }

  unplug(p: FakePort, removeFromMap = false): void {
    p.state = 'disconnected';
    if (removeFromMap) this.mapFor(p).delete(p.id);
    this.onstatechange?.({ port: p });
  }
}

let clock = 1000;
function setup(ports: FakePort[] = [], requestImpl?: () => Promise<FakeAccess>) {
  const access = new FakeAccess(ports);
  const request = vi.fn(requestImpl ?? (async () => access));
  const mgr = new MidiManager({
    requestMIDIAccess: request as unknown as (opts?: MIDIOptions) => Promise<MIDIAccess>,
    now: () => clock,
  });
  const events: MidiInputEvent[] = [];
  mgr.onEvent((ev) => events.push(ev));
  const states: MidiState[] = [];
  mgr.onChange(() => states.push(mgr.state));
  return { access, request, mgr, events, states };
}

const input = (id: string, name = `Piano ${id}`): FakePort => new FakePort(id, name, 'input');
const output = (id: string, name = `Piano ${id}`): FakePort => new FakePort(id, name, 'output');

afterEach(() => {
  clock = 1000;
});

/* ------------------------------------------------------------------------ */
/* decodeMidiMessage                                                         */
/* ------------------------------------------------------------------------ */

describe('decodeMidiMessage', () => {
  it('decodes note-on and note-off on every channel (channels reported 1-16)', () => {
    expect(decodeMidiMessage([0x90, 60, 100], 5)).toEqual({ type: 'noteon', midi: 60, velocity: 100, channel: 1, time: 5 });
    expect(decodeMidiMessage([0x9f, 108, 1], 6)).toEqual({ type: 'noteon', midi: 108, velocity: 1, channel: 16, time: 6 });
    expect(decodeMidiMessage([0x80, 21, 64], 7)).toEqual({ type: 'noteoff', midi: 21, channel: 1, time: 7 });
    expect(decodeMidiMessage(Uint8Array.from([0x89, 62, 0]), 8)).toEqual({ type: 'noteoff', midi: 62, channel: 10, time: 8 });
  });

  it('turns a velocity-0 note-on into a note-off', () => {
    expect(decodeMidiMessage([0x93, 64, 0], 9)).toEqual({ type: 'noteoff', midi: 64, channel: 4, time: 9 });
  });

  it('decodes CC64 with 64 and above as pedal down', () => {
    expect(decodeMidiMessage([0xb0, 64, 127], 1)).toEqual({ type: 'sustain', down: true, value: 127, channel: 1, time: 1 });
    expect(decodeMidiMessage([0xb2, 64, 64], 1)).toEqual({ type: 'sustain', down: true, value: 64, channel: 3, time: 1 });
    expect(decodeMidiMessage([0xb0, 64, 63], 1)).toEqual({ type: 'sustain', down: false, value: 63, channel: 1, time: 1 });
  });

  it('ignores everything else', () => {
    expect(decodeMidiMessage([0xf8], 1)).toBeNull(); // clock
    expect(decodeMidiMessage([0xfe], 1)).toBeNull(); // active sensing
    expect(decodeMidiMessage([0xb0, 7, 100], 1)).toBeNull(); // volume
    expect(decodeMidiMessage([0xb0, 123, 0], 1)).toBeNull(); // all notes off from the device
    expect(decodeMidiMessage([0xa0, 60, 30], 1)).toBeNull(); // poly aftertouch
    expect(decodeMidiMessage([0xe0, 0, 64], 1)).toBeNull(); // pitch bend
    expect(decodeMidiMessage([0xc0, 5, 0], 1)).toBeNull(); // program change
    expect(decodeMidiMessage([0xf0, 0x7e, 0x7f, 0xf7], 1)).toBeNull(); // sysex
    expect(decodeMidiMessage([0x90, 60], 1)).toBeNull(); // truncated
    expect(decodeMidiMessage([0x90, 200, 10], 1)).toBeNull(); // not a data byte
    expect(decodeMidiMessage([60, 100, 0], 1)).toBeNull(); // running status is never delivered
    expect(decodeMidiMessage(null, 1)).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* MidiManager                                                               */
/* ------------------------------------------------------------------------ */

describe('MidiManager: support and permission', () => {
  it('reports unsupported when there is no requestMIDIAccess', async () => {
    const mgr = new MidiManager({ requestMIDIAccess: undefined });
    expect(mgr.isSupported()).toBe(false);
    expect(mgr.state).toBe('unsupported');
    expect(mgr.errorMessage).toBe(MIDI_MESSAGES.unsupported);
    await expect(mgr.connect()).resolves.toBe('unsupported');
    expect(mgr.inputs()).toEqual([]);
    expect(mgr.inputConnected).toBe(false);
  });

  it('uses navigator.requestMIDIAccess by default, called on navigator with sysex off', async () => {
    expect('requestMIDIAccess' in navigator).toBe(false); // jsdom has no Web MIDI
    expect(new MidiManager().state).toBe('unsupported');

    const access = new FakeAccess([input('a')]);
    let calledOn: unknown = null;
    const fn = vi.fn(function (this: unknown) {
      calledOn = this;
      return Promise.resolve(access);
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: fn, configurable: true });
    try {
      const mgr = new MidiManager();
      expect(mgr.isSupported()).toBe(true);
      expect(mgr.state).toBe('idle');
      await expect(mgr.connect()).resolves.toBe('ready');
      expect(fn).toHaveBeenCalledWith({ sysex: false });
      expect(calledOn).toBe(navigator);
    } finally {
      Reflect.deleteProperty(navigator, 'requestMIDIAccess');
    }
  });

  it('reports denied for NotAllowedError and SecurityError, and can retry', async () => {
    let attempt = 0;
    const access = new FakeAccess([input('a')]);
    const { mgr, states, request } = setup([], async () => {
      attempt += 1;
      if (attempt === 1) throw new DOMException('blocked', 'NotAllowedError');
      if (attempt === 2) throw new DOMException('insecure', 'SecurityError');
      return access;
    });

    await expect(mgr.connect()).resolves.toBe('denied');
    expect(mgr.errorMessage).toBe(MIDI_MESSAGES.denied);
    expect(states).toEqual(['requesting', 'denied']);

    await expect(mgr.connect()).resolves.toBe('denied');
    await expect(mgr.connect()).resolves.toBe('ready');
    expect(mgr.errorMessage).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
    expect(mgr.selectedInputId).toBe('a');
  });

  it('reports a plain-language error for other failures, including synchronous throws', async () => {
    let attempt = 0;
    const access = new FakeAccess([input('a')]);
    const { mgr } = setup([], () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Illegal invocation');
      if (attempt === 2) return Promise.reject(new Error('internal'));
      return Promise.resolve(access);
    });
    await expect(mgr.connect()).resolves.toBe('error');
    expect(mgr.errorMessage).toBe(MIDI_MESSAGES.error);
    await expect(mgr.connect()).resolves.toBe('error');
    await expect(mgr.connect()).resolves.toBe('ready');
    expect(mgr.errorMessage).toBeNull();
  });

  it('shares one pending request between overlapping connect() calls', async () => {
    const { mgr, request } = setup([input('a')]);
    const [s1, s2] = await Promise.all([mgr.connect(), mgr.connect()]);
    expect([s1, s2]).toEqual(['ready', 'ready']);
    expect(request).toHaveBeenCalledTimes(1);
    await mgr.connect();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('MidiManager: devices and selection', () => {
  it('is ready with no devices, then auto-selects a piano that is plugged in later', async () => {
    const { mgr, access, events } = setup();
    await expect(mgr.connect()).resolves.toBe('ready');
    expect(mgr.inputs()).toEqual([]);
    expect(mgr.outputs()).toEqual([]);
    expect(mgr.selectedInputId).toBeNull();
    expect(mgr.inputConnected).toBe(false);

    const p = input('p1', 'Yamaha P-125');
    access.plug(p);
    expect(mgr.selectedInputId).toBe('p1');
    expect(mgr.inputConnected).toBe(true);
    p.emit([0x90, 60, 70], 2000);
    expect(events).toEqual([{ type: 'noteon', midi: 60, velocity: 70, channel: 1, time: 2000 }]);
  });

  it('auto-selects a single input, lists devices, and never auto-selects the output', async () => {
    const inp = input('in1', 'Digital Piano');
    const out = output('out1', 'Digital Piano');
    const { mgr, events } = setup([inp, out]);
    await mgr.connect();

    expect(mgr.selectedInputId).toBe('in1');
    expect(mgr.inputConnected).toBe(true);
    expect(mgr.inputs()).toEqual([{ id: 'in1', name: 'Digital Piano', manufacturer: 'Yamaha', connected: true }]);
    expect(mgr.outputs()).toEqual([{ id: 'out1', name: 'Digital Piano', manufacturer: 'Yamaha', connected: true }]);
    expect(mgr.selectedOutputId).toBeNull();

    inp.emit([0x90, 64, 90], 1500);
    inp.emit([0xb0, 64, 127], 1510);
    inp.emit([0xf8], 1511);
    inp.emit([0x80, 64, 0], 1520);
    expect(events).toEqual([
      { type: 'noteon', midi: 64, velocity: 90, channel: 1, time: 1500 },
      { type: 'sustain', down: true, value: 127, channel: 1, time: 1510 },
      { type: 'noteoff', midi: 64, channel: 1, time: 1520 },
    ]);
  });

  it('with several inputs, waits for a choice and listens only to the selected one', async () => {
    const a = input('a', 'Keyboard A');
    const b = input('b', 'Keyboard B');
    const { mgr, events, access } = setup([a, b]);
    await mgr.connect();
    expect(mgr.selectedInputId).toBeNull();
    expect(mgr.inputs().map((d) => d.id)).toEqual(['a', 'b']);

    a.emit([0x90, 60, 80], 1100);
    expect(events).toEqual([]);

    mgr.selectInput('b');
    expect(mgr.selectedInputId).toBe('b');
    a.emit([0x90, 60, 80], 1200);
    b.emit([0x90, 62, 80], 1210);
    b.emit([0x99, 62, 0], 1220); // channel 10, velocity-0 note-on
    expect(events).toEqual([
      { type: 'noteon', midi: 62, velocity: 80, channel: 1, time: 1210 },
      { type: 'noteoff', midi: 62, channel: 10, time: 1220 },
    ]);

    mgr.selectInput('a');
    expect(b.onmidimessage).toBeNull();
    b.emit([0x90, 65, 80], 1300);
    a.emit([0x90, 67, 80], 1310);
    expect(events.map((e) => (e.type === 'sustain' ? -1 : e.midi))).toEqual([62, 62, 67]);

    // "None" is respected, even when only one input remains afterwards.
    mgr.selectInput(null);
    expect(mgr.inputConnected).toBe(false);
    access.unplug(b, true);
    expect(mgr.selectedInputId).toBeNull();
    a.emit([0x90, 69, 80], 1400);
    expect(events).toHaveLength(3);
  });

  it('accepts a remembered input id before connect()', async () => {
    const { mgr } = setup([input('a'), input('b')]);
    mgr.selectInput('b');
    await mgr.connect();
    expect(mgr.selectedInputId).toBe('b');
    expect(mgr.inputConnected).toBe(true);
  });

  it('does not take a device that was already there at connect() over a remembered id that is missing', async () => {
    for (const name of ['Midi Through Port-0', 'USB MIDI Interface']) {
      const other = input('other', name);
      const { mgr, access, events } = setup([other]);
      mgr.selectInput('piano', 'Yamaha P-125'); // saved with the piece; the piano is off
      await mgr.connect();
      expect(mgr.selectedInputId).toBe('piano');
      expect(mgr.inputConnected).toBe(false);
      expect(mgr.inputSeen).toBe(false);
      expect(other.onmidimessage).toBeNull();

      // The piano is switched on under its saved id: attached.
      const piano = input('piano', 'Yamaha P-125');
      access.plug(piano);
      expect(mgr.selectedInputId).toBe('piano');
      expect(mgr.inputConnected).toBe(true);
      piano.emit([0x90, 60, 70], 2000);
      expect(events).toHaveLength(1);
    }
  });

  it('finds a remembered input that is back under a new id by its remembered name, at connect() or later', async () => {
    const atConnect = setup([input('other', 'USB MIDI Interface'), input('new-id', 'Yamaha P-125')]);
    atConnect.mgr.selectInput('old-id', 'Yamaha P-125');
    await atConnect.mgr.connect();
    expect(atConnect.mgr.selectedInputId).toBe('new-id');
    expect(atConnect.mgr.inputConnected).toBe(true);

    const later = setup([input('other', 'USB MIDI Interface')]);
    later.mgr.selectInput('old-id', 'Yamaha P-125');
    await later.mgr.connect();
    expect(later.mgr.inputConnected).toBe(false);
    // Plugged in beside another newcomer: found by name, not left to a choice.
    later.access.inputs.set('pad', input('pad', 'Pad Controller'));
    later.access.plug(input('new-id', 'Yamaha P-125'));
    expect(later.mgr.selectedInputId).toBe('new-id');
    expect(later.mgr.inputConnected).toBe(true);
  });

  it('never picks a loopback port (Midi Through) on its own, with or without a remembered input', async () => {
    const through = (): FakePort => input('thru', 'Midi Through Port-0');
    const fresh = setup([through()]);
    await fresh.mgr.connect();
    expect(fresh.mgr.selectedInputId).toBeNull();
    expect(fresh.mgr.inputConnected).toBe(false);
    // The piano switched on later beside it is attached: Midi Through does not compete.
    const piano = input('piano', 'Yamaha P-125');
    fresh.access.plug(piano);
    expect(fresh.mgr.selectedInputId).toBe('piano');
    expect(fresh.mgr.inputConnected).toBe(true);
    // Choosing Midi Through from the list still works.
    fresh.mgr.selectInput('thru');
    expect(fresh.mgr.inputConnected).toBe(true);
    expect(piano.onmidimessage).toBeNull();

    // A piano already on beside it at Connect still asks for a choice, as two devices do.
    const both = setup([through(), input('piano', 'Yamaha P-125')]);
    await both.mgr.connect();
    expect(both.mgr.selectedInputId).toBeNull();

    const late = setup([]);
    late.mgr.selectInput('piano');
    await late.mgr.connect();
    late.access.plug(through());
    expect(late.mgr.selectedInputId).toBe('piano');
    expect(late.mgr.inputConnected).toBe(false);
  });
});

describe('MidiManager: disconnect and reconnect', () => {
  it('re-attaches the same input when it comes back', async () => {
    const p = input('p', 'Stage Piano');
    const other = input('o', 'Pad Controller');
    const { mgr, access, events, states } = setup([p]);
    await mgr.connect();
    states.length = 0;

    access.unplug(p);
    expect(states.length).toBeGreaterThan(0);
    expect(mgr.inputConnected).toBe(false);
    expect(mgr.selectedInputId).toBe('p');
    expect(mgr.inputs()).toEqual([{ id: 'p', name: 'Stage Piano', manufacturer: 'Yamaha', connected: false }]);
    p.emit([0x90, 60, 80], 1100);
    expect(events).toEqual([]);

    // Another device arriving meanwhile is not taken over the remembered choice.
    access.plug(other);
    expect(mgr.selectedInputId).toBe('p');
    expect(other.onmidimessage).toBeNull();

    access.plug(p);
    expect(mgr.inputConnected).toBe(true);
    expect(mgr.selectedInputId).toBe('p');
    p.emit([0x90, 60, 80], 1200);
    expect(events).toEqual([{ type: 'noteon', midi: 60, velocity: 80, channel: 1, time: 1200 }]);
  });

  it('re-attaches by name when the device returns with a new id', async () => {
    const before = input('id-1', 'Roland FP-30');
    const { mgr, access, events } = setup([before, input('x', 'Other')]);
    await mgr.connect();
    mgr.selectInput('id-1');

    access.unplug(before, true);
    expect(mgr.inputConnected).toBe(false);
    expect(mgr.inputs()).toEqual([
      { id: 'x', name: 'Other', manufacturer: 'Yamaha', connected: true },
      { id: 'id-1', name: 'Roland FP-30', manufacturer: '', connected: false },
    ]);

    const after = input('id-2', 'Roland FP-30');
    access.plug(after);
    expect(mgr.selectedInputId).toBe('id-2');
    expect(mgr.inputConnected).toBe(true);
    after.emit([0x90, 72, 50], 1300);
    expect(events).toEqual([{ type: 'noteon', midi: 72, velocity: 50, channel: 1, time: 1300 }]);
  });

  it('feeds a FollowMatcher that the engine can reset when the input drops', async () => {
    const p = input('p');
    const { mgr, access } = setup([p]);
    await mgr.connect();
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: '.' }] }));
    mgr.onEvent((ev) => f.handle(ev));
    mgr.onChange(() => {
      if (!mgr.inputConnected) f.resetPhysical();
    });

    p.emit([0x90, 61, 80], 1100); // wrong key, then the cable is pulled
    expect(f.status().wrong).toEqual([61]);
    access.unplug(p);
    expect(f.physicalDown).toEqual([]);

    access.plug(p);
    p.emit([0x90, 60, 80], 1200);
    expect(f.status().finished).toBe(true);
  });
});

describe('MidiManager: output', () => {
  it('sends nothing until an output is chosen, then uses channel 1', async () => {
    const inp = input('in');
    const out = output('out');
    const { mgr } = setup([inp, out]);
    await mgr.connect();

    mgr.sendNoteOn(60, 100);
    mgr.sendNoteOff(60);
    expect(out.sent).toEqual([]);

    mgr.selectOutput('out');
    expect(mgr.selectedOutputId).toBe('out');
    mgr.sendNoteOn(60, 100);
    mgr.sendNoteOn(62, 0);
    mgr.sendNoteOn(64, 300, 1500);
    mgr.sendNoteOff(60, 1600);
    mgr.sendNoteOn(200, 50);
    expect(out.sent).toEqual([
      { data: [0x90, 60, 100], at: undefined },
      { data: [0x90, 62, 1], at: undefined },
      { data: [0x90, 64, 127], at: 1500 },
      { data: [0x80, 60, 0], at: 1600 },
    ]);
  });

  it('never forwards input to the output', async () => {
    const inp = input('in');
    const out = output('out');
    const { mgr, events } = setup([inp, out]);
    await mgr.connect();
    mgr.selectOutput('out');
    inp.emit([0x90, 60, 80], 1100);
    inp.emit([0x80, 60, 0], 1150);
    expect(events).toHaveLength(2);
    expect(out.sent).toEqual([]);
  });

  it('allNotesOff sends note-offs for every app-sent note not yet released, CC123 and sustain off', async () => {
    const out = new FakeOutputWithClear('out', 'Synth', 'output');
    const { mgr } = setup([out]);
    await mgr.connect();
    mgr.selectOutput('out');
    mgr.sendNoteOn(64, 80);
    mgr.sendNoteOn(60, 80);
    mgr.sendNoteOff(60); // C4 is already released: no second note-off for it
    out.sent.length = 0;

    mgr.allNotesOff();
    expect(out.clears).toBe(1);
    expect(out.sent.map((s) => s.data)).toEqual([
      [0x80, 64, 0],
      [0xb0, 123, 0],
      [0xb0, 64, 0],
    ]);

    out.sent.length = 0;
    mgr.allNotesOff();
    expect(out.sent.map((s) => s.data)).toEqual([
      [0xb0, 123, 0],
      [0xb0, 64, 0],
    ]);
  });

  it('without clear(), follows each still-queued future note-on with a note-off', async () => {
    const out = output('out');
    const { mgr } = setup([out]);
    await mgr.connect();
    mgr.selectOutput('out');
    clock = 5000;
    mgr.sendNoteOn(67, 80, 5100);
    mgr.sendNoteOn(69, 80, 4990);
    out.sent.length = 0;

    mgr.allNotesOff();
    expect(out.sent).toEqual([
      { data: [0x80, 67, 0], at: undefined },
      { data: [0x80, 69, 0], at: undefined },
      { data: [0xb0, 123, 0], at: undefined },
      { data: [0xb0, 64, 0], at: undefined },
      { data: [0x80, 67, 0], at: 5101 },
      // All Notes Off once more, after the last message still queued.
      { data: [0xb0, 123, 0], at: 5101 },
    ]);

    // Nothing queued any more: no late All Notes Off.
    out.sent.length = 0;
    mgr.allNotesOff();
    expect(out.sent.every((m) => m.at === undefined)).toBe(true);
  });

  it('without clear(), sends All Notes Off again after a queued note-off too', async () => {
    const out = output('out');
    const { mgr } = setup([out]);
    await mgr.connect();
    mgr.selectOutput('out');
    clock = 5000;
    mgr.sendNoteOn(67, 80, 5020);
    mgr.sendNoteOff(67, 5140);
    out.sent.length = 0;

    mgr.allNotesOff();
    expect(out.sent.filter((m) => m.at !== undefined)).toEqual([
      { data: [0x80, 67, 0], at: 5021 },
      { data: [0xb0, 123, 0], at: 5141 },
    ]);
  });

  it('with clear(), sends nothing for later', async () => {
    const out = new FakeOutputWithClear('out', 'Synth', 'output');
    const { mgr } = setup([out]);
    await mgr.connect();
    mgr.selectOutput('out');
    clock = 5000;
    mgr.sendNoteOn(67, 80, 5020);
    mgr.sendNoteOff(67, 5140);
    out.sent.length = 0;
    mgr.allNotesOff();
    expect(out.clears).toBe(1);
    expect(out.sent.every((m) => m.at === undefined)).toBe(true);
  });

  it('switching output releases notes on the old one first', async () => {
    const o1 = output('o1', 'Piano');
    const o2 = output('o2', 'Synth');
    const { mgr } = setup([o1, o2]);
    await mgr.connect();
    mgr.selectOutput('o1');
    mgr.sendNoteOn(60, 90);
    mgr.selectOutput('o2');
    expect(o1.sent.map((s) => s.data)).toEqual([
      [0x90, 60, 90],
      [0x80, 60, 0],
      [0xb0, 123, 0],
      [0xb0, 64, 0],
    ]);
    mgr.sendNoteOn(62, 90);
    expect(o2.sent.map((s) => s.data)).toEqual([[0x90, 62, 90]]);
    mgr.selectOutput(null);
    expect(mgr.selectedOutputId).toBeNull();
    mgr.sendNoteOn(64, 90);
    expect(o2.sent).toHaveLength(4);
  });
});

describe('MidiManager: echo guard', () => {
  /** A piano whose MIDI thru plays app output straight back into its input. */
  async function loopback(latencyMs: number) {
    const inp = input('in', 'Loop Piano');
    const out = output('out', 'Loop Piano');
    const ctx = setup([inp, out]);
    await ctx.mgr.connect();
    ctx.mgr.selectOutput('out');
    out.onSend = (data, at) => {
      if ((data[0] & 0xf0) === 0x90 || (data[0] & 0xf0) === 0x80) {
        inp.emit(data, (at ?? clock) + latencyMs);
      }
    };
    return { ...ctx, inp, out };
  }

  it('drops input notes that echo an app-sent note within 80 ms', async () => {
    const { mgr, inp, events } = await loopback(5);
    mgr.sendNoteOn(60, 90); // echo at 1005
    mgr.sendNoteOff(60, 1050); // echo at 1055
    expect(events).toEqual([]);

    // Same key, real presses, outside the window.
    inp.emit([0x90, 60, 70], 1000 + ECHO_WINDOW_MS + 1);
    // Different key, or a different message type for the same key, inside the window.
    inp.emit([0x90, 62, 70], 1010);
    inp.emit([0x80, 60, 0], 1020);
    expect(events).toEqual([
      { type: 'noteon', midi: 60, velocity: 70, channel: 1, time: 1081 },
      { type: 'noteon', midi: 62, velocity: 70, channel: 1, time: 1010 },
      { type: 'noteoff', midi: 60, channel: 1, time: 1020 },
    ]);
  });

  it('uses the scheduled time of a future note and matches velocity-0 note-offs', async () => {
    const { mgr, inp, events } = await loopback(0);
    mgr.sendNoteOn(64, 80, 2000);
    events.length = 0;
    inp.emit([0x90, 64, 80], 1990); // before the app's note: a real press
    inp.emit([0x90, 64, 80], 2050); // echo
    inp.emit([0x90, 64, 80], 2081); // a real press again
    mgr.sendNoteOff(64, 2100);
    inp.emit([0x90, 64, 0], 2120); // velocity-0 echo of the note-off
    expect(events.map((e) => [e.type, e.time])).toEqual([
      ['noteon', 1990],
      ['noteon', 2081],
    ]);
  });

  it("delivers the player's own note-off even right after the app released the same key", async () => {
    // A piano that does not echo: the player plays along with app playback.
    const inp = input('in', 'Piano');
    const out = output('out', 'Piano');
    const { mgr, events } = setup([inp, out]);
    await mgr.connect();
    mgr.selectOutput('out');
    inp.emit([0x90, 60, 70], 900); // the player strikes C4 (delivered)
    mgr.sendNoteOn(62, 80, 950);
    mgr.sendNoteOff(60, 1000); // the app's own C4 ends
    mgr.sendNoteOff(62, 1000);
    inp.emit([0x80, 60, 0], 1030); // the player lets go 30 ms later
    expect(events.map((e) => [e.type, 'midi' in e ? e.midi : null, e.time])).toEqual([
      ['noteon', 60, 900],
      ['noteoff', 60, 1030],
    ]);
  });

  it('with an echoing piano, swallows the echoed pair but keeps the player\'s own release', async () => {
    const { mgr, inp, events } = await loopback(5);
    inp.emit([0x90, 60, 70], 900); // the player holds C4
    mgr.sendNoteOn(60, 90, 1000); // echo at 1005: swallowed
    mgr.sendNoteOff(60, 1500); // echo at 1505: swallowed (pairs with the echoed note-on)
    inp.emit([0x80, 60, 0], 1520); // the player lets go
    expect(events.map((e) => [e.type, 'midi' in e ? e.midi : null, e.time])).toEqual([
      ['noteon', 60, 900],
      ['noteoff', 60, 1520],
    ]);
  });

  it('forgets swallowed echoes when another input is chosen', async () => {
    const a = input('a', 'Piano A');
    const b = input('b', 'Piano B');
    const out = output('out', 'Piano A');
    const { mgr, events } = setup([a, b, out]);
    await mgr.connect();
    mgr.selectInput('a');
    mgr.selectOutput('out');
    mgr.sendNoteOn(60, 90, 1000);
    a.emit([0x90, 60, 90], 1002); // echo: swallowed
    mgr.selectInput('b');
    mgr.sendNoteOff(60, 1100);
    b.emit([0x80, 60, 0], 1110); // B's note-off cannot pair with A's echo
    expect(events.map((e) => [e.type, 'midi' in e ? e.midi : null, e.time])).toEqual([['noteoff', 60, 1110]]);
  });

  it('app playback echoed back by the piano does not advance Follow me', async () => {
    const { mgr, inp } = await loopback(3);
    const f = new FollowMatcher(buildSequence({ steps: [{ R: 'C4' }, { R: 'E4' }, { R: '.' }] }));
    mgr.onEvent((ev) => f.handle(ev));

    mgr.sendNoteOn(60, 90);
    mgr.sendNoteOff(60);
    expect(f.currentStep).toBe(0);
    expect(f.physicalDown).toEqual([]);

    inp.emit([0x90, 60, 90], 1200);
    expect(f.currentStep).toBe(1);
  });
});

describe('MidiManager: release burst and echoes', () => {
  /** A piano that plays back everything it receives (notes and controllers) into its input. */
  async function echoingPiano(latencyMs = 3) {
    const inp = input('in', 'Loop Piano');
    const out = output('out', 'Loop Piano');
    const ctx = setup([inp, out]);
    await ctx.mgr.connect();
    ctx.mgr.selectOutput('out');
    out.onSend = (data, at) => inp.emit(data, Math.max(at ?? clock, clock) + latencyMs);
    return { ...ctx, inp, out };
  }

  it('still sends a note-off for a key whose release was only queued for later', async () => {
    for (const withClear of [true, false]) {
      const out = withClear ? new FakeOutputWithClear('out', 'Synth', 'output') : output('out');
      const { mgr } = setup([out]);
      await mgr.connect();
      mgr.selectOutput('out');
      clock = 5000;
      mgr.sendNoteOn(60, 80, 4900); // sounding now
      mgr.sendNoteOff(60, 5100); // its release is still queued (withdrawn by clear())
      out.sent.length = 0;
      mgr.allNotesOff();
      expect(out.sent.filter((m) => m.at === undefined).map((m) => m.data)).toEqual([
        [0x80, 60, 0],
        [0xb0, 123, 0],
        [0xb0, 64, 0],
      ]);
    }
  });

  it("does not take the echoed All Notes Off and sustain off for the player's pedal or keys", async () => {
    const { mgr, inp, events } = await echoingPiano();
    mgr.sendNoteOn(60, 80); // the app plays C4 and releases it
    mgr.sendNoteOff(60);
    clock = 1500;
    inp.emit([0xb0, 64, 127], 1500); // the player holds the pedal...
    inp.emit([0x90, 60, 70], 1510); // ...and C4
    clock = 1600;
    mgr.allNotesOff(); // pause or loop restart
    mgr.allNotesOff(); // a second release with nothing played since
    expect(events.map((e) => [e.type, 'midi' in e ? e.midi : e.value, e.time])).toEqual([
      ['sustain', 127, 1500],
      ['noteon', 60, 1510],
    ]);
    // The player's own pedal release still gets through.
    inp.emit([0xb0, 64, 0], 1700);
    expect(events.at(-1)).toEqual({ type: 'sustain', down: false, value: 0, channel: 1, time: 1700 });
  });

  it('delivers a real pedal release right after the release burst on a piano that does not echo', async () => {
    const inp = input('in', 'Piano');
    const out = output('out', 'Piano');
    const { mgr, events } = setup([inp, out]);
    await mgr.connect();
    mgr.selectOutput('out');
    inp.emit([0xb0, 64, 127], 1000);
    mgr.allNotesOff();
    inp.emit([0xb0, 64, 0], 1010);
    expect(events.map((e) => (e.type === 'sustain' ? e.down : e.type))).toEqual([true, false]);
  });
});

describe('MidiManager: a remembered input that has not turned up', () => {
  it('gives way to the only piano switched on later, under any id or name', async () => {
    for (const [id, name] of [
      ['usb-id', 'Digital Piano'],
      ['bt-id', 'Digital Piano'],
      ['bt-id', 'Digital Piano Bluetooth'],
    ]) {
      const { mgr, access, events } = setup([]);
      mgr.selectInput('usb-id'); // saved with the piece
      await mgr.connect(); // the piano is still off
      expect(mgr.selectedInputId).toBe('usb-id');
      expect(mgr.inputConnected).toBe(false);
      expect(mgr.inputSeen).toBe(false);

      const p = input(id, name);
      access.plug(p);
      expect(mgr.selectedInputId).toBe(id);
      expect(mgr.inputConnected).toBe(true);
      expect(mgr.inputSeen).toBe(true);
      p.emit([0x90, 60, 70], 2000);
      expect(events).toHaveLength(1);
    }
  });

  it('waits for a choice when several unknown devices turn up', async () => {
    const { mgr, access } = setup([]);
    mgr.selectInput('usb-id');
    await mgr.connect();
    // Both turn up in one device change (e.g. a USB hub switched on).
    const a = input('a', 'Keyboard A');
    access.inputs.set('a', a);
    access.inputs.set('b', input('b', 'Keyboard B'));
    access.onstatechange?.({ port: a });
    expect(mgr.selectedInputId).toBe('usb-id');
    expect(mgr.inputConnected).toBe(false);
    expect(mgr.inputSeen).toBe(false);
  });

  it('a device that stood in for it gives way to the remembered piano when that turns up after all', async () => {
    const { mgr, access, events } = setup([]);
    mgr.selectInput('piano', 'Yamaha P-125');
    await mgr.connect();
    const pad = input('pad', 'Pad Controller');
    access.plug(pad); // turned up first: it may be the piano under another id and name
    expect(mgr.selectedInputId).toBe('pad');
    expect(mgr.inputConnected).toBe(true);

    const piano = input('piano', 'Yamaha P-125');
    access.plug(piano);
    expect(mgr.selectedInputId).toBe('piano');
    expect(mgr.inputConnected).toBe(true);
    expect(pad.onmidimessage).toBeNull();
    piano.emit([0x90, 60, 70], 2000);
    expect(events).toHaveLength(1);

    // An explicit choice is final: nothing is switched back afterwards.
    mgr.selectInput('pad');
    access.unplug(piano);
    access.plug(piano);
    expect(mgr.selectedInputId).toBe('pad');
  });

  it('once it has been connected, it is waited for again when it goes missing', async () => {
    const p = input('p', 'Stage Piano');
    const { mgr, access } = setup([]);
    mgr.selectInput('p');
    await mgr.connect();
    access.plug(p);
    expect(mgr.inputSeen).toBe(true);
    access.unplug(p, true);
    access.plug(input('o', 'Pad Controller'));
    expect(mgr.selectedInputId).toBe('p');
    expect(mgr.inputConnected).toBe(false);
    expect(mgr.inputSeen).toBe(true);
  });
});

describe('MidiManager: dispose', () => {
  it('detaches handlers, releases app notes and stops all notifications', async () => {
    const inp = input('in');
    const out = output('out');
    const { mgr, access, events, states } = setup([inp, out]);
    await mgr.connect();
    mgr.selectOutput('out');
    mgr.sendNoteOn(60, 90);
    out.sent.length = 0;
    states.length = 0;

    mgr.dispose();
    expect(out.sent.map((s) => s.data)).toEqual([
      [0x80, 60, 0],
      [0xb0, 123, 0],
      [0xb0, 64, 0],
    ]);
    expect(inp.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(mgr.inputConnected).toBe(false);

    inp.emit([0x90, 60, 80], 1100);
    mgr.sendNoteOn(62, 90);
    mgr.selectInput('in');
    expect(events).toEqual([]);
    expect(states).toEqual([]);
    expect(out.sent).toHaveLength(3);
  });

  it('ignores a permission answer that arrives after dispose', async () => {
    let resolve: (a: FakeAccess) => void = () => {};
    const access = new FakeAccess([input('in')]);
    const { mgr } = setup([], () => new Promise<FakeAccess>((r) => (resolve = r)));
    const pending = mgr.connect();
    mgr.dispose();
    resolve(access);
    await expect(pending).resolves.toBe('requesting');
    expect(access.onstatechange).toBeNull();
    expect(access.inputs.get('in')?.onmidimessage).toBeNull();
  });
});
