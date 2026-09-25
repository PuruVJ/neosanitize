/**
 * The pluggable parse-adapter system: the same policy engine + serializer run over
 * a tree produced by ANY parser. The default is our bundled WHATWG parser; the
 * optional `parse5` / `htmlparser2` adapters (and `.parser(...)` override) swap only
 * the parse step. These tests assert the override plumbing works end-to-end and that
 * each adapter sanitizes correctly (the inviolable baseline holds regardless of parser).
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, whatwgAdapter, type Preset } from '../../src/main/index';
import { whatwgAdapter as whatwgAdapterFromModule } from '../../src/main/whatwg-parser';
import { parse5Adapter } from '../../src/main/parse5';
import { htmlparser2Adapter } from '../../src/main/htmlparser2';

const policy: Preset = (b) =>
  b.allow(['p', 'a', 'b', 'i', 'em', 'strong', 'span', 'div', 'ul', 'ol', 'li', 'img', 'code', 'pre', 'br'])
    .allow('a', ['href', 'title'])
    .allow('img', ['src', 'alt'])
    .allow('*', ['class']);

const adapters = [
  { name: 'default (whatwg)', make: () => Sanitizer.builder(policy).build() },
  { name: 'whatwgAdapter (explicit)', make: () => Sanitizer.builder(policy).parser(whatwgAdapter).build() },
  { name: 'parse5', make: () => Sanitizer.builder(policy).parser(parse5Adapter).build() },
  { name: 'htmlparser2', make: () => Sanitizer.builder(policy).parser(htmlparser2Adapter).build() },
];

describe('parse-adapter system', () => {
  for (const { name, make } of adapters) {
    describe(name, () => {
      const s = make();

      it('keeps allow-listed markup', () => {
        expect(s.sanitize('<p class="x">hi <a href="/d" title="t">link</a> <b>b</b></p>'))
          .toBe('<p class="x">hi <a href="/d" title="t">link</a> <b>b</b></p>');
      });

      it('drops non-allow-listed tags and strips event handlers / scripts', () => {
        const out = s.sanitize('<p>ok</p><iframe></iframe><img src=x onerror=alert(1)><script>bad()</script>');
        expect(out).not.toMatch(/<script|<iframe|onerror/i);
        expect(out).toContain('<p>ok</p>');
        expect(out).toContain('<img src="x">');
      });

      it('strips javascript: URLs even though href is allow-listed (inviolable baseline)', () => {
        expect(s.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
      });

      it('is reparse-stable (sanitize∘sanitize = sanitize)', () => {
        const once = s.sanitize('<p>hi<img src=x onerror=alert(1)><b>z</b>');
        expect(s.sanitize(once)).toBe(once);
      });
    });
  }

  it('whatwgAdapter is importable from neosanitize/whatwg-parser (browser-safe path)', () => {
    expect(typeof whatwgAdapterFromModule).toBe('function');
    const out = Sanitizer.builder(policy).parser(whatwgAdapterFromModule).build().sanitize('<p class="x">hi</p>');
    expect(out).toBe('<p class="x">hi</p>');
  });

  it('.parser(null) restores the environment default', () => {
    const out = Sanitizer.builder(policy).parser(parse5Adapter).parser(null).build()
      .sanitize('<p>hi</p>');
    expect(out).toBe('<p>hi</p>');
  });

  it('sanitizeUnsafe re-parses with the SAME override adapter, not the default', () => {
    // A custom adapter we can detect: rename every <p> to <b> at parse time. If the
    // unsafe re-parse used the default parser instead, the marker tag wouldn't appear.
    const markerAdapter = (html: string) => {
      const tree = whatwgAdapter(html);
      const walk = (n: any) => {
        if (n.type === 'element' && n.name === 'p') n.name = 'b';
        for (const c of n.children ?? []) walk(c);
      };
      walk(tree);
      return tree;
    };
    const s = Sanitizer.builder().allow('b')
      .parser(markerAdapter)
      .build();
    expect(s.sanitize('<p>x</p>')).toBe('<b>x</b>');
    expect(s.sanitizeUnsafe('<p>x</p>')).toBe('<b>x</b>'); // override carried through
  });

  it('parse5 namespaces foreign content (svg) like the default parser', () => {
    const p: Preset = (b) => b.allow(['svg', 'a']).allow('a', ['xlink href']);
    const html = '<svg><a xlink:href="/x"></a></svg>';
    const def = Sanitizer.builder(p).build().sanitize(html);
    const p5 = Sanitizer.builder(p).parser(parse5Adapter).build().sanitize(html);
    expect(p5).toBe(def);
  });
});
