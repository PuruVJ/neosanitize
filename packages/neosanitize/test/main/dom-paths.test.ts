// @vitest-environment happy-dom
/**
 * Coverage + behaviour for the DOM-only code paths, which need a real DOM:
 *   - SanitizerCore.sanitizeToFragment + buildDom (string-free, round-trip-free)
 *   - SanitizerCore.sanitizeToTrustedHTML (all three Trusted Types branches)
 *   - the browser entry's native-DOMParser parse + domToNode conversion
 *
 * Runs under happy-dom (a dev-only dependency; the library itself stays zero-dep),
 * which provides document / DocumentFragment / DOMParser.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Sanitizer } from '../../src/main/index';
import { Sanitizer as BrowserSanitizer } from '../../src/main/browser';

describe('sanitizeToFragment + buildDom', () => {
  const s = Sanitizer.builder().allow(['p', 'b', 'br', 'img']).allow('img', ['src', 'alt']).allow('*', ['class']).build();

  it('builds a DocumentFragment: keep, drop, unwrap, void, attrs, text', () => {
    const frag = s.sanitizeToFragment(
      'hi <p class="x">a<b>b</b></p><span>unwrap</span><script>drop()</script><br><img src="u" alt="y">'
    );
    expect(frag).toBeInstanceOf(DocumentFragment);
    const html = [...frag.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : (n as Element).outerHTML)).join('');
    // text kept; <p> kept with class + nested <b>; <span> unwrapped to its text;
    // <script> dropped with content; <br> + <img> void with attrs.
    expect(html).toContain('hi ');
    expect(html).toContain('<p class="x">a<b>b</b></p>');
    expect(html).toContain('unwrap');
    expect(html).not.toContain('script');
    expect(html).toContain('<br>');
    expect(html).toContain('<img src="u" alt="y">');
  });

  it('swallows an invalid DOM attribute name (setAttribute throws → caught)', () => {
    // `a"b` is a valid HTML attribute *token* but invalid for setAttribute.
    const weird = Sanitizer.builder().allow('x', ['a"b', 'ok']).build();
    const frag = weird.sanitizeToFragment('<x a"b="1" ok="2">t</x>');
    const el = frag.querySelector('x')!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('ok')).toBe('2'); // the valid one survived
    expect(el.hasAttribute('a"b')).toBe(false); // the invalid one was skipped, not thrown
  });
});

describe('sanitizeToTrustedHTML', () => {
  const s = Sanitizer.builder().allow('b').build();
  afterEach(() => { delete (globalThis as Record<string, unknown>).trustedTypes; });

  it('returns a plain string when Trusted Types is unavailable', () => {
    delete (globalThis as Record<string, unknown>).trustedTypes;
    expect(s.sanitizeToTrustedHTML('<b>x</b><script>y</script>')).toBe('<b>x</b>');
  });

  it('falls back to the safe string if createPolicy throws (caught)', () => {
    // Must run BEFORE the success case: ttPolicy caches on first success.
    (globalThis as Record<string, unknown>).trustedTypes = { createPolicy() { throw new Error('CSP blocks it'); } };
    expect(s.sanitizeToTrustedHTML('<b>x</b>')).toBe('<b>x</b>');
  });

  it('wraps via the Trusted Types policy when available', () => {
    (globalThis as Record<string, unknown>).trustedTypes = {
      createPolicy(_n: string, rules: { createHTML: (s: string) => string }) {
        return { createHTML: (str: string) => ({ toString: () => '[TT]' + rules.createHTML(str) }) };
      },
    };
    const out = s.sanitizeToTrustedHTML('<b>x</b>');
    expect(String(out)).toBe('[TT]<b>x</b>');
  });
});

describe('browser entry — native DOMParser path', () => {
  afterEach(() => { /* DOMParser is provided by happy-dom; nothing to clean */ });

  it('parses + sanitizes via the real DOMParser (foreign ns, attrs, text)', () => {
    const s = BrowserSanitizer.builder().allow(['p', 'a', 'svg']).allow('a', ['href']).build();
    const out = s.sanitize('<p>hi <a href="javascript:alert(1)" onclick="x">link</a></p>');
    expect(out).toBe('<p>hi <a>link</a></p>'); // js: url + on* stripped through native parse
  });

  it('handles <template> content and comments through domToNode', () => {
    const s = BrowserSanitizer.builder().allow(['template', 'b', 'p']).build();
    const out = s.sanitize('<p>a</p><!--c--><template><b>inside</b></template>');
    expect(out).toContain('<p>a</p>');
    expect(out).toContain('inside'); // template.content walked
    expect(out).not.toContain('<!--'); // comment dropped
  });

  it('maps SVG namespace + space-form foreign attrs', () => {
    const s = BrowserSanitizer.builder().allow('svg', ['xlink href']).build();
    const out = s.sanitize('<svg xlink:href="/ok"></svg>');
    expect(out).toContain('<svg'); // svg kept, namespace mapped to 'svg'
  });

  it('maps the MathML namespace', () => {
    const s = BrowserSanitizer.builder().allow(['math', 'mi']).build();
    const out = s.sanitize('<math><mi>x</mi></math>');
    expect(out).toContain('<math'); // namespaceURI → 'mathml'
  });

});
