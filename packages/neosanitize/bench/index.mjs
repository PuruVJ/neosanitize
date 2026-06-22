/**
 * Benchmark: neosanitize (this repo) vs. the original sanitize-html.
 *
 *   pnpm build && node bench/index.mjs
 *
 * For every scenario we:
 *   1. run both implementations once and diff their output (parity check), so a
 *      speed win is never just one library quietly doing less work;
 *   2. benchmark each implementation with tinybench under identical options.
 *
 * Env knobs:
 *   BENCH_TIME=2000   per-task measurement time in ms (default 1000)
 *   BENCH_ONLY=name1,name2   run a subset of scenarios
 */

import { Bench } from 'tinybench';
import original from 'sanitize-html';
import next from '../dist/legacy/index.mjs';
import { scenarios } from './fixtures.mjs';

const TIME = Number(process.env.BENCH_TIME ?? 1000);
const WARMUP_TIME = Number(process.env.BENCH_WARMUP ?? 300);
const ONLY = process.env.BENCH_ONLY ? new Set(process.env.BENCH_ONLY.split(',')) : null;

// transformTags can't be JSON-described in fixtures.mjs (it holds functions),
// so build it here, once, identically for both libraries.
function withTransform(options, lib) {
  return {
    ...options,
    transformTags: {
      b: 'strong',
      i: 'em',
      font: lib.simpleTransform('span', { class: 'legacy-font' }),
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  };
}

function optionsFor(scenario, lib) {
  if (scenario.needsTransform) {
    return withTransform({ allowedTags: ['strong', 'em', 'span', 'a', 'ol', 'ul', 'li'] }, lib);
  }
  return scenario.options;
}

// --- formatting helpers ------------------------------------------------------
const bytes = (s) => `${(Buffer.byteLength(s, 'utf8') / 1024).toFixed(1)}KB`;
const fmtHz = (n) =>
  n >= 1000 ? `${Math.round(n).toLocaleString('en-US')}` : n.toFixed(1);
const fmtMs = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(1)}µs` : `${ms.toFixed(2)}ms`);
const pad = (s, w, right = false) =>
  right ? String(s).padStart(w) : String(s).padEnd(w);

function geomean(values) {
  if (!values.length) return 0;
  const sum = values.reduce((a, v) => a + Math.log(v), 0);
  return Math.exp(sum / values.length);
}

// ----------------------------------------------------------------------------
const list = scenarios.filter((s) => !ONLY || ONLY.has(s.name));

console.log('\nneosanitize  vs.  sanitize-html (original)\n' + '='.repeat(78));
console.log(
  `node ${process.version}  ·  tinybench  ·  ${TIME}ms/task (+${WARMUP_TIME}ms warmup)  ·  ` +
    `original v${original.version ?? '2.x'}\n`
);

const rows = [];

// Silence per-call config warnings during the timed section: they are config
// validation (not sanitization work), and writing to stderr thousands of times
// would distort throughput. Restored before results are printed.
const realWarn = console.warn;
const realError = console.error;
console.warn = () => {};
console.error = () => {};

for (const scenario of list) {
  const optsOrig = optionsFor(scenario, original);
  const optsNext = optionsFor(scenario, next);

  // --- parity check (also surfaces any throughput-skewing output diff) ------
  let parity, outNext, outOrig;
  try {
    outOrig = original(scenario.html, optsOrig);
    outNext = next(scenario.html, optsNext);
    parity = outOrig === outNext ? 'exact' : `≠ (${bytes(outOrig)}/${bytes(outNext)})`;
  } catch (err) {
    parity = `ERR ${err.message}`;
  }

  const bench = new Bench({ time: TIME, warmupTime: WARMUP_TIME, throws: true });
  bench.add('original', () => original(scenario.html, optsOrig));
  bench.add('next', () => next(scenario.html, optsNext));

  process.stdout.write(`  running ${pad(scenario.name, 20)} …`);
  await bench.run();

  const tOrig = bench.getTask('original').result;
  const tNext = bench.getTask('next').result;
  const speedup = tNext.throughput.mean / tOrig.throughput.mean;

  rows.push({
    name: scenario.name,
    size: bytes(scenario.html),
    parity,
    origHz: tOrig.throughput.mean,
    nextHz: tNext.throughput.mean,
    origMs: tOrig.latency.mean,
    nextMs: tNext.latency.mean,
    origRme: tOrig.throughput.rme,
    nextRme: tNext.throughput.rme,
    speedup,
  });
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
}

console.warn = realWarn;
console.error = realError;

// --- results table -----------------------------------------------------------
const W = { name: 20, size: 9, parity: 20, hz: 16, lat: 11, sp: 10 };
const head =
  pad('scenario', W.name) +
  pad('input', W.size) +
  pad('parity', W.parity) +
  pad('original op/s', W.hz, true) +
  pad('next op/s', W.hz, true) +
  pad('next p50', W.lat, true) +
  pad('speedup', W.sp, true);
console.log(head);
console.log('-'.repeat(head.length));

for (const r of rows) {
  const tag =
    r.speedup >= 1.05 ? `${r.speedup.toFixed(2)}× ▲` :
    r.speedup <= 0.95 ? `${r.speedup.toFixed(2)}× ▼` :
    `${r.speedup.toFixed(2)}× ≈`;
  console.log(
    pad(r.name, W.name) +
      pad(r.size, W.size) +
      pad(r.parity, W.parity) +
      pad(`${fmtHz(r.origHz)} ±${r.origRme.toFixed(1)}%`, W.hz, true) +
      pad(`${fmtHz(r.nextHz)} ±${r.nextRme.toFixed(1)}%`, W.hz, true) +
      pad(fmtMs(r.nextMs), W.lat, true) +
      pad(tag, W.sp, true)
  );
}
console.log('-'.repeat(head.length));

// --- summary -----------------------------------------------------------------
const speedups = rows.map((r) => r.speedup).filter((n) => Number.isFinite(n) && n > 0);
const gm = geomean(speedups);
const wins = rows.filter((r) => r.speedup >= 1.05).length;
const losses = rows.filter((r) => r.speedup <= 0.95).length;
const mismatches = rows.filter((r) => !String(r.parity).startsWith('exact')).length;

console.log(
  `\nsummary: geomean speedup ${gm.toFixed(2)}× (next vs original)  ·  ` +
    `${wins} faster / ${losses} slower / ${rows.length - wins - losses} even`
);
console.log(
  `parity:  ${rows.length - mismatches}/${rows.length} scenarios byte-identical` +
    (mismatches ? `  ·  ${mismatches} differ (see table, compared fairly, just flagged)` : '')
);
console.log(
  '\nspeedup > 1.0 means neosanitize is faster. ▲ faster · ▼ slower · ≈ within ±5%.\n'
);
