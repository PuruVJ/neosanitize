/**
 * Streaming output via `sanitizeTo` — must deliver byte-identical output to
 * `sanitize()`, in chunks, through either a callback or a Node-style `write`
 * sink, and apply the exact same inviolable baseline.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../../src/main/index';
import * as presets from '../../src/main/presets';

const s = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

const samples = [
  '',
  '<p>hello <b>world</b></p>',
  '<p>hi <img src=x onerror=alert(1)> <script>bad()</script></p>',
  '<a href="javascript:alert(1)" onclick="x()">click</a>',
  '<div><ul>' + '<li>item</li>'.repeat(500) + '</ul></div>', // big enough to span chunks
  '<table><tr><td>a&amp;b</td><td>&lt;c&gt;</td></tr></table>',
  '<p>text with no markup at all, just words and words and words</p>',
];

describe('sanitizeTo', () => {
  it('callback sink concatenates to exactly sanitize() output', () => {
    for (const html of samples) {
      let acc = '';
      s.sanitizeTo(html, (chunk) => { acc += chunk; });
      expect(acc).toBe(s.sanitize(html));
    }
  });

  it('object sink with write() works the same', () => {
    for (const html of samples) {
      const chunks: string[] = [];
      s.sanitizeTo(html, { write: (c: string) => chunks.push(c) });
      expect(chunks.join('')).toBe(s.sanitize(html));
    }
  });

  it('applies the inviolable baseline (same as sanitize)', () => {
    let acc = '';
    s.sanitizeTo('<a href="javascript:alert(1)" onclick="x()">y</a>', (c) => { acc += c; });
    expect(acc).toBe('<a>y</a>');
    expect(acc).not.toContain('javascript:');
    expect(acc).not.toContain('onclick');
  });

  it('emits no chunks when the result is empty', () => {
    let calls = 0;
    s.sanitizeTo('<script>only dropped content</script>', () => { calls++; });
    expect(s.sanitize('<script>only dropped content</script>')).toBe('');
    expect(calls).toBe(0);
  });

  it('respects chunkSize: small docs are one write, large docs are many', () => {
    const big = '<div>' + '<p>paragraph of some length here</p>'.repeat(2000) + '</div>';

    const oneShot: string[] = [];
    s.sanitizeTo('<p>tiny</p>', (c) => oneShot.push(c));
    expect(oneShot.length).toBe(1);

    const chunked: string[] = [];
    s.sanitizeTo(big, (c) => chunked.push(c), { chunkSize: 4096 });
    expect(chunked.length).toBeGreaterThan(1);
    expect(chunked.join('')).toBe(s.sanitize(big));
    // every flushed chunk is at least the target size except the final remainder
    for (let i = 0; i < chunked.length - 1; i++) {
      expect(chunked[i].length).toBeGreaterThanOrEqual(4096);
    }
  });

  it('chunkSize is configurable down to per-fragment', () => {
    const chunks: string[] = [];
    s.sanitizeTo('<p>a<b>b</b>c</p>', (c) => chunks.push(c), { chunkSize: 1 });
    expect(chunks.join('')).toBe(s.sanitize('<p>a<b>b</b>c</p>'));
    expect(chunks.length).toBeGreaterThan(1);
  });
});
