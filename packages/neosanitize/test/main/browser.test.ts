/**
 * Browser entry (`src/main/browser.ts`) tests.
 *
 * The browser build parses via the native `DOMParser` instead of the bundled
 * WHATWG parser, then runs the SAME engine-core policy. There is no real DOM in
 * the Node test env (jsdom/happy-dom are intentionally not deps), so we install a
 * tiny fake `DOMParser` whose `parseFromString` returns a HAND-BUILT DOM tree.
 * That exercises the real code path end-to-end — `parse()` → `domToNode()` → the
 * shared serializer — covering the only browser-specific logic (DOM→tree
 * conversion + that the inviolable baseline still applies). Parse *fidelity*
 * itself is the platform's responsibility (it is literally the browser's parser),
 * so it needs no test here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Sanitizer as BrowserSanitizer, SanitizerBuilder, UNSAFE_PRESET_SYMBOL, version } from '../../src/main/browser';
import { Sanitizer as NodeSanitizer } from '../../src/main/index';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

// --- minimal DOM node factories (duck-typed to what domToNode reads) ----------
type FakeNode = FakeEl | FakeText;
interface FakeText { nodeType: 3; data: string; }
interface FakeEl {
  nodeType: 1;
  namespaceURI: string | null;
  localName: string;
  attributes: Array<{ name: string; value: string }>;
  childNodes: FakeNode[];
  content?: { childNodes: FakeNode[] };
}
const text = (data: string): FakeText => ({ nodeType: 3, data });
const el = (
  localName: string,
  attrs: Record<string, string> = {},
  children: FakeNode[] = [],
  ns: string | null = XHTML
): FakeEl => ({
  nodeType: 1,
  namespaceURI: ns,
  localName,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  childNodes: children
});

/** Wrap content in <html><head/><body>…</body></html>, as DOMParser would. */
function docOf(...body: FakeNode[]) {
  const documentElement = el('html', {}, [el('head'), el('body', {}, body)]);
  return { documentElement };
}

/** Install a fake DOMParser that ignores the HTML string and returns `doc`. */
function withDom(doc: { documentElement: FakeEl }, fn: () => void) {
  (globalThis as Record<string, unknown>).DOMParser = class {
    parseFromString() { return doc; }
  };
  try { fn(); } finally { delete (globalThis as Record<string, unknown>).DOMParser; }
}

afterEach(() => { delete (globalThis as Record<string, unknown>).DOMParser; });

describe('browser entry — export parity', () => {
  it('exposes the same class-only API surface as the default entry', () => {
    expect(typeof BrowserSanitizer).toBe('function');
    expect(typeof SanitizerBuilder).toBe('function');
    expect(typeof UNSAFE_PRESET_SYMBOL).toBe('symbol');
    expect(version).toBe('0.0.0-dev');
    // builder() is inherited and returns a builder whose build() is a Sanitizer
    const s = BrowserSanitizer.builder({ tags: ['b'] }).build();
    expect(s).toBeInstanceOf(BrowserSanitizer);
  });
});

describe('browser entry — requires a DOM', () => {
  it('throws a clear error when DOMParser is unavailable', () => {
    expect((globalThis as Record<string, unknown>).DOMParser).toBeUndefined();
    const s = BrowserSanitizer.builder({ tags: ['b'] }).build();
    expect(() => s.sanitize('<b>hi</b>')).toThrow(/no DOM available/);
  });
});

describe('browser entry — DOMParser path + inviolable baseline', () => {
  const policy = { tags: ['a', 'b', 'svg'], attrs: { a: ['href'] } };

  it('keeps allow-listed tags, escapes text, unwraps the rest', () => {
    withDom(docOf(el('a', { href: '/ok' }, [text('hi')]), el('span', {}, [text(' world')])), () => {
      const s = BrowserSanitizer.builder(policy).build();
      expect(s.sanitize('ignored')).toBe('<a href="/ok">hi</a> world');
    });
  });

  it('strips javascript: URLs and on* handlers via the baseline', () => {
    withDom(docOf(el('a', { href: 'javascript:alert(1)', onclick: 'x()' }, [text('z')])), () => {
      const s = BrowserSanitizer.builder(policy).build();
      expect(s.sanitize('ignored')).toBe('<a>z</a>');
    });
  });

  it('drops <script> WITH its content even if somehow present', () => {
    withDom(docOf(el('b', {}, [text('a')]), el('script', {}, [text('alert(1)')]), el('b', {}, [text('b')])), () => {
      const s = BrowserSanitizer.builder(policy).build();
      expect(s.sanitize('ignored')).toBe('<b>a</b><b>b</b>');
    });
  });

  it('maps SVG namespace and round-trips a kept foreign element', () => {
    withDom(docOf(el('svg', {}, [text('x')], SVG)), () => {
      const s = BrowserSanitizer.builder(policy).build();
      expect(s.sanitize('ignored')).toBe('<svg>x</svg>');
    });
  });

  it('reads <template> content from the .content fragment, not childNodes', () => {
    const tmpl = el('template', {}, []);
    tmpl.content = { childNodes: [el('b', {}, [text('inside')])] };
    // template is allow-listed here so its (sanitized) content is emitted
    withDom(docOf(tmpl), () => {
      const s = BrowserSanitizer.builder({ tags: ['template', 'b'] }).build();
      expect(s.sanitize('ignored')).toBe('<template><b>inside</b></template>');
    });
  });

  it('agrees with the default (custom-parser) build on unambiguous markup', () => {
    // For simple, unambiguous HTML the hand-built DOM mirrors what DOMParser
    // yields, so both builds must produce byte-identical output.
    const html = '<b>hi</b><a href="/x">link</a>';
    const built = NodeSanitizer.builder(policy).build().sanitize(html);
    withDom(docOf(el('b', {}, [text('hi')]), el('a', { href: '/x' }, [text('link')])), () => {
      const browser = BrowserSanitizer.builder(policy).build().sanitize('ignored');
      expect(browser).toBe(built);
      expect(browser).toBe('<b>hi</b><a href="/x">link</a>');
    });
  });
});
