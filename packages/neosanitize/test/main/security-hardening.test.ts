/**
 * Extra security hardening for the main `Sanitizer`, beyond sanitizer.test.ts.
 *
 * Safety oracle: rather than substring-grep the output (which false-positives on
 * `javascript:` / `onload=` sitting harmlessly in ESCAPED TEXT), we RE-SANITIZE
 * the output and report mode tells us if a second pass would strip any genuinely
 * dangerous construct (event handler, dangerous URL, script/iframe/…). If it
 * would, the first output was a real hole. This is robust and context-aware.
 *
 *  1. A broad adversarial vector corpus (namespace confusion, encoding tricks,
 *     raw-text breakouts, foreign-content integration points, dangling markup).
 *  2. A SEEDED generative fuzz over dangerous fragments asserting, per input:
 *       • STRICT safety: no dangerous construct survives the first sanitize, and
 *       • bounded stabilization: `sanitize²(x)` is a fixed point (convergence ≤2).
 *     (~2% of adversarial inputs aren't byte-idempotent in one pass — cosmetic
 *     tree reshaping from the tree-builder long-tail; both the output AND its
 *     fixed point are verified safe, which is what matters.)
 *  3. Unsafe-baseline differential + builder allow/deny/preset semantics.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, SanitizerBuilder, type Preset, type Removal } from '../../src/main/index';

const policy: Preset = (b) =>
  b.allow(['p', 'a', 'b', 'i', 'em', 'strong', 'span', 'div', 'ul', 'ol', 'li', 'img',
    'h1', 'h2', 'h3', 'code', 'pre', 'br', 'blockquote', 'table', 'tr', 'td', 'svg'])
    .allow('a', ['href', 'title'])
    .allow('img', ['src', 'alt'])
    .allow('*', ['class', 'style']);
const s = Sanitizer.builder(policy).build();

const DANGER_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base']);
/** Genuinely-dangerous constructs that a second sanitize of `out` would strip
 * (i.e. ones that survived the first pass). Empty ⇒ `out` is safe. */
function realDangers(out: string): Removal[] {
  return s.sanitizeWithReport(out).removed.filter(
    (r) => r.reason === 'event-handler' || r.reason === 'dangerous-url' || (r.kind === 'tag' && DANGER_TAGS.has(r.name))
  );
}
/** Iterate sanitize to a fixed point; return [fixedPoint, passes]. */
function converge(input: string, max = 8): [string, number] {
  let prev = s.sanitize(input);
  let passes = 1;
  while (passes < max) { const nx = s.sanitize(prev); if (nx === prev) break; prev = nx; passes++; }
  return [prev, passes];
}

describe('Sanitizer — extended adversarial vectors', () => {
  const vectors = [
    // namespace / foreign-content confusion + integration points
    '<svg><foreignObject><iframe src=javascript:alert(1)></foreignObject></svg>',
    '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>',
    '<svg><desc><img src=x onerror=alert(1)></desc></svg>',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<math><mi><mglyph><style>*{x:expression(alert(1))}</style></mglyph></mi></math>',
    // raw-text / RCDATA breakouts
    '<title><img src=x onerror=alert(1)></title>',
    '<textarea></textarea><img src=x onerror=alert(1)>',
    '<xmp></xmp><script>alert(1)</script>',
    '<noembed><img src=x onerror=alert(1)></noembed>',
    '<noframes><a href="javascript:alert(1)">x</a></noframes>',
    // encoding / obfuscation (the URL fast-path must defer these to the parser)
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<a href="  javascript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    // comment / bogus-comment / CDATA games
    '<!--><img src=x onerror=alert(1)><!-->',
    '<![CDATA[<img src=x onerror=alert(1)>]]>',
    '<? <img src=x onerror=alert(1)> ?>',
    // attribute-boundary / unquoted-value tricks
    '<a href=javascript:alert(1)>x</a>',
    '<a/href=javascript:alert(1)>x</a>',
    '<img/src=x/onerror=alert(1)>',
    '<a href =\n"javascript:alert(1)">x</a>',
    // mutation via implied tags + table foster parenting
    '<table><a href="javascript:alert(1)"><tr><td>x',
    '<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(1)>',
    // dangling markup / partial tags
    '<a href="javascript:alert(1)',
    '<svg><script>aler',
  ];
  for (const v of vectors) {
    it(`neutralizes ${JSON.stringify(v).slice(0, 56)}`, () => {
      const out = s.sanitize(v);
      expect(realDangers(out), `survived: ${out}`).toEqual([]);
      const [fixed, passes] = converge(v);
      expect(realDangers(fixed)).toEqual([]); // fixed point is safe too
      expect(passes).toBeLessThanOrEqual(2); // stabilizes fast (no oscillation)
    });
  }
});

describe('Sanitizer — seeded generative fuzz', () => {
  const FRAGS = [
    '<a href="javascript:alert(1)">', '</a>', '<img src=x onerror=alert(1)>', '<script>', '</script>',
    '<svg>', '</svg>', '<math>', '<mtext>', '<mglyph>', '<style>', '</style>', '<!--', '-->',
    '<![CDATA[', ']]>', '<p>', '</p>', '<b>', '<div>', '</div>', '<table>', '<td>', '<tr>',
    '<noscript>', '<textarea>', '</textarea>', '<title>', '</title>', '<xmp>', '</xmp>',
    '<plaintext>', '<foreignObject>', '<annotation-xml encoding="text/html">', '<iframe src=javascript:alert(1)>',
    '<a xlink:href="javascript:alert(1)">', '<form>', '<button formaction="javascript:alert(1)">',
    '<select autofocus onfocus=alert(1)>', '<body onload=alert(1)>', '<details open ontoggle=alert(1)>',
    'javascript:', 'data:text/html,', '&lt;', '&#x3c;', '&amp;', '&', '<', '>', '"', "'", '=', '/',
    'onload=alert(1)', ' ', '\t', '\n', 'hello', 'src=x', 'href=', '<a href=javascript:alert(1)>',
  ];
  // Seeded LCG → deterministic; any failure reproduces from the printed input.
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);

  it('no dangerous construct survives, and sanitize² is always a fixed point', () => {
    const RUNS = 5000;
    let nonIdempotent = 0;
    for (let n = 0; n < RUNS; n++) {
      let input = '';
      const len = 1 + ((rnd() * 12) | 0);
      for (let k = 0; k < len; k++) input += FRAGS[(rnd() * FRAGS.length) | 0];

      const out = s.sanitize(input);
      const d = realDangers(out);
      if (d.length) throw new Error(`DANGER survived (run ${n}): ${JSON.stringify(d)}\n in:  ${input}\n out: ${out}`);
      if (s.sanitize(out) !== out) {
        nonIdempotent++;
        // not byte-idempotent → must converge by the 2nd pass, to a SAFE fixed point
        const out2 = s.sanitize(out);
        const out3 = s.sanitize(out2);
        if (out3 !== out2) throw new Error(`no fixed point by pass 2 (run ${n})\n in: ${input}\n out2: ${out2}\n out3: ${out3}`);
        if (realDangers(out2).length) throw new Error(`fixed point unsafe (run ${n})\n in: ${input}\n out2: ${out2}`);
      }
    }
    // characterize (informational): the cosmetic non-idempotence rate stays low.
    expect(nonIdempotent / RUNS).toBeLessThan(0.05);
  });
});

describe('Sanitizer — baseline differential + builder semantics', () => {
  it('sanitizeUnsafe keeps a javascript: URL that sanitize strips (baseline is the only diff)', () => {
    const b = Sanitizer.builder().allow('a', ['href']).build();
    expect(b.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(b.sanitizeUnsafe('<a href="javascript:alert(1)">x</a>')).toContain('javascript:');
  });

  it('sanitizeUnsafe still enforces the allow-list (unsafe ≠ no policy)', () => {
    const b = Sanitizer.builder().allow('b').build();
    expect(b.sanitizeUnsafe('<b>ok</b><script>alert(1)</script>')).toBe('<b>ok</b>');
  });

  it('builder allow() / deny() compose; deny removes a tag + its attrs', () => {
    const b = new SanitizerBuilder(Sanitizer).allow('a', ['href']).allow('b').deny('b').build();
    expect(b.sanitize('<a href="/x">y</a><b>z</b>')).toBe('<a href="/x">y</a>z');
  });

  it('presets compose: applying one then refining unions tags + attrs', () => {
    const b = Sanitizer.builder()
      .allow('p', ['class'])
      .preset((bb) => bb.allow('a', ['href']))
      .build();
    expect(b.sanitize('<p class="x"><a href="/y">z</a></p>')).toBe('<p class="x"><a href="/y">z</a></p>');
  });
});
