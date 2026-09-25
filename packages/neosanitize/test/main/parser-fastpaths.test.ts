/**
 * Exercises the parser's perf fast paths and their fallbacks: name interning,
 * inline tag/attribute transitions, bulk comment scanning, the `&name;` / numeric
 * character-reference fast paths, first-child children arrays, and the lazy
 * deep-stack name counts that keep stray end tags O(1). Every expectation is the
 * output of the pre-fast-path parser (same trees / tokens, byte for byte).
 */
import { describe, it, expect } from 'vitest';
import { TreeBuilder } from '../../src/main/parser/tree-builder';
import type { ParentNode, TreeNode } from '../../src/main/parser/tree-builder';
import { Tokenizer } from '../../src/main/parser/tokenizer';

/** Compact html5lib-ish dump of the <body> subtree (or whole doc). */
function dump(n: ParentNode | TreeNode): string {
  if (n.type === 'text') return JSON.stringify(n.value);
  if (n.type === 'comment') return `<!--${n.value}-->`;
  if (n.type === 'doctype') return `<!DOCTYPE ${n.name}>`;
  const kids = n.children.map(dump).join('');
  if (n.type === 'document') return kids;
  const ns = n.namespace === 'html' ? '' : n.namespace + ' ';
  const attrs = n.attrs.map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('');
  return `<${ns}${n.name}${attrs}>${kids}</${n.name}>`;
}
const body = (html: string) => {
  const doc = new TreeBuilder(html).parse();
  const htmlEl = doc.children.find((c) => c.type === 'element')!;
  const b = (htmlEl as ParentNode).children.find((c) => c.type === 'element' && c.name === 'body');
  return b ? dump(b as ParentNode) : dump(doc);
};
const tokens = (html: string) => JSON.stringify(new Tokenizer(html, {}).tokenize());

describe('tokenizer fast paths', () => {
  it('interns known names, folds uppercase, and keeps unknown / non-ASCII names exact', () => {
    expect(body('<DIV CLASS="a" Data-X=1><sPaN iD=b>t</SPAN></div>')).toBe('<body><div class="a" data-x="1"><span id="b">"t"</span></div></body>');
    // non-ASCII in an uppercase run: only ASCII letters fold (U+0130 / U+212A untouched)
    expect(body('<Aİ KİD=1>x</aİ>')).toBe('<body><aİ kİd="1">"x"</aİ></body>');
    expect(body('<custom-el Foo-Bar="1">')).toBe('<body><custom-el foo-bar="1"></custom-el></body>');
  });

  it('handles NUL inside tag / attribute names (slow-path reconsumes)', () => {
    expect(tokens('<a\0 b>')).toBe(tokens('<a� b>'));
    expect(body('<a\0 b>')).toBe('<body><a� b=""></a�></body>');
    expect(body('<a b\0="x" c\0=\'y\'>')).toBe('<body><a b�="x" c�="y"></a></body>');
  });

  it('inline attribute transitions: whitespace runs, self-closing, unquoted, EOF', () => {
    expect(body('<a  \n\t b="1"  c=\'2\'/>x')).toBe('<body><a b="1" c="2">"x"</a></body>');
    expect(body('<img src="x"/><br/>')).toBe('<body><img src="x"></img><br></br></body>');
    expect(body('<a b="1"c="2">')).toBe('<body><a b="1" c="2"></a></body>');
    expect(tokens('<a b="1')).toBe('[{"type":"eof"}]');
    expect(tokens('<a b="1"')).toBe('[{"type":"eof"}]');
    expect(tokens('<a')).toBe('[{"type":"eof"}]');
    expect(tokens('<')).toBe('[{"type":"character","data":"<"},{"type":"eof"}]');
    expect(tokens('</')).toBe('[{"type":"character","data":"</"},{"type":"eof"}]');
    expect(tokens('</>x')).toBe('[{"type":"character","data":"x"},{"type":"eof"}]');
    expect(tokens('< a')).toBe('[{"type":"character","data":"< a"},{"type":"eof"}]');
  });

  it('bulk comment / bogus comment scanning keeps NUL and dash handling', () => {
    expect(tokens('<!--a\0b-c--d-->')).toBe('[{"type":"comment","data":"a�b-c--d"},{"type":"eof"}]');
    expect(tokens('<?x\0y>z')).toBe('[{"type":"comment","data":"?x�y"},{"type":"character","data":"z"},{"type":"eof"}]');
    expect(tokens('<!--unterminated')).toBe('[{"type":"comment","data":"unterminated"},{"type":"eof"}]');
  });

  it('named references: `&name;` fast path, legacy no-semicolon forms, attribute rule', () => {
    expect(body('&amp;&lt;&notin;&notit;&ampx &copy x&AElig;&unknown;')).toBe('<body>"&<∉¬it;&x © xÆ&unknown;"</body>');
    expect(body('<a href="?a=1&amp;b=2&copy=3&notin;">')).toBe('<body><a href="?a=1&b=2&copy=3∉"></a></body>');
  });

  it('numeric references: inline scan, no-digit fallbacks, replacement rules', () => {
    expect(body('&#65;&#x42;&#X43&#0;&#x110000;&#xD800;&#128;&#x9F;&#;&#x;&#xZ&#99999999999999999999;')).toBe(
      '<body>"ABC���€Ÿ&#;&#x;&#xZ�"</body>',
    );
    expect(body('<a title="&#x41;&#66">')).toBe('<body><a title="AB"></a></body>');
  });
});

describe('tree builder: deep-stack name counts (stray end tags stay O(1))', () => {
  const D = 200; // > DEEP_STACK
  const spans = (n: number) => '<span>'.repeat(n);
  const close = (n: number, t: string) => `</${t}>`.repeat(n);

  it('stray generic / block / heading / table-scope end tags are ignored', () => {
    const r = body(spans(D) + '</x></div></h2></td></b>ok');
    expect(r.endsWith('"ok"' + close(D, 'span') + '</body>')).toBe(true);
  });

  it('real matches deep in the stack still close', () => {
    const r = body('<div>' + spans(D) + '</div>after');
    expect(r).toBe('<body><div>' + spans(D) + close(D, 'span') + '</div>"after"</body>');
    const h = body('<h2>' + spans(D) + '</h1>after');
    expect(h.endsWith('</h2>"after"</body>')).toBe(true);
  });

  it('adoption agency with a closed <a> in the formatting list under deep nesting', () => {
    const inner = (html: string) => { const r = body(html); return r.slice(r.indexOf('<a>'), r.indexOf('</div>')); };
    expect(inner('<div>'.repeat(D) + '<a><p></a>'.repeat(3) + 'x')).toBe('<a></a><p><a></a><a></a></p><p><a></a></p><p>"x"</p>');
    expect(inner('<div>'.repeat(D) + '<a>1<p>2</a>3')).toBe('<a>"1"</a><p><a>"2"</a>"3"</p>');
  });

  it('formatting element more than 16 entries below the top (indexOf fallback)', () => {
    expect(body('<b>' + spans(20) + 'x</b>y')).toBe('<body><b>' + spans(20) + '"x"' + close(20, 'span') + '</b>"y"</body>');
  });

  it('forms / templates and table scope on a deep stack', () => {
    const r = body(spans(D) + '<form><form>x</form>y');
    expect(r.includes('<form>"x"</form>"y"')).toBe(true);
    const t = body('<table><tr><td>' + spans(D) + '</td>z');
    expect(t.includes('"z"')).toBe(true);
    const tpl = body('<template>' + spans(D) + '<form></form></template>');
    expect(tpl.length > 0).toBe(true);
  });

  it('foreign end tags on a deep SVG stack (lowercase + camelCase fixups)', () => {
    const r = body('<svg>' + '<g>'.repeat(D) + '</x><clippath></clippath></clipPath></svg>after');
    expect(r.endsWith('"after"</body>')).toBe(true);
    const m = body('<svg>' + '<g>'.repeat(D) + '<foreignObject></foreignobject>x');
    expect(m.includes('<svg foreignObject></foreignObject>"x"')).toBe(true);
  });
});

describe('lazy CR / CRLF normalization', () => {
  // The tokenizer no longer copies the whole input to normalize line endings up
  // front; parsing raw input must still equal parsing pre-normalized input.
  const dump = (html: string) => JSON.stringify(new TreeBuilder(html).parse(), (k, v) => (k === 'parent' ? undefined : v));
  const same = (x: string) => expect(dump(x), JSON.stringify(x)).toBe(dump(x.replace(/\r\n?/g, '\n')));

  it('matches pre-normalized input in every kind of context', () => {
    for (const x of [
      'a\r\nb\rc\r\n\r\nd',
      '<p\r\nclass="x\r\ny"\rid=z\r\n>t\r\n</p\r\n>',
      '<pre>\r\nfirst LF dropped</pre><textarea>\r\nt</textarea>',
      '<title>a\r\nb</title\r\n><style>s\r\n</style\r><xmp>x\r</xmp>',
      '<!--c\r\nd--\r-->\r<!x\r\ny><?p\r?>',
      '<!DOCTYPE html PUBLIC "-//a\r\nb" \r\n"c\rd">',
      '<svg><![CDATA[a\r\nb]\r]]></svg>',
      '<script><!--\r\n<script>\r\nx</script>\r-->\r\n</script>',
      'x&#13;y&#x0d;\r\nz&amp\r\n<a href=\'&amp\r\n\'>',
      '<plaintext>a\r\nb\rc',
      'trailing\r',
    ]) same(x);
  });

  it('matches pre-normalized input on random CR-heavy fragments', () => {
    const fr = ['<script><!--', '</script>', '-->', '<!--', '-', '<svg><![CDATA[', ']]>', '<!DOCTYPE x PUBLIC "a', '" "b', '">', '<p', ' a=', '"v', '>', '</p', '<title>', '</title', '&amp', '&#13;', 'x', ' ', '\n', '\r', '\r\n', '<pre>', '<'];
    let seed = 5;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
    for (let k = 0; k < 3000; k++) {
      let x = '';
      for (let j = 1 + rnd(25); j > 0; j--) x += fr[rnd(fr.length)];
      same(x);
    }
  });
});
