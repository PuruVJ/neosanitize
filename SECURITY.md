# Security policy

## Reporting a vulnerability

If you believe you've found a way to get a dangerous construct (script execution,
event handler, or dangerous-scheme navigation) through a sanitizer in its default
configuration, please report it **privately**:

- Open a private GitHub **security advisory** on this repository (Security →
  Advisories → "Report a vulnerability"), preferred, or
- email the maintainer at **devpuruvj@gmail.com** with `[security]` in the subject.

Please include the input, the configuration (preset / allow-list), the observed
output, and why it is exploitable. We aim to acknowledge within a few days and to
ship a fix before any public disclosure. Please do not open a public issue for an
unfixed vulnerability.

A "vulnerability" is output that, when inserted into a page and parsed by a
browser, executes script or navigates to a dangerous scheme **despite the
inviolable baseline** (i.e. without `sanitizeUnsafe()` / `allowUnsafe`). Allowing
something your own allow-list explicitly permits is not a vulnerability.

## Threat model

**Goal:** given untrusted HTML, produce output that is safe to insert into a
trusted page — no script execution, no event handlers, no dangerous-scheme URLs —
while preserving the markup you explicitly allow.

**In scope**

- Script execution via `<script>`, `on*` handlers, `javascript:` / `vbscript:`
  URLs, and non-image `data:` URLs.
- **mutation-XSS / parser differentials** — output that is inert when *we* parse it
  but becomes dangerous when a *browser* re-parses it. The main engine's parser is
  verified against the html5lib suite to match the browser, and sanitized output
  is fuzzed for reparse-stability.
- CSS-vector injection via the `style` attribute (`expression()`, `url(javascript:)`,
  `behavior`, `-moz-binding`).
- Scheme obfuscation in URLs (embedded tabs/newlines, control characters, mixed
  case, entity encoding) — resolved with the platform URL parser, matching the
  browser.

**Out of scope**

- Anything you opt into with `sanitizeUnsafe()` / `allowUnsafe: true`. That
  deliberately disables the baseline; you own the result.
- Content correctness/styling, DoS from pathologically large input, and the
  security of how *you* insert the output (e.g. inserting into an attribute or a
  `<script>` context rather than as element content).
- The `./legacy` engine's posture is, by design, **exactly** `sanitize-html`'s — it
  is a faithful port, so its security characteristics (and configuration
  responsibilities) are those of `sanitize-html`. New deny-by-default guarantees
  apply to the main (`.`) engine.

## Design guarantees (main engine)

1. **Deny-by-default.** Only allow-listed tags/attributes survive; everything else
   is dropped or unwrapped.
2. **Inviolable baseline.** `<script>`, `on*` handlers, and dangerous-scheme URLs
   are stripped *even when the allow-list permits them*. Only `sanitizeUnsafe()`
   bypasses this — and even then the allow-list still applies.
3. **Browser-faithful parse.** The tree we sanitize is the tree a browser builds
   (100% html5lib tokenizer conformance), so there is no parser-differential gap
   for an attacker to exploit between sanitize-time and render-time.
4. **Reparse-stable output.** Sanitized output converges to a safe fixed point;
   re-parsing it does not resurrect dangerous constructs. This is continuously
   fuzz-tested (20,000+ adversarial inputs, zero bypasses).

## Supported versions

This project is pre-1.0 and evolving; security fixes target the latest published
version. Pin a version and watch releases for advisories.
