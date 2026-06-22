<p align="center">
  <img src="assets/logo.svg" width="84" height="84" alt="neosanitize" />
</p>

<h1 align="center">neosanitize</h1>

Zero-dependency, isomorphic HTML sanitizer in TypeScript. **Two engines in one package:**

- **`.` (main)** — a new, forward-looking engine built on a **browser-faithful WHATWG parser** (100% [html5lib](https://github.com/html5lib/html5lib-tests) tokenizer conformance), **deny-by-default** policy, and an **inviolable safe baseline**. Roughly **2.3× faster** than `sanitize-html` across a 13-scenario benchmark.
- **`./legacy`** — a byte-identical, drop-in port of [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) 2.x: same API, same output, verified against the original with millions of differential-fuzz cases. Use it to migrate off `sanitize-html` (and its `htmlparser2` + `postcss` dependency tree) with no behaviour change.

No runtime dependencies. ESM. `sideEffects: false` and subpath exports — you ship only what you import.

```bash
npm install neosanitize
```

---

## Which engine should I use?

| | `.` (main) | `./legacy` |
|---|---|---|
| **Use when** | new code; you want speed, a browser-faithful parse, and deny-by-default safety | dropping in for an existing `sanitize-html` install with zero behaviour change |
| **Parser** | own WHATWG/HTML5 parser (matches the browser) | `htmlparser2` semantics (matches `sanitize-html`) |
| **API** | class-only: build a `Sanitizer`, call `.sanitize()` | functional: `sanitize(html, options)` |
| **Default posture** | deny-by-default + inviolable baseline | identical to `sanitize-html` |
| **Stability** | evolves (semver) | frozen to `sanitize-html`'s behaviour |

The two share **no runtime code** — importing one never pulls in the other.

---

## Quick start — the main engine

The main engine is **class-only by design**. You build a `Sanitizer` with an explicit policy and call `.sanitize()`. There is deliberately **no** one-shot `sanitize(html)` helper: forcing an explicit policy means there's no implicit global default to misconfigure, and the policy is compiled **once** so repeated `.sanitize()` calls are cheap.

```ts
import { Sanitizer } from 'neosanitize';
import * as presets from 'neosanitize/presets';

// Build once (compiles the policy), reuse everywhere.
const sanitizer = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

sanitizer.sanitize('<p>hi <img src=x onerror=alert(1)> <script>bad()</script></p>');
// → '<p>hi <img src="x"> </p>'
//   onerror handler stripped, <script> dropped with its content.
```

Start from scratch (deny-by-default — everything not allow-listed is removed):

```ts
const s = Sanitizer.builder({ tags: ['a', 'b', 'p'], attrs: { a: ['href'] } }).build();
s.sanitize('<p>see <a href="/docs" onclick="x()">docs</a><iframe></iframe></p>');
// → '<p>see <a href="/docs">docs</a></p>'
```

### Presets

Curated, ready-to-use policies, all under the single `neosanitize/presets` entry. The convention is a namespace import:

```ts
import * as presets from 'neosanitize/presets';
// presets.none · presets.basic · presets.ugc · presets.markdown
```

| Preset | For |
|---|---|
| `none` | strip all tags to safe text |
| `basic` | minimal inline formatting |
| `ugc` | user-generated content (comments, posts) |
| `markdown` | the HTML a Markdown renderer emits |

### Refining a policy with the builder

```ts
const s = Sanitizer.builder(presets.basic) // start from a preset (or a partial policy)
  .allow('a', ['href', 'title'])           // add tags + attributes
  .allow('img', ['src', 'alt'])
  .deny('span')                      // remove a tag (and its attributes)
  .build();
```

`'*'` allows an attribute on any tag: `attrs: { '*': ['class'] }`.

### Output targets

```ts
s.sanitize(html);             // → string (the default)
s.sanitizeToText(html);       // → plain text, all markup removed
s.sanitizeToFragment(html);   // → DocumentFragment (browser only; skips re-parsing)
s.sanitizeToTrustedHTML(html);// → TrustedHTML when Trusted Types is available, else string
s.sanitizeTo(html, sink);     // → streams the result to a sink (no return value)
```

### Streaming output

`sanitizeTo(html, sink, opts?)` delivers the **same bytes** as `sanitize()` incrementally instead of returning one string — handy for large documents (no big result string) and for writing straight to a response or file stream. The sink is a callback or any object with a Node-style `write(chunk)`:

```ts
s.sanitizeTo(html, (chunk) => res.write(chunk));   // callback
s.sanitizeTo(html, res);                           // an HTTP response / fs write stream
s.sanitizeTo(html, sink, { chunkSize: 64 * 1024 }); // tune the flush size (default 16 KB)
```

Fragments are batched into ~`chunkSize`-character writes (so the sink isn't hit once per tag). The same inviolable baseline applies. It's synchronous — the whole input is parsed first (a faithful tree is required), so it streams *output*, not input, and doesn't await backpressure.

### Report mode

See exactly what was removed and why — for audits, debugging, or telemetry:

```ts
const { html, removed } = s.sanitizeWithReport('<a href=javascript:alert(1) onclick=x>y</a>');
// html    → '<a>y</a>'
// removed → [
//   { kind: 'url',  name: 'href',    reason: 'dangerous-url' },
//   { kind: 'attr', name: 'onclick', reason: 'not-allowed'   },
// ]
```

### The inviolable safe baseline

Even if your allow-list permits them, the baseline **always** strips known-dangerous constructs — `<script>`, `on*` event handlers, and `javascript:` / `vbscript:` / non-image `data:` URLs — mirroring the browser's native `setHTML()`. An allow-list can never re-introduce them.

The only escape hatch is explicit, and named to make that obvious:

```ts
s.sanitizeUnsafe(html); // skips the baseline (mirrors setHTMLUnsafe); the allow-list still applies
```

---

## Browser build (native parser, ~3 KB)

In the browser you don't need to ship an HTML parser — the platform already has one. The package's `browser` export condition automatically routes bundlers (Vite, esbuild, webpack, Rollup) to a build that parses with the native `DOMParser` and runs the **same** policy engine. Same `Sanitizer` API, **zero parser bytes**:

```ts
import { Sanitizer } from 'neosanitize'; // resolves to the browser build in a bundler
```

| Build | Min+gzip | Min+brotli | Notes |
|---|---:|---:|---|
| `.` browser | ~3.2 KB | **~2.9 KB** | native `DOMParser`, no bundled parser |
| `.` Node/default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |
| `./legacy` | ~21 KB | ~18 KB | single-file `sanitize-html` port |

Because parsing is the browser's own, the browser build is byte-for-byte what the user's browser would build — which closes parser-differential / mutation-XSS gaps by construction.

---

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

It reimplements `sanitize-html`'s three parsers — `htmlparser2`, `parse-srcset`, and `postcss` — **inline, with zero runtime dependencies**. Notably, `postcss` is only there to filter the `style` attribute for `allowedStyles`; our hand-written declaration parser matches it on every realistic style **and** works in the browser (the original's postcss path is Node-only). Details: [the legacy guide](https://neosanitize.puruvj.dev/legacy#zero-dependencies-what-we-replaced).

---

## Parsing — `neosanitize/parse`

Need the tree, not the sanitizer? `neosanitize/parse` exposes the **same browser-faithful WHATWG parser**, policy-free — zero-dep, no DOM. The tree is what a browser builds (misnesting, foster parenting, the adoption agency, all handled), and `parse()` returns a full document just like `DOMParser.parseFromString(html, 'text/html')`.

```ts
import { parse, findAll, textContent, serialize } from 'neosanitize/parse';

const doc = parse('<main><a href="/x">one</a><a href="/y">two</a></main>');
findAll(doc, 'a').map((a) => a.attrs.find(([k]) => k === 'href')?.[1]); // ['/x','/y']
textContent(doc); // 'onetwo'
serialize(doc);   // round-trips to the normalized HTML the browser would produce
```

`parse`, `serialize`, `find`/`findAll` (tag name or predicate), `walk`, `textContent`. It's a parse tree + helpers, not a full DOM — see the [parsing guide](https://neosanitize.puruvj.dev/parse).

---

## Performance

Throughput vs. the original `sanitize-html`, across a 13-scenario corpus (`node bench/three-way.mjs`):

- **main: geomean ~2.3× faster** than `sanitize-html` (up to 3.7× on entity-heavy input) — while doing a *full* WHATWG-conformant parse + tree construction. On heavy/adversarial inputs (XSS payloads, attribute-dense markup, big tables) it now **matches or beats** `./legacy`.
- The `./legacy` port (~2.7×) edges ahead only on benign prose and tiny documents, where its `htmlparser2`-style streaming parse skips the tree's fixed setup cost.

Both engines compile their policy once and reuse it, so the hot path is just parse → walk → serialize.

---

## Security

- **Deny-by-default** + an **inviolable baseline** that an allow-list can't override (see above).
- **Browser-faithful parsing** (main): 100% html5lib tokenizer conformance, so the tree we sanitize is the tree a browser builds.
- **Defense-in-depth:** sanitized output is verified safe and reparse-stable against a 20,000-case adversarial fuzz (zero XSS bypasses).

Full threat model and responsible-disclosure process: [SECURITY.md](./SECURITY.md).

---

## Conformance & tests

- **Tokenizer:** 100% of the vendored html5lib tokenizer suite (6946/6946).
- **Tree construction:** ~95.6% of the html5lib tree-construction suite (ratcheted upward). The remaining divergences are degenerate adoption-agency/`<nobr>`/table nesting and bleeding-edge `<select>` cases — tree-shape differences that don't affect sanitization safety (output stays safe + reparse-stable).
- **Legacy parity:** the `./legacy` port is differential-fuzzed against `sanitize-html` itself.

```bash
pnpm test        # build + full suite
pnpm typecheck
pnpm bench       # legacy vs sanitize-html
pnpm bench:3way  # original vs legacy vs main
```

---

## Acknowledgements

This project stands on two MIT-licensed projects:

- **[sanitize-html](https://github.com/apostrophecms/sanitize-html)** (Apostrophe Technologies, Inc.) — the `./legacy` entry point is a faithful re-implementation of its behaviour. MIT.
- **[html5lib-tests](https://github.com/html5lib/html5lib-tests)** (html5lib contributors) — vendored under `test/fixtures/` as the parser-conformance oracle for the main engine (test-only; not shipped in the published package). MIT.

## License

[MIT](./LICENSE) © Puru Vijay
