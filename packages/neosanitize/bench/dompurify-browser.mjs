/**
 * neosanitize vs DOMPurify in a real browser (headless Chromium). Here both use the
 * browser's own HTML parser: neosanitize's browser build parses with the native DOMParser,
 * and DOMPurify uses the page's DOM. Same inputs and allow-list as the Node run
 * (bench/dompurify-policy.mjs), timed with tinybench inside the page.
 *
 *   pnpm build && node bench/dompurify-browser.mjs [--json]
 *
 * Needs Chromium for Playwright: `pnpm exec playwright-core install chromium` once.
 * --json writes the `browser` half of bench/dompurify.json.
 * Env: BENCH_TIME=ms per task (default 800), BENCH_ONLY=a,b
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { geomean } from './dompurify-policy.mjs';

const TIME = Number(process.env.BENCH_TIME ?? 800);
const ONLY = process.env.BENCH_ONLY ? process.env.BENCH_ONLY.split(',') : null;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (pkg) => JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;

// The page imports the real files over http, so the browser loads exactly what ships.
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { Sanitizer } from '/dist/main/browser.mjs';
import DOMPurify from '/node_modules/dompurify/dist/purify.es.mjs';
import { Bench } from '/node_modules/tinybench/dist/index.js';
import { scenarios } from '/bench/fixtures.mjs';
import { neoFor, policyFor, purifyConfig } from '/bench/dompurify-policy.mjs';

window.run = async (time, only) => {
  const rows = [];
  for (const s of scenarios) {
    if (only && !only.includes(s.name)) continue;
    const policy = policyFor(s);
    const neo = neoFor(Sanitizer, policy);
    const cfg = purifyConfig(policy);
    // both sides must do real work: an empty result would be a fake fast path
    if (!neo.sanitize(s.html) || !DOMPurify.sanitize(s.html, cfg)) throw new Error('empty output: ' + s.name);
    const bench = new Bench({ time, warmupTime: 200, throws: true });
    bench.add('neosanitize', () => neo.sanitize(s.html));
    bench.add('dompurify', () => DOMPurify.sanitize(s.html, cfg));
    await bench.run();
    const hz = (n) => bench.getTask(n).result.throughput.mean;
    rows.push({ name: s.name, bytes: new TextEncoder().encode(s.html).length,
      ops: { neosanitize: hz('neosanitize'), dompurify: hz('dompurify') } });
  }
  return rows;
};
window.ready = true;
</script>`;

const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready === true);
  const runtime = `Chromium ${browser.version()}`;
  console.log(`\nneosanitize (browser build) vs DOMPurify, in ${runtime}`);
  console.log(`DOMPurify ${version('dompurify')} · tinybench · ${TIME}ms/task\n`);

  const rows = await page.evaluate(([t, o]) => window.run(t, o), [TIME, ONLY]);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(20)} ${Math.round(r.ops.neosanitize).toLocaleString('en-US').padStart(10)}/s  ` +
      `${Math.round(r.ops.dompurify).toLocaleString('en-US').padStart(10)}/s  ` +
      `${(r.ops.neosanitize / r.ops.dompurify).toFixed(2)}×`,
    );
  }
  const ratio = geomean(rows.map((r) => r.ops.neosanitize / r.ops.dompurify));
  console.log(`\nneosanitize vs DOMPurify (browser): geomean ${ratio.toFixed(2)}× (>1× = neosanitize faster)\n`);

  if (process.argv.includes('--json')) {
    const file = join(ROOT, 'bench', 'dompurify.json');
    const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    out.browser = {
      generatedAt: new Date().toISOString(),
      runtime,
      msPerTask: TIME,
      versions: { dompurify: version('dompurify') },
      summary: { dompurify: 1, neosanitize: +ratio.toFixed(2) },
      scenarios: rows,
    };
    writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
  server.close();
}
