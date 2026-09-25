---
layout: home

hero:
  name: neosanitize
  text: The browser-faithful HTML sanitizer
  tagline: "Zero dependencies. A WHATWG parser that matches the browser, deny-by-default behind an inviolable safe baseline, ~2.3× faster than sanitize-html and ~3 KB in the browser. Plus a byte-identical drop-in for sanitize-html."
  image:
    src: /logo.svg
    alt: neosanitize
  actions:
    - theme: brand
      text: Get started
      link: /guide
    - theme: alt
      text: Performance
      link: /performance
    - theme: alt
      text: Security model
      link: /security

features:
  - icon: 🌐
    title: Browser-faithful parse
    details: "A WHATWG/HTML5 tokenizer at 100% html5lib conformance. The tree you sanitize is the tree a browser builds, which closes parser-differential and mutation-XSS gaps by construction."
  - icon: 🔒
    title: Deny-by-default
    details: "Only the tags and attributes you allow-list survive. Behind them sits an inviolable baseline that strips scripts, on* handlers and javascript:/data: URLs even when your policy permits them."
  - icon: ⚡
    title: ~2.3× faster
    details: "Geomean 2.3× the throughput of the original sanitize-html across a 13-scenario benchmark. The policy compiles once; every call is just parse, walk, serialize."
  - icon: 🤏
    title: ~3 KB in the browser
    details: "The browser build parses with the platform's own native DOMParser, so it ships zero parser bytes, about 3 KB brotli versus ~23 KB for the bundled-parser build."
  - icon: 🧩
    title: Tree-shakeable, zero-dep
    details: "ESM, side-effect-free, with subpath exports for the curated presets. No runtime dependencies, ever."
  - icon: 🔁
    title: Drop-in legacy
    details: "./legacy is a byte-identical re-implementation of sanitize-html 2.x, same API, same output, verified with millions of differential-fuzz cases. Migrate with no behaviour change."
    link: /guide#which-engine
---

<div class="shts-stats">
  <div class="shts-stat">
    <div class="shts-stat__value">2.3×</div>
    <div class="shts-stat__label"><strong>faster</strong> than sanitize-html (geomean, 13 scenarios)</div>
  </div>
  <div class="shts-stat">
    <div class="shts-stat__value">~3 KB</div>
    <div class="shts-stat__label"><strong>browser build</strong>, brotli, zero parser bytes</div>
  </div>
  <div class="shts-stat">
    <div class="shts-stat__value">100%</div>
    <div class="shts-stat__label"><strong>html5lib</strong> tokenizer conformance (6946/6946)</div>
  </div>
  <div class="shts-stat">
    <div class="shts-stat__value">0</div>
    <div class="shts-stat__label"><strong>mXSS holes</strong> across a 20,000-case adversarial fuzz</div>
  </div>
</div>

## Build a sanitizer, then sanitize

The API is **class-only by design**, you build a `Sanitizer` with an explicit policy and reuse it. There is deliberately no one-shot `sanitize(html)`: forcing an explicit policy means no implicit global default to misconfigure, and the policy compiles **once** so calls stay cheap.

```ts
import { Sanitizer } from 'neosanitize';
import * as presets from 'neosanitize/presets';

// Build once (compiles the policy), reuse everywhere.
const sanitizer = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

sanitizer.sanitize('<p>hi <img src=x onerror=alert(1)> <script>bad()</script></p>');
// → '<p>hi <img src="x"> </p>'
//   the onerror handler is stripped, <script> is dropped with its content.
```

## The inviolable safe baseline

Even if your allow-list permits them, the baseline **always** strips known-dangerous constructs, mirroring the browser's native `setHTML()`. An allow-list can never re-introduce them; only the explicit `sanitizeUnsafe()` opts out.

```ts
const s = Sanitizer.builder().allow('a', ['href', 'onclick']).build();

s.sanitize('<a href="javascript:alert(1)" onclick="x()">click</a>');
// → '<a>click</a>'   ← javascript: URL and on* handler stripped despite being allow-listed
```

Want to know exactly what was removed and why? Use **report mode**:

```ts
const { html, removed } = s.sanitizeWithReport('<a href=javascript:alert(1) onclick=x>y</a>');
// html    → '<a>y</a>'
// removed → [
//   { kind: 'url',  name: 'href',    reason: 'dangerous-url'  },
//   { kind: 'attr', name: 'onclick', reason: 'event-handler'  },
// ]
```

## Two engines, one package

```ts
// The new engine, browser-faithful WHATWG parser, deny-by-default:
import { Sanitizer } from 'neosanitize';

// A byte-identical drop-in for sanitize-html 2.x, same API, same output:
import sanitize from 'neosanitize/legacy';
sanitize('<img src=x onerror=alert(1) />', { allowedTags: ['img'], allowedAttributes: { img: ['src'] } });
// → '<img src="x" />'   (exactly what sanitize-html produces)
```

## Performance

**Both** engines are faster than the original `sanitize-html`, `legacy` (a byte-identical streaming drop-in) and `modern` (the default, browser-faithful WHATWG engine). Throughput in ops/sec, higher is better (`pnpm bench:3way`):

| Scenario | `sanitize-html` | `legacy` | `modern` |
| --- | ---: | ---: | ---: |
| xss-attack | 2,022 | 4,745 | 5,095 |
| entity-heavy | 973 | 5,149 | 3,600 |
| attribute-filtering | 1,492 | 2,906 | 3,695 |
| style-filtering | 1,956 | 3,330 | 4,400 |
| large-document (113 KB) | 274 | 834 | 561 |
| **geomean (13 scenarios)** | **1.00×** | **2.75×** | **2.28×** |

`legacy` is the fastest (a lean `htmlparser2`-style port, same output as sanitize-html); `modern` is ~2.3× the original *while* doing a full WHATWG parse + tree construction, the price of browser-faithfulness. See the [full performance page](/performance).

## Bundle size

| Build | Min+gzip | Min+brotli | Notes |
| --- | ---: | ---: | --- |
| `modern`, browser | ~3.2 KB | **~2.9 KB** | native `DOMParser`, no bundled parser |
| `modern`, Node / default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |
| `legacy` | ~21 KB | ~18 KB | single-file `sanitize-html` port |

> Zero runtime dependencies. ESM. `sideEffects: false` with subpath exports, you ship only what you import.
