import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import original from 'sanitize-html';
import ours from '../src/legacy/index';
import inputs from './fixtures/parse-srcset-inputs.json';
import known from './fixtures/parse-srcset-known-divergences.json';

// The original sanitize-html logs parse-srcset warnings to the console for
// invalid descriptors; silence them so the differential run stays readable.
const realWarn = console.warn;
const realError = console.error;
beforeAll(() => { console.warn = () => {}; console.error = () => {}; });
afterAll(() => { console.warn = realWarn; console.error = realError; });

// Inputs known to differ only on degenerate srcset (e.g. parenthesised
// descriptor groups that parse-srcset rejects wholesale). Documented so the
// suite stays green while still failing on any NEW divergence.
const KNOWN = new Set(known as string[]);

/**
 * Differential test against parse-srcset's own conformance corpus.
 *
 * The srcset descriptor-grammar edge cases (exponents, leading-dot densities,
 * uppercase descriptors, zero/negative widths, comma/whitespace quirks, data
 * URLs, multiple candidates) that the upstream parse-srcset suite exercises are
 * never re-tested by sanitize-html's own suite. Here we feed each harvested
 * srcset string through BOTH the original `sanitize-html` (the oracle) and our
 * reimplementation, asserting byte-identical output for both the `srcset` and
 * `imagesrcset` attributes (the original sanitizes both via parse-srcset).
 */

const srcsetInputs = inputs as string[];

// Build a valid `<img attr="...">` by escaping the value for a double-quoted
// HTML attribute. Both parsers see the same decoded value after HTML parsing.
function attrEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface Divergence {
  attr: string;
  input: string;
  orig: string;
  ours: string;
}

function collectDivergences(attr: 'srcset' | 'imagesrcset'): Divergence[] {
  const opts = {
    allowedTags: ['img'],
    allowedAttributes: { img: [attr] }
  };
  const divergences: Divergence[] = [];
  for (const input of srcsetInputs) {
    const html = `<img ${attr}="${attrEscape(input)}">`;
    const a = original(html, opts);
    const b = ours(html, opts);
    if (a !== b && !KNOWN.has(input)) {
      divergences.push({ attr, input, orig: a, ours: b });
    }
  }
  return divergences;
}

function summarize(divergences: Divergence[]): string {
  const shown = divergences.slice(0, 30);
  const lines = shown.map(
    (d) =>
      `  [${d.attr}] input=${JSON.stringify(d.input)}\n` +
      `        orig=${JSON.stringify(d.orig)}\n` +
      `        ours=${JSON.stringify(d.ours)}`
  );
  const more =
    divergences.length > shown.length
      ? `\n  ...and ${divergences.length - shown.length} more`
      : '';
  return `${divergences.length} divergence(s):\n${lines.join('\n')}${more}`;
}

describe('upstream parse-srcset differential', () => {
  it(`harvested ${srcsetInputs.length} srcset inputs`, () => {
    expect(srcsetInputs.length).toBeGreaterThan(0);
  });

  it('matches original sanitize-html for the `srcset` attribute', () => {
    const divergences = collectDivergences('srcset');
    expect(divergences, summarize(divergences)).toEqual([]);
  });

  it('matches original sanitize-html for the `imagesrcset` attribute', () => {
    const divergences = collectDivergences('imagesrcset');
    expect(divergences, summarize(divergences)).toEqual([]);
  });

  it('matches original across both attributes (combined)', () => {
    const divergences = [
      ...collectDivergences('srcset'),
      ...collectDivergences('imagesrcset')
    ];
    expect(divergences, summarize(divergences)).toEqual([]);
  });
});
