/**
 * Targeted coverage for tokenizer.ts paths the conformance harness doesn't reach
 * with this engine's own inputs: the constructor's default content state, a NUL in
 * PLAINTEXT, and a NUL inside DOCTYPE public/system identifiers. NUL is built via
 * String.fromCharCode(0) to keep a literal control char out of the source.
 */
import { describe, it, expect } from 'vitest';
import { Tokenizer, type Token } from '../../src/main/parser/tokenizer';

const NUL = String.fromCharCode(0);
const types = (toks: Token[]) => toks.map((t) => t.type);

describe('tokenizer — rare paths', () => {
  it('defaults to the data state when no options state is given', () => {
    const toks = new Tokenizer('hi<b>', {}).tokenize();
    expect(types(toks)).toContain('startTag');
    expect(toks.some((t) => t.type === 'character' && t.data === 'hi')).toBe(true);
  });

  it('replaces a NUL in PLAINTEXT with U+FFFD (bulk-scan break path)', () => {
    const toks = new Tokenizer('a' + NUL + 'b', { state: 'plaintext' }).tokenize();
    const text = toks.filter((t) => t.type === 'character').map((t) => (t as { data: string }).data).join('');
    expect(text).toBe('a�b');
  });

  it('replaces NUL inside DOCTYPE public + system identifiers', () => {
    const toks = new Tokenizer('<!DOCTYPE h PUBLIC "p' + NUL + 'q" "s' + NUL + 't">', {}).tokenize();
    const dt = toks.find((t) => t.type === 'doctype') as { publicId: string; systemId: string } | undefined;
    expect(dt?.publicId).toBe('p�q');
    expect(dt?.systemId).toBe('s�t');
  });
});
