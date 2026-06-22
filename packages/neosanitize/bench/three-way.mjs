/**
 * Three-way throughput benchmark: original `sanitize-html` vs `./legacy` (the
 * byte-identical port) vs `.` (the new main engine).
 *
 *   pnpm build && node bench/three-way.mjs
 *
 * NOTE on fairness: original + legacy share the SAME options and produce
 * byte-identical output (that parity is asserted by bench/index.mjs). The main
 * engine is deny-by-default with its own (browser-faithful) parser and output
 * model, so its result is NOT byte-identical, this measures THROUGHPUT on the
 * same input bytes, with main configured to a rich UGC-ish allow-list so it does
 * real keep/filter/serialize work (not a degenerate drop-everything fast path).
 *
 * Env: BENCH_TIME=ms per task (default 800), BENCH_ONLY=name1,name2
 */
import { Bench } from 'tinybench';
import original from 'sanitize-html';
import legacy from '../dist/legacy/index.mjs';
import { Sanitizer } from '../dist/main/index.mjs';
import { scenarios } from './fixtures.mjs';

const TIME = Number(process.env.BENCH_TIME ?? 800);
const ONLY = process.env.BENCH_ONLY ? new Set(process.env.BENCH_ONLY.split(',')) : null;

// A rich default policy so main keeps/serializes realistic markup when a scenario
// doesn't pin allowedTags (sanitize-html then uses ITS defaults too).
const RICH_TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const RICH_ATTRS = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};

/** Map a sanitize-html options object → a compiled main Sanitizer (cached). */
function mainFor(scenario) {
  const o = scenario.options ?? {};
  const tags = o.allowedTags && o.allowedTags.length ? o.allowedTags : RICH_TAGS;
  const attrs = o.allowedAttributes && Object.keys(o.allowedAttributes).length ? o.allowedAttributes : RICH_ATTRS;
  return Sanitizer.builder({ tags, attrs }).build();
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const fmtHz = (n) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));
const pad = (s, w, r = false) => (r ? String(s).padStart(w) : String(s).padEnd(w));
const geomean = (v) => (v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 0);

const list = scenarios.filter((s) => !ONLY || ONLY.has(s.name));
console.log('\n3-way throughput: original sanitize-html  vs  ./legacy  vs  . (main engine)');
console.log('='.repeat(82));
console.log(`node ${process.version} · tinybench · ${TIME}ms/task · main = rich UGC-ish allow-list\n`);

const realWarn = console.warn, realError = console.error;
console.warn = () => {}; console.error = () => {};

const rows = [];
for (const scenario of list) {
  const opts = scenario.options ?? { allowedTags: false, allowedAttributes: false };
  const san = mainFor(scenario);
  // sanity: every impl runs without throwing + record output sizes
  let oOut, lOut, mOut;
  try { oOut = original(scenario.html, opts); lOut = legacy(scenario.html, opts); mOut = san.sanitize(scenario.html); }
  catch (e) { console.warn(`skip ${scenario.name}: ${e.message}`); continue; }

  const bench = new Bench({ time: TIME, warmupTime: 200, throws: true });
  bench.add('original', () => original(scenario.html, opts));
  bench.add('legacy', () => legacy(scenario.html, opts));
  bench.add('main', () => san.sanitize(scenario.html));
  process.stdout.write(`  running ${pad(scenario.name, 20)} …`);
  await bench.run();
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const hz = (n) => bench.getTask(n).result.throughput.mean;
  rows.push({
    name: scenario.name, size: bytes(scenario.html),
    o: hz('original'), l: hz('legacy'), m: hz('main'),
    mb: (bytes(scenario.html) * hz('main')) / 1024 / 1024,
  });
}
console.warn = realWarn; console.error = realError;

const W = { n: 20, s: 8, hz: 15, x: 9 };
console.log(
  pad('scenario', W.n) + pad('input', W.s, true) +
  pad('original/s', W.hz, true) + pad('legacy/s', W.hz, true) + pad('main/s', W.hz, true) +
  pad('main MB/s', W.x + 1, true) + pad('vs orig', W.x, true) + pad('vs leg', W.x, true)
);
console.log('-'.repeat(W.n + W.s + W.hz * 3 + W.x * 2 + 1));
for (const r of rows) {
  console.log(
    pad(r.name, W.n) + pad((r.size / 1024).toFixed(1) + 'K', W.s, true) +
    pad(fmtHz(r.o), W.hz, true) + pad(fmtHz(r.l), W.hz, true) + pad(fmtHz(r.m), W.hz, true) +
    pad(r.mb.toFixed(1), W.x + 1, true) +
    pad((r.m / r.o).toFixed(2) + '×', W.x, true) + pad((r.m / r.l).toFixed(2) + '×', W.x, true)
  );
}
console.log('-'.repeat(W.n + W.s + W.hz * 3 + W.x * 2 + 1));
console.log(
  `\nmain vs original: geomean ${geomean(rows.map((r) => r.m / r.o)).toFixed(2)}×   ·   ` +
  `main vs legacy: geomean ${geomean(rows.map((r) => r.m / r.l)).toFixed(2)}×`
);
console.log('(>1× = main faster. main does a full WHATWG parse + deny-by-default policy + serialize.)\n');

if (process.argv.includes('--json')) {
  const { writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dir = dirname(fileURLToPath(import.meta.url));
  const payload = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    msPerTask: TIME,
    engines: ['original', 'legacy', 'modern'],
    summary: {
      original: 1,
      legacy: +geomean(rows.map((r) => r.l / r.o)).toFixed(2),
      modern: +geomean(rows.map((r) => r.m / r.o)).toFixed(2),
    },
    scenarios: rows.map((r) => ({ name: r.name, bytes: r.size, ops: { original: r.o, legacy: r.l, modern: r.m } })),
  };
  writeFileSync(join(dir, 'three-way.json'), JSON.stringify(payload, null, 2) + '\n');
  console.log(`wrote ${join(dir, 'three-way.json')}`);
}
