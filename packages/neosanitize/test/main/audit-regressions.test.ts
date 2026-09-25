/**
 * Regressions for the 2026-09 security audit of the modern engine. Every case is a
 * confirmed bypass: output that, re-parsed by a real browser, produced a live
 * `on*` handler, a `javascript:` link, a same-origin `srcdoc` document, or a crash.
 *
 * Oracle: re-parse the sanitized output with parse5 (the reference WHATWG parser)
 * with scripting both ON (a live page) and OFF, then walk the tree for anything
 * that runs script. None of the shipped presets is affected; each case needs a
 * permissive allow-list whose tags are individually harmless.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'parse5';
import { Sanitizer } from '../../src/main/index';
import { parse5Adapter } from '../../src/main/parse5';
import { htmlparser2Adapter } from '../../src/main/htmlparser2';
import { parse as whatwgParse, serialize, walk, textContent, findAll } from '../../src/main/whatwg-parser';
import type { ParseAdapter, Preset } from '../../src/main/index';

interface P5 {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5[];
  content?: { childNodes: P5[] };
}

/** Every script-capable construct in `html` when a browser re-parses it. */
function liveHazards(html: string): string[] {
  const hits: string[] = [];
  for (const scriptingEnabled of [true, false]) {
    const stack: P5[] = [parse(html, { scriptingEnabled }) as unknown as P5];
    while (stack.length) {
      const n = stack.pop()!;
      for (const a of n.attrs ?? []) {
        const v = a.value.replace(/[\t\n\r]/g, '').trim().toLowerCase();
        if (a.name.startsWith('on')) hits.push(`${n.nodeName}[${a.name}]`);
        if (a.name === 'srcdoc') hits.push(`${n.nodeName}[srcdoc]`);
        if (v.startsWith('javascript:')) hits.push(`${n.nodeName}[${a.name}=javascript:]`);
      }
      if (n.nodeName === 'script') hits.push('script');
      stack.push(...(n.childNodes ?? []), ...(n.content?.childNodes ?? []));
    }
  }
  return hits;
}

function build(preset: Preset, parser?: ParseAdapter) {
  const b = Sanitizer.builder(preset);
  if (parser) b.parser(parser);
  return b.build();
}

const XSS = '<img src=x onerror=alert(1)>';
const ESC = '&lt;img src=x onerror=alert(1)&gt;';

// [label, policy, input, parser?]
const cases: Array<[string, Preset, string, ParseAdapter?]> = [
  // 1. htmlparser2 decodes entities inside svg/math raw-text elements.
  ['h2: svg > style entity breakout', (b) => b.allow(['style']), `<svg><style>&lt;/style&gt;${ESC}</style></svg>`, htmlparser2Adapter],
  ['h2: math > xmp entity breakout', (b) => b.allow(['xmp']), `<math><xmp>&lt;/xmp&gt;${ESC}</xmp></math>`, htmlparser2Adapter],
  ['h2: kept svg > style', (b) => b.allow(['svg', 'style']), `<svg><style>${ESC}</style></svg>`, htmlparser2Adapter],
  // 2. Re-parse context differs from parse context (namespace confusion).
  ['foreignObject unwrapped', (b) => b.allow(['svg', 'style']), `<svg><foreignObject><style>${XSS}</style></foreignObject></svg>`],
  ['math > mi unwrapped', (b) => b.allow(['math', 'style']), `<math><mi><style>${XSS}</style></mi></math>`],
  ['svg > desc > xmp', (b) => b.allow(['svg', 'xmp']), `<svg><desc><xmp>${XSS}</xmp></desc></svg>`],
  ['foreignObject > template > style', (b) => b.allow(['svg', 'template', 'style']), `<svg><foreignObject><template><style>${XSS}</style></template></foreignObject></svg>`],
  ['annotation-xml encoding dropped', (b) => b.allow(['math', 'annotation-xml', 'style']), `<math><annotation-xml encoding="text/html"><style>${XSS}</style></annotation-xml></math>`],
  ['mglyph under mtext', (b) => b.allow(['math', 'mtext', 'mglyph', 'style']), `<math><mtext><table><mglyph><style>${XSS}`],
  ['malignmark + xmp', (b) => b.allow(['math', 'mtext', 'malignmark', 'xmp']), `<math><mtext><table><malignmark><xmp>${XSS}`],
  ['parse5: foreignObject unwrapped', (b) => b.allow(['svg', 'style']), `<svg><foreignObject><style>${XSS}</style></foreignObject></svg>`, parse5Adapter],
  // 3. srcdoc is a same-origin document, not a URL.
  ['iframe srcdoc', (b) => b.allow('iframe', ['srcdoc']), `<iframe srcdoc="${ESC}"></iframe>`],
  ['iframe srcdoc via *', (b) => b.allow('iframe', '*'), `<iframe srcdoc="${ESC}"></iframe>`],
  // 4. noscript: attribute value closes the element under scripting-on re-parse.
  ['noscript attr breakout', (b) => b.allow(['div', 'noscript', 'p']).allow('p', ['title']), `<div><noscript><p title="</noscript>${XSS}"></p></noscript></div>`],
  // 5. xlink:href colon form.
  ['xlink:href after foreignObject unwrap', (b) => b.allow(['svg']).allow('a', '*'), '<svg><foreignObject><a xlink:href="javascript:alert(1)">click</a></foreignObject></svg>'],
  ['h2: xlink:href', (b) => b.allow(['svg']).allow('a', '*'), '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', htmlparser2Adapter],
  // 6. SVG animation rewriting href.
  ['svg set href', (b) => b.allow(['svg']).allow(['a', 'animate', 'set'], '*'), '<svg><a><set attributeName="href" to="javascript:alert(1)"/><text y=20>click</text></a></svg>'],
  ['svg animate xlink:href', (b) => b.allow(['svg']).allow(['a', 'animate', 'set'], '*'), '<svg><a><animate attributeName="xlink:href" values="javascript:alert(1)"/><text y=20>click</text></a></svg>'],
];

describe('audit regressions: no live script after browser re-parse', () => {
  for (const [label, preset, input, parser] of cases) {
    it(label, () => {
      const out = build(preset, parser).sanitize(input);
      expect(liveHazards(out), out).toEqual([]);
    });
  }
});

describe('audit regressions: data: URL MIME obfuscation', () => {
  it('tab / newline inside image/svg+xml is caught', () => {
    const s = Sanitizer.builder().allow('iframe', ['src']).build();
    for (const sep of ['&#9;', '&#10;', '&#13;']) {
      expect(s.sanitize(`<iframe src="data:image/s${sep}vg+xml,x"></iframe>`)).toBe('<iframe></iframe>');
    }
  });
});

describe('audit regressions: deep nesting never overflows the stack', () => {
  const deep = '<div>'.repeat(50_000) + 'x';
  const s = Sanitizer.builder().allow(['div']).build();

  it('sanitizeToText', () => {
    expect(s.sanitizeToText(deep)).toBe('x');
  });
  it('parse5 adapter', () => {
    expect(build((b) => b.allow(['div']), parse5Adapter).sanitizeToText(deep)).toBe('x');
  });
  it('htmlparser2 adapter', () => {
    expect(build((b) => b.allow(['div']), htmlparser2Adapter).sanitizeToText(deep)).toBe('x');
  });
  it('whatwg-parser helpers', () => {
    const doc = whatwgParse(deep);
    expect(textContent(doc)).toBe('x');
    expect(findAll(doc, 'div').length).toBe(50_000);
    let n = 0;
    walk(doc, () => { n++; });
    expect(n).toBeGreaterThan(50_000);
    expect(serialize(doc).length).toBeGreaterThan(deep.length);
  });
});

describe('audit regressions: whatwg-parser serialize()', () => {
  it('foreign raw-text content is escaped, not emitted raw', () => {
    const out = serialize(whatwgParse(`<svg><style>${ESC}</style></svg>`));
    expect(liveHazards(out)).toEqual([]);
  });
});

describe('audit regressions: duplicate-attribute check is linear', () => {
  it('60k attributes on one tag parse fast, first occurrence wins', () => {
    const names = Array.from({ length: 60_000 }, (_, i) => `a${i}`).join(' ');
    const t = performance.now();
    const doc = whatwgParse(`<p ${names} a5="dup" a59999="dup">`);
    expect(performance.now() - t).toBeLessThan(1000);
    const p = findAll(doc, 'p')[0];
    expect(p.attrs.length).toBe(60_000);
    expect(p.attrs.find(([n]) => n === 'a5')![1]).toBe('');
  });
});

describe('audit regressions: legitimate raw text is untouched', () => {
  it('style without "<" is emitted verbatim', () => {
    const s = Sanitizer.builder().allow(['style']).build();
    expect(s.sanitize('<style>a > b { color: red }</style>')).toBe('<style>a > b { color: red }</style>');
  });
});

describe('audit regressions: <command> no longer loops forever', () => {
  it('any input with <command> sanitizes instead of overflowing the stack', () => {
    const s = Sanitizer.builder().allow(['p']).build();
    expect(s.sanitize('<p>x<command>y</p>')).toBe('<p>xy</p>');
    expect(s.sanitize('<command>')).toBe('');
    expect(s.sanitize('<head><command></head><p>z')).toBe('<p>z</p>');
  });
});

describe('audit regressions: many distinct unclosed formatting elements', () => {
  it("Noah's Ark scan is bounded (was ~2 s on 250 KB)", () => {
    const s = Sanitizer.builder().allow(['b']).build();
    const html = Array.from({ length: 20_000 }, (_, i) => `<b id=${i}>`).join('') + 'x';
    const t = performance.now();
    expect(s.sanitize(html).endsWith('x' + '</b>'.repeat(20_000))).toBe(true);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('audit regressions: comment at end of input after text', () => {
  it('is kept (the EOF token used to overwrite it in the token queue)', () => {
    expect(serialize(whatwgParse('abc<!--x'))).toBe('<html><head></head><body>abc<!--x--></body></html>');
    expect(serialize(whatwgParse('a<b>c<!--z'))).toBe('<html><head></head><body>a<b>c<!--z--></b></body></html>');
  });
});
