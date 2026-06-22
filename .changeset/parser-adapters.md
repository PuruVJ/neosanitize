---
"neosanitize": minor
---

Add a pluggable parser-adapter system, and rename the parse-tree subpath.

The `Sanitizer`'s parser is now a swappable adapter (`type ParseAdapter = (html: string) => ParentNode`). Each entry keeps an environment-appropriate default (the bundled WHATWG parser in Node, native `DOMParser` in the browser, now exported as `whatwgAdapter` / `domParserAdapter`), and you can override it per-instance with `Sanitizer.builder(policy).parser(adapter).build()` (pass `null` to restore the default). The deny-by-default policy and serializer are unchanged regardless of parser.

Two optional adapters ship as subpath exports backed by optional peer dependencies (nothing is pulled in unless you import them):

- `neosanitize/parse5` exports `parse5Adapter`, the reference WHATWG parser, for 100% spec-conformant tree construction.
- `neosanitize/htmlparser2` exports `htmlparser2Adapter`, the fast, lenient parser sanitize-html uses.

**Breaking:** the `neosanitize/parse` subpath is renamed to `neosanitize/whatwg-parser` (same `parse`/`serialize`/`walk`/`find`/`findAll`/`textContent` API). Update imports from `neosanitize/parse` to `neosanitize/whatwg-parser`.
