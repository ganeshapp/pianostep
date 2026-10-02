import type { ReactNode } from 'react';
import { tickToSeconds } from '../../core/model/tempo';
import type { LoadedPiece } from '../../catalog/loader';
import { Dialog } from '../common/Dialog';
import { DifficultyDetails, safeExternalUrl } from '../common/DifficultyBadge';
import { groupWarnings, lengthDescription, measureList, SEVERITY_TITLE, tempoDescription } from './diagnostics';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

export interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  piece: LoadedPiece;
}

/** "About this arrangement": where the file came from and what the app noticed in it. Never needed to practise. */
export function DiagnosticsDialog({ open, onClose, piece }: DiagnosticsDialogProps) {
  const { prepared, entry, importMeta } = piece;
  const source = prepared.source;
  const fileName = entry ? (entry.file.split('/').pop() ?? entry.file) : (importMeta?.fileName ?? null);
  const rights = entry?.rightsInFile ?? source.rights;
  const upstream = safeExternalUrl(entry?.upstreamUrl);
  const original = safeExternalUrl(entry?.originalSourceUrl);
  // A checked hand setting is reported both as the hand description and as a
  // warning; the Hands section already shows it, so it is not repeated below.
  const groups = groupWarnings(prepared.warnings.filter((w) => w.message !== prepared.handMapping.description));
  const versionNotes = entry?.notes ?? [];
  const lengthSec = tickToSeconds(prepared.tempo, prepared.endTick);
  const writtenMeasures = source.measures.length;
  const playedMeasures = prepared.measures.length;

  return (
    <Dialog open={open} onClose={onClose} title="About this arrangement" size="large" className="ps-diag">
      <p className="muted">
        Details about the score file. You don’t need any of this to practise.
      </p>

      <section className="ps-diag__section" aria-labelledby="ps-diag-piece">
        <h3 id="ps-diag-piece">The piece</h3>
        <dl className="ps-diag__list">
          <Row term="Title">{prepared.meta.title || piece.title}</Row>
          {piece.arrangement && <Row term="Version">{piece.arrangement}</Row>}
          <Row term="Composer">{prepared.meta.composer ?? piece.composer ?? 'Not given in the file'}</Row>
          {prepared.meta.arranger && <Row term="Arranger">{prepared.meta.arranger}</Row>}
          {fileName && <Row term="Score file">{fileName}</Row>}
          <Row term="Rights">{rights?.trim() ? rights : 'The file has no rights statement.'}</Row>
          {entry?.attribution && <Row term="Credit">{entry.attribution}</Row>}
          {entry?.licenseNote && <Row term="Note">{entry.licenseNote}</Row>}
        </dl>
      </section>

      {versionNotes.length > 0 && (
        <section className="ps-diag__section" aria-labelledby="ps-diag-version">
          <h3 id="ps-diag-version">About this version</h3>
          <ul className="ps-diag__notes">
            {versionNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="ps-diag__section" aria-labelledby="ps-diag-difficulty">
        <h3 id="ps-diag-difficulty">Difficulty</h3>
        {entry ? (
          <div className="ps-diag__difficulty">
            <DifficultyDetails info={entry.difficulty} />
          </div>
        ) : (
          <p>Imported pieces are not rated.</p>
        )}
      </section>

      <section className="ps-diag__section" aria-labelledby="ps-diag-hands">
        <h3 id="ps-diag-hands">Hands</h3>
        <p>{prepared.handMapping.description}</p>
      </section>

      <section className="ps-diag__section" aria-labelledby="ps-diag-structure">
        <h3 id="ps-diag-structure">Length and speed</h3>
        <dl className="ps-diag__list">
          <Row term="Measures">
            {writtenMeasures === playedMeasures
              ? `${writtenMeasures}`
              : `${writtenMeasures} written, ${playedMeasures} when repeats are played`}
          </Row>
          <Row term="Speed">{tempoDescription(prepared)}</Row>
          <Row term="Length">{lengthDescription(prepared, lengthSec)}</Row>
        </dl>
      </section>

      <section className="ps-diag__section" aria-labelledby="ps-diag-notes">
        <h3 id="ps-diag-notes">What the app noticed</h3>
        {groups.length === 0 ? (
          <p>Nothing unusual was found in this score.</p>
        ) : (
          groups.map(([severity, list]) => (
            <div key={severity} className={`ps-diag__group ps-diag__group--${severity}`}>
              <h4>{SEVERITY_TITLE[severity]}</h4>
              <ul>
                {list.map((w) => {
                  const where = measureList(w);
                  return (
                    <li key={w.code}>
                      {w.message}
                      {where && <span className="ps-diag__measures">{where}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {(piece.fileUrl || upstream || original) && (
        <section className="ps-diag__section" aria-labelledby="ps-diag-links">
          <h3 id="ps-diag-links">Original file</h3>
          <ul className="ps-diag__links">
            {piece.fileUrl && (
              <li>
                <a href={piece.fileUrl} download={fileName ?? true}>
                  Download the score file{fileName ? ` (${fileName})` : ''}
                </a>
              </li>
            )}
            {upstream && (
              <li>
                <ExternalLink href={upstream}>See it in the online library</ExternalLink>
              </li>
            )}
            {original && (
              <li>
                <ExternalLink href={original}>Where the arrangement was first published</ExternalLink>
              </li>
            )}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
