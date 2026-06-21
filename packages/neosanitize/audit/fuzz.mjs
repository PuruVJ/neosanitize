/**
 * Exploratory differential fuzz: generate many well-formed documents (audit/
 * fuzz-gen.mjs) and run each through BOTH the original `sanitize-html` and our
 * reimplementation under every config in the matrix, asserting byte-identical
 * output. Reports divergences grouped by config with a minimal repro (seed +
 * input + both outputs).
 *
 * Run:  node audit/fuzz.mjs [docCount] [baseSeed]
 *
 * This is the discovery tool; the locked-in regression net is
 * test/differential-fuzz.test.ts (deterministic seed + count).
 */
import original from 'sanitize-html';
import ours from '../dist/legacy/index.mjs';
import { genDoc, makeRng, CONFIGS } from './fuzz-gen.mjs';

const DOCS = Number(process.argv[2] || 20000);
const BASE_SEED = Number(process.argv[3] || 1);

// The original prints console warnings (allowVulnerableTags, deprecated opts);
// silence them so the report stays readable.
const realWarn = console.warn;
const realError = console.error;
console.warn = () => {};
console.error = () => {};

function run(fn, html, opts) {
  try {
    return 'OK\n' + fn(html, opts);
  } catch (e) {
    return 'THREW: ' + (e && e.message ? e.message : String(e));
  }
}

const byConfig = new Map();
const samples = [];
let cases = 0;

for (let d = 0; d < DOCS; d++) {
  const seed = BASE_SEED + d;
  const rand = makeRng(seed);
  const html = genDoc(rand);
  for (const { label, opts } of CONFIGS) {
    cases++;
    const o = run(original, html, opts);
    const u = run(ours, html, opts);
    if (o !== u) {
      byConfig.set(label, (byConfig.get(label) || 0) + 1);
      if (samples.length < 40) samples.push({ seed, label, html, o, u });
    }
  }
}

console.warn = realWarn;
console.error = realError;

let total = 0;
for (const c of byConfig.values()) total += c;

console.log(`\n=== differential fuzz: ${DOCS} docs × ${CONFIGS.length} configs = ${cases} cases ===`);
console.log(`divergences: ${total}\n`);
if (byConfig.size) {
  console.log('by config:');
  for (const [label, n] of [...byConfig.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${label}`);
  }
  console.log('\nsamples (seed reproduces via makeRng):');
  for (const s of samples.slice(0, 25)) {
    console.log(`\n  [${s.label}] seed=${s.seed}`);
    console.log(`    in  : ${JSON.stringify(s.html).slice(0, 240)}`);
    console.log(`    orig: ${JSON.stringify(s.o).slice(0, 240)}`);
    console.log(`    ours: ${JSON.stringify(s.u).slice(0, 240)}`);
  }
}
process.exit(total > 0 ? 1 : 0);
