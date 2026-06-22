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

import { SanitizerCore, type ParseAdapter, type Policy } from './core';
import { TreeBuilder } from './parser/tree-builder';

/**
 * The default parse adapter, our bundled, browser-faithful WHATWG parser. Used
 * automatically by the default `Sanitizer`; also exported so you can pass it
 * explicitly, e.g. to force it in the browser build via `.parser(whatwgAdapter)`.
 */
export const whatwgAdapter: ParseAdapter = (html) => new TreeBuilder(html).parse();

/**
 * The default `Sanitizer`: parses untrusted HTML with the bundled WHATWG parser,
 * so it behaves identically in Node and the browser (no DOM required). Build one
 * with `Sanitizer.builder()`, e.g. `Sanitizer.builder(ugc).build()`. Override the
 * parser with `.parser(adapter)` (e.g. `parse5Adapter` from `neosanitize/parse5`).
 */
export class Sanitizer extends SanitizerCore {
  constructor(policy?: Policy, parser: ParseAdapter | null = null) {
    super(policy, whatwgAdapter, parser);
  }
}
