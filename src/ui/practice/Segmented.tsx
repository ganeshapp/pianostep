import { useId } from 'react';
import { usePointerRelease } from '../common/pointerFocus';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown as a tooltip and read as a description (e.g. why it is disabled). */
  hint?: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  /** Hide the visible group label (it is still announced). */
  hideLabel?: boolean;
}

/**
 * A radio group drawn as joined buttons; arrow keys move between options.
 * A mouse or touch choice does not leave focus on the radio, so Space and the
 * arrows keep meaning play/pause and step.
 */
export function Segmented<T extends string>({ label, value, options, onChange, hideLabel }: SegmentedProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;
  const pointer = usePointerRelease();
  return (
    <div className="ps-seg-group">
      <span id={labelId} className={hideLabel ? 'visually-hidden' : 'ps-field-label'}>
        {label}
      </span>
      <div className="ps-seg" role="radiogroup" aria-labelledby={labelId} {...pointer.zone}>
        {options.map((o) => {
          const hintId = o.hint ? `${id}-${o.value}-hint` : undefined;
          return (
            <label
              key={o.value}
              className={`ps-seg__option${o.disabled ? ' is-disabled' : ''}`}
              title={o.hint}
            >
              <input
                type="radio"
                name={id}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                aria-describedby={hintId}
                onChange={() => onChange(o.value)}
                onClick={(e) => pointer.release(e.currentTarget)}
              />
              <span className="ps-seg__text">{o.label}</span>
            </label>
          );
        })}
      </div>
      {options
        .filter((o) => o.hint)
        .map((o) => (
          <span key={o.value} id={`${id}-${o.value}-hint`} className="visually-hidden">
            {o.hint}
          </span>
        ))}
    </div>
  );
}
