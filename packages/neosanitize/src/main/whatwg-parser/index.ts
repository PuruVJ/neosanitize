/**
 * `neosanitize/whatwg-parser`: the browser-faithful WHATWG parse tree, exposed.
 *
 * Same tokenizer and tree construction the main sanitizer runs on (100% html5lib
 * tokenizer conformance), without any policy or filtering. Read, query, and
 * re-serialize HTML the way a browser would build it. Zero deps, no DOM.
 *
 *   import { parse, findAll, textContent, serialize } from 'neosanitize/whatwg-parser';
 *
 * `parse()` builds a full document (implied `<html>/<head>/<body>`), like
 * `new DOMParser().parseFromString(html, 'text/html')`.
 */
import { TreeBuilder } from '../parser/tree-builder';
import { escapeAttr, escapeText } from '../escape';
import type { DocumentNode, ElementNode, ParentNode, TreeNode } from '../parser/tree-builder';

export type { DocumentNode, ElementNode, TextNode, CommentNode, DoctypeNode, TreeNode, ParentNode, NS } from '../parser/tree-builder';

/** Parse HTML into the full WHATWG document tree a browser would build. */
export function parse(html: string): DocumentNode {
	return new TreeBuilder(html).parse();
}

/**
 * The bundled WHATWG parser as a parse adapter. Import it from here (not from
 * `neosanitize`) when you need it in a browser bundle: the `.` browser export
 * resolves to the DOMParser build, which does not carry this adapter.
 *
 *   import { whatwgAdapter } from 'neosanitize/whatwg-parser';
 *   Sanitizer.builder(ugc).parser(whatwgAdapter).build();
 */
export const whatwgAdapter = parse;

// --- serialization (policy-free; faithful HTML output) ----------------------
const VOID_ELEMENTS = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img', 'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// No `noscript`: `parse()` runs with scripting off, so its content is ordinary
// markup (entities decoded) and must be escaped like any other text.
const RAW_TEXT = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

// Foreign attrs are stored as "xlink href" (space form) → re-emit as "xlink:href".
const attrName = (n: string) => (n.indexOf(' ') === -1 ? n : n.replace(' ', ':'));

/** Serialize a node (or a whole document) back to HTML, faithfully — no filtering.
 * Iterative (explicit stack) so deep trees can't overflow the native stack. The
 * stack holds nodes to emit or pre-built end tags. Raw text is emitted verbatim
 * only for HTML-namespace raw-text elements: the same tag name inside SVG/MathML
 * holds decoded text, which would re-parse as live markup. */
export function serialize(node: DocumentNode | TreeNode): string {
	const out: string[] = [];
	const stack: Array<TreeNode | string> = [];
	if (node.type === 'document') for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]);
	else stack.push(node);
	while (stack.length !== 0) {
		const item = stack.pop()!;
		if (typeof item === 'string') { out.push(item); continue; }
		switch (item.type) {
			case 'text': {
				const p = item.parent;
				const raw = p !== null && p.type === 'element' && p.namespace === 'html' && RAW_TEXT.has(p.name);
				out.push(raw ? item.value : escapeText(item.value));
				break;
			}
			case 'element':
				out.push('<' + item.name);
				for (const [k, v] of item.attrs) out.push(' ' + attrName(k) + '="' + escapeAttr(v) + '"');
				out.push('>');
				if (VOID_ELEMENTS.has(item.name)) break;
				stack.push('</' + item.name + '>');
				for (let k = item.children.length - 1; k >= 0; k--) stack.push(item.children[k]);
				break;
			case 'comment':
				out.push('<!--' + item.value + '-->');
				break;
			case 'doctype':
				out.push('<!DOCTYPE ' + item.name + '>');
				break;
		}
	}
	return out.join('');
}

// --- traversal --------------------------------------------------------------
// All iterative (explicit stack, children pushed in reverse = document order).

/**
 * Depth-first (pre-order) walk over every descendant of `root`. Return `false`
 * from the visitor to skip that node's subtree.
 */
export function walk(root: ParentNode, visit: (node: TreeNode, parent: ParentNode) => void | boolean): void {
	const nodes: TreeNode[] = [];
	const parents: ParentNode[] = [];
	for (let k = root.children.length - 1; k >= 0; k--) { nodes.push(root.children[k]); parents.push(root); }
	while (nodes.length !== 0) {
		const child = nodes.pop()!;
		const parent = parents.pop()!;
		if (visit(child, parent) !== false && child.type === 'element') {
			for (let k = child.children.length - 1; k >= 0; k--) { nodes.push(child.children[k]); parents.push(child); }
		}
	}
}

/** All descendant text concatenated — DOM `textContent` semantics. */
export function textContent(node: DocumentNode | TreeNode): string {
	if (node.type === 'text') return node.value;
	if (node.type === 'comment' || node.type === 'doctype') return '';
	const out: string[] = [];
	const stack: TreeNode[] = [];
	for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]);
	while (stack.length !== 0) {
		const n = stack.pop()!;
		if (n.type === 'text') out.push(n.value);
		else if (n.type === 'element') for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]);
	}
	return out.join('');
}

/** A tag name (e.g. `'a'`) or a predicate over elements. */
export type ElementMatch = string | ((el: ElementNode) => boolean);
const matches = (el: ElementNode, m: ElementMatch) => (typeof m === 'string' ? el.name === m : m(el));

/** First descendant element matching a tag name or predicate, or `null`. */
export function find(root: ParentNode, match: ElementMatch): ElementNode | null {
	const stack: TreeNode[] = [];
	for (let k = root.children.length - 1; k >= 0; k--) stack.push(root.children[k]);
	while (stack.length !== 0) {
		const n = stack.pop()!;
		if (n.type !== 'element') continue;
		if (matches(n, match)) return n;
		for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]);
	}
	return null;
}

/** Every descendant element matching a tag name or predicate (document order). */
export function findAll(root: ParentNode, match: ElementMatch): ElementNode[] {
	const acc: ElementNode[] = [];
	const stack: TreeNode[] = [];
	for (let k = root.children.length - 1; k >= 0; k--) stack.push(root.children[k]);
	while (stack.length !== 0) {
		const n = stack.pop()!;
		if (n.type !== 'element') continue;
		if (matches(n, match)) acc.push(n);
		for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]);
	}
	return acc;
}
