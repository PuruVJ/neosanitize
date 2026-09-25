/**
 * Scale benchmark for the MAIN engine: big, full documents (1 MB and 10 MB) of
 * several shapes, measuring throughput AND garbage-collector cost.
 *
 *   pnpm build && node bench/scale.mjs
 *   SCALE_SIZES=1,10,50 SCALE_RUNS=8 node bench/scale.mjs
 *   SCALE_JSON=1 node bench/scale.mjs > before.json   (machine-readable, for A/B)
 *   SCALE_DIST=/abs/path/dist/main/index.mjs node bench/scale.mjs   (bench another build)
 *
 * Per shape × size it reports:
 *   MB/s      best-of-N throughput (higher is better; the headline number)
 *   median    median run time
 *   gc/run    garbage collections per run, and total GC pause per run (ms)
 *   maxRSS    process peak resident memory after the whole shape (MB)
 *
 * Throughput beats memory when they trade off; memory only has to stay sane
 * (no growth far past the input size, nothing retained between calls).
 */
import { PerformanceObserver, performance } from 'node:perf_hooks';
// SCALE_DIST points at another build for A/B runs (default: this package's dist).
const { Sanitizer } = await import(process.env.SCALE_DIST ?? '../dist/main/index.mjs');

const SIZES = (process.env.SCALE_SIZES ?? '1,10').split(',').map(Number);
const RUNS = Number(process.env.SCALE_RUNS ?? 6);
const JSON_OUT = !!process.env.SCALE_JSON;

// Realistic rich policy: the engine does real keep/filter/serialize work.
const TAGS = ['div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's', 'ul', 'ol', 'li', 'br', 'hr',
  'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'article', 'section'];
const san = Sanitizer.builder((b) => {
  b.allow(TAGS);
  b.allow('*', ['class', 'id', 'title', 'style']);
  b.allow('a', ['href', 'rel', 'target']);
  b.allow('img', ['src', 'alt', 'width', 'height']);
  b.allow(['td', 'th'], ['colspan', 'rowspan']);
}).build();

// One repeating unit per shape; repeated up to the target size.
const SHAPES = {
  // Mixed blog / CMS content with some hostile bits to strip.
  blog: `<article class="post"><h2 id="t">Title &amp; subtitle</h2><p>Hello <b>world</b>, <a href="https://example.com/p?a=1&amp;b=2" title="he said &quot;hi&quot;" onclick="x()">a link</a>. 5 &lt; 6 &gt; 3, café, naïve.</p><ul><li>one</li><li><i>two</i> <img src="https://cdn.example.com/a.png" alt="a" onerror="alert(1)"></li></ul><script>bad()</script><blockquote><p>Quoted <em>text</em> with <code>x &lt;= y</code></p></blockquote><iframe src="javascript:alert(1)"></iframe></article>\n`,
  // Big tables with repeated inline styles (email / report exports).
  table: `<tr><td style="text-align:right;color:#333" class="n">1,234.56</td><td style="padding:4px">Widget &amp; co</td><td colspan="2" style="background:url(javascript:x)">Total</td><th rowspan="1" class="h">Q3</th></tr>\n`,
  // Plain prose, lots of text needing escaping, few tags.
  text: `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit &amp; sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud 1 &lt; 2 &gt; 0 exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.  Duis aute irure dolor.</p>\n`,
  // Attribute- and URL-heavy (link farms, image galleries).
  attrs: `<a href="https://example.com/a/b/c?x=1" rel="noopener" target="_blank" class="l" id="a1" title="t" data-x="1" onmouseover="x()"><img src="data:image/png;base64,iVBORw0KGgo=" alt="i" width="10" height="10"></a><a href="vbscript:x" class="l">v</a>\n`,
  // Disallowed wrappers that must be unwrapped (forces the slow path).
  unwrap: `<font color="red"><center><marquee><span class="k">kept</span> text <blink>more</blink></marquee></center></font>\n`,
};

const gcStats = { count: 0, ms: 0 };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) { gcStats.count++; gcStats.ms += e.duration; }
}).observe({ entryTypes: ['gc'] });

function doc(unit, mb, shape) {
  const body = unit.repeat(Math.ceil((mb * 1e6) / unit.length));
  return shape === 'table' ? `<table><tbody>${body}</tbody></table>` : body;
}

// GC entries are delivered async, so yield after each run to collect them.
const tick = () => new Promise((r) => setImmediate(r));

const results = [];
for (const [shape, unit] of Object.entries(SHAPES)) {
  for (const mb of SIZES) {
    const html = doc(unit, mb, shape);
    for (let i = 0; i < 2; i++) san.sanitize(html); // warm up
    await tick();
    const times = [];
    let gcCount = 0, gcMs = 0;
    for (let i = 0; i < RUNS; i++) {
      gcStats.count = 0; gcStats.ms = 0;
      const t = performance.now();
      // Read the result: a real caller writes or stores it, which forces the
      // string to be flattened. Skipping that would hide the cost.
      const out = san.sanitize(html);
      out.charCodeAt(out.length >> 1);
      times.push(performance.now() - t);
      await tick();
      gcCount += gcStats.count; gcMs += gcStats.ms;
    }
    times.sort((a, b) => a - b);
    const sizeMB = html.length / 1e6;
    results.push({
      shape,
      sizeMB: +sizeMB.toFixed(1),
      mbPerSec: +(sizeMB / (times[0] / 1000)).toFixed(1),
      bestMs: +times[0].toFixed(1),
      medianMs: +times[times.length >> 1].toFixed(1),
      gcPerRun: +(gcCount / RUNS).toFixed(1),
      gcMsPerRun: +(gcMs / RUNS).toFixed(1),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pad = (s, n) => String(s).padStart(n);
  console.log(`${'shape'.padEnd(8)}${pad('MB', 6)}${pad('MB/s', 9)}${pad('best ms', 10)}${pad('median', 9)}${pad('gc/run', 8)}${pad('gc ms', 8)}${pad('maxRSS', 9)}`);
  for (const r of results) {
    console.log(`${r.shape.padEnd(8)}${pad(r.sizeMB, 6)}${pad(r.mbPerSec, 9)}${pad(r.bestMs, 10)}${pad(r.medianMs, 9)}${pad(r.gcPerRun, 8)}${pad(r.gcMsPerRun, 8)}${pad(r.maxRssMB, 9)}`);
  }
}
