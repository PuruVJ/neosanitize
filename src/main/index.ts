/**
 * neosanitize — main entry (default / Node).
 *
 * Wires the engine core (./core) to the custom, browser-faithful WHATWG parser
 * (./parser, verified against html5lib-tests). This is the entry used everywhere
 * EXCEPT browser bundlers, which resolve the package's `browser` export condition
 * to ./browser instead (native `DOMParser`, zero parser bytes). Both builds expose
 * the identical `Sanitizer` class API — only the parse step differs.
 *
 * See ./core for the policy engine + serializer and the full API docs.
 */
export * from './core';

import { SanitizerCore, type ParentNode } from './core';
import { TreeBuilder } from './parser/tree-builder';

/**
 * The default `Sanitizer`: parses untrusted HTML with the bundled WHATWG parser,
 * so it behaves identically in Node and the browser (no DOM required). Build one
 * with `Sanitizer.builder()` — e.g. `Sanitizer.builder(ugc).build()`.
 */
export class Sanitizer extends SanitizerCore {
  protected parse(html: string): ParentNode {
    return new TreeBuilder(html).parse();
  }
}
