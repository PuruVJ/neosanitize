/**
 * Dynamic tag matchers (`allowMatching`), the `transformAttribute` hook, and
 * `Sanitizer.toExtended()`. The inviolable baseline must still hold for every one of
 * them: matchers and hooks can widen or rewrite within safe bounds, never past them.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, type Preset } from '../../src/main/index';

const base: Preset = (b) => b.allow(['p', 'a', 'span']).allow('a', ['href']).allow('*', ['class']);

describe('allow (pattern matching)', () => {
  it('keeps tags matching a regex, unwraps the rest', () => {
    const s = Sanitizer.builder(base).allow(/^(qds|se)-/).build();
    expect(s.sanitize('<qds-card>hi</qds-card><x-other>no</x-other>')).toBe('<qds-card>hi</qds-card>no');
  });

  it('applies the matcher attribute list (plus `*`) to matched tags', () => {
    const s = Sanitizer.builder(base).allow(/^qds-/, ['variant']).build();
    expect(s.sanitize('<qds-btn variant="primary" class="c" data-x="1">go</qds-btn>'))
      .toBe('<qds-btn variant="primary" class="c">go</qds-btn>'); // variant + class kept, data-x dropped
  });

  it('still strips on* and dangerous URLs on matched tags (baseline is inviolable)', () => {
    const s = Sanitizer.builder(base).allow(/^qds-/, ['href', 'onclick']).build();
    const out = s.sanitize('<qds-link href="javascript:alert(1)" onclick="x()">y</qds-link>');
    expect(out).toBe('<qds-link>y</qds-link>');
  });

  it('accepts a predicate, and works with a global regex (no lastIndex bug)', () => {
    const pred = Sanitizer.builder(base).allow((t) => t.startsWith('se-')).build();
    expect(pred.sanitize('<se-a>1</se-a><se-b>2</se-b>')).toBe('<se-a>1</se-a><se-b>2</se-b>');
    const glob = Sanitizer.builder(base).allow(/^qds-/g).build();
    expect(glob.sanitize('<qds-x>1</qds-x><qds-y>2</qds-y>')).toBe('<qds-x>1</qds-x><qds-y>2</qds-y>');
  });

  it('is reparse-stable on matched tags', () => {
    const s = Sanitizer.builder(base).allow(/^qds-/).build();
    const once = s.sanitize('<qds-a><b>x</b><qds-a>y');
    expect(s.sanitize(once)).toBe(once);
  });

  it("'*' allows any attribute on matched tags, but the baseline still strips on*/urls", () => {
    const s = Sanitizer.builder(base).allow(/^qds-/, '*').build();
    expect(s.sanitize('<qds-w data-a="1" foo="bar" class="c">x</qds-w>'))
      .toBe('<qds-w data-a="1" foo="bar" class="c">x</qds-w>');
    expect(s.sanitize('<qds-w onclick="x()" href="javascript:1" data-ok="y">x</qds-w>'))
      .toBe('<qds-w data-ok="y">x</qds-w>');
  });
});

describe('Sanitizer.toExtended', () => {
  it('derives a variant with extra rules, leaving the base unchanged', () => {
    const baseS = Sanitizer.builder(base).build();
    const extended = baseS.toExtended((b) => b.allow(/^qds-/));

    expect(extended.sanitize('<qds-a>hi</qds-a>')).toBe('<qds-a>hi</qds-a>');
    expect(baseS.sanitize('<qds-a>hi</qds-a>')).toBe('hi'); // base is untouched
  });

  it('does not pollute the shared base across independent extensions', () => {
    const shared = Sanitizer.builder(base).build();
    const a = shared.toExtended((b) => b.allow(/^qds-/));
    const b = shared.toExtended((b) => b.allow('img', ['src']));
    expect(a.sanitize('<qds-x>1</qds-x><img src="i">')).toBe('<qds-x>1</qds-x>'); // a: qds kept, img unwrapped (void, no content)
    expect(b.sanitize('<qds-x>1</qds-x><img src="i">')).toBe('1<img src="i">');   // b: qds unwrapped (keeps "1"), img kept
    expect(shared.sanitize('<qds-x>1</qds-x><img src="i">')).toBe('1');           // base: both unwrapped
  });

  it('preserves the base policy, matchers, and hook when extending', () => {
    const baseS = Sanitizer.builder(base)
      .allow(/^qds-/)
      .transformAttribute(({ name, value }) => (name === 'class' ? value.toUpperCase() : value))
      .build();
    const extended = baseS.toExtended((b) => b.allow('img', ['src']));
    // base tag + base matcher + base hook + the newly added tag all work together
    expect(extended.sanitize('<p class="a">x</p><qds-w>y</qds-w><img src="z.png">'))
      .toBe('<p class="A">x</p><qds-w>y</qds-w><img src="z.png">');
  });
});

describe('transformAttribute', () => {
  it('rewrites a value, drops on null, leaves on undefined', () => {
    const s = Sanitizer.builder(base)
      .transformAttribute(({ name, value }) => {
        if (name === 'class') return value.replace(/secret-\S+/g, '').trim();
        if (name === 'href') return null; // drop all hrefs
        return undefined; // leave others
      })
      .build();
    expect(s.sanitize('<a href="/x" class="keep secret-abc">y</a>'))
      .toBe('<a class="keep">y</a>');
  });

  it('only runs on allow-listed attributes (cannot resurrect a denied one)', () => {
    const s = Sanitizer.builder().allow('p')
      .transformAttribute(() => 'injected')
      .build();
    expect(s.sanitize('<p title="x">y</p>')).toBe('<p>y</p>'); // title not allowed, hook never makes it appear
  });

  it('re-validates the hook result against the baseline', () => {
    const s = Sanitizer.builder(base)
      .transformAttribute(({ name }) => (name === 'href' ? 'javascript:alert(1)' : undefined))
      .build();
    // hook tries to inject a dangerous URL; baseline strips it back out
    expect(s.sanitize('<a href="/safe">y</a>')).toBe('<a>y</a>');
  });

  it('composes multiple hooks in order', () => {
    const s = Sanitizer.builder(base)
      .transformAttribute(({ name, value }) => (name === 'class' ? value + '-1' : value))
      .transformAttribute(({ name, value }) => (name === 'class' ? value + '-2' : value))
      .build();
    expect(s.sanitize('<p class="x">y</p>')).toBe('<p class="x-1-2">y</p>');
  });
});
