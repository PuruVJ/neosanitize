/**
 * Curated, audited policies — all under the single `neosanitize/presets` barrel.
 * Recommended convention is a namespace import:
 *   import * as presets from 'neosanitize/presets'
 *   Sanitizer.builder(presets.ugc).build()
 * Named imports still work: `import { ugc, markdown } from 'neosanitize/presets'`.
 * With `sideEffects: false`, bundlers drop the presets you don't reference.
 */
export { none } from './none';
export { basic } from './basic';
export { ugc } from './ugc';
export { markdown } from './markdown';
