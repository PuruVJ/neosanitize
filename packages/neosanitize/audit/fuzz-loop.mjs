/**
 * Continuous differential fuzz loop: rotate seed ranges, run audit/fuzz.mjs each
 * iteration, stop on first divergence and write audit/last-divergence.json.
 *
 * Run:  node audit/fuzz-loop.mjs [flags]
 *
 * Flags:
 *   --docs N           documents per iteration (default 20000)
 *   --start-seed N     first base seed (default 1)
 *   --max-iterations N 0 = infinite (default 0)
 *   --build-each       rebuild dist before every iteration (default: build once)
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import original from 'sanitize-html';
import ours from '../dist/legacy/index.mjs';
import { genDoc, makeRng, CONFIGS } from './fuzz-gen.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const lastDivPath = join(__dirname, 'last-divergence.json');

function parseArgs(argv) {
  const opts = { docs: 20000, startSeed: 1, maxIterations: 0, buildEach: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--docs') opts.docs = Number(argv[++i]);
    else if (a === '--start-seed') opts.startSeed = Number(argv[++i]);
    else if (a === '--max-iterations') opts.maxIterations = Number(argv[++i]);
    else if (a === '--build-each') opts.buildEach = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node audit/fuzz-loop.mjs [--docs N] [--start-seed N] [--max-iterations N] [--build-each]`);
      process.exit(0);
    }
  }
  return opts;
}

function build() {
  const r = spawnSync('pnpm', ['build'], { cwd: pkgRoot, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function run(fn, html, opts) {
  try {
    return 'OK\n' + fn(html, opts);
  } catch (e) {
    return 'THREW: ' + (e?.message ?? String(e));
  }
}

function fuzzBatch(docs, baseSeed) {
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = () => {};
  console.error = () => {};

  let cases = 0;
  try {
    for (let d = 0; d < docs; d++) {
      const seed = baseSeed + d;
      const html = genDoc(makeRng(seed));
      for (const { label, opts } of CONFIGS) {
        cases++;
        const o = run(original, html, opts);
        const u = run(ours, html, opts);
        if (o !== u) {
          return {
            diverged: true,
            seed,
            label,
            html,
            orig: o,
            ours: u,
            cases,
          };
        }
      }
    }
  } finally {
    console.warn = realWarn;
    console.error = realError;
  }
  return { diverged: false, cases };
}

const opts = parseArgs(process.argv.slice(2));
const t0 = Date.now();
let iteration = 0;
let totalCases = 0;
let baseSeed = opts.startSeed;

console.log(
  `fuzz-loop: docs=${opts.docs} start-seed=${opts.startSeed} max-iterations=${opts.maxIterations || '∞'} build-each=${opts.buildEach}`
);

build();

while (opts.maxIterations === 0 || iteration < opts.maxIterations) {
  iteration++;
  if (opts.buildEach && iteration > 1) build();

  const result = fuzzBatch(opts.docs, baseSeed);
  totalCases += result.cases;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const seedEnd = baseSeed + opts.docs - 1;

  if (result.diverged) {
    const repro = {
      iteration,
      seed: result.seed,
      label: result.label,
      html: result.html,
      orig: result.orig,
      ours: result.ours,
      baseSeed,
      docs: opts.docs,
      casesThisBatch: result.cases,
      totalCases,
      elapsedSec: Number(elapsed),
    };
    writeFileSync(lastDivPath, JSON.stringify(repro, null, 2) + '\n');
    console.log(`\nDIVERGENCE at iteration ${iteration}, seed=${result.seed}, config=${result.label}`);
    console.log(`  wrote ${lastDivPath}`);
    console.log(`  in  : ${JSON.stringify(result.html).slice(0, 300)}`);
    console.log(`  orig: ${JSON.stringify(result.orig).slice(0, 300)}`);
    console.log(`  ours: ${JSON.stringify(result.ours).slice(0, 300)}`);
    console.log(`\nResume after fix: node audit/fuzz-loop.mjs --start-seed ${result.seed} --docs ${opts.docs}`);
    process.exit(1);
  }

  console.log(
    `[${iteration}] seeds ${baseSeed}–${seedEnd}: ${result.cases} cases OK · total ${totalCases} · ${elapsed}s`
  );
  baseSeed += opts.docs;
}

console.log(`\nCompleted ${iteration} iterations, ${totalCases} cases, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
