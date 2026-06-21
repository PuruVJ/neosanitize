# Performance

neosanitize ships two engines, and **both are faster than the original `sanitize-html`**:

- **`modern`** — the default `import { Sanitizer } from 'neosanitize'`. A full, browser-faithful WHATWG parse + tree construction, deny-by-default. **~2.3× faster** than sanitize-html.
- **`legacy`** — `import sanitize from 'neosanitize/legacy'`. A lean, `htmlparser2`-style streaming port that's byte-identical to sanitize-html. **~2.7× faster** than sanitize-html.

The policy compiles once in the constructor, so every `sanitize()` call is just **parse → walk → serialize**.

## Three-way throughput

Run it yourself with `pnpm bench:3way` — the original `sanitize-html` vs `neosanitize/legacy` vs `neosanitize` (modern) — over a 13-scenario corpus. Numbers are **ops/sec, higher is better**:

| Scenario | Input | `sanitize-html` | `legacy` | `modern` |
| --- | ---: | ---: | ---: | ---: |
| simple-comment | 0.1 KB | 149,055 | 805,329 | 452,567 |
| blog-post | 5.6 KB | 5,571 | 16,737 | 11,353 |
| large-document | 113 KB | 274 | 834 | 561 |
| xss-attack | 19 KB | 2,022 | 4,745 | 5,095 |
| attribute-filtering | 28 KB | 1,492 | 2,906 | 3,695 |
| url-scheme-filter | 21 KB | 1,631 | 4,260 | 3,755 |
| style-filtering | 20 KB | 1,956 | 3,330 | 4,400 |
| transform-tags | 10 KB | 3,146 | 9,690 | 6,555 |
| escape-mode | 15 KB | 2,321 | 5,930 | 6,281 |
| passthrough | 28 KB | 1,104 | 3,208 | 2,318 |
| entity-heavy | 24 KB | 973 | 5,149 | 3,600 |
| big-table | 36 KB | 1,133 | 2,241 | 2,822 |
| deeply-nested | 5.9 KB | 4,252 | 8,354 | 4,266 |
| **geomean vs sanitize-html** | | **1.00×** | **2.75×** | **2.28×** |

> Node 24 on an Apple-silicon laptop, [tinybench](https://github.com/tinylibs/tinybench). Throughput is relative — your absolute ops/sec will differ, but the ratios hold.

**How to read it:**

- **`legacy` is the fastest overall** — geomean **2.75×** the original, and a drop-in replacement with byte-identical output. If you're migrating off `sanitize-html` purely for speed (and its `htmlparser2` + `postcss` dependency tree), this is the one.
- **`modern` is ~2.3×** the original *while* doing a full WHATWG-conformant parse + tree construction — the work that makes it byte-for-byte match a browser and close mutation-XSS gaps by construction. On the **heavy and adversarial inputs a sanitizer exists for** — XSS payloads (1.07×), attribute-dense markup (1.27×), big tables (1.26×), `style` filtering (1.32×), entity-escaping (1.06×) — it now **matches or beats `legacy`**, despite building the full tree.
- **Where `modern` trails `legacy`** is benign prose and tiny documents (blog-post ~0.7×, a one-line comment ~0.6×): there the tree has a fixed setup cost that streaming avoids, and throughput is already 10k–450k ops/sec, so it never matters in practice. The widest gap, `deeply-nested` (~0.5×), is a 250-level nested-`<div>` torture test — the spec's "element in scope" checks are inherently super-linear, and real HTML is shallow.

## Where the speed comes from

The modern engine went through a dedicated optimization pass driven by profiling and a tokenize-vs-build-vs-serialize time split (which showed tokenization dominates, and that the engine is **not** GC-bound — collection is ~1% of runtime):

- **Bulk text-run emission** — the tokenizer scans each run of text/raw-text to the next boundary character and appends it as a single slice, instead of a state-machine step per character.
- **Bulk tag- and attribute-scanning** — attribute *values* are sliced verbatim; tag and attribute *names* are sliced then ASCII-folded only when an uppercase letter was actually seen during the scan.
- **A two-slot emit queue** — the tokenizer emits tokens through two scalar fields instead of an array used as a FIFO. Removing the `Array.prototype.shift()` on the per-token hot path lifted raw tokenization throughput by **~35%**, the single biggest win of the pass.
- **A named-character-reference trie** — entity decoding walks a code-unit trie instead of rebuilding and re-hashing a growing string per character. This roughly **doubled** entity-heavy throughput (3.9× the original, up from 2.4×).
- **A `dangerousUrl` fast path** — clean ASCII URL schemes are decided by a string compare; the native `URL` parser is only constructed for genuinely obfuscated values (which is provably safe).
- **Per-token sync elision** — the parse loop re-syncs the tokenizer's foreign-content flag only when the open-element stack's top actually changes, not on every character token.
- **Allocation cuts** — attribute lists are taken from the tokenizer directly (no redundant de-dup copy), attribute filtering returns the original array when nothing changes, transient token objects are reused, and the serializer walks children with index loops (no per-element iterator).
- **Compile-once policy** — the allow-list resolves into fast lookup structures in the `Sanitizer` constructor, reused across every call.

## Bundle size

| Build | Min+gzip | Min+brotli | Notes |
| --- | ---: | ---: | --- |
| `modern`, browser | ~3.2 KB | **~2.9 KB** | native `DOMParser`, no bundled parser |
| `modern`, Node / default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |
| `legacy` | ~21 KB | ~18 KB | single-file `sanitize-html` port |

The browser build reuses the platform's own parser, so it ships **zero parser bytes** — about an 8× reduction over the bundled-parser build.
