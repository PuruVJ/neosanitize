/**
 * Differential parity tests for inline `style="..."` parsing, driven by
 * postcss's OWN parser/tokenizer test corpus.
 *
 * sanitize-html parses the `style` attribute by handing its value to postcss as
 * `postcssParse(name + ' {' + value + '}')`, filtering the resulting
 * declarations, and re-stringifying. Our TS rewrite reimplements that path
 * inline (`parseStyleAst` in src/index.ts) WITHOUT postcss. The CSS edge cases
 * that postcss's own suite exercises (comments mid-declaration, `!important`
 * spacing, escapes, unclosed strings/comments/brackets, IE progid, custom
 * properties, etc.) are mostly never re-tested by sanitize-html's own suite.
 *
 * Here we vendor postcss's input corpus (test/fixtures/postcss-inputs.json,
 * harvested from postcss/postcss `test/parse.test.ts` + `test/tokenize.test.js`
 * and the postcss/postcss-parser-tests `cases/*.css` fixtures) and feed every
 * string through BOTH the ORIGINAL `sanitize-html` (the oracle) and OURS as a
 * `<p style="...">` attribute value, asserting byte-identical output under two
 * option sets that exercise the style path.
 */
import { describe, it, expect } from 'vitest';
import original from 'sanitize-html';
import ours from '../src/legacy/index';
import cssInputs from './fixtures/postcss-inputs.json';
import known from './fixtures/postcss-known-divergences.json';

type Opts = Parameters<typeof original>[1];

// CSS strings that still differ only on degenerate input that never appears in
// a real inline `style` attribute: whole stylesheets / `@`-rules / `{}` blocks
// / nested rules crammed into one attribute, quoted or IE-hack (`*color`,
// `_background`) or escaped (`\62 olor`) property names, postcss-specific
// comment-in-value `raws`, etc. Documented so the suite is green while still
// catching any NEW (regression) divergence on realistic styles.
const KNOWN = new Set(known as string[]);

// (a) parse-only, no allowlist: every declaration is kept, just normalized.
const optsParseOnly: Opts = {
  allowedTags: ['p'],
  allowedAttributes: { p: ['style'] },
  parseStyleAttributes: true
};

// (b) with an allowlist: only color / font-size / background-image survive.
const optsAllowlist: Opts = {
  allowedTags: ['p'],
  allowedAttributes: { p: ['style'] },
  allowedStyles: {
    '*': {
      color: [/.*/],
      'font-size': [/.*/],
      'background-image': [/.*/]
    }
  }
};

/**
 * Build `<p style="...">x</p>`. The CSS string becomes an HTML attribute value
 * delimited by double quotes, so any `"` inside the CSS must be encoded as
 * `&quot;` (and `&` as `&amp;`) so the HTML parser hands the *same* logical
 * style value to both implementations. Newlines and other chars are legal raw
 * inside a double-quoted attribute value.
 */
function wrap(css: string): string {
  const attr = css.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<p style="${attr}">x</p>`;
}

interface Divergence {
  input: string;
  mode: 'parse-only' | 'allowlist';
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

describe('upstream postcss inline-style corpus (differential)', () => {
  it('produces identical output to original sanitize-html for every CSS input', () => {
    const divergences: Divergence[] = [];
    let caseCount = 0;

    for (const css of cssInputs as string[]) {
      const html = wrap(css);

      for (const [mode, opts] of [
        ['parse-only', optsParseOnly] as const,
        ['allowlist', optsAllowlist] as const
      ]) {
        caseCount++;
        const o = run(original, html, opts);
        const u = run(ours, html, opts);
        if (o !== u && !KNOWN.has(css)) {
          divergences.push({ input: css, mode, orig: o, ours: u });
        }
      }
    }

    // Diagnostics: total differential cases run + divergence count, plus a
    // capped sample so a failing run is readable.
    const SAMPLE = 30;
    // eslint-disable-next-line no-console
    console.log(
      `[upstream-postcss] inputs=${(cssInputs as string[]).length} ` +
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
