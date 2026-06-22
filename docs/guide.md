# Introduction

**neosanitize** is a zero-dependency, isomorphic HTML sanitizer written in TypeScript. It ships **two engines in one package**:

- **`.` (main)**, a new, forward-looking engine built on a **browser-faithful WHATWG parser** (100% [html5lib](https://github.com/html5lib/html5lib-tests) tokenizer conformance), **deny-by-default**, with an **inviolable safe baseline**. Roughly **2.3× faster** than `sanitize-html`.
- **`./legacy`**, a byte-identical, drop-in port of [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) 2.x: same API, same output, verified with millions of differential-fuzz cases.

A third subpath, **`./whatwg-parser`**, exposes the same browser-faithful parse tree without any policy, for reading and querying HTML the way a browser builds it.

No runtime dependencies. ESM. `sideEffects: false` with subpath exports, you ship only what you import.

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

The two share **no runtime code**, importing one never pulls in the other.

## Quick start

The main engine is **class-only by design**. You build a `Sanitizer` with an explicit policy and call `.sanitize()`. There is deliberately **no** one-shot `sanitize(html)` helper: forcing an explicit policy means there's no implicit global default to misconfigure, and the policy compiles **once** so repeated calls stay cheap.

```ts
import { Sanitizer } from 'neosanitize';
import * as presets from 'neosanitize/presets';

const sanitizer = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

sanitizer.sanitize('<p>hi <img src=x onerror=alert(1)> <script>bad()</script></p>');
// → '<p>hi <img src="x"> </p>'
```

Start from scratch, deny-by-default, so everything not allow-listed is removed:

```ts
const s = Sanitizer.builder({ tags: ['a', 'b', 'p'], attrs: { a: ['href'] } }).build();
s.sanitize('<p>see <a href="/docs" onclick="x()">docs</a><iframe></iframe></p>');
// → '<p>see <a href="/docs">docs</a></p>'
```

## Where to next

- **[Sanitizing](/sanitizing)**, the main engine in depth: presets, the builder, output targets, streaming, report mode, the safe baseline, and the ~3 KB browser build.
- **[WHATWG parser (`neosanitize/whatwg-parser`)](/whatwg-parser)**, read and query the browser-faithful tree without sanitizing.
- **[Parser adapters](/adapters)**, swap the sanitizer's parser for parse5 or htmlparser2.
- **[Legacy (`neosanitize/legacy`)](/legacy)**, the byte-identical `sanitize-html` drop-in.
- **[Performance](/performance)** · **[Security model](/security)**.
