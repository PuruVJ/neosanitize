/**
 * html5lib-tests conformance harness for the main tokenizer.
 *
 * Runs every vendored html5lib tokenizer case (test/fixtures/html5lib/tokenizer)
 * through `tokenize()` and compares the token stream to the expected output,
 * matching html5lib's format (doubleEscaped decoding, initialStates, lastStartTag,
 * coalesced Character tokens, parse-errors ignored). The pass rate is gated by a
 * RATCHET (`BASELINE`) — it can only go up; a regression fails CI. Bump BASELINE
 * as the tokenizer improves. See test/fixtures/html5lib/SNAPSHOT.txt.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tokenizer, type Token, type ContentState } from '../../src/main/parser/tokenizer';

// The tokenizer's conformance floor (ratchet — only goes up). Currently 6944/6946
// (99.97%); the 2 remaining are script-data double-escaped cases (rare; script
// content is dropped by the sanitizer anyway). Raise to 1.0 once those land.
const BASELINE = 1.0;

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'html5lib', 'tokenizer');

const STATE_MAP: Record<string, ContentState> = {
  'Data state': 'data',
  'PLAINTEXT state': 'plaintext',
  'RCDATA state': 'rcdata',
  'RAWTEXT state': 'rawtext',
  'Script data state': 'scriptData',
  'CDATA section state': 'cdata'
};

function unescape(s: string): string {
  return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Canonical, order-independent string for one expected/actual token. */
function canon(tok: unknown[]): string {
  const [kind] = tok;
  if (kind === 'StartTag') {
    const attrs = (tok[2] ?? {}) as Record<string, string>;
    const sorted = Object.keys(attrs).sort().map((k) => [k, attrs[k]]);
    return JSON.stringify(['StartTag', tok[1], sorted, tok[3] === true]);
  }
  if (kind === 'EndTag') return JSON.stringify(['EndTag', tok[1]]);
  if (kind === 'Comment') return JSON.stringify(['Comment', tok[1]]);
  if (kind === 'Character') return JSON.stringify(['Character', tok[1]]);
  if (kind === 'DOCTYPE') return JSON.stringify(['DOCTYPE', tok[1], tok[2], tok[3], tok[4]]);
  return JSON.stringify(tok);
}

/** Expected html5lib output → list of canonical strings (coalesce chars, drop errors). */
function expectedCanon(output: unknown[], doubleEscaped: boolean): string[] {
  const toks = output.filter((t) => t !== 'ParseError') as unknown[][];
  const merged: unknown[][] = [];
  for (const t of toks) {
    const tok = doubleEscaped ? deepUnescape(t) : t;
    if (tok[0] === 'Character' && merged.length && merged[merged.length - 1][0] === 'Character') {
      merged[merged.length - 1][1] = (merged[merged.length - 1][1] as string) + (tok[1] as string);
    } else merged.push(tok.slice());
  }
  return merged.map(canon);
}

function deepUnescape(tok: unknown[]): unknown[] {
  return tok.map((v, idx) => {
    if (typeof v === 'string' && idx > 0) return unescape(v);
    if (v && typeof v === 'object') {
      const o: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, string>)) o[unescape(k)] = unescape(val);
      return o;
    }
    return v;
  });
}

/** Our tokens → canonical strings. */
function actualCanon(tokens: Token[]): string[] {
  const merged: unknown[][] = [];
  for (const t of tokens) {
    if (t.type === 'eof') continue; // html5lib output has no EOF token
    let arr: unknown[];
    switch (t.type) {
      case 'doctype': arr = ['DOCTYPE', t.name, t.publicId, t.systemId, !t.forceQuirks]; break;
      case 'startTag': {
        const o: Record<string, string> = {};
        for (const [n, v] of t.attrs) o[n] = v;
        arr = t.selfClosing ? ['StartTag', t.name, o, true] : ['StartTag', t.name, o];
        break;
      }
      case 'endTag': arr = ['EndTag', t.name]; break;
      case 'comment': arr = ['Comment', t.data]; break;
      case 'character':
        if (merged.length && merged[merged.length - 1][0] === 'Character') {
          merged[merged.length - 1][1] = (merged[merged.length - 1][1] as string) + t.data;
          continue;
        }
        arr = ['Character', t.data];
        break;
    }
    merged.push(arr);
  }
  return merged.map(canon);
}

interface H5Test {
  description: string;
  input: string;
  output: unknown[];
  doubleEscaped?: boolean;
  initialStates?: string[];
  lastStartTag?: string;
}

describe('main tokenizer — html5lib conformance', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.test'));
  let total = 0;
  let passed = 0;
  const failures: string[] = [];

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { tests?: H5Test[] };
    for (const t of data.tests ?? []) {
      const states = t.initialStates?.length ? t.initialStates : ['Data state'];
      for (const stateName of states) {
        total++;
        const input = t.doubleEscaped ? unescape(t.input) : t.input;
        const state = STATE_MAP[stateName] ?? 'data';
        let ok = false;
        try {
          const got = actualCanon(new Tokenizer(input, { state, lastStartTag: t.lastStartTag }).tokenize());
          const want = expectedCanon(t.output, !!t.doubleEscaped);
          ok = got.length === want.length && got.every((g, i) => g === want[i]);
        } catch {
          ok = false;
        }
        if (ok) passed++;
        else if (failures.length < 40) failures.push(`[${file}] ${stateName}: ${t.description}`);
      }
    }
  }

  it(`passes ≥${(BASELINE * 100).toFixed(0)}% of html5lib tokenizer cases`, () => {
    const rate = passed / total;
    // eslint-disable-next-line no-console
    console.log(`[tokenizer] ${passed}/${total} html5lib cases (${(rate * 100).toFixed(1)}%)`);
    if (failures.length) {
      // eslint-disable-next-line no-console
      console.log('  sample failures:\n    ' + failures.slice(0, 20).join('\n    '));
    }
    expect(total).toBeGreaterThan(6000);
    expect(rate).toBeGreaterThanOrEqual(BASELINE);
  });
});
