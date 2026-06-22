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
const RAW_TEXT = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

const RE_AMP = /&/g;
const RE_LT = /</g;
const RE_GT = />/g;
const RE_QUOT = /"/g;
const NBSP = String.fromCharCode(0xa0); // U+00A0 — escaped to &nbsp; like the browser
const escapeText = (s: string) => s.replace(RE_AMP, "&amp;").replace(RE_LT, "&lt;").replace(RE_GT, "&gt;").split(NBSP).join("&nbsp;");
const escapeAttr = (s: string) => s.replace(RE_AMP, "&amp;").replace(RE_QUOT, "&quot;").split(NBSP).join("&nbsp;");
// Foreign attrs are stored as "xlink href" (space form) → re-emit as "xlink:href".
const attrName = (n: string) => (n.indexOf(' ') === -1 ? n : n.replace(' ', ':'));

function emitNode(node: TreeNode, raw: boolean, out: string[]): void {
	switch (node.type) {
		case 'text':
			out.push(raw ? node.value : escapeText(node.value));
			break;
		case 'element':
			out.push('<' + node.name);
			for (const [k, v] of node.attrs) out.push(' ' + attrName(k) + '="' + escapeAttr(v) + '"');
			out.push('>');
			if (VOID_ELEMENTS.has(node.name)) break;
			for (const child of node.children) emitNode(child, RAW_TEXT.has(node.name), out);
			out.push('</' + node.name + '>');
			break;
		case 'comment':
			out.push('<!--' + node.value + '-->');
			break;
		case 'doctype':
			out.push('<!DOCTYPE ' + node.name + '>');
			break;
	}
}

/** Serialize a node (or a whole document) back to HTML, faithfully — no filtering. */
export function serialize(node: DocumentNode | TreeNode): string {
	const out: string[] = [];
	if (node.type === 'document') for (const child of node.children) emitNode(child, false, out);
	else emitNode(node, false, out);
	return out.join('');
}

// --- traversal --------------------------------------------------------------
/**
 * Depth-first (pre-order) walk over every descendant of `root`. Return `false`
 * from the visitor to skip that node's subtree.
 */
export function walk(root: ParentNode, visit: (node: TreeNode, parent: ParentNode) => void | boolean): void {
	for (const child of root.children) {
		if (visit(child, root) !== false && child.type === 'element') walk(child, visit);
	}
}

/** All descendant text concatenated — DOM `textContent` semantics. */
export function textContent(node: DocumentNode | TreeNode): string {
	if (node.type === 'text') return node.value;
	if (node.type === 'comment' || node.type === 'doctype') return '';
	let s = '';
	for (const child of node.children) s += textContent(child);
	return s;
}

/** A tag name (e.g. `'a'`) or a predicate over elements. */
export type ElementMatch = string | ((el: ElementNode) => boolean);
const matches = (el: ElementNode, m: ElementMatch) => (typeof m === 'string' ? el.name === m : m(el));

/** First descendant element matching a tag name or predicate, or `null`. */
export function find(root: ParentNode, match: ElementMatch): ElementNode | null {
	for (const child of root.children) {
		if (child.type !== 'element') continue;
		if (matches(child, match)) return child;
		const inner = find(child, match);
		if (inner) return inner;
	}
	return null;
}

/** Every descendant element matching a tag name or predicate (document order). */
export function findAll(root: ParentNode, match: ElementMatch): ElementNode[] {
	const acc: ElementNode[] = [];
	(function rec(parent: ParentNode) {
		for (const child of parent.children) {
			if (child.type !== 'element') continue;
			if (matches(child, match)) acc.push(child);
			rec(child);
		}
	})(root);
	return acc;
}
