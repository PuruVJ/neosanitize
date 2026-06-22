---
"neosanitize": minor
---

Add the `neosanitize/parse` subpath export — policy-free access to the browser-faithful WHATWG parse tree.

`parse(html)` returns a full document (implied `<html>`/`<head>`/`<body>`, foster-parenting, the adoption agency — all handled), exactly like `DOMParser.parseFromString(html, 'text/html')`. Ships with helpers `serialize`, `walk`, `textContent`, and `find`/`findAll` (by tag name or predicate), plus the node type exports. Zero dependencies, no DOM, no selector engine.
