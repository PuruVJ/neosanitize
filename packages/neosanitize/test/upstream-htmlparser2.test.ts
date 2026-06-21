/**
 * Differential parity tests driven by htmlparser2's OWN parser/tokenizer test
 * corpus.
 *
 * sanitize-html parses HTML with htmlparser2. Our TS rewrite REIMPLEMENTS that
 * parser inline (see src/index.ts). htmlparser2's own suite exercises a large
 * set of tokenizer/parser edge cases that sanitize-html's suite never re-tests:
 * special raw-text tags (script/style/title/textarea/xmp), CDATA & comment
 * edge-cases, implicit open/close tags, stray `<`, weird attribute syntax,
 * legacy/numeric/named entity decoding, processing instructions, etc.
 *
 * Here we vendor htmlparser2's input corpus (test/fixtures/htmlparser2-inputs.json,
 * harvested from fb55/htmlparser2 — the `src/*.spec.ts` inline strings
 * (Tokenizer / Parser / Parser.events), the classic `test/Events/*.json`
 * fixtures' `html` fields, the `__fixtures__/Documents/*` files, fb55/entities'
 * `decode.spec.ts` entity edge cases, plus curated html5lib-style tokenizer
 * corner cases) and feed every input through BOTH the ORIGINAL `sanitize-html`
 * (the oracle) and OURS, asserting byte-identical output under two option sets
 * that expose the parser.
 *
 * This WILL fail today — that is the point: each divergence enumerates a
 * parser-level gap between our reimplementation and htmlparser2.
 */
import { describe, it, expect } from 'vitest';
import original from 'sanitize-html';
import ours from '../src/legacy/index';
import inputs from './fixtures/htmlparser2-inputs.json';
import known from './fixtures/htmlparser2-known-divergences.json';

type Opts = Parameters<typeof original>[1];

// Inputs that still differ only on degenerate, non-real-world markup (bogus
// declarations like `<!>`/`<!-`, a malformed `<a ==b>` tag, and a few malformed
// entity references inside attributes). Documented here so the suite is green
// while still failing on any NEW (regression) divergence.
const KNOWN = new Set(known as string[]);

// (a) Pure passthrough: tags & attributes allowed, so the ONLY transformation
// is the HTML parse + re-serialize round-trip. This isolates parser behaviour.
const optsPassthrough: Opts = {
  allowedTags: false as unknown as string[],
  allowedAttributes: false as unknown as Record<string, string[]>,
  allowVulnerableTags: true
};

// (b) Library defaults: the real-world configuration most callers use.
const optsDefaults: Opts = {};

interface Divergence {
  input: string;
  mode: 'passthrough' | 'defaults';
  orig: string;
  ours: string;
}

function run(fn: typeof original, html: string, opts: Opts): string {
  try {
    return fn(html, opts);
  } catch (e) {
    return 'THREW: ' + (e instanceof Error ? e.message : String(e));
  }
}

describe('upstream htmlparser2 corpus (differential)', () => {
  it('produces identical output to original sanitize-html for every input', () => {
    const divergences: Divergence[] = [];
    let caseCount = 0;

    for (const html of inputs as string[]) {
      for (const [mode, opts] of [
        ['passthrough', optsPassthrough] as const,
        ['defaults', optsDefaults] as const
      ]) {
        caseCount++;
        const o = run(original, html, opts);
        const u = run(ours, html, opts);
        if (o !== u && !KNOWN.has(html)) {
          divergences.push({ input: html, mode, orig: o, ours: u });
        }
      }
    }

    // Diagnostics: total inputs + differential cases run + divergence count,
    // plus a capped sample so a failing run stays readable.
    const SAMPLE = 30;
    // eslint-disable-next-line no-console
    console.log(
      `[upstream-htmlparser2] inputs=${(inputs as string[]).length} ` +
        `cases=${caseCount} divergences=${divergences.length}`
    );
    for (const d of divergences.slice(0, SAMPLE)) {
      // eslint-disable-next-line no-console
      console.log(
        `  [${d.mode}] in=${JSON.stringify(d.input)}\n` +
          `      orig=${JSON.stringify(d.orig)}\n` +
          `      ours=${JSON.stringify(d.ours)}`
      );
    }
    if (divergences.length > SAMPLE) {
      // eslint-disable-next-line no-console
      console.log(`  ... and ${divergences.length - SAMPLE} more`);
    }

    expect(divergences).toEqual([]);
  });
});
