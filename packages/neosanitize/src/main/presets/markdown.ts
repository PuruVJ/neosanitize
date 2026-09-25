import type { Preset } from '../index';

/**
 * `markdown`: tuned for the HTML a CommonMark/GFM renderer produces (headings,
 * emphasis, links, lists incl. task lists, tables, code blocks with a language
 * class, blockquotes, strikethrough, footnotes). Sanitize the rendered HTML output
 * with this, never trust a renderer's output blindly.
 */
export const markdown: Preset = (b) => {
  b.allow([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'del', 's', 'a', 'img',
    'ul', 'ol', 'li', 'input', 'blockquote', 'code', 'pre', 'kbd',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'sup', 'sub', 'details', 'summary', 'abbr',
  ])
    .allow('a', ['href', 'title', 'id', 'rel'])
    .allow('img', ['src', 'alt', 'title', 'width', 'height'])
    .allow('code', ['class']) // language-xxx
    .allow('pre', ['class'])
    .allow('span', ['class'])
    .allow('input', ['type', 'checked', 'disabled']) // task-list checkboxes
    .allow('th', ['align', 'colspan', 'rowspan'])
    .allow('td', ['align', 'colspan', 'rowspan'])
    .allow('ol', ['start'])
    .allow('li', ['id']) // footnote anchors
    .allow('sup', ['id']);
};
