/**
 * neosanitize, browser entry (resolved via the package's `browser` export
 * condition; also reachable explicitly as `neosanitize/browser`).
 *
 * Parses untrusted HTML with the PLATFORM parser (native `DOMParser`) instead of
 * the bundled WHATWG parser, then runs the EXACT same engine-core policy over the
 * resulting tree. Two wins:
 *   1. The browser bundle ships ZERO parser bytes, the tokenizer + tree-builder
 *      (the bulk of the engine) are never imported here, only the policy core.
 *   2. Parsing is, by construction, byte-for-byte what the user's own browser
 *      would do, which closes parser-differential / mutation-XSS gaps for free.
 *
 * Same `Sanitizer` class API as the default entry; the only difference is the
 * parse step (and that this build requires a DOM).
 */
export * from './core';

import { SanitizerCore, type ParseAdapter, type SanitizerOptions, type Policy } from './core';
import type { ElementNode, ParentNode, TreeNode, NS } from './core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * The browser default parse adapter, native `DOMParser`. Ships zero parser bytes
 * (the platform already has one) and parses byte-for-byte what the user's browser
 * would. Used automatically by the browser `Sanitizer`; also exported so you can
 * pass it to any `Sanitizer` via `.parser(domParserAdapter)` where a DOM exists.
 */
export const domParserAdapter: ParseAdapter = (html) => {
  if (typeof DOMParser === 'undefined') {
    throw new Error('neosanitize/browser: no DOM available (DOMParser is undefined). In Node, import the default "neosanitize" entry, which bundles the parser.');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root: ParentNode = { type: 'document', children: [] };
  if (doc.documentElement) root.children.push(domToNode(doc.documentElement));
  return root;
};

/**
 * Browser `Sanitizer`, defaults to native `DOMParser`. Build one with
 * `Sanitizer.builder()`. Override the parser with `.parser(adapter)`, e.g.
 * `whatwgAdapter` to force the bundled parser, or `parse5Adapter`.
 */
export class Sanitizer extends SanitizerCore {
  constructor(policy?: Policy, opts: SanitizerOptions = {}) {
    super(policy, domParserAdapter, opts);
  }
}

/**
 * Convert a native DOM element subtree into the engine-core node shape, the same
 * plain `{type,name,attrs,children}` tree the custom parser produces, so the
 * policy + serializer are reused verbatim (zero security-logic fork per env).
 */
function domToNode(el: Element): ElementNode {
  let ns: NS = 'html';
  /* v8 ignore start -- happy-dom (the test DOM) leaves <math> in the HTML namespace, so the MathML branch can't be exercised here; real browsers do namespace it */
  if (el.namespaceURI === SVG_NS) ns = 'svg';
  else if (el.namespaceURI === MATHML_NS) ns = 'mathml';
  /* v8 ignore stop */
  const attrs: Array<[string, string]> = [];
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    let name = a[i].name;
    // foreign namespaced attrs (xlink:href, xml:lang) -> space-form, matching the
    // custom parser's storage so URL_ATTRS / allow-list checks line up.
    if (ns !== 'html' && name.indexOf(':') !== -1) name = name.replace(':', ' ');
    attrs.push([name, a[i].value]);
  }
  // <template> content lives in a separate fragment, not in childNodes.
  const kids: NodeListOf<ChildNode> =
    ns === 'html' && el.localName === 'template' && (el as HTMLTemplateElement).content
      ? (el as HTMLTemplateElement).content.childNodes
      : el.childNodes;
  const children: TreeNode[] = [];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    const t = c.nodeType;
    if (t === 1) children.push(domToNode(c as Element));
    else if (t === 3) children.push({ type: 'text', value: (c as CharacterData).data, parent: null });
    // comments (8) and others are dropped, the serializer drops them anyway.
    // (CDATA sections / nodeType 4 never occur via parseFromString(html,'text/html').)
  }
  return { type: 'element', name: el.localName, namespace: ns, attrs, children, parent: null };
}
