/**
 * Minimal DOM helpers restricted to APIs that behave the same in browsers,
 * jsdom and @xmldom/xmldom: childNodes/item, nodeType, localName/nodeName,
 * getAttribute, hasAttribute, textContent.
 */

const ELEMENT_NODE = 1;

export function nameOf(node: Node): string {
  return (node as Element).localName || node.nodeName;
}

export function childElements(el: Element): Element[] {
  const out: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i);
    if (n && n.nodeType === ELEMENT_NODE) out.push(n as Element);
  }
  return out;
}

export function firstChild(el: Element, name: string): Element | null {
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i);
    if (n && n.nodeType === ELEMENT_NODE && nameOf(n) === name) return n as Element;
  }
  return null;
}

export function childrenNamed(el: Element, name: string): Element[] {
  return childElements(el).filter((c) => nameOf(c) === name);
}

/** Collapses runs of whitespace to single spaces and trims. */
export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function textOf(el: Element | null): string {
  return el ? (el.textContent ?? '') : '';
}

/** Trimmed text of the first child with this name, or null when absent/empty. */
export function childText(el: Element, name: string): string | null {
  const c = firstChild(el, name);
  if (!c) return null;
  const t = normalizeSpace(textOf(c));
  return t === '' ? null : t;
}

/** Numeric content of the first child with this name, or null when absent or not a number. */
export function childNumber(el: Element, name: string): number | null {
  return toNumber(childText(el, name));
}

export function toNumber(text: string | null): number | null {
  if (text === null || text.trim() === '') return null;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
}

export function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}
