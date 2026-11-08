/**
 * Heisenbench cases for the main engine (`neosanitize`), counted from `src/main/`:
 *
 * - every scenario of `fixtures.mjs` with the rich policy of `three-way.mjs`;
 * - the five document shapes of `scale.mjs`, at 64 KB instead of 1 and 10 MB (counting is
 *   slower than running; `pnpm bench:growth` grows them to 50 times that);
 * - building a policy, and the `ugc` preset, which no timed bench covers.
 *
 * Run with `pnpm bench:count`.
 */
import { bench } from 'heisenbench/bench';
import { Sanitizer } from '../src/main/index.ts';
import { ugc } from '../src/main/presets/index.ts';
// @ts-expect-error: the fixtures are plain JavaScript with no types.
import { scenarios } from './fixtures.mjs';

// The rich policy of `three-way.mjs`, used when a scenario does not pin its own tags.
const RICH_TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const RICH_ATTRS: Record<string, string[]> = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};

function main_for(scenario: any) {
  const o = scenario.options ?? {};
  const tags = o.allowedTags && o.allowedTags.length ? o.allowedTags : RICH_TAGS;
  const attrs = o.allowedAttributes && Object.keys(o.allowedAttributes).length ? o.allowedAttributes : RICH_ATTRS;
  return Sanitizer.builder((b) => {
    b.allow(tags);
    for (const [tag, list] of Object.entries(attrs)) b.allow(tag, list as string[]);
  }).build();
}

for (const scenario of scenarios) {
  bench(`main · ${scenario.name}`, ({ san, html }) => san.sanitize(html), {
    setup: () => ({ san: main_for(scenario), html: scenario.html as string }),
  });
}

// The policy and shapes of `scale.mjs`.
const SCALE_TAGS = ['div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's', 'ul', 'ol', 'li', 'br', 'hr',
  'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'article', 'section'];
const scale_sanitizer = () =>
  Sanitizer.builder((b) => {
    b.allow(SCALE_TAGS);
    b.allow('*', ['class', 'id', 'title', 'style']);
    b.allow('a', ['href', 'rel', 'target']);
    b.allow('img', ['src', 'alt', 'width', 'height']);
    b.allow(['td', 'th'], ['colspan', 'rowspan']);
  }).build();

const SHAPES: Record<string, string> = {
  blog: `<article class="post"><h2 id="t">Title &amp; subtitle</h2><p>Hello <b>world</b>, <a href="https://example.com/p?a=1&amp;b=2" title="he said &quot;hi&quot;" onclick="x()">a link</a>. 5 &lt; 6 &gt; 3, café, naïve.</p><ul><li>one</li><li><i>two</i> <img src="https://cdn.example.com/a.png" alt="a" onerror="alert(1)"></li></ul><script>bad()</script><blockquote><p>Quoted <em>text</em> with <code>x &lt;= y</code></p></blockquote><iframe src="javascript:alert(1)"></iframe></article>\n`,
  table: `<tr><td style="text-align:right;color:#333" class="n">1,234.56</td><td style="padding:4px">Widget &amp; co</td><td colspan="2" style="background:url(javascript:x)">Total</td><th rowspan="1" class="h">Q3</th></tr>\n`,
  text: `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit &amp; sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud 1 &lt; 2 &gt; 0 exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.  Duis aute irure dolor.</p>\n`,
  attrs: `<a href="https://example.com/a/b/c?x=1" rel="noopener" target="_blank" class="l" id="a1" title="t" data-x="1" onmouseover="x()"><img src="data:image/png;base64,iVBORw0KGgo=" alt="i" width="10" height="10"></a><a href="vbscript:x" class="l">v</a>\n`,
  unwrap: `<font color="red"><center><marquee><span class="k">kept</span> text <blink>more</blink></marquee></center></font>\n`,
};

const KB = 64 * 1024;
function doc(shape: string, bytes: number) {
  const unit = SHAPES[shape];
  const body = unit.repeat(Math.ceil(bytes / unit.length));
  return shape === 'table' ? `<table><tbody>${body}</tbody></table>` : body;
}

for (const shape of Object.keys(SHAPES)) {
  bench(`main · scale ${shape} (64 KB)`, ({ san, html }) => san.sanitize(html), {
    setup: () => ({ san: scale_sanitizer(), html: doc(shape, KB) }),
    scale: (ctx, factor) => ({ san: ctx.san, html: doc(shape, KB * factor) }),
  });
}

bench('main · build the rich policy', () => main_for({}));
bench('main · ugc preset on blog-post', ({ san, html }) => san.sanitize(html), {
  setup: () => ({
    san: Sanitizer.builder(ugc).build(),
    html: scenarios.find((s: any) => s.name === 'blog-post').html as string,
  }),
});
