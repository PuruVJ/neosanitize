# neosanitize

## 0.3.0

### Minor Changes

- [#4](https://github.com/PuruVJ/neosanitize/pull/4) [`6fae3bf`](https://github.com/PuruVJ/neosanitize/commit/6fae3bf8f67d7bfa719db0096b153ebf0c8201f9) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Add a pluggable parser-adapter system, and rename the parse-tree subpath.

  The `Sanitizer`'s parser is now a swappable adapter (`type ParseAdapter = (html: string) => ParentNode`). Each entry keeps an environment-appropriate default (the bundled WHATWG parser in Node, native `DOMParser` in the browser, now exported as `whatwgAdapter` / `domParserAdapter`), and you can override it per-instance with `Sanitizer.builder(policy).parser(adapter).build()` (pass `null` to restore the default). The deny-by-default policy and serializer are unchanged regardless of parser.

  Two optional adapters ship as subpath exports backed by optional peer dependencies (nothing is pulled in unless you import them):

  - `neosanitize/parse5` exports `parse5Adapter`, the reference WHATWG parser, for 100% spec-conformant tree construction.
  - `neosanitize/htmlparser2` exports `htmlparser2Adapter`, the fast, lenient parser sanitize-html uses.

  **Breaking:** the `neosanitize/parse` subpath is renamed to `neosanitize/whatwg-parser` (same `parse`/`serialize`/`walk`/`find`/`findAll`/`textContent` API). Update imports from `neosanitize/parse` to `neosanitize/whatwg-parser`.

## 0.2.0

### Minor Changes

- [#1](https://github.com/PuruVJ/neosanitize/pull/1) [`35ee0c9`](https://github.com/PuruVJ/neosanitize/commit/35ee0c9e7224f21b546797dfd5a3f223ab6b363b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Add the `neosanitize/parse` subpath export — policy-free access to the browser-faithful WHATWG parse tree.

  `parse(html)` returns a full document (implied `<html>`/`<head>`/`<body>`, foster-parenting, the adoption agency — all handled), exactly like `DOMParser.parseFromString(html, 'text/html')`. Ships with helpers `serialize`, `walk`, `textContent`, and `find`/`findAll` (by tag name or predicate), plus the node type exports. Zero dependencies, no DOM, no selector engine.

### Patch Changes

- [#1](https://github.com/PuruVJ/neosanitize/pull/1) [`35ee0c9`](https://github.com/PuruVJ/neosanitize/commit/35ee0c9e7224f21b546797dfd5a3f223ab6b363b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `./legacy`: improve `sanitize-html` parity while staying zero-dependency.

  The legacy engine now reimplements `parse-srcset` (its descriptor-validation state machine) and several `htmlparser2` parser edge cases (`<!-`, `<!>`, `<a ==b>`, short `<!--…-->` comments) inline — with **no `postcss` or `entities` runtime dependencies**. Inline `style` filtering for `allowedStyles` keeps using a hand-written flat-declaration parser instead of `postcss`, so it stays zero-dep and, unlike the original, also works in the browser (sanitize-html's postcss path is Node-only).
