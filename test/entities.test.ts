/**
 * Differential parity tests for HTML entity decoding.
 *
 * These run our sanitizer and the ORIGINAL sanitize-html side by side over the
 * full WHATWG named-character-reference table plus numeric / legacy / ambiguous
 * edge cases, asserting byte-identical output. This is the safety net for using
 * this library as a drop-in replacement.
 */
import { describe, it, expect } from 'vitest';
import original from 'sanitize-html';
import ours from '../src/legacy/index';
import whatwg from '../scripts/entities-whatwg.json';

const textOpts = { allowedTags: ['p'], allowedAttributes: {} };
const attrOpts = { allowedTags: ['a'], allowedAttributes: { a: ['href', 'title'] } };

/** Collect the keys where our output diverges from the original. */
function diffs(cases: Array<{ html: string; opts?: any; label: string }>) {
  const out: string[] = [];
  for (const { html, opts, label } of cases) {
    const a = original(html, opts);
    const b = ours(html, opts);
    if (a !== b) out.push(`${label}\n  orig: ${JSON.stringify(a)}\n  ours: ${JSON.stringify(b)}`);
  }
  return out;
}

describe('entity decoding parity vs. original sanitize-html', () => {
  const names = Object.keys(whatwg); // e.g. "&copy;", "&copy"

  it(`decodes all ${Object.keys(whatwg).length} named entities identically (text context)`, () => {
    const cases = names.map((name) => ({
      label: `text ${name}`,
      html: `<p>before ${name} after</p>`,
      opts: textOpts,
    }));
    expect(diffs(cases).slice(0, 20)).toEqual([]);
  });

  it('decodes every named entity identically (attribute context)', () => {
    const cases = names.map((name) => ({
      label: `attr ${name}`,
      html: `<a href="x${name}y" title="t${name}t">z</a>`,
      opts: attrOpts,
    }));
    expect(diffs(cases).slice(0, 20)).toEqual([]);
  });

  it('handles legacy no-semicolon forms identically in both contexts', () => {
    const legacy = names.filter((n) => !n.endsWith(';'));
    const cases = legacy.flatMap((name) => [
      { label: `text bare ${name}`, html: `<p>${name}</p>`, opts: textOpts },
      { label: `text ${name}+alnum`, html: `<p>${name}word</p>`, opts: textOpts },
      { label: `text ${name}+eq`, html: `<p>${name}=1</p>`, opts: textOpts },
      { label: `attr bare ${name}`, html: `<a href="q${name}">z</a>`, opts: attrOpts },
      { label: `attr ${name}+alnum`, html: `<a href="q${name}word">z</a>`, opts: attrOpts },
      { label: `attr ${name}+eq`, html: `<a href="?a=1${name}=2">z</a>`, opts: attrOpts },
    ]);
    expect(diffs(cases).slice(0, 30)).toEqual([]);
  });

  it('matches numeric character references (decimal, hex, edge ranges)', () => {
    const nums = [
      '&#233;', '&#xe9;', '&#XE9;', '&#233', '&#xe9', // basic + missing semicolon
      '&#0;', '&#x0;', // null -> replacement
      '&#128;', '&#129;', '&#130;', '&#149;', '&#159;', // windows-1252 remap window
      '&#xD800;', '&#xDFFF;', // surrogates -> replacement
      '&#x10FFFF;', '&#x110000;', '&#x7FFFFFFF;', // max valid / overflow
      '&#9;', '&#10;', '&#13;', '&#32;', '&#38;', '&#60;', '&#62;', '&#34;', '&#39;', // controls + escapables
      '&#;', '&#x;', '&#xZZ;', '&#abc;', // malformed
      '&#x1F600;', '&#128512;', // emoji (astral)
    ];
    const cases = nums.flatMap((n) => [
      { label: `text ${n}`, html: `<p>a${n}b</p>`, opts: textOpts },
      { label: `attr ${n}`, html: `<a href="a${n}b">z</a>`, opts: attrOpts },
    ]);
    expect(diffs(cases)).toEqual([]);
  });

  it('matches ambiguous / malformed ampersands', () => {
    const odd = [
      '&', '&&', '& ', '&;', '&amp', '&amp;', '&amp;amp;', '&AMP', '&aMp;',
      '&notit;', '&notin;', '&not;', '&notinva;', '&fooo;', '&bar', '&copy;s',
      'a&amp=b', '?x=1&y=2&z=3', 'rock&roll', 'Q&A', 'AT&T', 'M&Ms',
      '&#', '&#x', '&lt;script&gt;', '&#60;b&#62;', '&ltscript&gt',
    ];
    const cases = odd.flatMap((s) => [
      { label: `text ${JSON.stringify(s)}`, html: `<p>${s}</p>`, opts: textOpts },
      { label: `attr ${JSON.stringify(s)}`, html: `<a href="${s}">z</a>`, opts: attrOpts },
    ]);
    expect(diffs(cases)).toEqual([]);
  });

  it('matches realistic mixed content (URLs, query strings, prose)', () => {
    const cases = [
      { label: 'query', html: `<a href="/search?q=cats&category=pets&sort=new">go</a>`, opts: attrOpts },
      { label: 'query encoded', html: `<a href="/s?q=a&amp;b&copy=1">go</a>`, opts: attrOpts },
      { label: 'prose', html: `<p>Tom &amp; Jerry, 5 &lt; 6, caf&eacute;, 50&cent;, &frac12; off &mdash; &ldquo;deal&rdquo;!</p>`, opts: textOpts },
      { label: 'math', html: `<p>x &rarr; y &amp;&amp; a &le; b &ge; c &ne; d &times; e</p>`, opts: textOpts },
      { label: 'accents', html: `<p>na&iuml;ve r&eacute;sum&eacute; &agrave; la &ccedil;a</p>`, opts: textOpts },
    ];
    expect(diffs(cases)).toEqual([]);
  });
});
