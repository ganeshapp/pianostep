/**
 * Safe XML decoding and parsing shared by the MusicXML and MXL importers.
 *
 * Uses the global DOMParser only (browser, jsdom, or @xmldom/xmldom installed
 * on globalThis by Node scripts). Never resolves DTDs or entities: documents
 * declaring entities are rejected and any DOCTYPE is removed before parsing.
 */

export type ImportErrorCode =
  | 'not-musicxml'
  | 'malformed-xml'
  | 'bad-archive'
  | 'too-large'
  | 'no-score-in-archive'
  | 'unsafe-content'
  | 'empty-score'
  | 'unsupported';

const DEFAULT_MESSAGES: Record<ImportErrorCode, string> = {
  'not-musicxml': 'This file is not a MusicXML score. Choose a .musicxml, .xml or .mxl score file.',
  'malformed-xml': 'The score file is damaged or incomplete, so it cannot be read.',
  'bad-archive': 'The compressed score (.mxl) is damaged or incomplete, so it cannot be opened.',
  'too-large': 'The file is too large to open safely.',
  'no-score-in-archive': 'The compressed file does not contain a MusicXML score.',
  'unsafe-content': 'This file contains hidden extra definitions that are blocked for safety, so it cannot be opened.',
  'empty-score': 'The score does not contain any music.',
  unsupported: 'This file uses a feature the app cannot read.',
};

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** Technical detail for logs and diagnostics; `message` is the user-facing text. */
  readonly detail?: string;

  constructor(code: ImportErrorCode, message?: string, detail?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'ImportError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/* ------------------------------------------------------------------------ */
/* Decoding                                                                  */
/* ------------------------------------------------------------------------ */

function decodeWith(label: string, bytes: Uint8Array): string {
  return new TextDecoder(label, { ignoreBOM: true }).decode(bytes);
}

function decodeUtf16be(bytes: Uint8Array): string {
  const even = bytes.length - (bytes.length % 2);
  const swapped = new Uint8Array(even);
  for (let i = 0; i < even; i += 2) {
    swapped[i] = bytes[i + 1];
    swapped[i + 1] = bytes[i];
  }
  return decodeWith('utf-16le', swapped);
}

/** Encoding named in `<?xml ... encoding="..."?>`, read as ASCII from the first bytes. */
function declaredEncoding(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 256)));
  const m = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head);
  return m ? m[1] : null;
}

/**
 * Decodes XML file bytes: BOM first (UTF-8, UTF-16LE, UTF-16BE), then a
 * BOM-less UTF-16 guess from a NUL beside the first '<', then a declared
 * single-byte encoding (e.g. ISO-8859-1), else UTF-8. The BOM is not returned.
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (bytes.length >= 3 && b0 === 0xef && b1 === 0xbb && bytes[2] === 0xbf) {
    return decodeWith('utf-8', bytes.subarray(3));
  }
  if (bytes.length >= 2 && b0 === 0xff && b1 === 0xfe) return decodeWith('utf-16le', bytes.subarray(2));
  if (bytes.length >= 2 && b0 === 0xfe && b1 === 0xff) return decodeUtf16be(bytes.subarray(2));
  if (bytes.length >= 2 && b0 === 0x3c && b1 === 0x00) return decodeWith('utf-16le', bytes);
  if (bytes.length >= 2 && b0 === 0x00 && b1 === 0x3c) return decodeUtf16be(bytes);

  const declared = declaredEncoding(bytes);
  if (declared && !/^utf-?(8|16)/i.test(declared)) {
    try {
      return decodeWith(declared, bytes);
    } catch {
      // Unknown label: fall through to UTF-8.
    }
  }
  return decodeWith('utf-8', bytes);
}

/** True when the first non-whitespace character is '<' (cheap content sniff). */
export function looksLikeXml(text: string): boolean {
  const m = /^[\s\uFEFF]*</.exec(text.slice(0, 1024));
  return m !== null;
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                   */
/* ------------------------------------------------------------------------ */

/** Throws `unsafe-content` when the text declares XML entities. */
export function rejectUnsafeXml(text: string): void {
  if (/<!ENTITY/i.test(text)) throw new ImportError('unsafe-content');
}

/** Index just past the `>` that closes a DOCTYPE whose body starts at `from`. */
function doctypeEnd(text: string, from: number): number {
  let quote = 0;
  let depth = 0;
  for (let j = from; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) {
      quote = c;
    } else if (c === 0x5b) {
      depth++;
    } else if (c === 0x5d) {
      depth--;
    } else if (c === 0x3e && depth <= 0) {
      return j + 1;
    }
  }
  return -1;
}

/**
 * Removes a `<!DOCTYPE ...>` (including any internal subset) from the prolog,
 * so no external DTD is ever fetched or applied. Only the prolog is scanned.
 */
export function stripDoctype(text: string): string {
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xfeff) {
      i++;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) return text;
      i = end + 2;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) return text;
      i = end + 3;
    } else if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      const end = doctypeEnd(text, i + 9);
      if (end < 0) throw new ImportError('malformed-xml', undefined, 'unterminated DOCTYPE');
      return text.slice(0, i) + text.slice(end);
    } else {
      return text;
    }
  }
  return text;
}

/** Characters XML 1.0 forbids anywhere: C0 controls other than tab, LF and CR, plus U+FFFE and U+FFFF. */
const ILLEGAL_XML_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
/** An `&` that does not begin a character or entity reference. */
const BARE_AMPERSAND = /&(?!#[0-9]+;|#x[0-9A-Fa-f]+;|[^\s&;<>"'#]+;)/;
/**
 * Comments, CDATA sections and processing instructions, where a bare `&` is
 * legal. An unterminated one runs to the end of the text: that keeps the scan
 * linear (otherwise every unclosed "<!--" rescans the rest of the file), and
 * the XML parser rejects the unterminated section anyway.
 */
const LITERAL_SECTIONS = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)/g;

/**
 * Well-formedness errors that browsers reject but @xmldom/xmldom accepts
 * silently. Checking them up front keeps the Node catalog build and the
 * browser in agreement about which files open.
 */
function lexicalProblem(text: string): string | null {
  const bad = ILLEGAL_XML_CHAR.exec(text);
  if (bad) return `character U+${bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} is not allowed in XML`;
  if (BARE_AMPERSAND.test(text) && BARE_AMPERSAND.test(text.replace(LITERAL_SECTIONS, ''))) {
    return 'unescaped "&" outside a reference';
  }
  return null;
}

type ErrorLevel = 'warning' | 'error' | 'fatalError';
interface XmlParserOptions {
  /** Honoured by @xmldom/xmldom; ignored by browser and jsdom parsers. */
  onError?: (level: ErrorLevel, message: unknown) => void;
}
type XmlParserCtor = new (options?: XmlParserOptions) => DOMParser;

function getDomParser(): XmlParserCtor {
  const ctor = (globalThis as { DOMParser?: unknown }).DOMParser;
  if (typeof ctor !== 'function') {
    throw new ImportError('unsupported', 'This browser cannot open score files.', 'globalThis.DOMParser is missing');
  }
  return ctor as XmlParserCtor;
}

/**
 * Parses XML text into a Document without resolving any external resource.
 * Rejects entity declarations (`unsafe-content`) and reports every parser
 * failure — a `<parsererror>` element (browsers, jsdom) or a thrown/reported
 * error or warning (xmldom) — as `malformed-xml`.
 */
export function parseXmlSafely(xmlText: string): Document {
  rejectUnsafeXml(xmlText);
  // Whitespace before the XML declaration is technically malformed but harmless; accept it.
  const text = stripDoctype(xmlText.replace(/^[\uFEFF \t\r\n]+/, ''));
  const lexical = lexicalProblem(text);
  if (lexical) throw new ImportError('malformed-xml', undefined, lexical);
  const Parser = getDomParser();
  const problems: string[] = [];
  // xmldom's only XML-mode warning that is not a well-formedness error flags a
  // U+FFFD in the source, and it is always reported first.
  let replacementWarning = text.includes('\uFFFD');
  let doc: Document;
  try {
    const parser = new Parser({
      onError: (level, message) => {
        if (level === 'warning' && replacementWarning) {
          replacementWarning = false;
          return;
        }
        problems.push(String(message));
      },
    });
    doc = parser.parseFromString(text, 'application/xml');
  } catch (e) {
    throw new ImportError('malformed-xml', undefined, e instanceof Error ? e.message : String(e));
  }
  if (problems.length > 0) throw new ImportError('malformed-xml', undefined, problems[0]);
  const root = doc?.documentElement;
  if (!root) throw new ImportError('malformed-xml', undefined, 'no root element');
  const errors = doc.getElementsByTagName('parsererror');
  if ((root.localName || root.nodeName) === 'parsererror' || errors.length > 0) {
    const first = errors.item(0) ?? root;
    throw new ImportError('malformed-xml', undefined, (first.textContent ?? '').trim().slice(0, 300));
  }
  return doc;
}
