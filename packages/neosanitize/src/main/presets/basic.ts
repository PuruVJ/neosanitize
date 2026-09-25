import type { Preset } from '../index';

/**
 * `basic`: minimal safe inline + block formatting. Good for short comments:
 * paragraphs, emphasis, links, lists, quotes, inline/block code.
 */
export const basic: Preset = (b) => {
  b.allow(['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'])
    .allow('a', ['href', 'title']);
};
