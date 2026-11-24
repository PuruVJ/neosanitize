/**
 * The one policy both sides of the DOMPurify benchmarks get, so they keep and drop the
 * same things. DOMPurify has no per-tag attribute lists, so the attributes are one global
 * list for both: every attribute a scenario allows on any tag is allowed everywhere.
 *
 * Scenarios that pin no tags (sanitize-html then falls back to its defaults) use the same
 * rich UGC-ish allow-list as bench/three-way.mjs, minus html/head/body: DOMPurify returns the
 * body's content, so neither side should wrap its output in a document.
 */
export const RICH_TAGS = ['div', 'span', 'p', 'a', 'b', 'i', 'em', 'strong', 'u', 's',
  'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'figure', 'figcaption', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'input', 'label'];
const RICH_ATTRS = ['class', 'id', 'title', 'style', 'lang', 'dir', 'href', 'name', 'target', 'rel',
  'src', 'alt', 'width', 'height', 'type', 'value', 'placeholder', 'colspan', 'rowspan'];

/** @returns {{ tags: string[], attrs: string[] }} */
export function policyFor(scenario) {
  const o = scenario.options ?? {};
  const tags = o.allowedTags && o.allowedTags.length ? o.allowedTags : RICH_TAGS;
  const attrs = o.allowedAttributes && Object.keys(o.allowedAttributes).length
    ? [...new Set(Object.values(o.allowedAttributes).flat())]
    : RICH_ATTRS;
  return { tags, attrs };
}

/** A neosanitize Sanitizer for the policy. */
export const neoFor = (Sanitizer, { tags, attrs }) =>
  Sanitizer.builder((b) => {
    b.allow(tags);
    b.allow('*', attrs);
  }).build();

/** DOMPurify config for the policy (string in, string out, like neosanitize). */
export const purifyConfig = ({ tags, attrs }) => ({ ALLOWED_TAGS: tags, ALLOWED_ATTR: attrs });

export const geomean = (v) => (v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 0);
