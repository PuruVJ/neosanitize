/**
 * Profiling driver for the MAIN engine. Builds one rich Sanitizer and runs it
 * over the bench corpora in a tight loop. Run under the V8 profiler:
 *
 *   node --prof bench/profile-main.mjs
 *   node --prof-process isolate-*.log | sed -n '1,60p'
 *
 * Or plain (prints wall-clock + a parse/serialize split estimate):
 *   node bench/profile-main.mjs
 */
import { Sanitizer } from '../dist/main/index.mjs';
import { scenarios } from './fixtures.mjs';

// A rich, realistic UGC-ish policy so the engine does real keep/serialize work
// (not a degenerate "drop everything" fast path).
const TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const ATTRS = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};
const san = Sanitizer.builder({ tags: TAGS, attrs: ATTRS }).build();

const corpus = scenarios.map((s) => s.html);
const ITERS = Number(process.env.ITERS ?? 400);

// warm up the JIT
for (let i = 0; i < 30; i++) for (const html of corpus) san.sanitize(html);

const t0 = performance.now();
let chars = 0;
for (let i = 0; i < ITERS; i++) {
  for (const html of corpus) { const out = san.sanitize(html); chars += out.length; }
}
const dt = performance.now() - t0;

const totalBytes = corpus.reduce((n, h) => n + Buffer.byteLength(h, 'utf8'), 0) * ITERS;
console.log(`main.sanitize: ${ITERS} iters × ${corpus.length} docs`);
console.log(`  wall: ${dt.toFixed(0)}ms  ·  ${(totalBytes / 1024 / 1024 / (dt / 1000)).toFixed(1)} MB/s  ·  ${(chars / 1e6).toFixed(1)}M out chars`);
