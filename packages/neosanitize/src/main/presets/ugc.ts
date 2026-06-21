import { UNSAFE_PRESET_SYMBOL, type Preset } from '../index';

/**
 * `ugc` — rich user-generated content (forum posts, comments, articles):
 * headings, images, tables, figures, definition lists, plus the basic set.
 * Still deny-by-default and under the inviolable baseline.
 */
export const ugc: Preset = {
  [UNSAFE_PRESET_SYMBOL]: true,
  name: 'ugc',
  policy: {
    tags: new Set([
      'p', 'br', 'hr', 'b', 'i', 'em', 'strong', 'small', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'span', 'div',
      'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'kbd', 'samp',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'dl', 'dt', 'dd', 'abbr', 'cite', 'q', 'time'
    ]),
    attrs: new Map<string, Set<string>>([
      ['*', new Set(['class', 'id', 'title', 'dir', 'lang'])],
      ['a', new Set(['href', 'name', 'target', 'rel'])],
      ['img', new Set(['src', 'alt', 'width', 'height', 'loading'])],
      ['td', new Set(['colspan', 'rowspan'])],
      ['th', new Set(['colspan', 'rowspan', 'scope'])],
      ['col', new Set(['span'])],
      ['colgroup', new Set(['span'])],
      ['ol', new Set(['start', 'reversed', 'type'])],
      ['time', new Set(['datetime'])],
      ['abbr', new Set(['title'])]
    ]),
    allowUnsafe: false
  }
};
