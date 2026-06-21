# Security model

**Goal:** given untrusted HTML, produce output that is safe to insert into a trusted page — no script execution, no event handlers, no dangerous-scheme URLs — while preserving the markup you explicitly allow.

## Four guarantees (main engine)

1. **Deny-by-default.** Only allow-listed tags/attributes survive; everything else is dropped or unwrapped.
2. **Inviolable baseline.** `<script>`, `on*` handlers, and dangerous-scheme URLs are stripped *even when the allow-list permits them*. Only `sanitizeUnsafe()` bypasses this — and even then the allow-list still applies.
3. **Browser-faithful parse.** The tree we sanitize is the tree a browser builds (100% html5lib tokenizer conformance), so there is no parser-differential gap for an attacker to exploit between sanitize-time and render-time.
4. **Reparse-stable output.** Sanitized output converges to a safe fixed point; re-parsing it does not resurrect dangerous constructs. This is continuously fuzz-tested — **20,000+ adversarial inputs, zero bypasses.**

## Parser conformance & known divergences

The tokenizer passes **100%** of the html5lib tokenizer suite (6946/6946). Tree construction passes **~95.6%** of the html5lib tree-construction suite (ratcheted upward over time). The remaining divergences are all in *degenerate* constructs:

- **Pathological adoption-agency cases** — deeply misnested formatting elements interleaved with tables and `<nobr>` (e.g. `<b><nobr>1<table><nobr></b>…`), the gnarliest corner of the spec's reconstruction algorithm.
- **Bleeding-edge `<select>` parsing** — a couple of nested-`<select>`-with-formatting edge cases from the in-progress customizable-`<select>` spec changes.
- A handful of foreign-content / DOCTYPE-serialization edge cases.

None of these affect sanitization safety: on **every** such input the output is still safe and reparse-stable (verified by the fuzz). They are tree-*shape* differences on inputs no real document contains, not security gaps. If you have an input where the sanitized output is unsafe, that's a vulnerability — please report it (below).

## In scope

- Script execution via `<script>`, `on*` handlers, `javascript:` / `vbscript:` URLs, and non-image `data:` URLs.
- **mutation-XSS / parser differentials** — output that is inert when *we* parse it but becomes dangerous when a *browser* re-parses it. The parser is verified against html5lib to match the browser, and output is fuzzed for reparse-stability.
- CSS-vector injection via the `style` attribute (`expression()`, `url(javascript:)`, `behavior`, `-moz-binding`).
- Scheme obfuscation in URLs (embedded tabs/newlines, control characters, mixed case, entity encoding) — resolved with the platform URL parser, matching the browser.

## Out of scope

- Anything you opt into with `sanitizeUnsafe()` / `allowUnsafe: true`. That deliberately disables the baseline; you own the result.
- Content correctness/styling, DoS from pathologically large input, and the security of *how* you insert the output (e.g. into an attribute or `<script>` context rather than as element content).
- The `./legacy` engine's posture is, by design, **exactly** `sanitize-html`'s — it is a faithful port, so its security characteristics and configuration responsibilities are those of `sanitize-html`.

## The strongest path: build a fragment

The string output is safe, but the very strongest path skips serialization entirely. In the browser, `sanitizeToFragment()` builds DOM nodes directly from the sanitized tree — there is no serialize → re-parse round trip to worry about:

```ts
const frag = sanitizer.sanitizeToFragment(untrustedHtml);
container.replaceChildren(frag);
```

## Reporting a vulnerability

If you believe you've found a way to get a dangerous construct through the sanitizer in its default configuration, please report it **privately** (a GitHub security advisory, or email the maintainer with `[security]` in the subject) — not in a public issue. Include the input, the configuration, the observed output, and why it's exploitable.

A "vulnerability" is output that, when inserted into a page and parsed by a browser, executes script or navigates to a dangerous scheme **despite the inviolable baseline** (i.e. without `sanitizeUnsafe()` / `allowUnsafe`). Allowing something your own allow-list explicitly permits is not a vulnerability.
