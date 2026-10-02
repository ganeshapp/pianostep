import type { MidiInputEvent } from '../core/types';
import { decodeMidiMessage } from './decode';

export type MidiState = 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready' | 'error';

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export interface MidiEnv {
  requestMIDIAccess?: (opts?: MIDIOptions) => Promise<MIDIAccess>;
  now?: () => number;
}

/** Input note events this close after a matching app-sent note are treated as echo. */
export const ECHO_WINDOW_MS = 80;

export const MIDI_MESSAGES = {
  unsupported:
    "This browser can't connect to a MIDI piano. Listen, Steady steps and manual stepping still work. Chrome and Edge support MIDI.",
  denied:
    'MIDI access was blocked. Allow MIDI for this site in the browser settings, then try again.',
  error: "The browser couldn't open MIDI devices. Check the piano's cable and power, then try again.",
} as const;

const NOTE_ON_CH1 = 0x90;
const NOTE_OFF_CH1 = 0x80;
const CC_CH1 = 0xb0;
const CC_SUSTAIN = 64;
const CC_ALL_NOTES_OFF = 123;
/** Sent-note records are kept well past the echo window, in case input delivery lags. */
const SENT_RECORD_TTL_MS = ECHO_WINDOW_MS + 2000;

type NoteKind = 'noteon' | 'noteoff';
interface SentRecord {
  midi: number;
  type: NoteKind;
  at: number;
}
/** A controller message of allNotesOff's release burst, kept for the echo guard. */
interface SentCc {
  cc: number;
  value: number;
  at: number;
}
interface Selection {
  id: string | null;
  /** Remembered so the device can be found again if it returns with a new id. */
  name: string | null;
}
type PortMap<P> = ReadonlyMap<string, P>;
type OutputWithClear = MIDIOutput & { clear?: () => void };

function defaultRequest(): MidiEnv['requestMIDIAccess'] {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as Navigator & { requestMIDIAccess?: Navigator['requestMIDIAccess'] };
  return typeof nav.requestMIDIAccess === 'function' ? nav.requestMIDIAccess.bind(nav) : undefined;
}

function defaultNow(): number {
  return performance.now();
}

function isConnected(port: MIDIPort): boolean {
  return port.state === 'connected';
}

/**
 * A software loopback port that is always present and never carries a
 * piano's keys: ALSA's "Midi Through Port-0", listed by Chrome on Linux. It is
 * never picked automatically (it can still be chosen from the list).
 */
export function isLoopbackPort(name: string | null | undefined): boolean {
  return /\bmidi through\b/i.test(name ?? '');
}

function portList<P extends MIDIPort>(map: PortMap<P>): P[] {
  return Array.from(map.values());
}

function info(port: MIDIPort): MidiDeviceInfo {
  return {
    id: port.id,
    name: port.name || 'Unnamed MIDI device',
    manufacturer: port.manufacturer ?? '',
    connected: isConnected(port),
  };
}

/** A connected port matching the selection, by id first and then by name. */
function findPort<P extends MIDIPort>(map: PortMap<P>, sel: Selection): P | null {
  if (sel.id === null) return null;
  const ports = portList(map).filter(isConnected);
  return (
    ports.find((p) => p.id === sel.id) ??
    (sel.name ? ports.find((p) => p.name === sel.name) : undefined) ??
    null
  );
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) return String(err.name);
  return '';
}

function isMidiNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 127;
}

/**
 * Web MIDI wrapper (ARCHITECTURE.md §5). Input and output are separate roles:
 * one input is listened to (auto-selected when it is the only one), output is
 * off until the user picks a device. Input is never forwarded to output.
 */
export class MidiManager {
  private readonly request: MidiEnv['requestMIDIAccess'];
  private readonly now: () => number;
  private access: MIDIAccess | null = null;
  private currentState: MidiState;
  private message: string | null;
  private pending: Promise<MidiState> | null = null;
  private disposed = false;

  private inputSel: Selection = { id: null, name: null };
  private outputSel: Selection = { id: null, name: null };
  /** The user chose "no input"; do not auto-select over that choice. */
  private inputDeclined = false;
  /** The selected input has been connected at some point since it was selected. */
  private inputSeenFlag = false;
  /**
   * Inputs connected when access was granted (or when another input was
   * selected while access was open): devices already there beside the piano.
   * They never stand in for a remembered piano that has not turned up.
   */
  private presentAtConnect = new Set<string>();
  /**
   * A remembered input that had not turned up and gave way to a device that
   * appeared after Connect. It is re-attached if it turns up after all.
   */
  private displaced: Selection | null = null;
  private attached: MIDIInput | null = null;

  private readonly eventListeners = new Set<(ev: MidiInputEvent) => void>();
  private readonly changeListeners = new Set<() => void>();

  private sent: SentRecord[] = [];
  /**
   * Per key, echoed note-ons that were swallowed and whose note-off has not
   * arrived yet. Only such a note-off can itself be an echo; a note-off whose
   * note-on reached listeners is always delivered.
   */
  private readonly echoOns = new Map<number, number>();
  /** Every key the app has sent a note-on for since the last allNotesOff. */
  private readonly appNotes = new Set<number>();
  /**
   * Per key, the last note message sent (in send order) and when it takes
   * effect, so allNotesOff can leave out keys the app has already released.
   */
  private readonly lastSent = new Map<number, { type: NoteKind; at: number }>();
  /** Controller messages of recent release bursts (CC123, CC64 = 0), for the echo guard. */
  private sentCc: SentCc[] = [];
  /** When the input last echoed the app's All Notes Off (input time). */
  private ccEchoAt = -Infinity;
  /** Latest future-scheduled note-on time per key (for outputs without clear()). */
  private readonly scheduledOns = new Map<number, number>();
  /** Latest timestamp of any message sent for the future (for outputs without clear()). */
  private queuedUntil = -Infinity;

  /**
   * Passing an `env` object that has a `requestMIDIAccess` key (even
   * undefined) replaces the browser's; omitting the key uses
   * `navigator.requestMIDIAccess` when present.
   */
  constructor(env?: MidiEnv) {
    this.request = env && 'requestMIDIAccess' in env ? env.requestMIDIAccess : defaultRequest();
    this.now = env?.now ?? defaultNow;
    this.currentState = this.request ? 'idle' : 'unsupported';
    this.message = this.request ? null : MIDI_MESSAGES.unsupported;
  }

  isSupported(): boolean {
    return this.request !== undefined;
  }

  get state(): MidiState {
    return this.currentState;
  }

  /** Plain-language explanation for 'unsupported', 'denied' and 'error'; otherwise null. */
  get errorMessage(): string | null {
    return this.message;
  }

  /** Call from a user gesture. Retrying after 'denied' or 'error' asks again. */
  connect(): Promise<MidiState> {
    const request = this.request;
    if (this.disposed || !request) return Promise.resolve(this.currentState);
    if (this.pending) return this.pending;
    if (this.currentState === 'ready') return Promise.resolve(this.currentState);

    this.setState('requesting', null);
    // finally() runs asynchronously, so `pending` is cleared even when the
    // request throws synchronously.
    const attempt = this.requestAccess(request).finally(() => {
      this.pending = null;
    });
    this.pending = attempt;
    return attempt;
  }

  /**
   * Inputs known to the browser. If the selected input has vanished from the
   * browser's list, it is still reported (connected: false) so the selection
   * stays visible while waiting for it to come back.
   */
  inputs(): MidiDeviceInfo[] {
    return this.listWithSelection(this.access?.inputs, this.inputSel);
  }

  outputs(): MidiDeviceInfo[] {
    return this.listWithSelection(this.access?.outputs, this.outputSel);
  }

  get selectedInputId(): string | null {
    return this.inputSel.id;
  }

  get selectedOutputId(): string | null {
    return this.outputSel.id;
  }

  /** True when the selected input is present and delivering events. */
  get inputConnected(): boolean {
    return this.attached !== null && isConnected(this.attached);
  }

  /**
   * True once the selected input has been connected since it was selected.
   * False for an id remembered from an earlier visit that has not turned up
   * in this session: that piano was not found, rather than disconnected.
   */
  get inputSeen(): boolean {
    return this.inputSel.id !== null && this.inputSeenFlag;
  }

  /**
   * Ids may be chosen before connect(); the device is attached once it is
   * found, by id or else by name. `rememberedName` is the name the device had
   * when it was remembered (for an id saved on an earlier visit), so it is
   * found again if it comes back under another id.
   */
  selectInput(id: string | null, rememberedName?: string | null): void {
    if (this.disposed) return;
    this.displaced = null;
    if (id === null) {
      this.inputDeclined = true;
      this.inputSel = { id: null, name: null };
      this.inputSeenFlag = false;
      this.bindInput(null);
      this.emitChange();
      return;
    }
    this.inputDeclined = false;
    const access = this.access;
    const port = access?.inputs.get(id) ?? null;
    const same = this.inputSel.id === id;
    const keptName = same ? this.inputSel.name : null;
    this.inputSel = { id, name: port?.name || keptName || rememberedName || null };
    if (!same) {
      this.inputSeenFlag = false;
      if (access) this.presentAtConnect = new Set(portList(access.inputs).filter(isConnected).map((p) => p.id));
    }
    const found = access ? findPort(access.inputs, this.inputSel) : null;
    if (found) this.inputSel = { id: found.id, name: found.name || this.inputSel.name };
    this.bindInput(found);
    this.emitChange();
  }

  /**
   * Output is never chosen automatically. Switching releases notes on the old
   * output. `rememberedName` is the name the device had when its id was saved
   * (on an earlier visit), so it is found again if the browser now lists it
   * under another id; the selection then takes the new id.
   */
  selectOutput(id: string | null, rememberedName?: string | null): void {
    if (this.disposed || id === this.outputSel.id) return;
    this.allNotesOff();
    const access = this.access;
    const port = id === null ? null : (access?.outputs.get(id) ?? null);
    this.outputSel = { id, name: port?.name || rememberedName || null };
    const found = access ? findPort(access.outputs, this.outputSel) : null;
    if (found) this.outputSel = { id: found.id, name: found.name || this.outputSel.name };
    this.emitChange();
  }

  /** Real input from the selected input only, after the echo guard. */
  onEvent(fn: (ev: MidiInputEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** State, device list, selection and connection changes. */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  sendNoteOn(midi: number, velocity: number, atMs?: number): void {
    const out = this.outputPort();
    if (!out || !isMidiNumber(midi)) return;
    const vel = Math.min(127, Math.max(1, Math.round(velocity) || 1));
    // Recorded before sending so even an instant echo is recognised.
    this.remember(midi, 'noteon', atMs);
    this.appNotes.add(midi);
    this.lastSent.set(midi, { type: 'noteon', at: atMs ?? this.now() });
    this.send(out, [NOTE_ON_CH1, midi, vel], atMs);
    if (atMs !== undefined && atMs > this.now()) {
      this.scheduledOns.set(midi, Math.max(atMs, this.scheduledOns.get(midi) ?? -Infinity));
      this.queuedUntil = Math.max(this.queuedUntil, atMs);
    }
  }

  sendNoteOff(midi: number, atMs?: number): void {
    const out = this.outputPort();
    if (!out || !isMidiNumber(midi)) return;
    this.remember(midi, 'noteoff', atMs);
    this.lastSent.set(midi, { type: 'noteoff', at: atMs ?? this.now() });
    this.send(out, [NOTE_OFF_CH1, midi, 0], atMs);
    if (atMs !== undefined && atMs > this.now()) this.queuedUntil = Math.max(this.queuedUntil, atMs);
  }

  /**
   * Releases everything the app has played on the selected output: pending
   * scheduled messages are cleared where the browser supports it, then an
   * explicit note-off for every key the app struck and has not already
   * released, All Notes Off (CC123) and sustain off (CC64 = 0), all on
   * channel 1, the only channel the app uses. (A key whose note-off has
   * already taken effect gets none: on a piano that echoes, that extra
   * note-off would come back with nothing to pair with and be taken for the
   * player letting go of the same key.)
   *
   * Where clear() is missing (Chrome, Edge) messages already queued for the
   * future still go out afterwards. Each queued note-on is then followed by
   * its own note-off, and All Notes Off is sent once more just after the last
   * queued message, so the device is silent once the queue has drained. (The
   * engine keeps that queue short and starts new playback after it.)
   */
  allNotesOff(): void {
    const out = this.outputPort();
    if (out) {
      const now = this.now();
      const canClear = typeof out.clear === 'function';
      if (canClear) out.clear?.();
      for (const midi of [...this.appNotes].sort((a, b) => a - b)) {
        // Released already, with nothing still queued that clear() withdrew.
        const last = this.lastSent.get(midi);
        if (last && last.type === 'noteoff' && last.at <= now) continue;
        this.remember(midi, 'noteoff');
        this.send(out, [NOTE_OFF_CH1, midi, 0]);
      }
      this.sentCc = this.sentCc.filter((r) => r.at + SENT_RECORD_TTL_MS >= now);
      this.sentCc.push({ cc: CC_ALL_NOTES_OFF, value: 0, at: now }, { cc: CC_SUSTAIN, value: 0, at: now });
      this.send(out, [CC_CH1, CC_ALL_NOTES_OFF, 0]);
      this.send(out, [CC_CH1, CC_SUSTAIN, 0]);
      if (!canClear) {
        // Without clear(), note-ons already queued for the future will still
        // sound after this; follow each with its own note-off so none stick.
        for (const [midi, at] of this.scheduledOns) {
          if (at <= now) continue;
          this.remember(midi, 'noteoff', at + 1);
          this.send(out, [NOTE_OFF_CH1, midi, 0], at + 1);
        }
        if (this.queuedUntil > now) this.send(out, [CC_CH1, CC_ALL_NOTES_OFF, 0], this.queuedUntil + 1);
      }
    }
    this.appNotes.clear();
    this.lastSent.clear();
    this.scheduledOns.clear();
    this.queuedUntil = -Infinity;
  }

  /** Detaches every listener and releases app-sent notes. The manager is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.allNotesOff();
    this.bindInput(null);
    if (this.access) this.access.onstatechange = null;
    this.disposed = true;
    this.eventListeners.clear();
    this.changeListeners.clear();
  }

  private async requestAccess(request: NonNullable<MidiEnv['requestMIDIAccess']>): Promise<MidiState> {
    try {
      const access = await request({ sysex: false });
      if (this.disposed) return this.currentState;
      this.access = access;
      access.onstatechange = () => this.handleStateChange();
      this.reconcile(true);
      this.setState('ready', null);
    } catch (err) {
      if (this.disposed) return this.currentState;
      const name = errorName(err);
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        this.setState('denied', MIDI_MESSAGES.denied);
      } else {
        this.setState('error', MIDI_MESSAGES.error);
      }
    }
    return this.currentState;
  }

  private setState(state: MidiState, message: string | null): void {
    this.currentState = state;
    this.message = message;
    this.emitChange();
  }

  private emitChange(): void {
    for (const fn of [...this.changeListeners]) fn();
  }

  private handleStateChange(): void {
    if (this.disposed || !this.access) return;
    this.reconcile(false);
    this.emitChange();
  }

  /**
   * Re-finds the selected devices after any device change: a returning input
   * is re-attached by id, or by name when the browser gave it a new id. When
   * the selected input is not connected, one may be picked instead (see
   * autoPick). Once the selected input has been connected, it is kept and
   * waited for when it goes missing.
   */
  private reconcile(firstConnect = false): void {
    const access = this.access;
    if (!access) return;
    const connected = portList(access.inputs).filter(isConnected);
    if (firstConnect) this.presentAtConnect = new Set(connected.map((p) => p.id));

    // The remembered piano turned up after all: it replaces its stand-in.
    const back = this.displaced ? findPort(access.inputs, this.displaced) : null;
    if (back && this.displaced) {
      this.inputSel = { id: back.id, name: back.name || this.displaced.name };
      this.displaced = null;
    }

    let input = findPort(access.inputs, this.inputSel);
    if (!input && !this.inputDeclined) {
      input = this.autoPick(connected);
      if (input && this.inputSel.id !== null) this.displaced = { ...this.inputSel };
    }
    if (input) this.inputSel = { id: input.id, name: input.name || this.inputSel.name };
    this.bindInput(input);

    // An output id the browser still knows keeps its own name: a remembered
    // name (selectOutput) only stands in for a port the browser has forgotten.
    const knownOutput = this.outputSel.id === null ? undefined : access.outputs.get(this.outputSel.id);
    if (knownOutput?.name) this.outputSel = { ...this.outputSel, name: knownOutput.name };
    const output = findPort(access.outputs, this.outputSel);
    if (output) this.outputSel = { id: output.id, name: output.name || this.outputSel.name };
  }

  /**
   * The input to attach while the selected one is not connected. A loopback
   * port ("Midi Through") is never picked, and never keeps a device that
   * turned up after Connect from being picked.
   * - Nothing selected: the only connected input, or the only one besides
   *   loopback ports once it has turned up after Connect (the piano switched
   *   on). Several devices wait for a choice.
   * - An input remembered from an earlier visit that has not been connected
   *   this session: the only input that has turned up since Connect (the
   *   piano switched on, perhaps under another id and name). A device that
   *   was already there at Connect never stands in for it: the piano is then
   *   reported as not found, and attached when it turns up.
   * - A selected input that has been connected: none; it is waited for.
   */
  private autoPick(connected: readonly MIDIInput[]): MIDIInput | null {
    const pickable = connected.filter((p) => !isLoopbackPort(p.name));
    const fresh = pickable.filter((p) => !this.presentAtConnect.has(p.id));
    if (this.inputSel.id === null) {
      if (pickable.length !== 1) return null;
      return connected.length === 1 || fresh.length === 1 ? pickable[0] : null;
    }
    if (!this.inputSeenFlag) return fresh.length === 1 ? fresh[0] : null;
    return null;
  }

  private bindInput(port: MIDIInput | null): void {
    if (port) this.inputSeenFlag = true;
    if (this.attached === port) return;
    if (this.attached) this.attached.onmidimessage = null;
    this.attached = port;
    this.echoOns.clear();
    this.ccEchoAt = -Infinity;
    if (port) port.onmidimessage = (ev: MIDIMessageEvent) => this.handleMessage(port, ev);
  }

  private handleMessage(port: MIDIInput, ev: MIDIMessageEvent): void {
    if (this.disposed || port !== this.attached) return;
    const time = typeof ev.timeStamp === 'number' && ev.timeStamp > 0 ? ev.timeStamp : this.now();
    const data = ev.data;
    if (data && data.length >= 3 && (data[0] & 0xf0) === CC_CH1 && data[1] === CC_ALL_NOTES_OFF) {
      // Never delivered (not a key or the pedal); an echo of the app's own
      // All Notes Off marks the sustain off right behind it as an echo too.
      if (this.takeCcEcho(CC_ALL_NOTES_OFF, data[2], time)) this.ccEchoAt = time;
      return;
    }
    const decoded = decodeMidiMessage(data, time);
    if (!decoded) return;
    // The app's sustain off, echoed right after its All Notes Off: not the
    // player's foot. A piano that does not echo sends no All Notes Off, so a
    // real pedal release just after Pause or a loop restart still gets through.
    if (
      decoded.type === 'sustain' &&
      time - this.ccEchoAt <= ECHO_WINDOW_MS &&
      this.takeCcEcho(CC_SUSTAIN, decoded.value, time)
    ) {
      return;
    }
    if (decoded.type === 'noteon' && this.isEcho(decoded.midi, 'noteon', time)) {
      this.echoOns.set(decoded.midi, (this.echoOns.get(decoded.midi) ?? 0) + 1);
      return;
    }
    if (decoded.type === 'noteoff') {
      // A note-off is only an echo when it pairs with a swallowed echoed
      // note-on. The player's own release (its note-on was delivered) always
      // gets through, even right after the app released the same key.
      const pending = this.echoOns.get(decoded.midi) ?? 0;
      if (pending > 0) {
        if (pending === 1) this.echoOns.delete(decoded.midi);
        else this.echoOns.set(decoded.midi, pending - 1);
        if (this.isEcho(decoded.midi, 'noteoff', time)) return;
      }
    }
    for (const fn of [...this.eventListeners]) fn(decoded);
  }

  /** Consumes the record of a release-burst controller message this input event echoes, if any. */
  private takeCcEcho(cc: number, value: number, time: number): boolean {
    const i = this.sentCc.findIndex((r) => {
      const dt = time - r.at;
      return r.cc === cc && r.value === value && dt >= 0 && dt <= ECHO_WINDOW_MS;
    });
    if (i < 0) return false;
    this.sentCc.splice(i, 1);
    return true;
  }

  /** The device (or its MIDI thru) played back a note the app just sent. */
  private isEcho(midi: number, type: NoteKind, time: number): boolean {
    return this.sent.some((r) => {
      const dt = time - r.at;
      return r.midi === midi && r.type === type && dt >= 0 && dt <= ECHO_WINDOW_MS;
    });
  }

  /**
   * Records a sent note for the echo guard at the time it actually goes out:
   * a timestamp already in the past (a message sent late, after a busy main
   * thread) is sent at once, so its echo comes back relative to now.
   */
  private remember(midi: number, type: NoteKind, atMs?: number): void {
    const now = this.now();
    this.sent = this.sent.filter((r) => r.at + SENT_RECORD_TTL_MS >= now);
    this.sent.push({ midi, type, at: atMs === undefined ? now : Math.max(atMs, now) });
  }

  private outputPort(): OutputWithClear | null {
    if (this.disposed || !this.access) return null;
    return findPort(this.access.outputs, this.outputSel);
  }

  private send(out: MIDIOutput, data: number[], atMs?: number): void {
    try {
      if (atMs === undefined) out.send(data);
      else out.send(data, atMs);
    } catch {
      // A port that vanished between the lookup and the send; the statechange
      // handler will update the device list.
    }
  }

  private listWithSelection<P extends MIDIPort>(
    map: PortMap<P> | undefined,
    sel: Selection,
  ): MidiDeviceInfo[] {
    if (!map) return [];
    const list = portList(map).map(info);
    if (sel.id !== null && !list.some((d) => d.id === sel.id)) {
      list.push({ id: sel.id, name: sel.name || 'Unnamed MIDI device', manufacturer: '', connected: false });
    }
    return list;
  }
}
