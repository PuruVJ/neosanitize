/**
 * neosanitize vs DOMPurify in Node. DOMPurify needs a DOM, and on the server that DOM is
 * jsdom (what DOMPurify's own README tells you to use). Same inputs, same allow-list on both
 * sides (bench/dompurify-policy.mjs), string in and string out.
 *
 *   pnpm build && node bench/dompurify.mjs [--json]
 *
 * --json writes the `node` half of bench/dompurify.json (the browser half comes from
 * bench/dompurify-browser.mjs). Env: BENCH_TIME=ms per task (default 800), BENCH_ONLY=a,b
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Bench } from 'tinybench';
import { Sanitizer } from '../dist/main/index.mjs';
import { scenarios } from './fixtures.mjs';
import { geomean, neoFor, policyFor, purifyConfig } from './dompurify-policy.mjs';

const TIME = Number(process.env.BENCH_TIME ?? 800);
const ONLY = process.env.BENCH_ONLY ? new Set(process.env.BENCH_ONLY.split(',')) : null;
// read straight from node_modules: dompurify's `exports` hides its package.json
const version = (pkg) =>
  JSON.parse(readFileSync(new URL(`../node_modules/${pkg}/package.json`, import.meta.url), 'utf8')).version;

const DOMPurify = createDOMPurify(new JSDOM('').window);

console.log('\nneosanitize vs DOMPurify + jsdom (Node)');
console.log(`node ${process.version} · DOMPurify ${version('dompurify')} · jsdom ${version('jsdom')} · tinybench · ${TIME}ms/task\n`);

const rows = [];
for (const s of scenarios) {
  if (ONLY && !ONLY.has(s.name)) continue;
  const policy = policyFor(s);
  const neo = neoFor(Sanitizer, policy);
  const cfg = purifyConfig(policy);
  // both sides must do real work: an empty result would be a fake fast path
  if (!neo.sanitize(s.html) || !DOMPurify.sanitize(s.html, cfg)) throw new Error(`empty output: ${s.name}`);

  const bench = new Bench({ time: TIME, warmupTime: 200, throws: true });
  bench.add('neosanitize', () => neo.sanitize(s.html));
  bench.add('dompurify', () => DOMPurify.sanitize(s.html, cfg));
  process.stdout.write(`  running ${s.name.padEnd(20)} …`);
  await bench.run();
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const hz = (n) => bench.getTask(n).result.throughput.mean;
  const row = { name: s.name, bytes: Buffer.byteLength(s.html), ops: { neosanitize: hz('neosanitize'), dompurify: hz('dompurify') } };
  rows.push(row);
  console.log(
    `${s.name.padEnd(20)} ${Math.round(row.ops.neosanitize).toLocaleString('en-US').padStart(10)}/s  ` +
    `${Math.round(row.ops.dompurify).toLocaleString('en-US').padStart(10)}/s  ` +
    `${(row.ops.neosanitize / row.ops.dompurify).toFixed(2)}×`,
  );
}

const ratio = geomean(rows.map((r) => r.ops.neosanitize / r.ops.dompurify));
console.log(`\nneosanitize vs DOMPurify + jsdom: geomean ${ratio.toFixed(2)}× (>1× = neosanitize faster)\n`);

if (process.argv.includes('--json')) {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'dompurify.json');
  const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  out.node = {
    generatedAt: new Date().toISOString(),
    runtime: `Node ${process.version}`,
    msPerTask: TIME,
    versions: { dompurify: version('dompurify'), jsdom: version('jsdom') },
    summary: { dompurify: 1, neosanitize: +ratio.toFixed(2) },
    scenarios: rows,
  };
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
