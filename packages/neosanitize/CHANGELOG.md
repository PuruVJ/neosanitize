# neosanitize

## 0.2.0

### Minor Changes

- [#1](https://github.com/PuruVJ/neosanitize/pull/1) [`35ee0c9`](https://github.com/PuruVJ/neosanitize/commit/35ee0c9e7224f21b546797dfd5a3f223ab6b363b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Add the `neosanitize/parse` subpath export — policy-free access to the browser-faithful WHATWG parse tree.

  `parse(html)` returns a full document (implied `<html>`/`<head>`/`<body>`, foster-parenting, the adoption agency — all handled), exactly like `DOMParser.parseFromString(html, 'text/html')`. Ships with helpers `serialize`, `walk`, `textContent`, and `find`/`findAll` (by tag name or predicate), plus the node type exports. Zero dependencies, no DOM, no selector engine.

### Patch Changes

- [#1](https://github.com/PuruVJ/neosanitize/pull/1) [`35ee0c9`](https://github.com/PuruVJ/neosanitize/commit/35ee0c9e7224f21b546797dfd5a3f223ab6b363b) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `./legacy`: improve `sanitize-html` parity while staying zero-dependency.

  The legacy engine now reimplements `parse-srcset` (its descriptor-validation state machine) and several `htmlparser2` parser edge cases (`<!-`, `<!>`, `<a ==b>`, short `<!--…-->` comments) inline — with **no `postcss` or `entities` runtime dependencies**. Inline `style` filtering for `allowedStyles` keeps using a hand-written flat-declaration parser instead of `postcss`, so it stays zero-dep and, unlike the original, also works in the browser (sanitize-html's postcss path is Node-only).
