// @vitest-environment happy-dom
/**
 * Behaviour + coverage for the performance paths: streaming serialization during
 * tree building, the chunked serializer, precomputed attribute specs, the
 * allocation-free URL scheme scan, the ASCII style fast path, and the escapers.
 * Where a fast path has a reference implementation, the two are compared.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../../src/main/index';
import { whatwgAdapter } from '../../src/main/whatwg-parser';
import { escapeAttr, escapeText } from '../../src/main/escape';

const TAGS = ['p', 'div', 'b', 'i', 'a', 'table', 'tr', 'td', 'tbody', 'span', 'svg', 'animate', 'set', 'img'];
const build = (extra?: (b: ReturnType<typeof Sanitizer.builder>) => unknown) => {
  const b = Sanitizer.builder().allow(TAGS).allow('*', ['class', 'style', 'href', 'to', 'from', 'by', 'values', 'attributeName', 'attributename']);
  extra?.(b);
  return b.build();
};

/** Streams on EVERY pop and enters containers immediately, so small test documents
 * exercise every streaming path (the defaults batch passes and only go deeper than
 * body's children once top-level draining stalls). */
class EagerStreaming extends Sanitizer {
  protected static override streamEvery = 1;
  protected static override streamDeepAfter = 0;
}

describe('streaming sanitize (serialize during tree building)', () => {
  const eager = (() => {
    const b = EagerStreaming.builder().allow(TAGS).allow('*', ['class', 'style', 'href', 'to', 'from', 'by', 'values', 'attributeName', 'attributename']);
    return b.build();
  })();
  const defaults = build();
  // An explicit parser override disables streaming: same policy, tree-then-walk.
  const reference = build((b) => b.parser(whatwgAdapter));
  const docs = [
    '<!doctype html><html><head><title>t</title><meta charset=utf-8>\n<style>x</style></head>\n<body><p>a</p> <div>b</div>tail</body></html>after',
    '<p>one</p><p>two</p><b>unclosed <p>para</p> <i>x</b> y</i><div>z</div>',
    '<div></div><frameset><frame></frameset>', // framesetOk still true: body replaced
    '<p>x</p><table><tr><td>c</td></tr><div>fostered</div></table><p>after</p>',
    '<form><div>in form</form>still div</div><p>p</p>',
    '<p>a</p><template><p>t</p></template><p>b</p>',
    '<p>a</p><svg><animate attributeName="href" to="javascript:1"/></svg><p>b</p>',
    '<p>a</p></body></html><p>after html</p><!-- c -->',
    '<p>' + 'x'.repeat(5000) + '</p><p>' + '<b>y</b>'.repeat(500) + '</p>',
  ];
  it('is byte-identical to the non-streaming path (sanitize, report, sanitizeTo)', () => {
    for (const d of docs) for (const streaming of [eager, defaults]) {
      expect(streaming.sanitize(d)).toBe(reference.sanitize(d));
      expect(streaming.sanitizeWithReport(d)).toEqual(reference.sanitizeWithReport(d));
      for (const chunkSize of [1, 7, 256, 1 << 20]) {
        const chunks: string[] = [];
        streaming.sanitizeTo(d, (c) => chunks.push(c), { chunkSize });
        expect(chunks.join('')).toBe(reference.sanitize(d));
        for (let i = 0; i < chunks.length - 1; i++) expect(chunks[i].length).toBeGreaterThanOrEqual(chunkSize);
      }
    }
  });
  it('streams inside a single root element and matches on nested / misnested input', () => {
    const deepDocs = [
      '<main><section><p>a</p><p>b</p></section><div>c<b>d</b>e</div></main>',
      '<div id=root><p>never closed<div><span>x</span>',
      '<div><p>a</p><b>open<div>moved?</div></b>tail</div>',
      '<div><p>1</p><table><tr><td>c</td></tr>fostered</table><p>2</p></div>',
      '<div><form><p>f</p></div><p>after</p>',
      '<div><template><p>t</p></template><p>x</p></div>',
      '<div>text<!--c-->more<p>p</p>tail</div>tail2',
      '<article><script>x</script><p>a</p><style>s</style><iframe>i</iframe><p>b</p></article>',
      '<div><svg><g><circle/></g></svg><math><mi>x</mi></math><p>y</p></div>',
      '<ul><li>a<li>b<ul><li>c</ul><li>d</ul>',
      '<div><a href=x>1<div>2</a>3</div></div>',
      '<div>' + '<p><b>x</b> y</p>'.repeat(300) + '</div>',
      '<div>'.repeat(300) + 'deep' + '</div>'.repeat(150),
    ];
    let seed = 3;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
    const frag = ['<div>', '</div>', '<p>', '</p>', '<b>', '</b>', '<i>', '</i>', '<a href=x>', '</a>', '<table>', '<td>', '</table>', '<form>', '</form>', '<template>', '</template>', 'txt ', '<br>', '<svg>', '</svg>', '<span>', '</span>', '<script>s</script>', '<frameset>'];
    for (let k = 0; k < 1500; k++) {
      let d = '';
      for (let j = 1 + rnd(40); j > 0; j--) d += frag[rnd(frag.length)];
      deepDocs.push(d);
    }
    // big single-root documents cross the DEFAULT thresholds (deep entering)
    deepDocs.push('<main>' + '<section><p>a <b>b</b></p><ul><li>x</li></ul></section>'.repeat(3000) + '</main>');
    deepDocs.push('<div id=r>' + '<p>t<i>i</i></p><div>d</div>'.repeat(4000));
    for (const d of deepDocs) for (const streaming of [eager, defaults]) {
      expect(streaming.sanitize(d), d).toBe(reference.sanitize(d));
      expect(streaming.sanitizeWithReport(d), d).toEqual(reference.sanitizeWithReport(d));
      const chunks: string[] = [];
      streaming.sanitizeTo(d, (c) => chunks.push(c), { chunkSize: 5 });
      expect(chunks.join(''), d).toBe(reference.sanitize(d));
    }
  });
  it('is disabled when html/head/body are kept (their attrs can still change)', () => {
    const keepsBody = build((b) => b.allow(['html', 'head', 'body'], ['class']));
    const ref = build((b) => b.allow(['html', 'head', 'body'], ['class']).parser(whatwgAdapter));
    const d = '<p>a</p><p>b</p><body class="late"><p>c</p>';
    expect(keepsBody.sanitize(d)).toBe(ref.sanitize(d));
    expect(keepsBody.sanitize(d)).toContain('<body>');
  });
});

describe('attribute specs', () => {
  it('allowAll tags classify attribute names past the memo cap', () => {
    const s = Sanitizer.builder().allow('x-el', '*').build();
    let html = '';
    for (let i = 0; i < 2100; i++) html += `<x-el a${i}="v" onx${i}="1"></x-el>`;
    const out = s.sanitize(html);
    expect(out).toContain('a2099="v"');
    expect(out).not.toContain('onx');
  });
  it('builds DOM attributes through the same decision (buildDom)', () => {
    const s = build();
    const frag = s.sanitizeToFragment('<!-- c --><a href="javascript:x" class="c" onclick="y" title="t">z</a><img src="data:text/html,1">');
    const a = frag.firstChild as Element;
    expect(a.getAttribute('class')).toBe('c');
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.hasAttribute('onclick')).toBe(false);
    expect(a.hasAttribute('title')).toBe(false); // not allow-listed
  });
  it('checks SVG animation attributes by kind', () => {
    const s = build();
    expect(s.sanitize('<svg><animate attributeName="x" to=" https://ok" values="https://a;http://b" by="1"></animate></svg>'))
      .toBe('<svg><animate attributeName="x" to=" https://ok" values="https://a;http://b" by="1"></animate></svg>');
    const r = s.sanitizeWithReport('<svg><animate attributeName=" HREF " to="javascript:1" values="a;javascript:2" from="vbscript:x"></animate></svg>');
    expect(r.html).toBe('<svg><animate></animate></svg>');
    expect(r.removed.map((x) => x.reason)).toEqual(['unsafe-attr', 'dangerous-url', 'dangerous-url', 'dangerous-url']);
  });
});

describe('URL scheme scan (WHATWG scheme rules, no new URL())', () => {
  const s = Sanitizer.builder().allow('a', ['href']).build();
  const kept = (u: string) => s.sanitize(`<a href="${u.replace(/"/g, '&quot;')}">x</a>`).includes('href');
  it('keeps relative URLs that contain a colon later', () => {
    for (const u of ['\x00javascript:1' /* NUL -> U+FFFD: relative */, '/wiki/File:X.png', '?t=1:30', '#a:b', '../a:b', ' /x:y', '1abc:x', '\u00a0javascript:1', 'jav ascript:1', ':x', '  ']) expect(kept(u)).toBe(true);
  });
  it('sees through leading C0/space and tab/LF/CR anywhere in the scheme', () => {
    for (const u of [' javascript:1', '\tJaVa\nScRiPt:1', '\x01vbscript:x', ' \r\nvb\tscript:x', ' data:text/html,x', '\x02DA\tTA:text/html,x', '\tjavascript://[']) expect(kept(u)).toBe(false);
    for (const u of [' https://e.com', '\thttp:x', ' data:image/png;base64,AA', ' mailto:a@b', ' javascripts:x', ' java:x']) expect(kept(u)).toBe(true);
  });
});

describe('style fast path matches the reference (slow) path', () => {
  const s = Sanitizer.builder().allow('p', ['style']).build();
  const css = (v: string) => s.sanitize(`<p style="${v.replace(/"/g, '&quot;')}">x</p>`);
  it('ASCII and non-ASCII values', () => {
    expect(css('COLOR : Red ;  width:1px ')).toBe('<p style="color: Red; width: 1px">x</p>');
    expect(css('color:red; background: url( "data:text/html,x" )')).toBe('<p style="color: red">x</p>');
    expect(css('a: url(data:image/png;x); b: EXPRESSION (1); c: java script:1; d: x\ty')).toBe('<p style="a: url(data:image/png;x)">x</p>');
    expect(css('behavior:x; -moz-binding:y; :z; q:; color: rgb(1,2,3)')).toBe('<p style="color: rgb(1,2,3)">x</p>');
    // non-ASCII -> reference path (Unicode trim / lowercase rules)
    expect(css('\u00a0COLOR\u00a0: café ;x:\u212a')).toBe('<p style="color: café; x: \u212a">x</p>');
    expect(css('x: java\u00a0script:1; y: ok\u2028')).toBe('<p style="y: ok">x</p>');
    expect(css('é; behavior: xé; q: "a;b" é; :é; y: \x01é; z: url(data:text/html)é; w: ok é')).toBe('<p style="q: &quot;a;b&quot; é; w: ok é">x</p>');
  });
  it('memoizes and bounds the memo', () => {
    let html = '';
    for (let i = 0; i < 600; i++) html += `<p style="width:${i}px">x</p><p style="color:red">y</p>`;
    expect(s.sanitize(html)).toBe(s.sanitize(html)); // repeated values hit the memo; the cap clears it
  });
});

describe('escapers', () => {
  const ref = (s: string, attr: boolean) => s.replace(/&/g, '&amp;').replace(attr ? /"/g : /(?!)/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  it('match a replace-chain reference for short and long strings', () => {
    for (const s of ['', 'plain', 'a&b<c>d"e\u00a0f', '<>&"\u00a0', 'x'.repeat(40), ('ab<c>&"\u00a0 ').repeat(20), 'z'.repeat(40) + '>', 'z'.repeat(40) + '\u00a0']) {
      expect(escapeText(s)).toBe(ref(s, false));
      expect(escapeAttr(s)).toBe(ref(s, true));
    }
  });
  it('match the reference on random strings around the short/long cutoff', () => {
    const alphabet = 'ab &<>" é😀';
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
    for (let k = 0; k < 5000; k++) {
      let s = '';
      const len = rnd(120);
      for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
      expect(escapeText(s)).toBe(ref(s, false));
      expect(escapeAttr(s)).toBe(ref(s, true));
    }
  });
});
