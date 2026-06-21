import { UNSAFE_PRESET_SYMBOL, type Preset } from '../index';

/**
 * `none` — text-only. Allows no elements, so all markup is stripped and only the
 * (escaped) text content survives. The strictest safe policy.
 */
export const none: Preset = {
  [UNSAFE_PRESET_SYMBOL]: true,
  name: 'none',
  policy: { tags: new Set(), attrs: new Map(), allowUnsafe: false }
};
