---
"neosanitize": minor
---

Security hardening of the modern engine from an adversarial audit. The XSS issues needed a permissive custom allow-list (no shipped preset was affected); the `<command>` crash affected every configuration.

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
