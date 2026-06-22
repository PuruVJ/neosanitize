/**
 * `neosanitize/parse` — the browser-faithful WHATWG parse tree, exposed.
 *
 * This is the *same* tokenizer + tree construction the main sanitizer runs on
 * (100% html5lib tokenizer conformance), without any policy or filtering. Use it
 * to read, query, and re-serialize HTML exactly as a browser would build it —
 * zero dependencies, no DOM.
 *
 * ```ts
 * import { parse, findAll, textContent, serialize } from 'neosanitize/parse';
 *
 * const doc = parse('<main><a href="/x">one</a><a href="/y">two</a></main>');
 * findAll(doc, 'a').map((a) => a.attrs.find(([k]) => k === 'href')?.[1]); // ['/x','/y']
 * textContent(doc);                                                       // 'onetwo'
 * serialize(doc);  // round-trips to the normalized HTML the browser would produce
 * ```
 *
 * `parse()` builds a full document (with the implied `<html>/<head>/<body>`),
 * just like `new DOMParser().parseFromString(html, 'text/html')`.
 */
import { TreeBuilder } from '../parser/tree-builder';
import type { DocumentNode, ElementNode, ParentNode, TreeNode } from '../parser/tree-builder';

export type { DocumentNode, ElementNode, TextNode, CommentNode, DoctypeNode, TreeNode, ParentNode, NS } from '../parser/tree-builder';

/**
 * Parse HTML into the WHATWG tree a browser would build. Returns a full
 * `DocumentNode` (implied `<html>/<head>/<body>` included), matching
 * `DOMParser.parseFromString(html, 'text/html')`.
 */
export function parse(html: string): DocumentNode {
	return new TreeBuilder(html).parse();
}

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
