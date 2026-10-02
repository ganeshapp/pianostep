import type { Difficulty, DifficultyInfo } from '../../core/types';
import { Popover } from './Popover';

const METER: Record<Difficulty, string> = {
  Beginner: '●○○',
  Intermediate: '●●○',
  Advanced: '●●●',
  Unrated: '',
};

const BASIS_LABEL: Record<DifficultyInfo['basis'], string> = {
  source: 'Published rating',
  'in-file': 'Stated in the score',
  estimated: 'Estimated',
  none: 'Not rated',
};

const BASIS_DESCRIPTION: Record<DifficultyInfo['basis'], string> = {
  source: 'Taken from a published rating of this exact arrangement.',
  'in-file': 'The arrangement’s own sheet music names this level.',
  estimated: 'Estimated by this app from the notes. It is not an official rating.',
  none: 'No published rating was found for this arrangement.',
};

export interface DifficultyText {
  /** "Beginner", "Intermediate", "Advanced" or "Unrated". */
  level: string;
  /** Small qualifier after the level ("per score", "estimated"), or null. */
  qualifier: string | null;
}

/** What the badge says. Unrated is always plain; in-file and estimated levels carry a qualifier. */
export function difficultyText(info: DifficultyInfo): DifficultyText {
  if (info.level === 'Unrated' || info.basis === 'none') return { level: 'Unrated', qualifier: null };
  if (info.basis === 'in-file') return { level: info.level, qualifier: 'per score' };
  if (info.basis === 'estimated') return { level: info.level, qualifier: 'estimated' };
  return { level: info.level, qualifier: null };
}

/** Badge text as one string, e.g. "Beginner · per score". */
export function difficultyLabel(info: DifficultyInfo): string {
  const t = difficultyText(info);
  return t.qualifier ? `${t.level} · ${t.qualifier}` : t.level;
}

export function DifficultyBadge({ info }: { info: DifficultyInfo }) {
  const t = difficultyText(info);
  const unrated = t.level === 'Unrated';
  const meter = unrated ? '' : METER[info.level];
  return (
    <span className={`badge difficulty${unrated ? ' difficulty-unrated' : ''}`}>
      <span className="visually-hidden">Difficulty: </span>
      {meter && (
        <span className="difficulty-meter" aria-hidden="true">
          {meter}
        </span>
      )}
      <span>{t.level}</span>
      {t.qualifier && <span className="difficulty-qualifier">· {t.qualifier}</span>}
    </span>
  );
}

/** Only http(s) links are ever rendered from catalog data. */
export function safeExternalUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** "2026-09-30" -> "30 September 2026"; unparseable text is returned unchanged. */
export function formatCheckedDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The details shown in the ⓘ popover: basis, original label, source link and date checked. */
export function DifficultyDetails({ info }: { info: DifficultyInfo }) {
  const url = safeExternalUrl(info.sourceUrl);
  const checked = formatCheckedDate(info.checkedOn);
  const sourceText = info.sourceName?.trim() || (url ? hostOf(url) : null);
  return (
    <>
      <p className="popover-title">Difficulty: {difficultyLabel(info)}</p>
      <dl>
        <dt>Based on</dt>
        <dd>{BASIS_LABEL[info.basis]}</dd>
        {info.originalLabel && (
          <>
            <dt>Original label</dt>
            <dd>“{info.originalLabel}”</dd>
          </>
        )}
        {sourceText && (
          <>
            <dt>Source</dt>
            <dd>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {sourceText}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                sourceText
              )}
            </dd>
          </>
        )}
        {checked && (
          <>
            <dt>Checked</dt>
            <dd>{checked}</dd>
          </>
        )}
      </dl>
      <p>{BASIS_DESCRIPTION[info.basis]}</p>
      {info.note && <p>{info.note}</p>}
      <p className="muted">Levels are a rough guide for choosing pieces.</p>
    </>
  );
}

/** The discreet ⓘ button next to a difficulty badge. */
export function DifficultyInfoButton({ info, pieceTitle }: { info: DifficultyInfo; pieceTitle?: string }) {
  const label = pieceTitle ? `About the difficulty of ${pieceTitle}` : 'About this difficulty rating';
  return (
    <Popover label={label} panelLabel="Difficulty details" trigger={<span aria-hidden="true">ⓘ</span>}>
      <DifficultyDetails info={info} />
    </Popover>
  );
}
