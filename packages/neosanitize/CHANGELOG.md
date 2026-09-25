# neosanitize

## 0.5.0

### Minor Changes

- [#10](https://github.com/PuruVJ/neosanitize/pull/10) [`b28ea7d`](https://github.com/PuruVJ/neosanitize/commit/b28ea7dd1945493c4b513457634be038c204af10) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Security hardening of the modern engine from an adversarial audit. The XSS issues needed a permissive custom allow-list (no shipped preset was affected); the `<command>` crash affected every configuration.

  - Raw-text elements (`style`, `xmp`, `iframe`, `noembed`, `noframes`) now escape their content when it contains `<`, closing mutation-XSS paths where the output re-parses in a different namespace (unwrapped `foreignObject` / `mi` / `desc`, dropped `annotation-xml` encoding, `mglyph` / `malignmark`, and the htmlparser2 adapter).
  - `srcdoc` is always dropped by the baseline (it was checked as a URL).
  - Attribute values now escape `<` and `>` (current spec, Chrome 138+), so a value can't close a `noscript` on a scripting-on re-parse.
  - `xlink:href` in colon form, and SVG `animate` / `set` targeting `href` (plus their `to` / `from` / `by` / `values`), are URL-checked.
  - `data:` MIME checks ignore tab / newline like browsers do, so `data:image/s\tvg+xml` is caught.
  - `sanitizeToText`, `sanitizeToFragment`, the parse5 / htmlparser2 adapters and the `whatwg-parser` helpers are iterative, so deep nesting can't overflow the stack.
  - `whatwg-parser`'s `serialize()` only emits raw text for HTML-namespace raw-text elements.
  - Duplicate-attribute detection is linear on tags with many attributes.
  - Text and attribute escaping is a single pass with no regex chain (less garbage on large documents).
  - Any input containing `<command>` no longer overflows the stack (the tree builder bounced it between the head and body modes forever).

  - Many distinct unclosed formatting elements (`<b id=1><b id=2>…`) no longer take quadratic time (250 KB: 2 s to about 40 ms). The spec's "Noah's Ark" scan now looks back at most 128 entries.
  - Stray end tags, misnested `<a>`, and similar input on very deep documents are no longer quadratic (1 MB: about 35 s to about 20 ms).
  - `whatwg-parser`: a comment at the very end of the input after text (`abc<!--x`) is no longer dropped.

  Performance of the modern engine vs 0.4.0, full `sanitize()`: 1.5-1.8x the throughput on 1 MB and 10 MB documents (10 MB blog-style content: 49 to 89 MB/s; tables 57 to 92; plain text 227 to 343), with a lower memory peak (10 MB blog-style: about 940 MB to about 360 MB).

  - Content is serialized and freed while the tree is still being built, so the whole tree never has to be held in memory at once. This also works inside a single wrapper element (one big `<main>` or `<div>`): a 10 MB single-root document peaks at about 310 MB instead of about 780 MB. Tables, templates and forms still hold their content until they close.
  - CR / CRLF line endings are normalized as the input is read instead of in a full copy first: CRLF documents now parse at the same speed as LF ones (was about 15% slower).
  - URL scheme checks no longer call `new URL()` for relative URLs that contain a colon (`/wiki/File:X.png`), about 23x faster on such documents, and judge obfuscated `javascript:` / `vbscript:` / `data:` schemes by the WHATWG scheme rules (stricter than before).
  - Attribute rules are precomputed at `build()`, output is built as short chunks joined once, the tree walk uses a flat frame stack, inline styles have an ASCII fast path, and escaping jumps between hits with native `indexOf`.
  - Parser: the tokenizer runs as one loop with a jump-table state switch, tag and attribute names are interned while scanning (no slice or lowercase copy), named entities resolve with one table probe, start tags dispatch through one category map, and tree nodes are smaller (children and attribute arrays allocated at exact size).

## 0.4.0

### Minor Changes

- [#6](https://github.com/PuruVJ/neosanitize/pull/6) [`9dbc23c`](https://github.com/PuruVJ/neosanitize/commit/9dbc23cf05c8820aeed3e45ad998e1059facb2ae) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Unify the main-engine configuration around a single builder API, and add dynamic tags, an attribute hook, and sanitizer derivation.

  The builder is now the only way to construct a `Sanitizer`. There is no declarative config object and no public `new Sanitizer(...)`; everything goes through `Sanitizer.builder()...build()`.

  - **`allow` is polymorphic:** `allow('a', ['href'])` (exact), `allow(['p', 'b', 'i'])` (bulk), `allow(/^(ui|wc)-/, '*')` (pattern + any attribute). Pattern tags cover custom-element conventions whose set isn't known up front; matches are memoized. This folds in the previous `allowMatching`.
  - **`allow('*', [...])`** sets attributes allowed on any tag; an attribute list of `'*'` allows any attribute on that tag.
  - **`transformAttribute(({ tag, name, value }) => string | null | undefined)`** runs arbitrary per-attribute logic on allow-listed attributes; the result is re-checked by the baseline (a hook can rewrite or drop, never reintroduce `on*` / dangerous URLs). Hooks compose.
  - **`sanitizer.toExtended((b) => ...)`** returns a new `Sanitizer` derived from an existing one without re-declaring the base policy. Immutable (like `Array.prototype.toSorted`): the base is never mutated, so a shared sanitizer can be derived from per call site.
  - **`allowUnsafe(on?)`** on the builder; `parser(adapter)` is unchanged.

  **Breaking:** presets are now `(builder) => void` functions instead of branded policy objects (`UNSAFE_PRESET_SYMBOL` is removed). `Sanitizer.builder(preset)` and `import * as presets from 'neosanitize/presets'` still work. The declarative `Sanitizer.builder({ tags, attrs })` form and `new Sanitizer(policy)` are removed in favour of `.allow()` / presets.

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
