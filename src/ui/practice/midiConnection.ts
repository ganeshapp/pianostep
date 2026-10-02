import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { isLoopbackPort } from '../../midi/manager';
import type { MidiDeviceInfo, MidiState } from '../../midi/manager';

/** The parts of the app's MidiManager the practice page uses. */
export interface MidiControl {
  readonly state: MidiState;
  readonly errorMessage: string | null;
  readonly selectedInputId: string | null;
  readonly selectedOutputId: string | null;
  readonly inputConnected: boolean;
  /**
   * False while the selected input has not been connected at all this session
   * (an id remembered from an earlier visit, with the piano switched off): that
   * piano was not found rather than disconnected. Absent means unknown, and is
   * treated as seen.
   */
  readonly inputSeen?: boolean;
  connect(): Promise<MidiState>;
  inputs(): MidiDeviceInfo[];
  outputs(): MidiDeviceInfo[];
  /**
   * `rememberedName` is the name the piano had when its id was remembered, so
   * the manager can find it again if it comes back under another id.
   */
  selectInput(id: string | null, rememberedName?: string | null): void;
  onChange(fn: () => void): () => void;
}

export type MidiPhase =
  | 'idle'
  | 'requesting'
  | 'unsupported'
  | 'denied'
  | 'error'
  | 'no-devices'
  | 'choose'
  | 'connected'
  | 'disconnected';

/**
 * Connected inputs that could be a piano: a software loopback port ("Midi
 * Through Port-0", always present on Linux) never carries a piano's keys.
 */
export function livePianoInputs<T extends { connected: boolean; name?: string }>(inputs: readonly T[]): T[] {
  return inputs.filter((i) => i.connected && !isLoopbackPort(i.name));
}

export function midiPhase(
  m: Pick<MidiControl, 'state' | 'selectedInputId' | 'inputConnected' | 'inputSeen'> & {
    inputs(): readonly { connected: boolean; name?: string }[];
  },
): MidiPhase {
  switch (m.state) {
    case 'unsupported':
    case 'idle':
    case 'requesting':
    case 'denied':
    case 'error':
      return m.state;
    case 'ready':
      if (m.inputConnected) return 'connected';
      // A remembered piano that has not turned up yet was not found: the
      // learner is told so (or asked to choose), not that it was disconnected.
      // The selection is kept, so the piano is attached when it is switched on.
      if (m.selectedInputId !== null && m.inputSeen !== false) return 'disconnected';
      // Only loopback ports: no piano was found.
      return livePianoInputs(m.inputs()).length > 0 ? 'choose' : 'no-devices';
  }
}

export const MIDI_TEXT = {
  unsupported:
    "This browser can't connect to a MIDI piano. Listen, Steady steps and manual stepping still work.",
  denied: 'MIDI access was blocked. Allow MIDI for this site in the browser settings, then try again.',
  error: "The browser couldn't open MIDI devices. Check the piano's cable and power, then try again.",
  noDevices:
    'No piano found. Check that it is switched on and connected to this computer (usually by USB), then try again.',
  stillNoDevices: 'Still no piano found. Check the cable and that the piano is switched on, then try again.',
  disconnected: 'Your piano was disconnected. Reconnect it and it will be picked up again.',
  disconnectedOthers: 'Your piano was disconnected. Reconnect it, or choose your piano from the list.',
  choose: 'More than one MIDI device was found. Choose your piano from the list.',
  /** The piano used last time is off, and other devices are connected. */
  chooseSavedMissing:
    "The piano you used last time wasn't found. Switch it on and it will be picked up, or choose your piano from the list.",
} as const;

/**
 * The input to switch to when the chosen one is missing: a connected input
 * with the remembered name, else the only other connected input that could be
 * the piano. Inputs in `exclude` cannot be: they were already connected while
 * the chosen piano was (the learner saw them in the list and did not pick
 * them). A loopback port ("Midi Through Port-0") never can be. Null when
 * there is no such input; the selection is then kept so the piano is
 * re-attached when it returns, and the learner can still choose from the list.
 */
export function fallbackInput(
  inputs: readonly Pick<MidiDeviceInfo, 'id' | 'name' | 'connected'>[],
  selectedId: string | null,
  savedName: string | null,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  const others = inputs.filter((i) => i.connected && i.id !== selectedId);
  const byName = savedName ? others.find((i) => i.name === savedName) : undefined;
  if (byName) return byName.id;
  const live = others.filter((i) => !exclude.has(i.id) && !isLoopbackPort(i.name));
  return live.length === 1 ? live[0].id : null;
}

export interface MidiConnection {
  phase: MidiPhase;
  /** Connected inputs plus the selected one once it has been seen, so a vanished piano stays visible. */
  inputs: MidiDeviceInfo[];
  outputs: MidiDeviceInfo[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  /** Notice to show under the controls, or null. */
  notice: { text: string; canRetry: boolean } | null;
  connect: () => void;
  selectInput: (id: string) => void;
  dismissNotice: () => void;
  /**
   * A control the learner activated from the keyboard (Connect piano, Try
   * again, Dismiss) that may go away as a result. While set, ConnectPiano
   * moves focus to the piano control if focus is lost. Null otherwise.
   */
  focusFrom: HTMLElement | null;
  /** Remember the keyboard-activated control (see focusFrom). */
  keepFocusFrom: (el: HTMLElement) => void;
  /** Focus was restored, or the learner moved on: stop watching. */
  focusSettled: () => void;
}

export interface MidiConnectionOptions {
  /** Input id saved with this piece's settings, tried before connecting. */
  savedInputId: string | null;
  /** Input name remembered across pieces, matched after connecting. */
  savedInputName: string | null;
  /** Called whenever an input ends up connected, so it can be remembered. */
  onConnected: (id: string, name: string) => void;
}

/** The Connect piano flow: connect from a click, then pick, remember and watch the input. */
export function useMidiConnection(midi: MidiControl, opts: MidiConnectionOptions): MidiConnection {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => midi.onChange(refresh), [midi]);

  const [attempts, setAttempts] = useState(0);
  /** The phase whose notice was dismissed; a new problem shows its notice again. */
  const [dismissedPhase, setDismissedPhase] = useState<MidiPhase | null>(null);
  const [focusFrom, setFocusFrom] = useState<HTMLElement | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  /** Inputs seen connected while the chosen piano was connected too: never picked by "Try again". */
  const knownOthers = useRef(new Set<string>());

  const phase = midiPhase(midi);
  const allInputs = midi.inputs();
  // A remembered piano that has not turned up this session is not listed (it
  // would show as an unnamed, disconnected device): the list then asks for a choice.
  const inputs = allInputs.filter((i) => i.connected || (i.id === midi.selectedInputId && midi.inputSeen !== false));
  const connectedName = midi.inputConnected
    ? (allInputs.find((i) => i.id === midi.selectedInputId)?.name ?? null)
    : null;
  const selectedInputId = midi.selectedInputId;
  if (midi.inputConnected) {
    for (const i of allInputs) if (i.connected && i.id !== selectedInputId) knownOthers.current.add(i.id);
  }

  useEffect(() => {
    if (dismissedPhase !== null && dismissedPhase !== phase) setDismissedPhase(null);
  }, [phase, dismissedPhase]);

  useEffect(() => {
    if (selectedInputId && connectedName) optsRef.current.onConnected(selectedInputId, connectedName);
  }, [selectedInputId, connectedName]);

  const connect = useCallback(() => {
    setAttempts((n) => n + 1);
    setDismissedPhase(null);
    const { savedInputId, savedInputName } = optsRef.current;
    if (midi.selectedInputId === null && savedInputId) midi.selectInput(savedInputId, savedInputName);
    // Requested synchronously so the browser sees it as part of the click.
    // Once access is granted this resolves at once; a piano that is missing
    // (unplugged, or back under a new id and name) is then re-picked from the
    // inputs connected now. Devices that were already there alongside the
    // piano are never picked: the selection then stays, so the piano is
    // re-attached when it returns. While the selected piano has not turned up
    // at all this session (remembered from an earlier visit, or none chosen
    // yet), every device connected now was there before it: only one with the
    // remembered name may stand in, and the manager attaches the piano when
    // it is switched on.
    void midi.connect().then((state) => {
      if (state !== 'ready' || midi.inputConnected) return;
      const inputs = midi.inputs();
      const exclude = new Set(knownOthers.current);
      if (midi.inputSeen === false) for (const i of inputs) if (i.connected) exclude.add(i.id);
      const pick = fallbackInput(inputs, midi.selectedInputId, savedInputName, exclude);
      if (pick) midi.selectInput(pick);
    });
    refresh();
  }, [midi]);

  const focusSettled = useCallback(() => setFocusFrom(null), []);

  const selectInput = useCallback(
    (id: string) => {
      midi.selectInput(id);
      refresh();
    },
    [midi],
  );

  let notice: MidiConnection['notice'] = null;
  if (dismissedPhase !== phase) {
    switch (phase) {
      case 'unsupported':
        if (attempts > 0) notice = { text: MIDI_TEXT.unsupported, canRetry: false };
        break;
      case 'denied':
        notice = { text: midi.errorMessage ?? MIDI_TEXT.denied, canRetry: true };
        break;
      case 'error':
        notice = { text: midi.errorMessage ?? MIDI_TEXT.error, canRetry: true };
        break;
      case 'no-devices':
        notice = { text: attempts > 1 ? MIDI_TEXT.stillNoDevices : MIDI_TEXT.noDevices, canRetry: true };
        break;
      case 'disconnected':
        notice = {
          text: inputs.some((i) => i.connected) ? MIDI_TEXT.disconnectedOthers : MIDI_TEXT.disconnected,
          canRetry: true,
        };
        break;
      case 'choose':
        notice = {
          // A remembered piano that is off: say so, rather than (perhaps
          // wrongly, with one device) that several devices were found.
          text: midi.selectedInputId !== null && midi.inputSeen === false ? MIDI_TEXT.chooseSavedMissing : MIDI_TEXT.choose,
          canRetry: false,
        };
        break;
      default:
        break;
    }
  }

  return {
    phase,
    inputs,
    outputs: midi.outputs().filter((o) => o.connected || o.id === midi.selectedOutputId),
    selectedInputId,
    selectedOutputId: midi.selectedOutputId,
    notice,
    connect,
    selectInput,
    dismissNotice: () => setDismissedPhase(phase),
    focusFrom,
    keepFocusFrom: setFocusFrom,
    focusSettled,
  };
}
