import { UNSAFE_PRESET_SYMBOL, type Preset } from '../index';

/**
 * `basic` — minimal safe inline + block formatting. Good for short comments:
 * paragraphs, emphasis, links, lists, quotes, inline/block code.
 */
export const basic: Preset = {
  [UNSAFE_PRESET_SYMBOL]: true,
  name: 'basic',
  policy: {
    tags: new Set(['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre']),
    attrs: new Map<string, Set<string>>([['a', new Set(['href', 'title'])]]),
    allowUnsafe: false
  }
};
