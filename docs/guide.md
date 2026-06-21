# Introduction

**neosanitize** is a zero-dependency, isomorphic HTML sanitizer written in TypeScript. It ships **two engines in one package**:

- **`.` (main)** — a new, forward-looking engine built on a **browser-faithful WHATWG parser** (100% [html5lib](https://github.com/html5lib/html5lib-tests) tokenizer conformance), **deny-by-default**, with an **inviolable safe baseline**. Roughly **2.3× faster** than `sanitize-html`.
- **`./legacy`** — a byte-identical, drop-in port of [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) 2.x: same API, same output, verified with millions of differential-fuzz cases.

No runtime dependencies. ESM. `sideEffects: false` with subpath exports.

```bash
npm install neosanitize
```

## Which engine? {#which-engine}

| | `.` (main) | `./legacy` |
| --- | --- | --- |
| **Use when** | new code; you want speed, a browser-faithful parse, deny-by-default safety | dropping in for an existing `sanitize-html` install with zero behaviour change |
| **Parser** | own WHATWG/HTML5 parser (matches the browser) | `htmlparser2` semantics (matches `sanitize-html`) |
| **API** | class-only: build a `Sanitizer`, call `.sanitize()` | functional: `sanitize(html, options)` |
| **Default posture** | deny-by-default + inviolable baseline | identical to `sanitize-html` |

The two share **no runtime code** — importing one never pulls in the other.

---

## Quick start — the main engine

The main engine is **class-only by design**. You build a `Sanitizer` with an explicit policy and call `.sanitize()`. There is deliberately **no** one-shot `sanitize(html)` helper: forcing an explicit policy means there's no implicit global default to misconfigure, and the policy compiles **once** so repeated calls stay cheap.

```ts
import { Sanitizer } from 'neosanitize';
import * as presets from 'neosanitize/presets';

const sanitizer = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

sanitizer.sanitize('<p>hi <img src=x onerror=alert(1)> <script>bad()</script></p>');
// → '<p>hi <img src="x"> </p>'
```

Start from scratch — deny-by-default, so everything not allow-listed is removed:

```ts
const s = Sanitizer.builder({ tags: ['a', 'b', 'p'], attrs: { a: ['href'] } }).build();
s.sanitize('<p>see <a href="/docs" onclick="x()">docs</a><iframe></iframe></p>');
// → '<p>see <a href="/docs">docs</a></p>'
```

## Presets

Curated, ready-to-use policies, all under the single `neosanitize/presets` entry. The convention is a namespace import:

```ts
import * as presets from 'neosanitize/presets';
// presets.none · presets.basic · presets.ugc · presets.markdown
```

| Preset | For |
| --- | --- |
| `none` | strip all tags to safe text |
| `basic` | minimal inline formatting |
| `ugc` | user-generated content (comments, posts) |
| `markdown` | the HTML a Markdown renderer emits |

## Refining a policy

```ts
const s = Sanitizer.builder(presets.basic) // start from a preset (or a partial policy)
  .allow('a', ['href', 'title']) // add tags + attributes
  .allow('img', ['src', 'alt'])
  .deny('span') // remove a tag (and its attributes)
  .build();
```

`'*'` allows an attribute on any tag: `attrs: { '*': ['class'] }`.

## Output targets

```ts
s.sanitize(html); // → string (the default)
s.sanitizeToText(html); // → plain text, all markup removed
s.sanitizeToFragment(html); // → DocumentFragment (browser only; skips re-parsing)
s.sanitizeToTrustedHTML(html); // → TrustedHTML when Trusted Types is available, else string
s.sanitizeTo(html, sink); // → streams the result to a sink (no return value)
```

### Streaming output

`sanitizeTo(html, sink, opts?)` writes the **same bytes** as `sanitize()` incrementally instead of building one result string — for large documents and for piping straight to a response or file. The sink is a callback or any object with a Node-style `write(chunk)`:

```ts
s.sanitizeTo(html, (chunk) => res.write(chunk));    // callback
s.sanitizeTo(html, res);                            // HTTP response / fs write stream
s.sanitizeTo(html, sink, { chunkSize: 64 * 1024 }); // tune flush size (default 16 KB)
```

Fragments are batched into ~`chunkSize`-character writes, the same inviolable baseline applies, and it's synchronous: the whole input is parsed first (a faithful tree is required), so it streams *output*, not input.

## Report mode

See exactly what was removed and why — for audits, debugging, or telemetry:

```ts
const { html, removed } = s.sanitizeWithReport('<a href=javascript:alert(1) onclick=x>y</a>');
// html    → '<a>y</a>'
// removed → [
//   { kind: 'url',  name: 'href',    reason: 'dangerous-url' },
//   { kind: 'attr', name: 'onclick', reason: 'event-handler' },
// ]
```

## The inviolable safe baseline

Even if your allow-list permits them, the baseline **always** strips `<script>`, `on*` event handlers, and `javascript:` / `vbscript:` / non-image `data:` URLs — mirroring the browser's native `setHTML()`. The only escape hatch is explicit and named to make that obvious:

```ts
s.sanitizeUnsafe(html); // skips the baseline (mirrors setHTMLUnsafe); the allow-list still applies
```

## Browser build (~3 KB)

In the browser you don't need to ship an HTML parser — the platform already has one. The package's `browser` export condition automatically routes bundlers (Vite, esbuild, webpack, Rollup) to a build that parses with the native `DOMParser` and runs the **same** policy engine. Same `Sanitizer` API, **zero parser bytes**:

```ts
import { Sanitizer } from 'neosanitize'; // resolves to the browser build in a bundler
```

## Legacy drop-in

Identical API and output to `sanitize-html` 2.x:

```ts
import sanitize from 'neosanitize/legacy';

sanitize('<img src=x onerror=alert(1) />', {
  allowedTags: ['img'],
  allowedAttributes: { img: ['src'] },
});
// → '<img src="x" />'  (exactly what sanitize-html produces)
```
