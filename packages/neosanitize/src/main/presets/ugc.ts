import type { Preset } from '../index';

/**
 * `ugc`: rich user-generated content (forum posts, comments, articles): headings,
 * images, tables, figures, definition lists, plus the basic set. Still
 * deny-by-default and under the inviolable baseline.
 */
export const ugc: Preset = (b) => {
  b.allow([
    'p', 'br', 'hr', 'b', 'i', 'em', 'strong', 'small', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'span', 'div',
    'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'kbd', 'samp',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'dl', 'dt', 'dd', 'abbr', 'cite', 'q', 'time',
  ])
    .allow('*', ['class', 'id', 'title', 'dir', 'lang'])
    .allow('a', ['href', 'name', 'target', 'rel'])
    .allow('img', ['src', 'alt', 'width', 'height', 'loading'])
    .allow('td', ['colspan', 'rowspan'])
    .allow('th', ['colspan', 'rowspan', 'scope'])
    .allow('col', ['span'])
    .allow('colgroup', ['span'])
    .allow('ol', ['start', 'reversed', 'type'])
    .allow('time', ['datetime'])
    .allow('abbr', ['title']);
};
