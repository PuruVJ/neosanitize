/**
 * Behaviour + security tests for the main `Sanitizer` (policy engine + serializer
 * on the browser-faithful parser).
 *
 * Covers: deny-by-default allow-listing, the INVIOLABLE unsafe-baseline (script /
 * event-handlers / dangerous-URLs stripped even when the allow-list permits them;
 * only `sanitizeUnsafe()` escapes it), correct text/attribute escaping, an
 * mXSS/XSS vector corpus with a "no dangerous construct survives" invariant, and
 * idempotence (`sanitize∘sanitize = sanitize`, i.e. reparse-stability).
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, type Preset } from '../../src/main/index';

const ugcLike: Preset = (b) => {
  b.allow(['p', 'a', 'b', 'i', 'em', 'strong', 'span', 'div', 'ul', 'ol', 'li', 'img', 'h1', 'h2', 'h3', 'code', 'pre', 'br', 'blockquote'])
    .allow('a', ['href', 'title'])
    .allow('img', ['src', 'alt'])
    .allow('*', ['class']);
};
const s = Sanitizer.builder(ugcLike).build();

/** No script element, no inline event handler, no javascript:/vbscript: URL survives. */
function noDanger(out: string): boolean {
  return !/<script[\s/>]/i.test(out) && !/\son[a-z]+\s*=/i.test(out) && !/(?:javascript|vbscript)\s*:/i.test(out);
}

describe('Sanitizer — policy basics', () => {
  it('keeps allow-listed tags/attrs, drops the rest', () => {
    expect(s.sanitize('<p class="x">hi <b>bold</b> <u>under</u></p>')).toBe('<p class="x">hi <b>bold</b> under</p>');
    expect(s.sanitize('<a href="https://e.com" title="t" rel="x">l</a>')).toBe('<a href="https://e.com" title="t">l</a>');
  });
  it('unwraps disallowed elements but keeps their (sanitized) children', () => {
    // section is not allow-listed → unwrapped; div + i are kept
    expect(s.sanitize('<div><section><i>hi</i></section></div>')).toBe('<div><i>hi</i></div>');
    // table is not allow-listed → fully unwrapped to its text
    expect(s.sanitize('<table><tr><td>cell</td></tr></table>')).toBe('cell');
  });
  it('escapes text and attribute values correctly (spaces preserved)', () => {
    expect(s.sanitize('<p>a & b < c > d   spaced</p>')).toBe('<p>a &amp; b &lt; c &gt; d   spaced</p>');
    expect(s.sanitize('<a href="https://e.com/?a=1&b=2&quot;">l</a>')).toBe('<a href="https://e.com/?a=1&amp;b=2&quot;">l</a>');
  });
});

describe('Sanitizer — inviolable baseline (holds even when allow-listed)', () => {
  const permissive = Sanitizer.builder()
    .allow('script')
    .allow('a', ['href'])
    .allow('b', ['onclick'])
    .allow('img', ['src', 'onerror'])
    .build();
  it('drops <script> even if allow-listed', () => {
    expect(permissive.sanitize('a<script>alert(1)</script>b')).toBe('ab');
  });
  it('strips event handlers even if allow-listed', () => {
    expect(permissive.sanitize('<b onclick="evil()">x</b>')).toBe('<b>x</b>');
    expect(permissive.sanitize('<img src=x onerror="alert(1)">')).toBe('<img src="x">');
  });
  it('strips javascript:/vbscript:/data: URLs even if allow-listed', () => {
    expect(permissive.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(permissive.sanitize('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>');
    expect(permissive.sanitize('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(permissive.sanitize('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>'); // control-char obfuscation
    expect(permissive.sanitize('<a href="https://ok.com">x</a>')).toBe('<a href="https://ok.com">x</a>');
  });
  it('sanitizeUnsafe() escapes the baseline', () => {
    expect(permissive.sanitizeUnsafe('<b onclick="e()">x</b>')).toBe('<b onclick="e()">x</b>');
    expect(permissive.sanitizeUnsafe('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('Sanitizer — mXSS / XSS vector corpus', () => {
  const vectors = [
    '<img src=x onerror=alert(1)>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<math><mtext><table><mglyph><style><!--</style><img src=1 onerror=alert(1)>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<style>@import "evil.css"; body{background:url(javascript:alert(1))}</style>',
    '<form><button formaction="javascript:alert(1)">x</button></form>',
    '<body onload=alert(1)>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<details open ontoggle=alert(1)>',
    '<select autofocus onfocus=alert(1)>',
    '<x foo="bar"><script>alert(1)</script></x>',
    '<!--<img src=x onerror=alert(1)>-->'
  ];
  for (const v of vectors) {
    it(`neutralizes ${JSON.stringify(v).slice(0, 60)}`, () => {
      const out = s.sanitize(v);
      expect(noDanger(out), `output: ${out}`).toBe(true);
      // idempotence / reparse-stability
      expect(s.sanitize(out)).toBe(out);
    });
  }
});
