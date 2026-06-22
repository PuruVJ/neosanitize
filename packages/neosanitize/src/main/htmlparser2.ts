/**
 * Optional parse adapter backed by htmlparser2 (fast and lenient, the parser
 * sanitize-html uses). htmlparser2 is an optional peer dependency, imported only
 * when you import this module.
 *
 * Not a full WHATWG tree builder: no foster-parenting, no adoption agency, no
 * foreign-content namespacing. Every element is treated as HTML. Fine for
 * sanitization, but for browser fidelity use the default parser and for strict
 * conformance use neosanitize/parse5.
 */
import { parseDocument } from 'htmlparser2';
import type { ParseAdapter, ParentNode, ElementNode, TreeNode } from './core';

interface H2Node {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: H2Node[];
}

export const htmlparser2Adapter: ParseAdapter = (html) => {
  const doc = parseDocument(html) as unknown as H2Node;
  const root: ParentNode = { type: 'document', children: [] };
  for (const child of doc.children ?? []) {
    const n = to_node(child);
    if (n) root.children.push(n);
  }
  return root;
};

function to_node(h: H2Node): TreeNode | null {
  switch (h.type) {
    case 'text':
      return { type: 'text', value: h.data ?? '', parent: null };
    case 'comment':
      return { type: 'comment', value: h.data ?? '', parent: null };
    case 'tag':
    case 'script':
    case 'style':
      return to_element(h);
    default:
      return null; // directives, doctype, cdata: dropped by the serializer anyway
  }
}

function to_element(h: H2Node): ElementNode {
  const attrs: Array<[string, string]> = [];
  const a = h.attribs ?? {};
  for (const k of Object.keys(a)) attrs.push([k, a[k]]);
  const children: TreeNode[] = [];
  for (const c of h.children ?? []) {
    const n = to_node(c);
    if (n) children.push(n);
  }
  return { type: 'element', name: h.name ?? '', namespace: 'html', attrs, children, parent: null };
}
