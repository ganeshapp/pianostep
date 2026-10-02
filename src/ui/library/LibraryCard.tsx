import { useId } from 'react';
import type { CatalogEntry } from '../../core/types';
import type { ImportedPieceMeta } from '../../storage/imports';
import { DifficultyBadge, DifficultyInfoButton } from '../common/DifficultyBadge';
import { ReadinessChip } from '../common/ReadinessChip';
import { pieceHref } from '../router';
import { formatAddedDate, formatDuration, keyRangeText, measuresText, spokenDuration } from './format';

const DEFAULT_SPEED_TITLE = 'No speed is written in this file, so this length uses the app’s default speed.';

function CardStats({
  measures,
  durationSec,
  lowest,
  highest,
  tempoDefaulted = false,
}: {
  measures: number;
  durationSec: number;
  lowest: string | null | undefined;
  highest: string | null | undefined;
  /** The file gives no tempo, so the length is at the app's default speed (brief §8: label it). */
  tempoDefaulted?: boolean;
}) {
  const range = keyRangeText(lowest, highest);
  return (
    <p className="card-stats">
      <span>{measuresText(measures)}</span>
      {durationSec > 0 && (
        <>
          <span className="card-stats-sep" aria-hidden="true">
            ·
          </span>
          <span title={tempoDefaulted ? DEFAULT_SPEED_TITLE : undefined}>
            <span className="visually-hidden">
              Length {spokenDuration(durationSec)}
              {tempoDefaulted && ' at the app’s default speed, as the file gives no speed'}
            </span>
            <span aria-hidden="true" className="mono">
              {formatDuration(durationSec)}
            </span>
            {tempoDefaulted && (
              <span aria-hidden="true" className="card-stats-qualifier">
                {' '}
                at default speed
              </span>
            )}
          </span>
        </>
      )}
      {range && (
        <>
          <span className="card-stats-sep" aria-hidden="true">
            ·
          </span>
          <span>
            <span className="visually-hidden">
              Keys {lowest === highest ? range : `from ${lowest} to ${highest}`}
            </span>
            <span aria-hidden="true" className="note-label">
              {range}
            </span>
          </span>
        </>
      )}
    </p>
  );
}

function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return list.length ? list.join(' ') : undefined;
}

export function BuiltinCard({ entry }: { entry: CatalogEntry }) {
  const uid = useId();
  const disabled = entry.readiness === 'unsupported';
  const arrangementId = `${uid}-arrangement`;
  const composerId = `${uid}-composer`;
  return (
    <li className={`card${disabled ? ' card-disabled' : ''}`}>
      <div className="card-head">
        <h3 className="card-title">
          {disabled ? (
            <span>{entry.title}</span>
          ) : (
            <a
              className="card-link"
              href={pieceHref(entry.id)}
              aria-describedby={describedBy(entry.arrangement && arrangementId, entry.composer && composerId)}
            >
              {entry.title}
            </a>
          )}
        </h3>
        {entry.arrangement && (
          <p className="card-arrangement" id={arrangementId}>
            {entry.arrangement}
          </p>
        )}
        {entry.composer && (
          <p className="card-composer" id={composerId}>
            {entry.composer}
          </p>
        )}
      </div>
      <div className="card-tags">
        <span className="card-difficulty">
          <DifficultyBadge info={entry.difficulty} />
          <DifficultyInfoButton info={entry.difficulty} pieceTitle={entry.title} />
        </span>
        <ReadinessChip readiness={entry.readiness} reasons={entry.readinessReasons} />
      </div>
      <CardStats
        measures={entry.stats.measures}
        durationSec={entry.stats.durationSec}
        lowest={entry.stats.lowest}
        highest={entry.stats.highest}
        tempoDefaulted={entry.stats.tempoDefaulted === true}
      />
    </li>
  );
}

/** Imported pieces carry no difficulty tag at all (the user decided imports need none). */
export function ImportCard({ meta, onDelete }: { meta: ImportedPieceMeta; onDelete: (meta: ImportedPieceMeta) => void }) {
  const uid = useId();
  const disabled = meta.readiness === 'unsupported';
  const composerId = `${uid}-composer`;
  const added = formatAddedDate(meta.addedAt);
  return (
    <li className={`card card-import${disabled ? ' card-disabled' : ''}`}>
      <div className="card-head">
        <h3 className="card-title">
          {disabled ? (
            <span>{meta.title}</span>
          ) : (
            <a className="card-link" href={pieceHref(meta.id)} aria-describedby={describedBy(meta.composer && composerId)}>
              {meta.title}
            </a>
          )}
        </h3>
        {meta.composer && (
          <p className="card-composer" id={composerId}>
            {meta.composer}
          </p>
        )}
        <p className="card-meta">
          From <span className="card-file">{meta.fileName}</span>
          {added && <> · added {added}</>}
        </p>
      </div>
      {meta.readiness !== 'ready' && (
        <div className="card-tags">
          <ReadinessChip readiness={meta.readiness} reasons={meta.readinessReasons} />
        </div>
      )}
      <CardStats
        measures={meta.measures}
        durationSec={meta.durationSec}
        lowest={meta.lowest}
        highest={meta.highest}
        tempoDefaulted={meta.tempoDefaulted === true}
      />
      <div className="card-actions">
        <button type="button" className="btn btn-small" onClick={() => onDelete(meta)} aria-label={`Delete ${meta.title}`}>
          Delete
        </button>
      </div>
    </li>
  );
}
