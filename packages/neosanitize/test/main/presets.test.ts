/**
 * Curated preset tests — each preset is branded, sanitizes its intended tag set,
 * neutralizes XSS, and is idempotent. Presets are passed into the class API
 * (`new Sanitizer(preset.policy)` or `Sanitizer.builder(preset).build()`).
 */
import { describe, it, expect } from 'vitest';
import { Sanitizer, UNSAFE_PRESET_SYMBOL } from '../../src/main/index';
import * as presets from '../../src/main/presets';

describe('presets', () => {
  it('are branded, named, and safe-by-default', () => {
    for (const [name, p] of Object.entries(presets)) {
      expect(p[UNSAFE_PRESET_SYMBOL]).toBe(true);
      expect(p.name).toBe(name);
      expect(p.policy.allowUnsafe).toBe(false);
    }
  });

  it('work through the builder', () => {
    const s = Sanitizer.builder(presets.ugc).build();
    expect(s.sanitize('<h2 class="x">Title</h2><p>hi <b>b</b></p>')).toBe('<h2 class="x">Title</h2><p>hi <b>b</b></p>');
  });

  it('none → text only', () => {
    const s = new Sanitizer(presets.none.policy);
    expect(s.sanitize('<p>hi <b>bold</b> <a href="x">l</a></p>')).toBe('hi bold l');
  });

  it('basic → inline/block formatting, headings dropped', () => {
    const s = new Sanitizer(presets.basic.policy);
    expect(s.sanitize('<p>hi <strong>x</strong></p><h1>no heading</h1>')).toBe('<p>hi <strong>x</strong></p>no heading');
  });

  it('every preset neutralizes XSS and is idempotent', () => {
    const vectors = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">x</a>',
      '<svg onload=alert(1)></svg>',
      '<table><tr><td><img src=x onerror=alert(1)></td></tr></table>'
    ];
    for (const p of Object.values(presets)) {
      const s = new Sanitizer(p.policy);
      for (const v of vectors) {
        const out = s.sanitize(v);
        expect(/<script[\s/>]|\son[a-z]+\s*=|javascript:/i.test(out), `${p.name} → ${out}`).toBe(false);
        expect(s.sanitize(out)).toBe(out);
      }
    }
  });

  it('markdown → keeps task-lists + code language class', () => {
    const s = new Sanitizer(presets.markdown.policy);
    expect(s.sanitize('<pre><code class="language-js">x</code></pre>')).toBe('<pre><code class="language-js">x</code></pre>');
    expect(s.sanitize('<a href="https://e.com" onclick="x">l</a>')).toBe('<a href="https://e.com">l</a>');
  });
});
