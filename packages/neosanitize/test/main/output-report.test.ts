/**
 * Output targets (text / fragment / TrustedHTML) + report mode for the main Sanitizer.
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../../src/main/index';
import * as presets from '../../src/main/presets';

const s = Sanitizer.builder(presets.ugc).build();

describe('output targets', () => {
  it('sanitizeToText strips markup and excludes script/style content', () => {
    expect(s.sanitizeToText('<p>Hi <b>there</b> <script>x()</script><style>y{}</style>& friends</p>')).toBe('Hi there & friends');
  });
  it('sanitizeToFragment throws outside a DOM (browser-only)', () => {
    expect(() => s.sanitizeToFragment('<p>x</p>')).toThrow(/requires a DOM/);
  });
  it('sanitizeToTrustedHTML falls back to the sanitized string when no Trusted Types', () => {
    expect(s.sanitizeToTrustedHTML('<p>x<script>e()</script></p>')).toBe('<p>x</p>');
  });
});

describe('report mode', () => {
  it('reports removed tags / attrs / urls with reasons', () => {
    const r = s.sanitizeWithReport('<p onmouseover="x()">hi <script>a()</script><a href="javascript:1" title="t">l</a></p>');
    expect(r.html).toBe('<p>hi <a title="t">l</a></p>');
    const kinds = r.removed.map((x) => `${x.kind}:${x.name}`);
    expect(kinds).toContain('attr:onmouseover');
    expect(kinds).toContain('tag:script');
    expect(kinds).toContain('url:href');
    // implicit html/head/body structure is NOT reported as removals
    expect(r.removed.some((x) => x.name === 'html' || x.name === 'head' || x.name === 'body')).toBe(false);
  });
  it('reports unsafe CSS', () => {
    const styleS = Sanitizer.builder().allow('p', ['style']).build();
    const r = styleS.sanitizeWithReport('<p style="behavior:url(x)">y</p>');
    expect(r.removed.some((x) => x.kind === 'style')).toBe(true);
    expect(r.html).toBe('<p>y</p>');
  });
  it('report html is identical to sanitize() output', () => {
    const dirty = '<div><p onclick="x()">hi <b>b</b><script>s()</script></p></div>';
    expect(s.sanitizeWithReport(dirty).html).toBe(s.sanitize(dirty));
  });
});
