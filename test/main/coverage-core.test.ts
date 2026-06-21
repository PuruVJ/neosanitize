/**
 * Targeted coverage for core.ts branches not hit by the behaviour suites: the CSS
 * safe-subset, the dangerousUrl SLOW path (obfuscated schemes that defeat the
 * clean-scheme fast path and fall through to the native URL parser), and the
 * builder/unsafe entry points.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../../src/main/index';

const url = Sanitizer.builder({ tags: ['a'], attrs: { a: ['href'] } }).build();
const href = (v: string) => url.sanitizeWithReport(`<a href="${v}">x</a>`).removed.some((r) => r.kind === 'url');

const styled = Sanitizer.builder({ tags: ['p'], attrs: { p: ['style'] } }).build();
const css = (v: string) => styled.sanitize(`<p style="${v}">x</p>`);

describe('dangerousUrl — fast + slow paths', () => {
  it('clean schemes use the fast path', () => {
    expect(href('https://ok.test/p')).toBe(false);
    expect(href('/relative')).toBe(false);
    expect(href('mailto:a@b.test')).toBe(false);
    expect(href('javascript:alert(1)')).toBe(true);   // clean js:
    expect(href('vbscript:msgbox(1)')).toBe(true);     // clean vbscript:
    expect(href('data:image/png;base64,AAAA')).toBe(false); // data:image ok
    expect(href('data:text/html,x')).toBe(true);       // data non-image
    // schemes exercising each clean-scheme character class: upper, digit, + - .
    expect(href('HTTPS://x')).toBe(false);     // uppercase letters
    expect(href('h2c://x')).toBe(false);       // digit
    expect(href('coap+tcp://x')).toBe(false);  // +
    expect(href('view-source://x')).toBe(false); // -
    expect(href('a.b://x')).toBe(false);       // .
  });

  it('obfuscated schemes fall to the slow (native URL) path', () => {
    // &#9; decodes to a TAB inside the scheme → clean-scheme scan fails → new URL()
    expect(href('java&#9;script:alert(1)')).toBe(true);   // tab in javascript
    expect(href('da&#9;ta:text/html,x')).toBe(true);      // tab in data (non-image)
    // An OBFUSCATED data: URL is stripped even if it resolves to an image — the
    // slow-path image check is intentionally conservative (raw value still has the
    // tab, so it doesn't match "data:image/"). Over-cautious, but safe.
    expect(href('da&#9;ta:image/png,x')).toBe(true);
  });

  it('an obfuscated but harmless scheme stays allowed via the slow path', () => {
    expect(href('htt&#9;p://ok.test')).toBe(false); // tab in "http" → slow path → safe
  });

  it('a value whose scheme is unparseable is treated as a safe relative URL', () => {
    // "foo bar:baz" — space makes new URL() throw → scheme null → string fallback → safe
    expect(href('foo bar:baz')).toBe(false);
  });
});

describe('CSS safe-subset (style attribute)', () => {
  it('keeps benign declarations', () => {
    expect(css('color: red; margin: 0')).toBe('<p style="color: red; margin: 0">x</p>');
  });
  it('drops control-char, expression(), and script-scheme values', () => {
    expect(css('width: expression(alert(1))')).toBe('<p>x</p>');
    expect(css('color: ' + String.fromCharCode(1) + 'red')).toBe('<p>x</p>'); // real C0 control char
    expect(css('background: javascript:alert(1)')).toBe('<p>x</p>');
    expect(css('x: vbscript:foo')).toBe('<p>x</p>');
  });
  it('drops url(data:) non-image but keeps url(data:image/…)', () => {
    expect(css('background: url(data:text/html,x)')).toBe('<p>x</p>');
    expect(css('background: url(data:image/png,x)')).toContain('url(data:image/png,x)');
  });
  it('drops behavior / -moz-binding / -ms-behavior properties', () => {
    expect(css('behavior: url(x.htc)')).toBe('<p>x</p>');
    expect(css('-moz-binding: url(x)')).toBe('<p>x</p>');
    expect(css('-ms-behavior: url(x)')).toBe('<p>x</p>');
  });
  it('handles no-colon, empty, quoted and parenthesised declarations', () => {
    expect(css('novalue')).toBe('<p>x</p>');           // no colon
    expect(css('color:')).toBe('<p>x</p>');             // empty value
    expect(css("font-family: 'a; b', sans")).toContain('font-family'); // ; inside quotes kept
    expect(css('transform: translate(1px, 2px)')).toContain('translate(1px, 2px)'); // , inside parens
  });
});

describe('builder + unsafe entry points', () => {
  it('builder() with no base argument', () => {
    const s = Sanitizer.builder().allow('b').build();
    expect(s.sanitize('<b>x</b><i>y</i>')).toBe('<b>x</b>y');
  });
  it('builder() seeded from a partial policy object', () => {
    const s = Sanitizer.builder({ tags: ['em'], attrs: { em: ['class'] }, allowUnsafe: false }).build();
    expect(s.sanitize('<em class="a">x</em>')).toBe('<em class="a">x</em>');
  });
  it('sanitizeUnsafe re-parses with the same parser and the baseline off', () => {
    expect(url.sanitizeUnsafe('<a href="javascript:alert(1)">x</a>')).toContain('javascript:');
  });

  it('report distinguishes event-handler from dangerous-url removals', () => {
    // onclick must be allow-listed so the BASELINE (not the allow-list) strips it,
    // yielding reason "event-handler"; the js: href yields "dangerous-url".
    const s = Sanitizer.builder({ tags: ['a'], attrs: { a: ['onclick', 'href'] } }).build();
    const reasons = s.sanitizeWithReport('<a onclick="x()" href="javascript:1">y</a>').removed.map((r) => r.reason);
    expect(reasons).toContain('event-handler');
    expect(reasons).toContain('dangerous-url');
  });

  it('partial policies may omit tags / attrs / allowUnsafe', () => {
    expect(Sanitizer.builder({ attrs: { a: ['href'] } }).build().sanitize('<a href="/x">y</a>')).toBe('y'); // no tags → all dropped/unwrapped
    expect(Sanitizer.builder({ tags: ['b'] }).build().sanitize('<b>x</b>')).toBe('<b>x</b>'); // no attrs key
  });
});
