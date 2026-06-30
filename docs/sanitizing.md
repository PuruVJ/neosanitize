# Sanitizing

The main engine (`neosanitize`) is **class-only by design**. You build a `Sanitizer` once, which compiles the policy, and reuse it for every call. This page covers everything you can do with it.

```ts
import { Sanitizer } from 'neosanitize';

const s = Sanitizer.builder().allow(['a', 'b', 'p']).allow('a', ['href']).build();
s.sanitize('<p>see <a href="/docs" onclick="x()">docs</a><iframe></iframe></p>');
// → '<p>see <a href="/docs">docs</a></p>'
```

Everything not allow-listed is removed, **deny-by-default**.

## Presets {#presets}

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

## Refining a policy {#refining}

Start from a preset (or a partial policy) and adjust with the builder:

```ts
const s = Sanitizer.builder(presets.basic)
  .allow('a', ['href', 'title']) // add tags + attributes
  .allow('img', ['src', 'alt'])
  .deny('span') // remove a tag (and its attributes)
  .build();
```

`'*'` allows an attribute on any tag: `attrs: { '*': ['class'] }`.

## Dynamic tags {#dynamic-tags}

When the tag set follows a convention rather than a fixed list (custom elements like `ui-*` / `wc-*`, web components, a design-system prefix), pass a `RegExp` or predicate to `allow` instead of a name. Use `'*'` to allow any attribute on matched tags:

```ts
const s = Sanitizer.builder(ugc)
  .allow(/^(ui|wc)-/, '*')              // regex + any attribute
  .allow((tag) => tag.startsWith('x-')) // or a predicate
  .build();
```

This is compiled once, not evaluated per call. A matched tag is resolved on first sight and memoized, so repeated tags stay O(1). The inviolable baseline still applies to matched tags: a `<ui-link onclick=... href="javascript:...">` keeps neither the handler nor the URL.

## Transforming attributes {#transforming-attributes}

For attribute logic that isn't a simple allow/deny, register a `transformAttribute` hook. It runs on every allow-listed attribute and returns a new value, `null` to drop it, or `undefined` to leave it:

```ts
const s = Sanitizer.builder(ugc)
  .transformAttribute(({ tag, name, value }) =>
    name === 'class' ? value.replace(/\binternal-\S+/g, '').trim() : value
  )
  .build();
```

The hook can rewrite or drop, but its result is re-checked by the baseline, so it can never reintroduce an `on*` handler or a dangerous-scheme URL. It also only sees allow-listed attributes, so it can't resurrect a denied one. Multiple hooks compose in order.

> Stripping all `on*` event handlers needs no hook. The baseline already removes them (and `javascript:` / `vbscript:` / non-image `data:` URLs) by default, on every tag, regardless of the allow-list.

## Deriving a sanitizer {#extend}

A common setup is one shared `Sanitizer` built at startup and reused everywhere, with one or two call sites that need a little extra. `toExtended` derives a variant from an existing instance without re-declaring the base policy. Like `Array.prototype.toSorted`, it returns a new sanitizer and never mutates the original:

```ts
// shared, built once
export const sanitizer = Sanitizer.builder(ugc).build();

// at the one place that renders design-system markup
const withComponents = sanitizer.toExtended((b) => b.allow(/^(ui|wc)-/, '*'));
withComponents.sanitize(input);
```

The derived sanitizer inherits the base tags, attributes, matchers, hooks, and parser, then applies whatever you add in the callback, and compiles once like any other.

## Output targets {#output-targets}

```ts
s.sanitize(html); // → string (the default)
s.sanitizeToText(html); // → plain text, all markup removed
s.sanitizeToFragment(html); // → DocumentFragment (browser only; skips re-parsing)
s.sanitizeToTrustedHTML(html); // → TrustedHTML when Trusted Types is available, else string
s.sanitizeTo(html, sink); // → streams the result to a sink (no return value)
```

### Streaming output {#streaming}

`sanitizeTo(html, sink, opts?)` writes the **same bytes** as `sanitize()` incrementally instead of building one result string, for large documents and for piping straight to a response or file. The sink is a callback or any object with a Node-style `write(chunk)`:

```ts
s.sanitizeTo(html, (chunk) => res.write(chunk));    // callback
s.sanitizeTo(html, res);                            // HTTP response / fs write stream
s.sanitizeTo(html, sink, { chunkSize: 64 * 1024 }); // tune flush size (default 16 KB)
```

Fragments are batched into ~`chunkSize`-character writes, the same inviolable baseline applies, and it's synchronous: the whole input is parsed first (a faithful tree is required), so it streams *output*, not input.

## Report mode {#report-mode}

See exactly what was removed and why, for audits, debugging, or telemetry:

```ts
const { html, removed } = s.sanitizeWithReport('<a href=javascript:alert(1) onclick=x>y</a>');
// html    → '<a>y</a>'
// removed → [
//   { kind: 'url',  name: 'href',    reason: 'dangerous-url' },
//   { kind: 'attr', name: 'onclick', reason: 'event-handler' },
// ]
```

## The inviolable safe baseline {#safe-baseline}

Even if your allow-list permits them, the baseline **always** strips `<script>`, `on*` event handlers, and `javascript:` / `vbscript:` / non-image `data:` URLs, mirroring the browser's native `setHTML()`. The only escape hatch is explicit and named to make that obvious:

```ts
s.sanitizeUnsafe(html); // skips the baseline (mirrors setHTMLUnsafe); the allow-list still applies
```

See the [security model](/security) for the full set of guarantees.

## Browser build (~3 KB) {#browser-build}

In the browser you don't need to ship an HTML parser, the platform already has one. The package's `browser` export condition automatically routes bundlers (Vite, esbuild, webpack, Rollup) to a build that parses with the native `DOMParser` and runs the **same** policy engine. Same `Sanitizer` API, **zero parser bytes**:

```ts
import { Sanitizer } from 'neosanitize'; // resolves to the browser build in a bundler
```

| Build | Min+gzip | Min+brotli | Notes |
| --- | ---: | ---: | --- |
| `.` browser | ~3.2 KB | **~2.9 KB** | native `DOMParser`, no bundled parser |
| `.` Node / default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |

Because parsing is the browser's own, the browser build is byte-for-byte what the user's browser would build, which closes parser-differential / mutation-XSS gaps by construction.
