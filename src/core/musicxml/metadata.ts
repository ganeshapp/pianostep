import { attr, childElements, childText, firstChild, nameOf, normalizeSpace, textOf } from './dom';

/** Score-level descriptive text. Everything is plain text, never markup. */
export interface ScoreMetadata {
  title: string | null;
  subtitle: string | null;
  composer: string | null;
  arranger: string | null;
  rights: string | null;
  software: string | null;
  credits: string[];
}

interface Credit {
  types: string[];
  text: string;
  words: string[];
}

function readCredits(root: Element): Credit[] {
  const credits: Credit[] = [];
  for (const credit of childElements(root)) {
    if (nameOf(credit) !== 'credit') continue;
    const types: string[] = [];
    const words: string[] = [];
    let raw = '';
    for (const c of childElements(credit)) {
      const name = nameOf(c);
      if (name === 'credit-type') types.push(normalizeSpace(textOf(c)).toLowerCase());
      else if (name === 'credit-words') {
        const t = textOf(c);
        raw += t;
        const n = normalizeSpace(t);
        if (n) words.push(n);
      }
    }
    credits.push({ types, text: normalizeSpace(raw), words });
  }
  return credits;
}

function creditOfType(credits: Credit[], type: string): string | null {
  const found = credits.filter((c) => c.types.includes(type) && c.text !== '').map((c) => c.text);
  return found.length ? found.join(' ') : null;
}

export function readMetadata(root: Element): ScoreMetadata {
  const credits = readCredits(root);
  const work = firstChild(root, 'work');
  const workTitle = work ? childText(work, 'work-title') : null;
  const movementTitle = childText(root, 'movement-title');

  let composer: string | null = null;
  let arranger: string | null = null;
  let software: string | null = null;
  const rights: string[] = [];
  const identification = firstChild(root, 'identification');
  if (identification) {
    for (const c of childElements(identification)) {
      const name = nameOf(c);
      const text = normalizeSpace(textOf(c));
      if (name === 'creator' && text) {
        const type = (attr(c, 'type') ?? '').toLowerCase();
        if (type === 'composer' && composer === null) composer = text;
        else if (type === 'arranger' && arranger === null) arranger = text;
      } else if (name === 'rights' && text) {
        rights.push(text);
      } else if (name === 'encoding' && software === null) {
        software = childText(c, 'software');
      }
    }
  }

  const title = workTitle ?? movementTitle ?? creditOfType(credits, 'title');
  let subtitle = creditOfType(credits, 'subtitle');
  if (subtitle === null && workTitle !== null && movementTitle !== null && movementTitle !== workTitle) {
    subtitle = movementTitle;
  }

  return {
    title,
    subtitle,
    composer: composer ?? creditOfType(credits, 'composer'),
    arranger: arranger ?? creditOfType(credits, 'arranger'),
    rights: rights.length ? rights.join('\n') : creditOfType(credits, 'rights'),
    software,
    credits: credits.flatMap((c) => c.words),
  };
}
