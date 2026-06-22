/**
 * Parser-adapter throughput benchmark: the SAME `Sanitizer` (same policy, same
 * serializer) over three parse adapters , 
 *   - `ours`        the bundled, browser-faithful WHATWG parser (default)
 *   - `parse5`      the reference WHATWG parser (neosanitize/parse5)
 *   - `htmlparser2` the fast, lenient parser sanitize-html uses (neosanitize/htmlparser2)
 *
 *   pnpm build && node bench/adapters.mjs            # prints a table
 *   pnpm build && node bench/adapters.mjs --json     # also writes bench/adapters.json
 *
 * Only the PARSE step differs, so this isolates parser cost. Output is written to
 * bench/adapters.json (committed) and rendered as progress bars on the docs site.
 *
 * Env: BENCH_TIME=ms per task (default 800), BENCH_ONLY=name1,name2
 */
import { Bench } from 'tinybench';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Sanitizer } from '../dist/main/index.mjs';
import { parse5Adapter } from '../dist/main/parse5.mjs';
import { htmlparser2Adapter } from '../dist/main/htmlparser2.mjs';
import { scenarios } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TIME = Number(process.env.BENCH_TIME ?? 800);
const ONLY = process.env.BENCH_ONLY ? new Set(process.env.BENCH_ONLY.split(',')) : null;
const WRITE_JSON = process.argv.includes('--json');

const RICH_TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const RICH_ATTRS = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};

const ADAPTERS = [
  { name: 'ours', parser: null },
  { name: 'parse5', parser: parse5Adapter },
  { name: 'htmlparser2', parser: htmlparser2Adapter },
];

function sanitizerFor(scenario, parser) {
  const o = scenario.options ?? {};
  const tags = o.allowedTags && o.allowedTags.length ? o.allowedTags : RICH_TAGS;
  const attrs = o.allowedAttributes && Object.keys(o.allowedAttributes).length ? o.allowedAttributes : RICH_ATTRS;
  return Sanitizer.builder({ tags, attrs }).parser(parser).build();
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const fmtHz = (n) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));
const pad = (s, w, r = false) => (r ? String(s).padStart(w) : String(s).padEnd(w));
const geomean = (v) => (v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 0);

const list = scenarios.filter((s) => !ONLY || ONLY.has(s.name));
console.log('\nParser-adapter throughput: ours  vs  parse5  vs  htmlparser2  (same Sanitizer)');
console.log('='.repeat(82));
console.log(`node ${process.version} · tinybench · ${TIME}ms/task\n`);

const realWarn = console.warn, realError = console.error;
console.warn = () => {}; console.error = () => {};

const out = [];
const ratios = { parse5: [], htmlparser2: [] };
for (const scenario of list) {
  const sans = ADAPTERS.map((a) => sanitizerFor(scenario, a.parser));
  try { sans.forEach((s) => s.sanitize(scenario.html)); }
  catch (e) { realWarn.call(console, `skip ${scenario.name}: ${e.message}`); continue; }

  const bench = new Bench({ time: TIME, warmupTime: 200, throws: true });
  ADAPTERS.forEach((a, i) => bench.add(a.name, () => sans[i].sanitize(scenario.html)));
  await bench.run();

  const ops = {};
  for (const a of ADAPTERS) ops[a.name] = bench.getTask(a.name).result.throughput.mean;
  out.push({ name: scenario.name, description: scenario.description ?? '', bytes: bytes(scenario.html), ops });
  if (ops.ours) { ratios.parse5.push(ops.parse5 / ops.ours); ratios.htmlparser2.push(ops.htmlparser2 / ops.ours); }

  const top = Math.max(...Object.values(ops));
  const tag = (n) => (ops[n] === top ? ' *' : '  ');
  console.log(pad(scenario.name, 22), `${pad(bytes(scenario.html) + 'B', 8, true)}`);
  for (const a of ADAPTERS) console.log('  ', pad(a.name, 14), pad(fmtHz(ops[a.name]) + ' ops/s', 18, true), tag(a.name));
  console.log();
}

console.warn = realWarn; console.error = realError;

const summary = {
  ours: 1,
  parse5: +geomean(ratios.parse5).toFixed(2),
  htmlparser2: +geomean(ratios.htmlparser2).toFixed(2),
};
console.log('='.repeat(82));
console.log(`geomean throughput vs ours:  parse5 ${summary.parse5}×  ·  htmlparser2 ${summary.htmlparser2}×  (ours = 1.00×)`);

if (WRITE_JSON) {
  const v = (p) => { try { return require(`${p}/package.json`).version; } catch { return null; } };
  const payload = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    msPerTask: TIME,
    versions: { neosanitize: require('../package.json').version, parse5: v('parse5'), htmlparser2: v('htmlparser2') },
    adapters: ADAPTERS.map((a) => a.name),
    summary,
    scenarios: out,
  };
  const file = join(__dirname, 'adapters.json');
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${file}`);
}
