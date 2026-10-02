import type { Readiness } from '../../core/types';
import { Popover } from './Popover';

/**
 * Nothing when ready; an amber "Needs review" chip or a grey "Can't be used"
 * chip otherwise. Either chip opens a small panel listing the reasons.
 */
export function ReadinessChip({ readiness, reasons }: { readiness: Readiness; reasons: readonly string[] }) {
  if (readiness === 'ready') return null;
  const review = readiness === 'review';
  const text = review ? 'Needs review' : 'Can’t be used';
  const intro = review
    ? 'Some parts may not play exactly as written:'
    : 'This piece can’t be used for practice:';
  const fallback = review
    ? 'Some details of this score could not be checked automatically.'
    : 'The app could not find anything to play in this score.';
  return (
    <Popover
      label={`${text}: show ${review ? 'reasons' : 'reason'}`}
      panelLabel={text}
      trigger={text}
      triggerClassName={`badge ${review ? 'badge-review' : 'badge-unusable'}`}
    >
      <p className="popover-title">{text}</p>
      <p>{intro}</p>
      <ul>
        {(reasons.length > 0 ? reasons : [fallback]).map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </Popover>
  );
}
