/**
 * neosanitize, main entry (default / Node).
 *
 * Wires the engine core (./core) to the custom, browser-faithful WHATWG parser
 * (./parser, verified against html5lib-tests). This is the entry used everywhere
 * EXCEPT browser bundlers, which resolve the package's `browser` export condition
 * to ./browser instead (native `DOMParser`, zero parser bytes). Both builds expose
 * the identical `Sanitizer` class API, only the default parse adapter differs, and
 * either can be overridden per-instance with `.parser(adapter)`.
 *
 * See ./core for the policy engine + serializer and the full API docs.
 */
export * from './core';

import { SanitizerCore, type SanitizerOptions, type Policy } from './core';
import { whatwgAdapter } from './whatwg-parser';

// The default parse adapter. Re-exported from the whatwg-parser module so the
// same import works in a browser bundle (where `.` resolves to the DOMParser build).
export { whatwgAdapter };

/**
 * The default `Sanitizer`: parses untrusted HTML with the bundled WHATWG parser,
 * so it behaves identically in Node and the browser (no DOM required). Build one
 * with `Sanitizer.builder()`, e.g. `Sanitizer.builder(ugc).build()`. Override the
 * parser with `.parser(adapter)` (e.g. `parse5Adapter` from `neosanitize/parse5`).
 */
export class Sanitizer extends SanitizerCore {
  constructor(policy?: Policy, opts: SanitizerOptions = {}) {
    super(policy, whatwgAdapter, opts);
  }
}
