# Parsing — `neosanitize/parse`

`neosanitize/parse` exposes the **same browser-faithful WHATWG parser** the sanitizer runs on (100% html5lib tokenizer conformance) — without any policy or filtering. Use it to read, query, and re-serialize HTML _exactly as a browser would build it_, with **zero dependencies** and no DOM.

```ts
import { parse, findAll, textContent, serialize } from 'neosanitize/parse';

const doc = parse('<main><a href="/x">one</a><a href="/y">two</a></main>');

findAll(doc, 'a').map((a) => a.attrs.find(([k]) => k === 'href')?.[1]);
// → ['/x', '/y']

textContent(doc); // → 'onetwo'
serialize(doc); // → the normalized HTML the browser would produce
```

`parse()` builds a **full document** — implied `<html>` / `<head>` / `<body>` and all — exactly like `new DOMParser().parseFromString(html, 'text/html')` in the browser. It is _not_ a regex or a naive split: misnested tags, foster-parented table content, the adoption agency, raw-text elements — all handled the way a browser does.

## Why

- **Browser-faithful** — the tree is the one a browser builds, so what you read is what renders. No parser-differential surprises.
- **Zero dependencies** — no jsdom, no parse5, no DOM. Just the parser.
- **The same tree the sanitizer uses** — parse → inspect → (sanitize) is one consistent model.

## The tree

`parse()` returns a `DocumentNode`. Every node is a plain object:

| Node       | Shape                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| `element`  | `{ type: 'element', name, namespace, attrs: [name, value][], children, parent }` |
| `text`     | `{ type: 'text', value, parent }`                                            |
| `comment`  | `{ type: 'comment', value, parent }`                                         |
| `doctype`  | `{ type: 'doctype', name, publicId, systemId, parent }`                      |
| `document` | `{ type: 'document', children }`                                             |

Attributes are an **ordered array of `[name, value]` pairs** — source order preserved, first-occurrence-wins on duplicates, like the browser. `namespace` is `'html'`, `'svg'`, or `'mathml'`.

## API

### `parse(html): DocumentNode`

Parse a full HTML document into the WHATWG tree.

### `serialize(node): string`

Serialize a node (or the whole document) back to HTML — faithfully, no filtering. Escapes text and attribute values, leaves raw-text (`<script>`, `<style>`, …) unescaped, and self-closes void elements.

### `find(root, match)` · `findAll(root, match)`

First / all descendant elements matching a **tag name** (`'a'`) or a **predicate** (`(el) => boolean`), in document order.

```ts
find(doc, 'title');
findAll(doc, (el) => el.attrs.some(([k]) => k === 'data-id'));
```

### `walk(root, visit)`

Depth-first (pre-order) walk over every descendant. Return `false` from the visitor to skip that node's subtree.

```ts
walk(doc, (node, parent) => {
  if (node.type === 'element' && node.name === 'script') return false; // skip <script> subtrees
});
```

### `textContent(node): string`

All descendant text concatenated — DOM `textContent` semantics.

## What it is _not_

A parse tree + helpers, **not a DOM**. There's no `querySelector` (use `find` with a predicate), no live collections, no mutation API, no CSS selector engine. Need a full DOM in Node? Reach for [linkedom](https://github.com/WebReflection/linkedom) or [jsdom](https://github.com/jsdom/jsdom). Need to _sanitize_? Use the main [`Sanitizer`](/guide) — it runs on this exact tree.
