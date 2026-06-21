/**
 * html5lib-tests tree-construction conformance harness for the main tree builder.
 *
 * Parses the vendored `.dat` cases, runs `TreeBuilder.parse()`, serializes the
 * tree into html5lib's `| `-indented format, and compares to the expected
 * `#document`. Pass rate is ratcheted (`BASELINE`) — it can only go up. Bump it
 * as tree-construction modes are completed. Fragment (`#document-fragment`) and
 * scripting (`#script-on`) cases are skipped for now (no fragment context / no
 * scripting flag yet) and reported separately. See SNAPSHOT.txt for the pin.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TreeBuilder, type DocumentNode, type TreeNode, type ElementNode
} from '../../src/main/parser/tree-builder';

// Current tree-construction conformance floor (ratchet — only goes up). 927/1170
// after table modes + foster parenting + CDATA-in-foreign. Remaining is a long
// tail: foreign edge cases (tests19), script-data-escaped (tests16), misc.
const BASELINE = 0.95;

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'html5lib', 'tree-construction');

interface DatTest {
  data: string;
  document: string;
  fragment?: string;
  scriptOn?: boolean;
}

function parseDat(text: string): DatTest[] {
  const tests: DatTest[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i] !== '#data') { i++; continue; }
    i++;
    const data: string[] = [];
    while (i < lines.length && lines[i] !== '#errors' && lines[i] !== '#new-errors') { data.push(lines[i]); i++; }
    const t: DatTest = { data: data.join('\n'), document: '' };
    // skip to #document / #document-fragment, capturing fragment + script flags
    while (i < lines.length && !lines[i].startsWith('#document')) {
      if (lines[i] === '#document-fragment') { i++; t.fragment = lines[i]; }
      else if (lines[i] === '#script-on') t.scriptOn = true;
      i++;
    }
    if (lines[i] === '#document-fragment') { i++; t.fragment = lines[i]; i++; }
    // now at #document
    if (lines[i] === '#document') i++;
    const doc: string[] = [];
    while (i < lines.length && lines[i] !== '#data') {
      if (lines[i] === '' && (i + 1 >= lines.length || lines[i + 1] === '#data')) break;
      doc.push(lines[i]); i++;
    }
    t.document = doc.join('\n').replace(/\n+$/, '');
    tests.push(t);
  }
  return tests;
}

const NS_PREFIX: Record<string, string> = { html: '', svg: 'svg ', mathml: 'math ' };

function serialize(doc: DocumentNode): string {
  const out: string[] = [];
  const walk = (node: TreeNode, depth: number) => {
    const ind = '| ' + '  '.repeat(depth);
    if (node.type === 'doctype') {
      let s = '<!DOCTYPE ' + node.name;
      if (node.publicId || node.systemId) s += ` "${node.publicId}" "${node.systemId}"`;
      out.push(ind + s + '>');
    } else if (node.type === 'comment') {
      out.push(ind + '<!-- ' + node.value + ' -->');
    } else if (node.type === 'text') {
      out.push(ind + '"' + node.value + '"');
    } else {
      const el = node as ElementNode;
      out.push(ind + '<' + (NS_PREFIX[el.namespace] ?? '') + el.name + '>');
      const attrs = el.attrs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [k, v] of attrs) out.push('| ' + '  '.repeat(depth + 1) + k + '="' + v + '"');
      for (const c of el.children) walk(c, depth + 1);
    }
  };
  for (const c of doc.children) walk(c, 0);
  return out.join('\n');
}

describe('main tree builder — html5lib conformance', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.dat'));
  let total = 0, passed = 0, skipped = 0;
  const failures: string[] = [];
  const perFile: Record<string, { pass: number; total: number }> = {};

  for (const file of files) {
    const tests = parseDat(readFileSync(join(DIR, file), 'utf8'));
    perFile[file] = { pass: 0, total: 0 };
    for (const t of tests) {
      if (t.fragment || t.scriptOn) { skipped++; continue; }
      total++;
      perFile[file].total++;
      let ok = false;
      try {
        const got = serialize(new TreeBuilder(t.data).parse());
        ok = got === t.document;
        if (!ok && failures.length < 30) {
          failures.push(`[${file}] ${JSON.stringify(t.data).slice(0, 70)}\n   want: ${JSON.stringify(t.document).slice(0, 90)}\n   got:  ${JSON.stringify(got).slice(0, 90)}`);
        }
      } catch (e) {
        if (failures.length < 30) failures.push(`[${file}] THREW ${JSON.stringify(t.data).slice(0, 60)}: ${(e as Error).message}`);
      }
      if (ok) { passed++; perFile[file].pass++; }
    }
  }

  it(`passes ≥${(BASELINE * 100).toFixed(0)}% of html5lib tree-construction cases`, () => {
    const rate = passed / total;
    // eslint-disable-next-line no-console
    console.log(`[tree] ${passed}/${total} cases (${(rate * 100).toFixed(1)}%), ${skipped} fragment/script skipped`);
    const worst = Object.entries(perFile)
      .map(([f, s]) => [f, s.total - s.pass, s.total] as const)
      .filter(([, miss]) => miss > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    // eslint-disable-next-line no-console
    console.log('  worst files (misses): ' + worst.map(([f, m, t]) => `${f}:${m}/${t}`).join('  '));
    if (failures.length) {
      // eslint-disable-next-line no-console
      console.log('  sample failures:\n' + failures.slice(0, 15).join('\n'));
    }
    expect(total).toBeGreaterThan(700);
    expect(rate).toBeGreaterThanOrEqual(BASELINE);
  });
});
