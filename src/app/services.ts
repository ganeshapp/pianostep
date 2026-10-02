import { PianoSampler } from '../audio/sampler';
import { MidiManager } from '../midi/manager';

/**
 * App-wide singletons shared by every page. Neither touches the browser's
 * audio or MIDI until first used from a user gesture (ensureStarted / connect).
 */
export const sampler: PianoSampler = new PianoSampler();
export const midi: MidiManager = new MidiManager();
