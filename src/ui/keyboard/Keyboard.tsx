import { useId, useMemo, useRef, type ReactNode } from 'react';
import { MIDDLE_C, midiToLabel } from '../../core/pitch';
import type { Hand } from '../../core/types';
import { usePointerRelease } from '../common/pointerFocus';
import { describeHighlights, keyHighlights, type HandKeys, type KeyHighlight } from './highlight';
import { computeKeyboardRange, framingKey, keyLayout, whiteKeyCount, type KeyRect } from './layout';
import { useElementWidth } from './useElementWidth';
import './keyboard.css';

const WHITE_HEIGHT = 180;
const BLACK_RATIO = 0.62;
/** Very wide white keys look odd; small ranges are centred instead. */
const MAX_WHITE_WIDTH = 64;
const CAPTION_HEIGHT = 18;
/** Half the "keep holding" outline's width (keyboard.css) plus a hair, so it sits inside the key. */
const HOLD_INSET = 2;

export interface KeyboardProps {
  /** Keys the frame must fit. The frame changes only when this list's contents change. */
  frameKeys: readonly number[];
  /** Keys that get their address printed on them (the passage's used keys). */
  labelKeys: readonly number[];
  /** Keys held after the marker step, per hand. */
  expected: HandKeys;
  /** Keys struck at the marker step, per hand. */
  struck: HandKeys;
  /** Keys physically held on the connected piano (never app playback). */
  physicalDown: readonly number[];
  /** Follow me: keys held that the step does not expect. */
  wrong: readonly number[];
  pedalDown: boolean;
  /** Hands in the current selection (for the legend). */
  hands: readonly Hand[];
  /** A piano is connected, so the "your key" dot is meaningful. */
  showPhysical: boolean;
  /** Follow me is active, so wrong-key marks are meaningful. */
  showWrong: boolean;
  fitWholePiece: boolean;
  onFitChange: (wholePiece: boolean) => void;
}

function bottomRoundedPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return [
    `M${x} ${y}`,
    `H${x + w}`,
    `V${y + h - rr}`,
    `Q${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `Q${x} ${y + h} ${x} ${y + h - rr}`,
    'Z',
  ].join(' ');
}

type Tone = 'strong' | 'soft';

const RH = 'var(--rh, #7c3aed)';
const RH_SOFT = 'var(--rh-soft, #c4b5fd)';
const LH = 'var(--lh, #15803d)';
const LH_SOFT = 'var(--lh-soft, #4ade80)';

function colourOf(hand: Hand, tone: Tone): string {
  if (hand === 'R') return tone === 'strong' ? RH : RH_SOFT;
  return tone === 'strong' ? LH : LH_SOFT;
}

function fillFor(h: KeyHighlight | undefined, splitIds: Record<string, string>): string | undefined {
  if (!h) return undefined;
  if (h.R && h.L) return `url(#${splitIds[`${h.R}-${h.L}`]})`;
  if (h.R) return colourOf('R', h.R);
  if (h.L) return colourOf('L', h.L);
  return undefined;
}

/**
 * "Keep holding" keys get an outline in the full hand colour on top of their
 * light fill, so a long hold stays easy to see on white and black keys after
 * its instruction has scrolled away. A key split between both hands takes the
 * outline in both full colours, each on its own half.
 */
function holdStrokeFor(h: KeyHighlight | undefined, splitIds: Record<string, string>): string | undefined {
  if (!h || (h.R !== 'soft' && h.L !== 'soft')) return undefined;
  if (h.R && h.L) return `url(#${splitIds['strong-strong']})`;
  return h.R ? RH : LH;
}

/** Text drawn on a strongly filled key is white; on light fills it stays dark. */
function isStrongOnly(h: KeyHighlight | undefined): boolean {
  if (!h) return false;
  const tones = [h.R, h.L].filter((t): t is Tone => t !== null);
  return tones.length > 0 && tones.every((t) => t === 'strong');
}

interface KeyShapeProps {
  rect: KeyRect;
  label: string | null;
  highlight: KeyHighlight | undefined;
  physical: boolean;
  wrong: boolean;
  splitIds: Record<string, string>;
}

function KeyShape({ rect, label, highlight, physical, wrong, splitIds }: KeyShapeProps) {
  const { x, width, height, black } = rect;
  const w = width;
  const cx = x + w / 2;
  const fill = fillFor(highlight, splitIds);
  const holdStroke = holdStrokeFor(highlight, splitIds);
  const lit = fill !== undefined;
  const strong = isStrongOnly(highlight);
  const letters = highlight ? [highlight.R && 'R', highlight.L && 'L'].filter(Boolean).join(' ') : '';

  const textClass = black
    ? lit && !strong
      ? 'kb-text kb-text--dark'
      : 'kb-text kb-text--light'
    : strong
      ? 'kb-text kb-text--light'
      : 'kb-text kb-text--dark';
  const haloed = lit && !strong ? ' kb-text--halo' : '';

  let labelNode: ReactNode = null;
  let labelTop = height;
  if (label) {
    if (black) {
      const twoLines = w < 26;
      const size = twoLines ? Math.max(7, Math.min(11, w * 0.6)) : Math.min(12, w * 0.42);
      if (twoLines) {
        const note = label.replace(/-?\d+$/, '');
        const octave = label.slice(note.length);
        labelNode = (
          <text className={`${textClass}${haloed}`} x={cx} y={height - 8} fontSize={size} textAnchor="middle">
            <tspan x={cx} dy={-size}>
              {note}
            </tspan>
            <tspan x={cx} dy={size}>
              {octave}
            </tspan>
          </text>
        );
        labelTop = height - 8 - size * 2;
      } else {
        labelNode = (
          <text className={`${textClass}${haloed}`} x={cx} y={height - 9} fontSize={size} textAnchor="middle">
            {label}
          </text>
        );
        labelTop = height - 9 - size;
      }
    } else {
      const size = Math.max(10, Math.min(14, w * 0.34));
      labelNode = (
        <text className={`${textClass}${haloed}`} x={cx} y={height - 10} fontSize={size} textAnchor="middle">
          {label}
        </text>
      );
      labelTop = height - 10 - size;
    }
  }

  const dotY = labelTop - 12;
  const letterY = dotY - 12;
  const dotR = Math.max(3.5, Math.min(6, w * 0.16));
  const letterSize = Math.max(9, Math.min(12, w * 0.3));

  return (
    <g className={`kb-key ${black ? 'kb-key--black' : 'kb-key--white'}${lit ? ' is-lit' : ''}`} data-midi={rect.midi}>
      <path
        className={black ? 'kb-shape kb-shape--black' : 'kb-shape kb-shape--white'}
        d={bottomRoundedPath(x, 0, w, height, black ? 3 : 5)}
        style={fill ? { fill } : undefined}
      />
      {holdStroke && (
        <path
          className="kb-hold-outline"
          d={bottomRoundedPath(x + HOLD_INSET, HOLD_INSET, w - 2 * HOLD_INSET, height - 2 * HOLD_INSET, black ? 2 : 4)}
          style={{ stroke: holdStroke }}
        />
      )}
      {wrong && (
        <path
          className="kb-wrong-outline"
          d={bottomRoundedPath(x + 2, 2, w - 4, height - 4, black ? 2 : 4)}
        />
      )}
      {labelNode}
      {physical && <circle className="kb-physical" cx={cx} cy={dotY} r={dotR} />}
      {letters && (
        <text
          className={`${textClass} kb-hand-letter${haloed}`}
          x={cx}
          y={letterY}
          fontSize={letterSize}
          textAnchor="middle"
        >
          {letters}
        </text>
      )}
      {wrong && (
        <g className="kb-wrong-badge" transform={`translate(${cx} ${letterY - 16})`}>
          <circle r={8} />
          <path d="M-3.2 -3.2 L3.2 3.2 M3.2 -3.2 L-3.2 3.2" />
        </g>
      )}
    </g>
  );
}

function LegendSwatch({ className }: { className: string }) {
  return <span className={`kb-swatch ${className}`} aria-hidden="true" />;
}

/**
 * Large labelled keyboard. Purple and green show the expected hand state of
 * the marker step; physical input and wrong keys are drawn as separate marks
 * so they are never confused with the score.
 */
export function Keyboard({
  frameKeys,
  labelKeys,
  expected,
  struck,
  physicalDown,
  wrong,
  pedalDown,
  hands,
  showPhysical,
  showWrong,
  fitWholePiece,
  onFitChange,
}: KeyboardProps) {
  const uid = `kb${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(containerRef, 1100);
  const fitPointer = usePointerRelease();

  const frameSignature = framingKey(frameKeys);
  // Re-framed only when the framed keys change (passage, hands or fit mode),
  // never because of playback.
  const range = useMemo(() => computeKeyboardRange(frameKeys), [frameSignature]);

  const whiteCount = whiteKeyCount(range.low, range.high);
  const width = Math.max(200, Math.min(containerWidth, whiteCount * MAX_WHITE_WIDTH));
  const layout = useMemo(
    () => keyLayout(range, width, { whiteHeight: WHITE_HEIGHT, blackHeightRatio: BLACK_RATIO }),
    [range, width],
  );

  const highlights = keyHighlights(expected, struck);
  const labelled = new Set(labelKeys);
  const physical = new Set(showPhysical ? physicalDown : []);
  const wrongSet = new Set(showWrong ? wrong : []);

  const splitIds: Record<string, string> = {
    'strong-strong': `${uid}-ss`,
    'strong-soft': `${uid}-sl`,
    'soft-strong': `${uid}-ls`,
    'soft-soft': `${uid}-ll`,
  };
  const middleC = layout.byMidi.get(MIDDLE_C);
  const svgHeight = WHITE_HEIGHT + CAPTION_HEIGHT;
  const lowLabel = midiToLabel(range.low);
  const highLabel = midiToLabel(range.high);
  const summary = describeHighlights(highlights, midiToLabel);

  const renderKey = (rect: KeyRect) => (
    <KeyShape
      key={rect.midi}
      rect={rect}
      label={labelled.has(rect.midi) ? midiToLabel(rect.midi) : null}
      highlight={highlights.get(rect.midi)}
      physical={physical.has(rect.midi)}
      wrong={wrongSet.has(rect.midi)}
      splitIds={splitIds}
    />
  );

  const legend: ReactNode[] = [];
  if (hands.includes('R')) {
    legend.push(
      <span key="r" className="kb-legend__item">
        <LegendSwatch className="kb-swatch--rh" />
        Purple = right hand
      </span>,
    );
  }
  if (hands.includes('L')) {
    legend.push(
      <span key="l" className="kb-legend__item">
        <LegendSwatch className="kb-swatch--lh" />
        Green = left hand
      </span>,
    );
  }
  legend.push(
    <span key="strong" className="kb-legend__item">
      <LegendSwatch className={hands.includes('R') ? 'kb-swatch--rh' : 'kb-swatch--lh'} />
      Strong = press now
    </span>,
    <span key="soft" className="kb-legend__item">
      <LegendSwatch className={hands.includes('R') ? 'kb-swatch--rh-soft' : 'kb-swatch--lh-soft'} />
      Light = keep holding
    </span>,
  );
  if (showPhysical) {
    legend.push(
      <span key="phys" className="kb-legend__item">
        <span className="kb-legend__dot" aria-hidden="true">
          ●
        </span>
        <span className="kb-sr-only">Dark dot </span>= your key
      </span>,
    );
  }
  if (showWrong) {
    legend.push(
      <span key="wrong" className="kb-legend__item">
        <span className="kb-legend__wrong" aria-hidden="true">
          ✕
        </span>
        <span className="kb-sr-only">Amber cross </span>= not expected
      </span>,
    );
  }

  const outOfRangeText = range.outOfRange.map(midiToLabel).join(', ');

  const fitToggle = (
    // A mouse choice does not leave focus on the radio, so Space and the arrows keep meaning play/pause and step.
    <div className="kb-fit" role="radiogroup" aria-label="Fit the keyboard to" {...fitPointer.zone}>
      <span className="kb-fit__label" aria-hidden="true">
        Fit:
      </span>
      <label className="kb-fit__option">
        <input
          type="radio"
          name={`${uid}-fit`}
          checked={!fitWholePiece}
          onChange={() => onFitChange(false)}
          onClick={(e) => fitPointer.release(e.currentTarget)}
        />
        <span>Passage</span>
      </label>
      <label className="kb-fit__option">
        <input
          type="radio"
          name={`${uid}-fit`}
          checked={fitWholePiece}
          onChange={() => onFitChange(true)}
          onClick={(e) => fitPointer.release(e.currentTarget)}
        />
        <span>Whole piece</span>
      </label>
    </div>
  );

  return (
    <section className="kb" aria-label="Piano keyboard">
      {range.hasOutOfRange && (
        <p className="kb-notice" role="note">
          {range.outOfRange.length === 1
            ? `One note (${outOfRangeText}) is beyond the 88 keys of a piano, so it can't be shown here.`
            : `Some notes (${outOfRangeText}) are beyond the 88 keys of a piano, so they can't be shown here.`}
        </p>
      )}

      <div ref={containerRef} className="kb__stage">
        <svg
          className="kb__svg"
          width={layout.width}
          height={svgHeight}
          viewBox={`0 0 ${layout.width} ${svgHeight}`}
          role="img"
          // Named with aria-label, not an SVG <title>: browsers show a <title> as
          // a hover tooltip over the keys, and this summary changes every step.
          aria-label={`Keyboard from ${lowLabel} to ${highLabel}. ${summary}.`}
        >
          <defs>
            {(['strong', 'soft'] as const).flatMap((r) =>
              (['strong', 'soft'] as const).map((l) => (
                <linearGradient
                  key={`${r}-${l}`}
                  id={splitIds[`${r}-${l}`]}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                  gradientUnits="objectBoundingBox"
                >
                  {/* Hard stops split the key along its diagonal: right hand upper left, left hand lower right. */}
                  <stop offset="0.5" style={{ stopColor: colourOf('R', r) }} />
                  <stop offset="0.5" style={{ stopColor: colourOf('L', l) }} />
                </linearGradient>
              )),
            )}
          </defs>
          <g className="kb-whites">{layout.whites.map(renderKey)}</g>
          <rect className="kb-felt" x={0} y={0} width={layout.width} height={5} />
          <g className="kb-blacks">{layout.blacks.map(renderKey)}</g>
          {middleC && (
            <g className="kb-middle-c" aria-hidden="true">
              <path d={`M${middleC.x + middleC.width / 2 - 5} ${WHITE_HEIGHT + 7} l4.5 -5 l4.5 5 z`} />
              <text x={middleC.x + middleC.width / 2} y={WHITE_HEIGHT + 17} textAnchor="middle">
                Middle C
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="kb__footer">
        {fitToggle}
        <p className="kb-legend">
          {legend.map((item, i) => (
            <span key={i} className="kb-legend__part">
              {i > 0 && (
                <span className="kb-legend__sep" aria-hidden="true">
                  ·
                </span>
              )}
              {item}
            </span>
          ))}
        </p>
        <div className="kb__pedal-slot">
          <span className={`kb-pedal${pedalDown ? '' : ' is-up'}`} aria-hidden={!pedalDown}>
            Pedal ▾ down
          </span>
        </div>
      </div>
    </section>
  );
}
