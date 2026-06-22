/**
 * `neosanitize/parse` — the policy-free, browser-faithful parse tree surface.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize, walk, textContent, find, findAll } from '../../src/main/parse';

describe('neosanitize/parse', () => {
  it('parses a full document (implied html/head/body, like DOMParser)', () => {
    const doc = parse('<p>hi</p>');
    expect(doc.type).toBe('document');
    expect(find(doc, 'html')?.name).toBe('html');
    expect(find(doc, 'head')).toBeTruthy();
    expect(find(doc, 'body')).toBeTruthy();
    expect(find(doc, 'p')?.name).toBe('p');
  });

  it('serialize round-trips faithfully', () => {
    expect(serialize(parse('<p>hi <b>there</b></p>'))).toBe(
      '<html><head></head><body><p>hi <b>there</b></p></body></html>',
    );
    // serialize a single subtree too
    const p = find(parse('<p><a>x</a></p>'), 'p')!;
    expect(serialize(p)).toBe('<p><a>x</a></p>');
  });

  it('is browser-faithful, not a naive string parse', () => {
    // a second <p> implicitly closes the first
    expect(serialize(parse('<p>a<p>b'))).toContain('<p>a</p><p>b</p>');
    // non-whitespace text in a table is foster-parented out BEFORE the table
    expect(serialize(parse('<table>x<tr><td>y'))).toMatch(/x<table>/);
  });

  it('serialize escapes text + attrs, leaves raw-text alone, voids self-close', () => {
    expect(serialize(parse('<p>a < b & c</p>'))).toContain('a &lt; b &amp; c');
    expect(serialize(parse(`<a title='x "y" & z'>t</a>`))).toContain('title="x &quot;y&quot; &amp; z"');
    expect(serialize(parse('<style>a < b</style>'))).toContain('<style>a < b</style>'); // not escaped
    expect(serialize(parse('<img src=x>'))).toContain('<img src="x">'); // void: no </img>
  });

  it('find / findAll by tag name and by predicate', () => {
    const doc = parse('<main><a href="/x">one</a><a href="/y">two</a><span>s</span></main>');
    const links = findAll(doc, 'a');
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.attrs.find(([k]) => k === 'href')![1])).toEqual(['/x', '/y']);
    expect(find(doc, (el) => el.name === 'span')?.name).toBe('span');
    expect(find(doc, 'nope')).toBeNull();
  });

  it('textContent concatenates descendant text', () => {
    expect(textContent(parse('<p>a<b>b<i>c</i></b>d</p>'))).toBe('abcd');
  });

  it('walk visits descendants; returning false skips that subtree', () => {
    const names: string[] = [];
    walk(parse('<div><p><a>x</a></p><span>y</span></div>'), (n) => {
      if (n.type === 'element') {
        names.push(n.name);
        if (n.name === 'p') return false; // skip <a> under <p>
      }
    });
    expect(names).toContain('span');
    expect(names).not.toContain('a');
  });
});
