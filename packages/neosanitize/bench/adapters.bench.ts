/**
 * Heisenbench cases for the parse adapters, as in `adapters.mjs`: the same `Sanitizer` over
 * the bundled WHATWG parser, `parse5` and `htmlparser2`. Both packages are ES modules, so
 * their own work is counted too, under their name and version. Run with `pnpm bench:count`.
 */
import { bench } from 'heisenbench/bench';
import { Sanitizer } from '../src/main/index.ts';
import { parse5Adapter } from '../src/main/parse5.ts';
import { htmlparser2Adapter } from '../src/main/htmlparser2.ts';
// @ts-expect-error: the fixtures are plain JavaScript with no types.
import { scenarios } from './fixtures.mjs';

const RICH_TAGS = ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const RICH_ATTRS: Record<string, string[]> = {
  '*': ['class', 'id', 'title', 'style', 'lang', 'dir'],
  a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'],
  input: ['type', 'value', 'name', 'placeholder'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};

const ADAPTERS = { parse5: parse5Adapter, htmlparser2: htmlparser2Adapter };

function sanitizer_for(scenario: any, parser: typeof parse5Adapter) {
  const o = scenario.options ?? {};
  const tags = o.allowedTags && o.allowedTags.length ? o.allowedTags : RICH_TAGS;
  const attrs = o.allowedAttributes && Object.keys(o.allowedAttributes).length ? o.allowedAttributes : RICH_ATTRS;
  return Sanitizer.builder((b) => {
    b.allow(tags);
    for (const [tag, list] of Object.entries(attrs)) b.allow(tag, list as string[]);
  })
    .parser(parser)
    .build();
}

// `main.bench.ts` already counts the bundled parser on every scenario.
for (const [name, parser] of Object.entries(ADAPTERS)) {
  for (const scenario of scenarios) {
    bench(`${name} · ${scenario.name}`, ({ san, html }) => san.sanitize(html), {
      setup: () => ({ san: sanitizer_for(scenario, parser), html: scenario.html as string }),
    });
  }
}
