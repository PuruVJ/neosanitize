/**
 * Optional parse adapter backed by parse5 (the reference WHATWG parser).
 * parse5 is an optional peer dependency, imported only when you import this module.
 *
 *   import { Sanitizer } from 'neosanitize';
 *   import { parse5Adapter } from 'neosanitize/parse5';
 *   const s = Sanitizer.builder(ugc).parser(parse5Adapter).build();
 */
import { parse } from 'parse5';
import type { ParseAdapter, ParentNode, ElementNode, TreeNode, NS } from './core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
  namespaceURI?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string }>;
  childNodes?: P5Node[];
  content?: { childNodes: P5Node[] };
}

export const parse5Adapter: ParseAdapter = (html) => {
  const doc = parse(html) as unknown as P5Node;
  const root: ParentNode = { type: 'document', children: [] };
  for (const child of doc.childNodes ?? []) root.children.push(to_node(child));
  return root;
};

function ns_of(uri: string | undefined): NS {
  if (uri === SVG_NS) return 'svg';
  if (uri === MATHML_NS) return 'mathml';
  return 'html';
}

function to_node(p: P5Node): TreeNode {
  switch (p.nodeName) {
    case '#text':
      return { type: 'text', value: p.value ?? '', parent: null };
    case '#comment':
      return { type: 'comment', value: p.data ?? '', parent: null };
    case '#documentType':
      return { type: 'doctype', name: p.name ?? '', publicId: p.publicId ?? '', systemId: p.systemId ?? '', parent: null };
    default:
      return to_element(p);
  }
}

function to_element(p: P5Node): ElementNode {
  const ns = ns_of(p.namespaceURI);
  const attrs: Array<[string, string]> = [];
  // foreign namespaced attrs (xlink:href, xml:lang) use the "prefix localname"
  // space form so URL and allow-list checks match the bundled parser.
  for (const a of p.attrs ?? []) attrs.push([a.prefix ? a.prefix + ' ' + a.name : a.name, a.value]);
  const kids = (ns === 'html' && p.tagName === 'template' && p.content ? p.content.childNodes : p.childNodes) ?? [];
  const children: TreeNode[] = [];
  for (const c of kids) children.push(to_node(c));
  return { type: 'element', name: p.tagName ?? p.nodeName, namespace: ns, attrs, children, parent: null };
}
