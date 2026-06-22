# Legacy — `neosanitize/legacy`

`neosanitize/legacy` is a **byte-identical, drop-in port of [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) 2.x** — same function signature, same options, same output. It exists so you can migrate off `sanitize-html` (and its `htmlparser2` + `postcss` dependency tree) **with no behaviour change**, then adopt the [main engine](/sanitizing) at your own pace.

```ts
import sanitize from 'neosanitize/legacy';

sanitize('<img src=x onerror=alert(1) />', {
  allowedTags: ['img'],
  allowedAttributes: { img: ['src'] },
});
// → '<img src="x" />'  (exactly what sanitize-html produces)
```

## A true drop-in

The export is the **default function**, so both module systems get the sanitize function directly — no `.default`, no interop shim:

```ts
import sanitize from 'neosanitize/legacy'; // ESM
const sanitize = require('neosanitize/legacy'); // CommonJS — IS the function
```

To migrate an existing codebase, the import is usually the only line that changes:

```diff
- import sanitize from 'sanitize-html';
+ import sanitize from 'neosanitize/legacy';
```

The full `sanitize-html` options surface is supported — `allowedTags`, `allowedAttributes`, `allowedClasses`, `allowedSchemes`, `allowedSchemesByTag`, `transformTags`, `exclusiveFilter`, `textFilter`, `nonTextTags`, `selfClosing`, `parser`, and the rest — with the same defaults.

## Why it matches

The port is verified against the original `sanitize-html` itself with a **differential fuzzer**: millions of randomly generated inputs run through both implementations, and the outputs must be byte-identical. The corpora include the original's own test suite plus adversarial XSS, malformed-markup, entity, CSS, and URL cases. Any divergence is tracked as a fixture under `test/fixtures/*-known-divergences.json`.

> Because it mirrors `sanitize-html` exactly, the legacy engine's **security posture and configuration responsibilities are those of `sanitize-html`** — it is frozen to that behaviour by design. For deny-by-default safety and a browser-faithful parse, use the [main engine](/sanitizing).

## Zero dependencies — what we replaced

The original `sanitize-html` pulls in three parsers. The legacy port reimplements each **inline, with no runtime dependency**:

| Original dependency | What it does there | Our replacement |
| --- | --- | --- |
| `htmlparser2` | tokenizes the HTML | a faithful hand-written tokenizer + entity decoder |
| `parse-srcset` | parses `srcset` / `imagesrcset` values | a line-for-line port of its state machine |
| `postcss` | parses the `style` attribute for `allowedStyles` | a hand-written flat-declaration parser |

### About `postcss` and the `style` attribute

It's worth being explicit about `postcss`, because it's the heaviest of the three and the most commonly misunderstood. In `sanitize-html`, postcss is **not** part of HTML parsing or security — it exists solely to power `allowedStyles`. For each `style` attribute it parses a synthetic rule and filters the declarations against your allowlist:

```js
// what sanitize-html does internally:
const ast = postcssParse(name + ' {' + value + '}');   // e.g. parse `p {color:red;width:10px}`
const filtered = filterCss(ast, options.allowedStyles); // keep only allowed properties
value = stringifyStyleAttributes(filtered);             // re-serialize
```

A real inline style is always a **flat list of declarations** (`color: red; width: 10px`), so a full stylesheet parser is overkill. We parse that list directly — byte-identical output on every realistic style, and two concrete wins:

- **`allowedStyles` works in the browser.** The original's postcss path is Node-only; `sanitize-html` itself [warns](https://github.com/apostrophecms/sanitize-html/issues/547) that style parsing "only works in a node environment due to a postcss dependency." Our port has no such limitation.
- **No ~90 KB of CSS-tooling** in your bundle just to allowlist a handful of properties.

The **only** observable differences are on *degenerate* input that never occurs in a real `style` attribute — whole stylesheets, `@media` / `@charset` blocks, nested `{}` rules, or IE hacks crammed into one attribute. Because postcss is a full stylesheet parser, on such junk it builds rule/at-rule nodes and `sanitize-html` emits quirky output like `style="undefined:undefined"`; we simply drop the unparseable value. These cases are catalogued in `test/fixtures/postcss-known-divergences.json`, and the differential fuzzer guards every *realistic* style for exact parity.

## When to use which

| | `neosanitize` (main) | `neosanitize/legacy` |
| --- | --- | --- |
| **Use when** | new code; you want speed, a browser-faithful parse, deny-by-default | dropping in for an existing `sanitize-html` install |
| **API** | class-only `Sanitizer` builder | functional `sanitize(html, options)` |
| **Parser** | own WHATWG parser (matches the browser) | `htmlparser2` semantics (matches `sanitize-html`) |
| **Stability** | evolves (semver) | frozen to `sanitize-html`'s behaviour |

The two share **no runtime code** — importing one never pulls in the other.
