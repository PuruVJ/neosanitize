/**
 * Phase-split micro-bench for the MODERN engine. Attributes wall-clock across the
 * three stages so optimizations can be targeted + measured in isolation:
 *   1. tokenize-only  (Tokenizer.nextToken loop, no tree)
 *   2. tree-build     (TreeBuilder.parse → tree, includes tokenize)
 *   3. full-sanitize  (parse + policy walk + serialize)
 * Serialize cost ≈ full − tree. Tree-only cost ≈ tree − tokenize.
 *
 * Run with tsx so it reads TS source directly (relative ratios are reliable;
 * absolute MB/s runs a touch slower than the built dist — use three-way.mjs for
 * headline numbers). Usage:  npx tsx bench/phase-split.mjs  [ITERS]
 */
import { Tokenizer } from '../src/main/parser/tokenizer.ts';
import { TreeBuilder } from '../src/main/parser/tree-builder.ts';
import { Sanitizer } from '../src/main/index.ts';
import { scenarios } from './fixtures.mjs';

const TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const ATTRS = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};
const san = Sanitizer.builder((b) => {
  b.allow(TAGS);
  for (const [tag, list] of Object.entries(ATTRS)) b.allow(tag, list);
}).build();

const corpus = scenarios.map((s) => s.html);
const totalBytes = corpus.reduce((n, h) => n + Buffer.byteLength(h, 'utf8'), 0);
const ITERS = Number(process.argv[2] ?? 300);

function tokenizeOnly(html) {
  const tk = new Tokenizer(html, {});
  let n = 0, t;
  while ((t = tk.nextToken()) !== null) n++;
  return n;
}
function treeBuild(html) { return new TreeBuilder(html).parse(); }
function full(html) { return san.sanitize(html); }

function time(label, fn) {
  // warm
  for (let i = 0; i < 40; i++) for (const h of corpus) fn(h);
  let sink = 0;
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) for (const h of corpus) { const r = fn(h); sink += typeof r === 'number' ? r : (r.length ?? 1); }
  const dt = performance.now() - t0;
  const mbps = (totalBytes * ITERS) / 1024 / 1024 / (dt / 1000);
  return { label, dt, mbps, sink };
}

console.log(`\nphase split · ${ITERS} iters × ${corpus.length} docs · ${(totalBytes/1024).toFixed(1)}KB/iter · node ${process.version}\n`);
const tok = time('tokenize', tokenizeOnly);
const tree = time('tree-build', treeBuild);
const fu = time('full', full);
const pad = (s, w) => String(s).padEnd(w);
const padr = (s, w) => String(s).padStart(w);
for (const r of [tok, tree, fu]) {
  console.log(`  ${pad(r.label, 12)} ${padr(r.dt.toFixed(0)+'ms', 9)}  ${padr(r.mbps.toFixed(1)+' MB/s', 12)}`);
}
const serialize = fu.dt - tree.dt;
const treeOnly = tree.dt - tok.dt;
console.log('  ' + '-'.repeat(34));
console.log(`  ${pad('→ tokenize', 12)} ${padr(tok.dt.toFixed(0)+'ms', 9)}  ${padr((100*tok.dt/fu.dt).toFixed(0)+'%', 6)}`);
console.log(`  ${pad('→ tree-only', 12)} ${padr(treeOnly.toFixed(0)+'ms', 9)}  ${padr((100*treeOnly/fu.dt).toFixed(0)+'%', 6)}`);
console.log(`  ${pad('→ serialize', 12)} ${padr(serialize.toFixed(0)+'ms', 9)}  ${padr((100*serialize/fu.dt).toFixed(0)+'%', 6)}`);
console.log(`\n  full throughput: ${fu.mbps.toFixed(1)} MB/s\n`);
