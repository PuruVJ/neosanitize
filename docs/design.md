# neosanitize, Architecture & Design

> **Working name.** A zero-dependency HTML sanitizer shipped as **two entry points in one package**:
> `./legacy`, a byte-identical drop-in for `sanitize-html`; and `.` (main), a new, forward-looking,
> browser-faithful engine. They share **no runtime code**.

---

## 1. Vision & positioning

**One-liner: `/legacy` is faithful to `sanitize-html`; `.` (main) is faithful to the browser.**

| | `./legacy` | `.` (main) |
|---|---|---|
| What | byte-identical `sanitize-html` 2.17.5 port (today's code) | brand-new independent engine |
| Role | adoption bridge, change one import, output provably identical | the flagship; where the product evolves |
| Reach | universal (Node + browser), stable, frozen-but-for-parity-fixes | universal, deny-by-default, evolves freely (semver breaks OK) |
| Security argument | **safety-by-equivalence** (≈2.8M-case differential fuzz vs original) | **safety-by-construction** (own threat model + XSS corpus) |

**Competitive frame.** `/legacy` bridges *from* `sanitize-html`. Main competes with **DOMPurify** (the client-side gold standard) but on ground DOMPurify can't hold: **universal + zero-dep + server-first, with no jsdom.**

---

## 2. Competitive landscape & evidence

The deep-research pass (peer-reviewed security literature + primary sources, adversarially verified) confirms a **real, well-evidenced gap** on every axis. Summary of what each incumbent solves and doesn't:

| Library | Parser | Safe where | Default posture | Key gap (evidenced) |
|---|---|---|---|---|
| **DOMPurify** | borrows the **real browser DOM** | client only | deny-by-default | server needs **jsdom** → security *and* resource liability (below) |
| **sanitize-html** | htmlparser2 (custom, fast, lenient) | server-first | allow-list, permissive-ish | non-conformant parser → e.g. the `xmp` CVE below |
| **xss / js-xss** | custom | both | allow-list | ⚠ bundle/TS/tree-shaking under-verified, inspect before claiming |
| **hast-util-sanitize** | none (operates on hast) | both (in unified) | allow-list (gh schema) | coupled to rehype/unified pipeline; not standalone string→string |
| **insane / ultrahtml** | custom/minimal | both | varies | ⚠ specifics under-verified, inspect before claiming |
| **native Sanitizer API** | the browser itself | client only | **deny-by-default, inviolable safe path** | browser-only, **not** a W3C standard yet, no server story |

**The evidence that matters (verified, cited in §11):**

1. **mXSS is a *parsing differential*, and it's the dominant bypass class.** Cure53/CCS 2013 and Klein & Johns (IEEE S&P 2024) establish that sanitizers fail because *the sanitizer's idea of the HTML differs from the DOM the browser builds after serialize-then-reparse*, and "well-formed HTML is unambiguous" is **false**; only a browser-dependent subset survives the `innerHTML` round-trip. The WHATWG spec itself warns that serializing a fragment and re-parsing "will not return the original tree structure."
2. **The landscape is broadly bypassable.** The 2024 study automatically bypassed **all but two of 11 sanitizers** across five languages, **6 of 11 even in their restrictive default config.** Only `sanitize-html` and `loofah` survived the *differential-bypass* dimension.
3. **DOMPurify's server story is a documented liability** on two axes: **security**, updating DOMPurify doesn't update jsdom, and jsdom doesn't treat parsing differentials as security bugs, so bypasses persist (a real one hit Mozilla and Grafana); **resource**, a reproducible jsdom memory leak (heap ~87.5 MB→476.3 MB and latency ~0.32 ms→4.85 ms over 9k calls) the DOMPurify maintainer could not resolve.
4. **Even the "safe" incumbent had a parser-conformance XSS.** `sanitize-html ≤ 2.17.3` had a default-config `<xmp>` raw-text bypass (CVE-2026-44990), markup inside `xmp` (a WHATWG RAWTEXT element) re-emitted as live HTML. *Our `/legacy` track already fixes this* (it includes `xmp` in `RAW_TEXT_TAGS` and default `nonTextTags`, with a regression test citing the advisory).
5. **The native Sanitizer API defines the bar to match**: deny-by-default, and an **inviolable safe path**, `setHTML`/`parseHTML` strip XSS-unsafe markup *even if a developer allow-list permits it*; only the `*Unsafe` variants skip that. But it's browser-only and not yet standardized.

**Honest scope gap:** the per-library specifics for `xss`, `hast-util-sanitize`, `insane`, `ultrahtml` (bundle size, ESM, TS types, CSS/URL, tree-shaking) were **not independently verified** in this pass, fill them in by direct package inspection before publishing any survey table.

---

## 3. Architecture

- **One package, two entry points, zero shared runtime code.**
  ```jsonc
  "exports": {
    ".":        { "import": "./dist/index.mjs", "types": "./dist/index.d.mts" },
    "./legacy": { "import": "./dist/legacy/index.mjs", "types": "./dist/legacy/index.d.mts" }
  },
  "sideEffects": false
  ```
- **Independence is load-bearing.** `/legacy`'s value is "provably identical to the audited original", any main code leaking in breaks that guarantee; and main must be free of legacy's parity quirks. A CI test fails if `src/main/` ↔ `src/legacy/` ever cross-import.
- **Shared *spec data*, never shared *code*.** Both generate their entity table from `scripts/entities-whatwg.json` at build time, coupling to the WHATWG spec, not to each other.

```
src/
  legacy/index.ts     # today's code, moved here untouched
  main/index.ts       # new engine; imports NOTHING from ../legacy
test/  test/main/     # two independent suites
bench/                # 3-way: original vs legacy vs main
```

---

## 4. The main engine

### 4.1 Browser-faithful parser, necessary foundation (not a silver bullet)

**main's parser targets the browser's WHATWG HTML parser.** Matching it is the *necessary* foundation, it's what removes the parsing-differential that drives mXSS. Two corrections the research forced, both important:

- **The floor MUST be a full, single-pass tree-construction parser, streaming/SAX/regex cannot be the security floor.** Klein & Johns prove a stream parser can *never* be spec-compliant: operations like **foster parenting** rearrange already-emitted nodes (`<table><div><tbody>` → `<div></div><table><tbody>`), so a streaming parser would have to invalidate prior output. Accurate HTML parsing is only possible in a single pass with full tree construction. Streaming may be an **opt-in subpath export**, never the core.
- **Parser-faithfulness is necessary but NOT sufficient.** DOMPurify uses the *literal* browser DOM and was still bypassed repeatedly via **namespace/foreign-content confusion** (MathML/SVG integration points like `mtext`/`mglyph`) and re-contextualization. And `serialize → reparse` is provably non-idempotent; Chrome/Firefox/Safari parsers even differ from *each other*, so no static parser is byte-identical to every renderer. **So we target WHATWG conformance + defense-in-depth, and never market "mXSS solved."**

Concretely:
- **In-browser:** use native `DOMParser` (match-by-identity, and a builtin).
- **Node:** own single-pass WHATWG tree-construction parser (tokenizer states + ~20 insertion modes + adoption agency + **SVG/MathML foreign content** + **RAWTEXT** handling, the exact places bypasses live).
- **Has a hard oracle** (unlike the policy layer): html5lib-tests + headless `DOMParser` differential. `parse5` is the feasibility reference.

### 4.2 Defense-in-depth (the second layer parser-parity requires)

Because parser-parity alone can't be sufficient:
- **Prefer DOM/fragment output over a string** where possible, returning a `DocumentFragment` avoids the dangerous `serialize→reparse` round-trip entirely (this is *the* strongest mitigation).
- **Reparse-stability guard**: for string output, optionally re-parse the result and diff the tree; instability = reject or report. Cheap, and it catches mutations parity misses.
- **Inviolable unsafe-baseline** (see §5) so the policy layer can never re-introduce known-unsafe constructs.

### 4.3 Builtins-first, spec-compliant fallback

| Concern | Builtin (preferred) | Fallback (no universal builtin) |
|---|---|---|
| URL/scheme/host | **`URL` / `URL.canParse`** (universal) |, |
| HTML parse | `DOMParser` (browser) | own single-pass WHATWG parser (Node) |
| CSS | CSSOM (browser) | own CSS-Syntax-L3 parser |
| Sanitize hardening | native Sanitizer API (browser, optional defense-in-depth) |, |
| Encoding | `TextEncoder/Decoder` (universal) |, |

---

## 5. Feature set (on top of perf & correctness)

### v1, must-have (tight, safe, differentiated)

A sanitizer's v1 must be **safe before featureful**.

- **Full single-pass WHATWG tree-construction parser** (native in browser; conformant own in Node), the only mandatory floor.
- **Deny-by-default engine** with an **inviolable always-unsafe baseline**, even if a developer allow-lists `<script>`/`onclick`/`javascript:`, the baseline still strips it; an explicit `sanitizeUnsafe()` (mirroring `setHTMLUnsafe`) is the only escape hatch. This kills the #1 misconfiguration footgun.
- **Correct foreign-content (SVG/MathML) + RAWTEXT (`xmp`/`style`/`textarea`/…) handling**, where real bypasses live.
- Curated **presets**: `none` (text), `basic`, `ugc`, `markdown`.
- **Typed core API**: `sanitize(html, policy)` + a `Sanitizer` builder.
- **URL safety** via native `URL`.
- **CSS**: conservative safe-subset allow-list (off by default, opt-in).
- **Output targets**: `string` (default), **`DocumentFragment`** (round-trip-free, safest), plain `text`, `TrustedHTML`.
- **Report mode (basic)**, `{ html, removed: [{ kind, name, reason }] }`. Headline transparency feature.
- **Safety extras**: auto-`rel="noopener noreferrer"` on `target=_blank`; nesting/size **DoS limits**.
- **Verification harness** (makes v1 *trustworthy*, non-negotiable): html5lib-tests, headless-browser differential fuzz, **XSS/mXSS corpus** (cure53/PortSwigger/OWASP), idempotence + reparse-stability.

### Later (v1.x / v2)

- Built-in transforms (`url.rewrite()`, `link.external()`, `proxyImages()`); preset `extend`/compose; `email` + editor-output presets (TipTap/ProseMirror/Quill/Lexical).
- **Streaming** via a Web-Streams `TransformStream`, **opt-in subpath only, never the floor.**
- Per-category disposition (strip / escape / keep-text / **throw**); rich report (line/col), `onRemoved` telemetry, `isClean()` / `diff()`.
- Native Sanitizer API defense-in-depth; CSSOM fast-path in-browser.
- **No first-party framework packages** (decided): `sanitize()` is already a one-liner in `{@html}`/`dangerouslySetInnerHTML`/`v-html`, so per-framework wrappers are pure sugar + maintenance tax. Instead, make DOM/fragment output first-class in core and *document* the framework patterns, especially the round-trip-free fragment path (a ~5-line action/ref), which is *safer* than `{@html sanitize(x)}` because it skips the serialize→reparse step.

### Honest positioning

Table stakes (DOMPurify has these, *not* the wedge): output targets, hooks, TrustedTypes.
Genuine differentiation vs *both* incumbents: **true isomorphism with zero deps (no jsdom), report mode, curated/versioned presets, the typed composable API, the inviolable baseline, and streaming.**

---

## 6. Tree-shakeability architecture (pay-for-what-you-use)

The resolution of "comprehensive *and* small": **comprehensive in capability, minimal in what you bundle.** DOMPurify is monolithic; you won't be.

- **`"sideEffects": false`** + pure, side-effect-free modules so bundlers drop everything unused.
- **The parser is the only floor.** Everything above it is droppable: each preset, the CSS engine, URL-rewriting, report mode, streaming, transforms.
- **Subpath exports** so consumers pull only what they import:
  ```
  neosanitize                 # core engine + sanitize()
  neosanitize/presets         # all curated presets (import * as presets)
  neosanitize/css             # CSS allow-list engine (sizable, opt-in)
  neosanitize/url             # URL-rewrite/link policies
  neosanitize/report          # removal tracking
  neosanitize/stream          # Web-Streams wrapper
  ```
- **Functional, opt-in features**: report/CSS/url-rewrite are functions you import and pass into a policy, never referenced unless used, so the bundler omits them.
- **Target:** a strict `sanitize(html, presets.none)` pulls in *parser + minimal policy only*, no CSS, no URL-rewrite, no report, no streaming, no other presets.

---

## 7. Security model

- **Grounded in the literature** (not vibes): the threat model is parsing-differential / mXSS (Cure53 2013; Klein & Johns 2024), namespace/foreign-content confusion (PortSwigger; Sonar mXSS cheatsheet), RAWTEXT mishandling (sanitize-html `xmp` CVE), URL/scheme injection, CSS injection, and DoS.
- **Deny-by-default + inviolable unsafe-baseline** (mirrors the native `setHTML` safe path).
- **Necessary-but-not-sufficient discipline**: parser-parity is the foundation; it is *paired* with defense-in-depth (DOM-output, reparse-stability, baseline), never sold as a complete cure.
- **Invariants, verified not asserted**: idempotence (`sanitize∘sanitize = sanitize`) and reparse-stability.
- The **policy layer has no oracle**, its proof is the threat model + XSS corpus.

---

## 8. Verification strategy (how every claim is proven)

| Claim | Proof |
|---|---|
| Parser conformance | **html5lib-tests** + headless **`DOMParser`** differential fuzz (mirror the ~2.8M-case `/legacy` method) |
| Safety | **mXSS/XSS corpus** (cure53, PortSwigger, OWASP, DOMPurify suite) as CI gate + idempotence + reparse-stability |
| Correctness (URL/CSS/entities) | spec conformance suites (WHATWG URL, CSS-Syntax, WHATWG named refs) |
| Speed | **3-way bench** (original vs legacy vs main), Node *and* browser |
| Independence | import-boundary CI test |
| No server leak | long-running soak test (vs the documented jsdom growth) |

---

## 9. Decisions log

- **2026-06-21**, Publish dual-track (`/legacy` + `.` main), neotraverse-style, **no shared runtime code**.
- **2026-06-21**, `/legacy` = current code (frozen-but-for-parity-fixes). `.` main = new, independent, breaks-allowed.
- **2026-06-21**, main target = **"Universal own engine"** (runs in Node too; builtins where they help; own portable parser).
- **2026-06-21**, main's parser must match the browser's WHATWG parser **and be full single-pass tree-construction** (streaming can't be the floor, Klein & Johns 2024).
- **2026-06-21**, Adopt **inviolable unsafe-baseline** (allow-lists can't re-introduce known-unsafe) + **DOM-output/reparse-stability defense-in-depth**, because parser-parity is necessary-not-sufficient.

## 10. Open questions

- **Browser parse path**: native `DOMParser` (match-by-identity, two code paths) vs own-parser-everywhere (one path, simpler consistency)?
- **Conformance target**: html5lib-tests + headless-browser differential, accept WHATWG conformance (not bit-for-bit to any single engine, which is impossible)?
- **Second defense layer**: make `DocumentFragment` output the recommended default (no reparse) and string output the convenience? Add a post-sanitize reparse-diff in report mode?
- **Is there a zero-dep single-pass WHATWG *tree-construction* reference to model against** (parse5's algorithm port) or is it from scratch?
- Per-competitor matrix gaps (`xss`, `hast-util-sanitize`, `insane`, `ultrahtml`), verify by direct package inspection.
- npm name; publish prereqs: **MIT attribution** for `sanitize-html` (vendored tests), `SECURITY.md` + disclosure, measured bundle-size delta.

## 11. Roadmap / sequencing

1. **Design doc** (this) ✓
2. **Scaffold** the split, move `src/index.ts` → `./legacy`, add `.` skeleton, two build targets, import-boundary guard, 3-way bench. (No behavior change; current 216 tests stay green.)
3. **Parser**, single-pass WHATWG tree construction, built against html5lib-tests + `DOMParser` differential.
4. **Deny-by-default core + inviolable baseline + presets + typed API.**
5. **URL / CSS / report mode / DoS limits / DOM-output + reparse-stability.**
6. **Verification harness** (mXSS corpus, invariants) in CI.
7. Later features per §5.

## 12. Sources (verified)

- Heiderich et al., *mXSS Attacks* (Cure53 / ACM CCS 2013), https://cure53.de/fp170.pdf
- Klein & Johns, *Parse Me, Baby, One More Time: Bypassing HTML Sanitizers via Parsing Differentials* (IEEE S&P 2024), https://www.ias.cs.tu-bs.de/publications/parsing_differentials.pdf
- WHATWG HTML, serializing fragments warning, https://html.spec.whatwg.org/multipage/parsing.html#serializing-html-fragments
- PortSwigger, *Bypassing DOMPurify again with mutation XSS*, https://portswigger.net/research/bypassing-dompurify-again-with-mutation-xss
- Sonar, mXSS cheatsheet, https://sonarsource.github.io/mxss-cheatsheet/explained/
- sanitize-html `xmp` advisory CVE-2026-44990, https://github.com/apostrophecms/apostrophe/security/advisories/GHSA-rpr9-rxv7-x643
- DOMPurify + jsdom memory leak (maintainer-unresolved), https://github.com/cure53/DOMPurify/issues/1089
- isomorphic-dompurify leak + clearWindow workaround, https://github.com/kkomelin/isomorphic-dompurify/issues/368
- MDN, Sanitizer interface / `setHTML`, https://developer.mozilla.org/en-US/docs/Web/API/Sanitizer
- WICG, HTML Sanitizer API spec (not a W3C standard), https://wicg.github.io/sanitizer-api/
