import type { Preset } from '../index';

/**
 * `none`: text-only. Allows no elements, so all markup is stripped and only the
 * (escaped) text content survives. The strictest safe policy.
 */
export const none: Preset = () => {};
