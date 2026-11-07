<script setup>
import EngineBench from './.vitepress/theme/components/EngineBench.vue';
import AdapterBench from './.vitepress/theme/components/AdapterBench.vue';
</script>

# Performance

neosanitize ships two engines, and **both are faster than the original `sanitize-html`**:

- **`modern`**, the default `import { Sanitizer } from 'neosanitize'`. A full, browser-faithful WHATWG parse + tree construction, deny-by-default. **~2.3× faster** than sanitize-html.
- **`legacy`**, `import sanitize from 'neosanitize/legacy'`. A lean, `htmlparser2`-style streaming port that's byte-identical to sanitize-html. **~2.7× faster** than sanitize-html.

The policy compiles once in the constructor, so every `sanitize()` call is just **parse → walk → serialize**.

## Engine throughput

The original `sanitize-html` vs `neosanitize/legacy` vs `neosanitize` (modern), over a 13-scenario corpus, **higher is better**. Run it yourself with `pnpm bench:3way`.

<EngineBench />

**How to read it:**

- **`legacy` is the fastest overall**, geomean **2.75×** the original, and a drop-in replacement with byte-identical output. If you're migrating off `sanitize-html` purely for speed (and its `htmlparser2` + `postcss` dependency tree), this is the one.
- **`modern` is ~2.3×** the original *while* doing a full WHATWG-conformant parse + tree construction, the work that makes it byte-for-byte match a browser and close mutation-XSS gaps by construction. On the **heavy and adversarial inputs a sanitizer exists for**, XSS payloads, attribute-dense markup, big tables, `style` filtering, entity-escaping, it **matches or beats `legacy`**, despite building the full tree.
- **Where `modern` trails `legacy`** is benign prose and tiny documents: there the tree has a fixed setup cost that streaming avoids, and throughput is already 10k-450k ops/sec, so it never matters in practice. The widest gap, `deeply-nested`, is a 250-level nested-`<div>` torture test, the spec's "element in scope" checks are inherently super-linear, and real HTML is shallow.

## Parser adapters

The main engine's parser is [pluggable](/adapters). By default it uses our bundled WHATWG parser; you can swap in [`parse5`](/adapters/parse5) (reference-grade, 100% spec) or [`htmlparser2`](/adapters/htmlparser2) (fast & lenient). This is the **same `Sanitizer`** over each, only the parse step changes, so it isolates parser cost:

<AdapterBench />

Our bundled parser is the fastest on nearly every workload; `htmlparser2` is close (and wins on pathologically deep nesting); `parse5` trades throughput for full spec conformance. Pick the default unless you specifically need one of those properties.

## Where the speed comes from

The modern engine went through a dedicated optimization pass driven by profiling and a tokenize-vs-build-vs-serialize time split (which showed tokenization dominates, and that the engine is **not** GC-bound, collection is ~1% of runtime):

- **Bulk text-run emission**, the tokenizer scans each run of text/raw-text to the next boundary character and appends it as a single slice, instead of a state-machine step per character.
- **Bulk tag- and attribute-scanning**, attribute *values* are sliced verbatim; tag and attribute *names* are sliced then ASCII-folded only when an uppercase letter was actually seen during the scan.
- **A two-slot emit queue**, the tokenizer emits tokens through two scalar fields instead of an array used as a FIFO. Removing the `Array.prototype.shift()` on the per-token hot path lifted raw tokenization throughput by **~35%**, the single biggest win of the pass.
- **A named-character-reference trie**, entity decoding walks a code-unit trie instead of rebuilding and re-hashing a growing string per character. This roughly **doubled** entity-heavy throughput (3.9× the original, up from 2.4×).
- **A `dangerousUrl` fast path**, clean ASCII URL schemes are decided by a string compare; the native `URL` parser is only constructed for genuinely obfuscated values (which is provably safe).
- **Per-token sync elision**, the parse loop re-syncs the tokenizer's foreign-content flag only when the open-element stack's top actually changes, not on every character token.
- **Allocation cuts**, attribute lists are taken from the tokenizer directly (no redundant de-dup copy), attribute filtering returns the original array when nothing changes, transient token objects are reused, and the serializer walks children with index loops (no per-element iterator).
- **Compile-once policy**, the allow-list resolves into fast lookup structures in the `Sanitizer` constructor, reused across every call.

## Counting work (for PRs)

The numbers above are timings: they answer "how fast is it, and how does it compare with `sanitize-html`". They move by a few percent from run to run, so they cannot tell you whether a PR made the tokenizer 2% slower.

For that, the repository also counts the work each function does with [Heisenbench](https://www.npmjs.com/package/heisenbench). It runs the TypeScript source in `packages/neosanitize/src` with every function rewritten to count its own operations (property reads, compares, calls, allocations). The count is exact and the same on every run, so one run of a PR and one of its base are enough, and a change is reported on the line that caused it.

```bash
pnpm bench:count    # needs Node 26.4 or newer; writes packages/neosanitize/bench/heisenbench.json
```

- The cases are in `packages/neosanitize/bench/*.bench.ts`: the 13 scenarios of `fixtures.mjs` on the legacy engine (as in `pnpm bench`) and on the main engine with the policy of `pnpm bench:3way`, the five document shapes of `pnpm bench:scale` at 64 KB, the `parse5` and `htmlparser2` adapters (as in `pnpm bench:adapters`), building a policy, and the `ugc` preset.
- `--deps all` counts the work inside `parse5`, `htmlparser2` and `entities` too, so the adapter cases compare whole parsers.
- `bench/resolve.ts` lets the source's extensionless imports (`./core`) load the `.ts` files.
- `pnpm --filter neosanitize run bench:growth` counts the main-engine cases at 1×, 10× and 100× their input and names the curve: every one is linear. The legacy cases are left out on purpose: they read quadratic, but that is the counter, not the code. It prices each `result += …` by the whole string's length, while V8 appends without copying. Timed, legacy is linear (`blog-post` at 64× its size takes 44× as long).
- Every PR gets a comment from [`.github/workflows/heisenbench.yml`](https://github.com/PuruVJ/neosanitize/blob/main/.github/workflows/heisenbench.yml): each function whose count changed and the lines where it changed, then the PR's own counts (`bench/summary.ts`): the heaviest cases, the function and line that do the most work in each, and the growth class.
- To compare two commits by hand, count each one, then run `pnpm exec heisenbench diff base.json pr.json --repo ../..` in `packages/neosanitize`.

Counts are not time: the engine can make some operations nearly free, and `sanitize-html` (CommonJS) is not counted at all. Use the timed benches for speed and for the comparison with `sanitize-html`, and the counts to see what a change does to the work.

## Bundle size

| Build | Min+gzip | Min+brotli | Notes |
| --- | ---: | ---: | --- |
| `modern`, browser | ~3.2 KB | **~2.9 KB** | native `DOMParser`, no bundled parser |
| `modern`, Node / default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |
| `legacy` | ~21 KB | ~18 KB | single-file `sanitize-html` port |

The browser build reuses the platform's own parser, so it ships **zero parser bytes**, about an 8× reduction over the bundled-parser build.
