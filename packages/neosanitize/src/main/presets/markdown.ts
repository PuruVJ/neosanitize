import { UNSAFE_PRESET_SYMBOL, type Preset } from '../index';

/**
 * `markdown` — tuned for the HTML that a CommonMark/GFM renderer produces
 * (headings, emphasis, links, lists incl. task lists, tables, code blocks with a
 * language class, blockquotes, strikethrough, footnotes). Sanitize the rendered
 * HTML output with this — never trust a renderer's output blindly.
 */
export const markdown: Preset = {
  [UNSAFE_PRESET_SYMBOL]: true,
  name: 'markdown',
  policy: {
    tags: new Set([
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'del', 's', 'a', 'img',
      'ul', 'ol', 'li', 'input', 'blockquote', 'code', 'pre', 'kbd',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'sup', 'sub', 'details', 'summary', 'abbr'
    ]),
    attrs: new Map<string, Set<string>>([
      ['a', new Set(['href', 'title', 'id', 'rel'])],
      ['img', new Set(['src', 'alt', 'title', 'width', 'height'])],
      ['code', new Set(['class'])], // language-xxx
      ['pre', new Set(['class'])],
      ['span', new Set(['class'])],
      ['input', new Set(['type', 'checked', 'disabled'])], // task-list checkboxes
      ['th', new Set(['align', 'colspan', 'rowspan'])],
      ['td', new Set(['align', 'colspan', 'rowspan'])],
      ['ol', new Set(['start'])],
      ['li', new Set(['id'])], // footnote anchors
      ['sup', new Set(['id'])]
    ]),
    allowUnsafe: false
  }
};
