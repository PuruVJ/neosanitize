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
    const s = Sanitizer.builder(base).allow(/^(ui|wc)-/).build();
    expect(s.sanitize('<ui-card>hi</ui-card><x-other>no</x-other>')).toBe('<ui-card>hi</ui-card>no');
  });

  it('applies the matcher attribute list (plus `*`) to matched tags', () => {
    const s = Sanitizer.builder(base).allow(/^ui-/, ['variant']).build();
    expect(s.sanitize('<ui-btn variant="primary" class="c" data-x="1">go</ui-btn>'))
      .toBe('<ui-btn variant="primary" class="c">go</ui-btn>'); // variant + class kept, data-x dropped
  });

  it('still strips on* and dangerous URLs on matched tags (baseline is inviolable)', () => {
    const s = Sanitizer.builder(base).allow(/^ui-/, ['href', 'onclick']).build();
    const out = s.sanitize('<ui-link href="javascript:alert(1)" onclick="x()">y</ui-link>');
    expect(out).toBe('<ui-link>y</ui-link>');
  });

  it('accepts a predicate, and works with a global regex (no lastIndex bug)', () => {
    const pred = Sanitizer.builder(base).allow((t) => t.startsWith('wc-')).build();
    expect(pred.sanitize('<wc-a>1</wc-a><wc-b>2</wc-b>')).toBe('<wc-a>1</wc-a><wc-b>2</wc-b>');
    const glob = Sanitizer.builder(base).allow(/^ui-/g).build();
    expect(glob.sanitize('<ui-x>1</ui-x><ui-y>2</ui-y>')).toBe('<ui-x>1</ui-x><ui-y>2</ui-y>');
  });

  it('is reparwc-stable on matched tags', () => {
    const s = Sanitizer.builder(base).allow(/^ui-/).build();
    const once = s.sanitize('<ui-a><b>x</b><ui-a>y');
    expect(s.sanitize(once)).toBe(once);
  });

  it("'*' allows any attribute on matched tags, but the baseline still strips on*/urls", () => {
    const s = Sanitizer.builder(base).allow(/^ui-/, '*').build();
    expect(s.sanitize('<ui-w data-a="1" foo="bar" class="c">x</ui-w>'))
      .toBe('<ui-w data-a="1" foo="bar" class="c">x</ui-w>');
    expect(s.sanitize('<ui-w onclick="x()" href="javascript:1" data-ok="y">x</ui-w>'))
      .toBe('<ui-w data-ok="y">x</ui-w>');
  });

  it('build() snapshots matchers: reusing the builder never mutates an earlier sanitizer', () => {
    const builder = Sanitizer.builder().allow('p');
    const first = builder.build();
    builder.allow(/^ui-/, '*'); // mutate the builder AFTER first.build()
    const second = builder.build();
    expect(first.sanitize('<ui-x>hi</ui-x>')).toBe('hi');                 // first must NOT gain the pattern
    expect(second.sanitize('<ui-x>hi</ui-x>')).toBe('<ui-x>hi</ui-x>');   // second has it
  });
});

describe('Sanitizer.toExtended', () => {
  it('derives a variant with extra rules, leaving the base unchanged', () => {
    const baseS = Sanitizer.builder(base).build();
    const extended = baseS.toExtended((b) => b.allow(/^ui-/));

    expect(extended.sanitize('<ui-a>hi</ui-a>')).toBe('<ui-a>hi</ui-a>');
    expect(baseS.sanitize('<ui-a>hi</ui-a>')).toBe('hi'); // base is untouched
  });

  it('does not pollute the shared base across independent extensions', () => {
    const shared = Sanitizer.builder(base).build();
    const a = shared.toExtended((b) => b.allow(/^ui-/));
    const b = shared.toExtended((b) => b.allow('img', ['src']));
    expect(a.sanitize('<ui-x>1</ui-x><img src="i">')).toBe('<ui-x>1</ui-x>'); // a: ui- kept, img unwrapped (void, no content)
    expect(b.sanitize('<ui-x>1</ui-x><img src="i">')).toBe('1<img src="i">');   // b: ui- unwrapped (keeps "1"), img kept
    expect(shared.sanitize('<ui-x>1</ui-x><img src="i">')).toBe('1');           // base: both unwrapped
  });

  it('preserves the base policy, matchers, and hook when extending', () => {
    const baseS = Sanitizer.builder(base)
      .allow(/^ui-/)
      .transformAttribute(({ name, value }) => (name === 'class' ? value.toUpperCase() : value))
      .build();
    const extended = baseS.toExtended((b) => b.allow('img', ['src']));
    // base tag + base matcher + base hook + the newly added tag all work together
    expect(extended.sanitize('<p class="a">x</p><ui-w>y</ui-w><img src="z.png">'))
      .toBe('<p class="A">x</p><ui-w>y</ui-w><img src="z.png">');
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
