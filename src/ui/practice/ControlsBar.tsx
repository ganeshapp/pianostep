import { useId, useRef } from 'react';
import type { HandSelection, MeasureOccurrence, PracticeMode, PracticeSettings } from '../../core/types';
import { useFocusHandoff } from '../common/focusHandoff';
import { isKeyboardClick, keepFocusOffFromLabel, keepFocusOnMouse, releaseAfterDrag, usePointerRelease } from '../common/pointerFocus';
import { ConnectPiano } from './ConnectPiano';
import type { MidiConnection } from './midiConnection';
import { MoreMenu } from './MoreMenu';
import { Segmented, type SegmentOption } from './Segmented';
import { settleOnPointerUp, useSettledSlider } from './settledSlider';
import { defaultSpeedNote, FOLLOW_NEEDS_PIANO, speedValueText } from './text';
import {
  formatSpeed,
  formatStepSeconds,
  passageEndingAt,
  passageStartingAt,
  SPEED_SLIDER,
  STEP_SECONDS_SLIDER,
} from './settings';

/** The session method the settings call. */
export interface SessionControls {
  updateSettings(patch: Partial<PracticeSettings>): void;
}

export interface ControlsBarProps {
  session: SessionControls;
  settings: PracticeSettings;
  canFollow: boolean;
  measures: readonly MeasureOccurrence[];
  midi: MidiConnection;
  onOutputChange: (id: string | null) => void;
  onOpenAbout: () => void;
  /**
   * The speed (quarter notes per minute) the app chose because the file gives
   * none, or null when the speed comes from the file. Listen's 1× is then
   * labelled as the app's default, never as the written speed.
   */
  defaultTempoQpm?: number | null;
}

const HANDS: readonly SegmentOption<HandSelection>[] = [
  { value: 'both', label: 'Both hands' },
  { value: 'R', label: 'Right hand' },
  { value: 'L', label: 'Left hand' },
];

function Switch({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const pointer = usePointerRelease();
  return (
    <label className={`ps-switch${disabled ? ' is-disabled' : ''}`} title={hint} {...pointer.zone}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => pointer.release(e.currentTarget)}
      />
      <span className="ps-switch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/**
 * The practice settings: mode, hands, speed or step length, passage, Repeat,
 * Sound, Count-in, Connect piano and More. Playback (the transport) is in
 * the transport bar under the notes.
 */
export function ControlsBar({
  session,
  settings,
  canFollow,
  measures,
  midi,
  onOutputChange,
  onOpenAbout,
  defaultTempoQpm = null,
}: ControlsBarProps) {
  const id = useId();
  const fromPointer = usePointerRelease();
  const toPointer = usePointerRelease();
  const follow = settings.mode === 'follow';
  const occCount = measures.length;
  const last = Math.max(0, occCount - 1);
  const range = settings.range;
  const fromOcc = range ? range.startOcc : 0;
  const toOcc = range ? range.endOcc : last;

  const modes: SegmentOption<PracticeMode>[] = [
    { value: 'listen', label: 'Listen' },
    { value: 'steady', label: 'Steady steps' },
    {
      value: 'follow',
      label: 'Follow me',
      disabled: !canFollow,
      hint: canFollow ? undefined : FOLLOW_NEEDS_PIANO,
    },
  ];

  const update = (patch: Partial<PracticeSettings>): void => session.updateSettings(patch);
  // A timing change re-anchors playback, so a drag commits once it rests or ends, not on every input event.
  const speed = useSettledSlider(settings.speed, (v) => session.updateSettings({ speed: v }));
  const stepSeconds = useSettledSlider(settings.stepSeconds, (v) => session.updateSettings({ stepSeconds: v }));
  const speedRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
  const wholeRef = useRef<HTMLButtonElement>(null);
  // "Whole piece" is disabled once chosen: keyboard focus goes to the From list.
  useFocusHandoff(wholeRef, range === null, () => fromRef.current);
  const midiReady = midi.phase === 'connected' || midi.phase === 'choose' || midi.phase === 'disconnected' || midi.phase === 'no-devices';

  return (
    <div className="ps-controls">
      <div className="ps-controls__row">
        <Segmented label="Mode" hideLabel value={settings.mode} options={modes} onChange={(mode) => update({ mode })} />
        <Segmented label="Hands" hideLabel value={settings.hands} options={HANDS} onChange={(hands) => update({ hands })} />

        <div className="ps-controls__end">
          <ConnectPiano conn={midi} />
          <MoreMenu
            monitorInput={settings.monitorInput}
            onMonitorChange={(monitorInput) => update({ monitorInput })}
            midiReady={midiReady}
            outputs={midi.outputs}
            outputId={settings.midiOutputId}
            onOutputChange={onOutputChange}
            onOpenAbout={onOpenAbout}
          />
        </div>
      </div>

      <div className="ps-controls__row ps-controls__row--secondary">
        {settings.mode === 'listen' && (
          <div className="ps-slider">
            <label htmlFor={`${id}-speed`} className="ps-field-label" onClick={keepFocusOffFromLabel}>
              Speed
            </label>
            <input
              ref={speedRef}
              id={`${id}-speed`}
              type="range"
              min={SPEED_SLIDER.min}
              max={SPEED_SLIDER.max}
              step={SPEED_SLIDER.step}
              value={speed.value}
              aria-valuetext={speedValueText(speed.value, defaultTempoQpm)}
              aria-describedby={defaultTempoQpm !== null ? `${id}-speed-note` : undefined}
              onPointerDown={(e) => {
                releaseAfterDrag(e);
                settleOnPointerUp(speed);
              }}
              onBlur={speed.settle}
              onChange={(e) => speed.change(Number(e.target.value))}
            />
            <output htmlFor={`${id}-speed`} className="ps-slider__value">
              {formatSpeed(speed.value)}
            </output>
            {speed.value !== 1 && (
              <button
                type="button"
                className="ps-link-btn"
                onMouseDown={keepFocusOnMouse}
                onClick={(e) => {
                  speed.set(1);
                  // The button goes away at 1×: keyboard focus moves to the slider, not the page body.
                  if (isKeyboardClick(e)) speedRef.current?.focus();
                }}
              >
                Reset
              </button>
            )}
            {defaultTempoQpm !== null && (
              <span id={`${id}-speed-note`} className="ps-slider__note">
                {defaultSpeedNote(defaultTempoQpm)}
              </span>
            )}
          </div>
        )}
        {settings.mode === 'steady' && (
          <div className="ps-slider">
            <label htmlFor={`${id}-step`} className="ps-field-label" onClick={keepFocusOffFromLabel}>
              Seconds per step
            </label>
            <input
              id={`${id}-step`}
              type="range"
              min={STEP_SECONDS_SLIDER.min}
              max={STEP_SECONDS_SLIDER.max}
              step={STEP_SECONDS_SLIDER.step}
              value={stepSeconds.value}
              aria-valuetext={`${stepSeconds.value.toFixed(1)} seconds per step`}
              onPointerDown={(e) => {
                releaseAfterDrag(e);
                settleOnPointerUp(stepSeconds);
              }}
              onBlur={stepSeconds.settle}
              onChange={(e) => stepSeconds.change(Number(e.target.value))}
            />
            <output htmlFor={`${id}-step`} className="ps-slider__value">
              {formatStepSeconds(stepSeconds.value)}
            </output>
          </div>
        )}

        <div className="ps-passage" role="group" aria-label="Passage" aria-describedby={`${id}-passage-hint`}>
          <div className="ps-passage__line">
            <label htmlFor={`${id}-from`} className="ps-passage__word" onClick={keepFocusOffFromLabel}>
              From measure
            </label>
            <select
              ref={fromRef}
              id={`${id}-from`}
              className="ps-select ps-select--measure"
              aria-label="From measure"
              value={fromOcc}
              disabled={occCount === 0}
              {...fromPointer.zone}
              onChange={(e) => {
                update({ range: passageStartingAt(range, Number(e.target.value), occCount) });
                fromPointer.release(e.currentTarget);
              }}
            >
              {measures.map((m) => (
                <option key={m.occ} value={m.occ}>
                  {m.label}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-to`} className="ps-passage__word" onClick={keepFocusOffFromLabel}>
              to
            </label>
            <select
              id={`${id}-to`}
              className="ps-select ps-select--measure"
              aria-label="To measure"
              value={toOcc}
              disabled={occCount === 0}
              {...toPointer.zone}
              onChange={(e) => {
                update({ range: passageEndingAt(range, Number(e.target.value), occCount) });
                toPointer.release(e.currentTarget);
              }}
            >
              {measures.map((m) => (
                <option key={m.occ} value={m.occ}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              ref={wholeRef}
              type="button"
              className="ps-btn ps-btn--small"
              disabled={range === null}
              onMouseDown={keepFocusOnMouse}
              onClick={() => update({ range: null })}
            >
              Whole piece
            </button>
            <Switch label="Repeat" checked={settings.loop} onChange={(loop) => update({ loop })} />
          </div>
          <p id={`${id}-passage-hint`} className="ps-passage__hint">
            A measure is a numbered section of the piece.
          </p>
        </div>

        <div className="ps-toggles">
          <Switch label="Sound" checked={settings.sound} onChange={(sound) => update({ sound })} />
          <Switch
            label="Count-in"
            checked={settings.countIn}
            disabled={follow}
            hint={follow ? 'Follow me waits for you, so it needs no count-in' : 'Four clicks before playback starts'}
            onChange={(countIn) => update({ countIn })}
          />
        </div>
      </div>
    </div>
  );
}
