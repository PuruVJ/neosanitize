/**
 * Optional parse adapter backed by htmlparser2 (fast and lenient, the parser
 * sanitize-html uses). htmlparser2 is an optional peer dependency, imported only
 * when you import this module.
 *
 * Not a full WHATWG tree builder: no foster-parenting, no adoption agency, and
 * only approximate svg/math namespacing (see `child_ns`). Fine for
 * sanitization, but for browser fidelity use the default parser and for strict
 * conformance use neosanitize/parse5.
 */
import { parseDocument } from 'htmlparser2';
import type { ParseAdapter, ParentNode, ElementNode, TreeNode, NS } from './core';

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
  // Iterative (explicit stack): a recursive walk overflows the native stack on
  // deeply nested input. Children are pushed in reverse so they land in order.
  const stack: Frame[] = [];
  push_children(stack, doc.children, root.children, 'html');
  while (stack.length !== 0) {
    const { node: h, into, ns: parentNs } = stack.pop()!;
    switch (h.type) {
      case 'text':
        into.push({ type: 'text', value: h.data ?? '', parent: null });
        break;
      case 'comment':
        into.push({ type: 'comment', value: h.data ?? '', parent: null });
        break;
      case 'tag':
      case 'script':
      case 'style': {
        const name = h.name ?? '';
        const ns = name === 'svg' ? 'svg' : name === 'math' ? 'mathml' : parentNs;
        const attrs: Array<[string, string]> = [];
        const a = h.attribs ?? {};
        for (const k of Object.keys(a)) attrs.push([k, a[k]]);
        const children: TreeNode[] = [];
        into.push({ type: 'element', name, namespace: ns, attrs, children, parent: null } satisfies ElementNode);
        push_children(stack, h.children, children, child_ns(ns, name, a));
        break;
      }
      // directives, doctype, cdata: dropped by the serializer anyway
    }
  }
  return root;
};

interface Frame {
  node: H2Node;
  into: TreeNode[];
  ns: NS;
}

function push_children(stack: Frame[], kids: H2Node[] | undefined, into: TreeNode[], ns: NS): void {
  if (!kids) return;
  for (let k = kids.length - 1; k >= 0; k--) stack.push({ node: kids[k], into, ns });
}

/** Namespace for the children of a `name` element in `ns`. htmlparser2 parses
 * svg/math content but does not label it, so rebuild the labels here: back to HTML
 * at the SVG and MathML HTML integration points, foreign otherwise. Approximate
 * (no mglyph/malignmark nuance); the serializer does not rely on it for safety. */
function child_ns(ns: NS, name: string, attribs: Record<string, string>): NS {
  if (ns === 'svg') return name === 'foreignobject' || name === 'desc' || name === 'title' ? 'html' : 'svg';
  if (ns === 'mathml') {
    if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext') return 'html';
    if (name === 'annotation-xml') {
      const enc = (attribs.encoding ?? '').toLowerCase();
      if (enc === 'text/html' || enc === 'application/xhtml+xml') return 'html';
    }
    return 'mathml';
  }
  return 'html';
}
