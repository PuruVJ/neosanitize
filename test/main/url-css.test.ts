/**
 * URL (native-`URL`-backed) + CSS safe-subset tests for the main Sanitizer.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, type Policy } from '../../src/main/index';

const policy: Policy = {
  tags: new Set(['p', 'a', 'div', 'img']),
  attrs: new Map<string, Set<string>>([['*', new Set(['style'])], ['a', new Set(['href'])], ['img', new Set(['src'])]]),
  allowUnsafe: false
};
const s = new Sanitizer(policy);

describe('URL safety (native URL parser)', () => {
  it('keeps safe schemes + relative', () => {
    expect(s.sanitize('<a href="https://e.com">x</a>')).toBe('<a href="https://e.com">x</a>');
    expect(s.sanitize('<a href="mailto:x@e.com">x</a>')).toBe('<a href="mailto:x@e.com">x</a>');
    expect(s.sanitize('<a href="/p?a=1">x</a>')).toBe('<a href="/p?a=1">x</a>');
    expect(s.sanitize('<a href="#frag">x</a>')).toBe('<a href="#frag">x</a>');
  });
  it('strips dangerous schemes incl. control-char/whitespace obfuscation', () => {
    expect(s.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(s.sanitize('<a href="java\nscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(s.sanitize('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(s.sanitize('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>');
    expect(s.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });
  it('data: only allowed for images', () => {
    expect(s.sanitize('<img src="data:image/png;base64,AAA">')).toBe('<img src="data:image/png;base64,AAA">');
    expect(s.sanitize('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe('<a>x</a>');
  });
});

describe('CSS safe-subset (style attribute)', () => {
  it('keeps safe declarations, drops dangerous ones', () => {
    expect(s.sanitize('<p style="color:red; background:url(javascript:alert(1)); margin:4px">x</p>'))
      .toBe('<p style="color: red; margin: 4px">x</p>');
  });
  it('drops expression(), behavior, -moz-binding', () => {
    expect(s.sanitize('<p style="width: expression(alert(1)); color: blue">x</p>')).toBe('<p style="color: blue">x</p>');
    expect(s.sanitize('<p style="behavior:url(x.htc); color:green">x</p>')).toBe('<p style="color: green">x</p>');
    expect(s.sanitize('<p style="-moz-binding:url(evil.xml); color:teal">x</p>')).toBe('<p style="color: teal">x</p>');
  });
  it('url() data: only for images', () => {
    expect(s.sanitize('<p style="background:url(data:image/png;base64,AAA)">x</p>')).toBe('<p style="background: url(data:image/png;base64,AAA)">x</p>');
    expect(s.sanitize('<p style="background:url(data:text/html,evil)">x</p>')).toBe('<p>x</p>');
  });
  it('drops the style attribute entirely when all declarations are unsafe', () => {
    expect(s.sanitize('<p style="behavior:url(x)">x</p>')).toBe('<p>x</p>');
  });
  it('is idempotent on styled content', () => {
    const dirty = '<p style="color:red; x:expression(1); background:url(javascript:1)">hi</p>';
    const once = s.sanitize(dirty);
    expect(s.sanitize(once)).toBe(once);
  });
});
