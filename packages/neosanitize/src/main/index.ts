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

import { SanitizerCore, type SanitizerOptions, type Policy, type ElementNode, type Removal, type TreeNode } from './core';
import { whatwgAdapter } from './whatwg-parser';
import { TreeBuilder } from './parser/tree-builder';

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
    this.streamOk = this.canStream();
  }
  private readonly streamOk: boolean;
  /** Pops between streaming passes (see `run`); bounds how many completed elements
   * wait in the tree before being written. Static so tests can force every pop. */
  protected static streamEvery = 32;
  /** Pops without a successful top-level drain before streaming goes deeper than
   * body's children (see `run`). */
  protected static streamDeepAfter = 4096;

  /**
   * Same bytes as the tree-then-walk path, but content is serialized and released
   * DURING tree building, so the whole document tree never has to be resident.
   * With `flush` (sanitizeTo) output also leaves in chunks as parsing proceeds.
   *
   * The open elements below <body> that are streamable containers form an
   * "entered" prefix of the open stack: their open tags are already written, and
   * only their unwritten tails stay in the tree. On every pop (TreeBuilder.onPop):
   *  1. If the popped element was entered, its subtree is final (closed): write its
   *     remaining children and its close tag, and detach it.
   *  2. If `streamSafe()`, enter any newly open containers (writing the completed
   *     siblings before each first), then write the deepest entered element's
   *     completed children (all but a trailing text node, which later text could
   *     still extend, or the still-open child).
   * At EOF the still-open entered elements are closed the same way, innermost first.
   */
  protected override run(html: string, removed: Removal[] | null, flush: ((chunk: string) => void) | null, chunkSize: number): string {
    if (!this.streamOk) return super.run(html, removed, flush, chunkSize);
    const tb = new TreeBuilder(html);
    let out = ''; // one accumulator threaded through every emit (keeps chunk order)
    let started = false;
    const entered: ElementNode[] = []; // open stack [2 .. 2 + entered.length), in order
    const closes: string[] = [];
    const emit = (children: TreeNode[]) => {
      out = this.emitChildren({ type: 'document', children }, removed, flush, chunkSize, out);
    };
    /** Write `el`'s children, keeping only `keep` (its trailing still-live child). */
    const drain = (el: ElementNode, keep: TreeNode | null) => {
      const kids = el.children;
      if (keep === null) {
        if (kids.length === 0) return;
        el.children = [];
      } else {
        if (kids.length === 1) return;
        kids.pop();
        el.children = [keep];
      }
      emit(kids);
    };
    const finish = (el: ElementNode) => {
      drain(el, null);
      out += closes.pop()!;
      entered.pop();
      tb.streamWatch = entered.length === 0 ? null : entered[entered.length - 1];
      const siblings = el.parent!.children;
      // An entered element is always its parent's last child while open.
      siblings.splice(siblings.lastIndexOf(el), 1);
    };
    const { streamEvery, streamDeepAfter } = this.constructor as typeof Sanitizer;
    let stalled = 0; // pops since a pass last freed anything
    tb.streamEvery = streamEvery;
    tb.onPop = (popped: ElementNode) => {
      if (popped === tb.streamWatch) finish(popped);
      // Step 2 is optional (skipping it only keeps content in the tree longer); the
      // builder only calls in every `streamEvery` pops (or for the watched element).
      if (!tb.streamSafe()) return;
      const open = tb.openElements;
      const body = tb.body;
      if (body === null || open[1] !== body) return;
      if (!started) {
        // First time: write what precedes <body> in <html> (head content, inter-
        // element whitespace) and drop it; nothing is inserted there once body exists.
        started = true;
        const root = body.parent as ElementNode;
        const bi = root.children.indexOf(body);
        if (bi > 0) emit(root.children.splice(0, bi));
      }
      // Enter newly open containers, outermost first. Only once plain draining has
      // stalled (a single huge root, or already entered): entering costs extra
      // passes, and normal documents free plenty at the top level.
      let parent = entered.length === 0 ? body : entered[entered.length - 1];
      if (stalled >= streamDeepAfter || entered.length !== 0) for (let k = 2 + entered.length; k < open.length; k++) {
        const el = open[k];
        const sib = parent.children;
        if (el.parent !== parent || sib[sib.length - 1] !== el) break;
        drain(parent, el); // completed siblings first: output and report order
        if (!tb.streamEnterable(el)) break;
        const tags = this.openContainer(el, removed);
        if (tags === null) break;
        out += tags[0];
        entered.push(el);
        closes.push(tags[1]);
        tb.streamWatch = el;
        parent = el;
      }
      // `parent` is now the deepest entered element (or body).
      const kids = parent.children;
      stalled += streamEvery;
      if (kids.length < 2) return;
      const last = kids[kids.length - 1];
      const top = open[open.length - 1];
      if (parent === top) drain(parent, last.type === 'text' ? last : null);
      else if (last === open[2 + entered.length]) drain(parent, last);
      else return;
      stalled = 0;
    };
    const doc = tb.parse(); // runs the hooks, so `out` must be read after this
    while (entered.length !== 0) finish(entered[entered.length - 1]);
    return this.emitChildren(doc, removed, flush, chunkSize, out);
  }
}
