/**
 * Broad generative differential fuzz — the primary "drop-in" safety net.
 *
 * Generates thousands of well-formed HTML documents (audit/fuzz-gen.mjs) and runs
 * each through BOTH the original `sanitize-html` and our reimplementation under a
 * matrix of configs that touches every option, asserting byte-identical output.
 * Because the generator only emits well-formed markup, the two MUST agree — so a
 * failure is a real regression, reproducible from the printed seed. (Deliberately
 * malformed input, where documented tokenizer divergences live, is covered
 * separately by the htmlparser2/postcss/parse-srcset corpora.)
 *
 * Coverage proven during authoring: 0 divergences over ~1.7M cases across many
 * seed ranges, and mutation-tested (injected escape/scheme/attribute/class bugs
 * are all caught). The deterministic slice below locks in a fixed subset.
 */
import { describe, it, expect } from 'vitest';
import original from 'sanitize-html';
import ours from '../src/legacy/index';
import { genDoc, makeRng, CONFIGS } from '../audit/fuzz-gen.mjs';

type Opts = Parameters<typeof original>[1];

const DOCS = 5000; // × CONFIGS (25) ≈ 125k differential cases, ~2.5s
const SEED_BASE = 1;

interface Divergence {
  seed: number;
  label: string;
  html: string;
  orig: string;
  ours: string;
}

function run(fn: typeof original, html: string, opts: Opts): string {
  try {
    return 'OK\n' + fn(html, opts);
  } catch (e) {
    return 'THREW: ' + (e instanceof Error ? e.message : String(e));
  }
}

describe('generative differential fuzz vs original sanitize-html', () => {
  it(`produces byte-identical output across ${DOCS} docs × ${CONFIGS.length} configs`, () => {
    // The original emits console warnings (allowVulnerableTags, deprecations);
    // silence them so a failure dump stays readable.
    const warn = console.warn;
    const error = console.error;
    console.warn = () => {};
    console.error = () => {};

    const divergences: Divergence[] = [];
    let cases = 0;
    try {
      for (let d = 0; d < DOCS; d++) {
        const seed = SEED_BASE + d;
        const html = genDoc(makeRng(seed));
        for (const { label, opts } of CONFIGS as Array<{ label: string; opts: Opts }>) {
          cases++;
          const o = run(original, html, opts);
          const u = run(ours, html, opts);
          if (o !== u) divergences.push({ seed, label, html, orig: o, ours: u });
        }
      }
    } finally {
      console.warn = warn;
      console.error = error;
    }

    if (divergences.length) {
      const sample = divergences
        .slice(0, 15)
        .map(
          (x) =>
            `  [${x.label}] seed=${x.seed}\n` +
            `    in  : ${JSON.stringify(x.html).slice(0, 300)}\n` +
            `    orig: ${JSON.stringify(x.orig).slice(0, 300)}\n` +
            `    ours: ${JSON.stringify(x.ours).slice(0, 300)}`
        )
        .join('\n');
      // eslint-disable-next-line no-console
      console.log(
        `[differential-fuzz] ${cases} cases, ${divergences.length} divergences:\n${sample}`
      );
    }

    expect(divergences).toEqual([]);
    // Guard against the fuzz silently degenerating to a no-op.
    expect(cases).toBe(DOCS * CONFIGS.length);
    expect(cases).toBeGreaterThan(100_000);
  });
});
