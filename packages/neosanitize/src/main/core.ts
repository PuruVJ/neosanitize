/**
 * neosanitize, engine core (parser-agnostic policy + serializer).
 *
 * This module holds EVERYTHING except the parse step: the deny-by-default policy,
 * the inviolable safe baseline, the URL/CSS checks, and the string/text/DOM
 * serializers. It is the single source of truth for every security decision, so
 * the two entry points can NEVER drift:
 *
 *   • `./index`   (default / Node), `parse()` runs the custom WHATWG parser.
 *   • `./browser` (browser bundle), `parse()` runs the native `DOMParser`.
 *
 * Both subclass {@link SanitizerCore} and supply only `parse()`; the browser
 * build therefore ships ZERO parser bytes (it reuses the platform's parser) yet
 * shares 100% of this policy code. The node shape produced by either parser is
 * the same plain `{type,name,attrs,children}` tree (see ./parser/tree-builder).
 *
 * API is CLASS-ONLY by mandate: you BUILD a `Sanitizer` (via `Sanitizer.builder()`
 * or `new SanitizerBuilder(Sanitizer)`) and call `.sanitize()`. There is
 * deliberately NO one-shot functional `sanitize(html)` helper, constructing a
 * sanitizer forces an explicit policy choice (no careless implicit default), and
 * the policy compilation happens ONCE in the constructor so `.sanitize()` is cheap
 * to call repeatedly.
 */
import type { ElementNode, ParentNode, TreeNode } from './parser/tree-builder';
import { appendAttr, appendText, escapeText } from './escape';

// Re-export the (runtime-free) node-shape types so entry points and advanced
// users can build/consume the common tree without importing the parser.
export type { ElementNode, TextNode, CommentNode, DoctypeNode, DocumentNode, TreeNode, ParentNode, NS } from './parser/tree-builder';

/**
 * A parse adapter turns untrusted HTML into the common `{type,name,attrs,children}`
 * tree the policy engine consumes. This is the ONLY pluggable seam: every entry
 * supplies an environment-appropriate default (the bundled WHATWG parser in Node,
 * native `DOMParser` in the browser), and `Sanitizer.builder().parser(adapter)`
 * overrides it with any other, e.g. the `parse5` adapter from `neosanitize/parse5`,
 * or your own. The policy + serializer are reused verbatim regardless of parser.
 */
export type ParseAdapter = (html: string) => ParentNode;

/** Matches tag names to allow dynamically: a `RegExp` (tested against the tag) or
 * a predicate. See `SanitizerBuilder.allow`. */
export type TagMatcher = RegExp | ((tag: string) => boolean);

/** Passed to a `transformAttribute` hook for one surviving attribute. */
export interface AttributeContext {
  readonly tag: string;
  readonly name: string;
  readonly value: string;
}

/** A `transformAttribute` hook: return a replacement value, `null` to drop the
 * attribute, or `undefined` to leave it unchanged. The result is re-checked by the
 * inviolable baseline, so a hook can rewrite or drop but never reintroduce an
 * `on*` handler or a dangerous-scheme URL. See `SanitizerBuilder.transformAttribute`. */
export type AttributeTransform = (attr: AttributeContext) => string | null | undefined;

/** Compiled tag matcher (predicate + the attributes allowed on matched tags). */
interface CompiledMatcher {
  readonly test: (tag: string) => boolean;
  readonly attrs: ReadonlySet<string> | null;
}

/** Non-policy construction options threaded builder -> concrete `Sanitizer`. */
export interface SanitizerOptions {
  parser?: ParseAdapter | null;
  matchers?: readonly CompiledMatcher[];
  attrHook?: AttributeTransform | null;
}

export const version = '0.0.0-dev';

// ---------------------------------------------------------------------------
// Inviolable safe baseline (applied unless policy.allowUnsafe, mirrors the
// native setHTML() safe path). These hold EVEN IF the allow-list permits them;
// only `sanitizeUnsafe()` skips them.
// ---------------------------------------------------------------------------
/** Elements always dropped WITH their content under the baseline. */
const BASELINE_DROP = new Set(['script']);
/** Disallowed elements whose CONTENT is also dropped (not unwrapped), raw-text
 * / metadata elements whose children aren't renderable text. */
const DROP_CONTENT_WHEN_DISALLOWED = new Set(['script', 'style', 'textarea', 'option', 'xmp', 'noscript', 'noembed', 'noframes', 'iframe', 'title', 'template']);
/** Void elements, serialized with no end tag and no children. */
const VOID_ELEMENTS = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img', 'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Raw-text elements, their text children serialize unescaped — ONLY valid in the
 * HTML namespace (see the namespace gate in `emitElement`). `noscript` is
 * intentionally excluded: with scripting disabled (this engine's model) its content
 * is parsed as normal markup with entities decoded, never as verbatim raw text, so
 * emitting it unescaped would re-materialize decoded markup (a baseline bypass). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
/** Attributes interpreted as URLs (for the baseline scheme check). Any other
 * attribute whose local name is `href` (`xlink href` space-stored foreign form, or
 * a literal `xlink:href` on an HTML element that re-parses as SVG) is checked too,
 * see `attrUnsafe`. `srcdoc` is NOT a URL: it is a whole same-origin document, so
 * the baseline drops it outright. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background', 'cite', 'longdesc', 'poster', 'data', 'manifest']);

// ---------------------------------------------------------------------------
// Policy (resolved, immutable). Deliberately minimal for the scaffold, the
// real shape firms up alongside the engine. Presets/url/css live in their own
// tree-shakeable subpath modules and are passed INTO the builder.
// ---------------------------------------------------------------------------
export interface Policy {
  /** Allowed element names. Deny-by-default: everything else is dropped. */
  readonly tags: ReadonlySet<string>;
  /** Allowed attributes, per tag (`*` = any tag). */
  readonly attrs: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * When false (the safe default), an inviolable baseline still strips
   * known-unsafe constructs (script, event handlers, javascript: URLs, …) even
   * if `tags`/`attrs` would allow them. `sanitizeUnsafe()` sets this true.
   */
  readonly allowUnsafe: boolean;
}

/**
 * A preset is a function that applies rules to a builder. Presets compose: a
 * preset can call `b.preset(other)`. The curated presets in `neosanitize/presets`
 * (`none` / `basic` / `ugc` / `markdown`) are values of this type.
 *
 *   const corporate: Preset = (b) => b.preset(ugc).allow(/^acme-/, '*');
 *   Sanitizer.builder(corporate).build();
 */
export type Preset = (builder: SanitizerBuilder) => void;

const EMPTY_POLICY: Policy = {
  tags: new Set(),
  attrs: new Map(),
  allowUnsafe: false
};

/** Fallback when `SanitizerCore` is constructed directly with no parser. Every
 * shipped entry (`neosanitize`, `neosanitize/browser`) supplies a real default,
 * so this only fires if you instantiate the base class without one. */
const THROW_NO_PARSER: ParseAdapter = () => {
  throw new Error('neosanitize: no parse adapter. Use the `Sanitizer` from "neosanitize" (or "neosanitize/browser"), or pass one via `.parser(adapter)`.');
};

const EMPTY_MATCHERS: readonly CompiledMatcher[] = [];
/** Upper bound on tag names memoized from pattern (`allow`) resolution, so a hostile
 * input with many distinct unknown tag names can't grow the cache without limit.
 * Past the cap, matchers still run, the result just isn't cached. */
const DYNAMIC_TAG_CACHE_CAP = 4096;

/** Precomputed serialize data for one allow-listed ("keep") tag. See `tagCache`. */
interface TagSer {
  /** The open-tag prefix `<name` (sans attributes and `>`). */
  readonly open: string;
  /** The full end tag `</name>`. */
  readonly close: string;
  /** Void element, no end tag, no children. */
  readonly isVoid: boolean;
  /** Raw-text element, text children serialize unescaped. */
  readonly rawText: boolean;
  /** Resolved allow-listed attributes (tag-specific ∪ `*`), each mapped to its
   * precomputed {@link AttrSpec}; null = none allowed. Ignored when `allowAll`. */
  readonly attrSpecs: ReadonlyMap<string, AttrSpec> | null;
  /** Allow ANY attribute on this tag (from a `'*'` entry in its attr list). The
   * baseline still strips `on*` / dangerous URLs. */
  readonly allowAll: boolean;
}

/** Baseline attribute kinds. The baseline's decision depends on the attribute NAME
 * (plus, for URL/attributeName/style, the value), so the name part is classified
 * ONCE (at build() for allow-listed names, memoized for `allowAll`) instead of
 * re-running the `on*` / URL_ATTRS / endsWith / toLowerCase chain per attribute.
 * Must mirror the order of checks in the baseline exactly (see `attrValue`). */
const K_PLAIN = 0, K_EVENT = 1, K_URL = 2, K_SRCDOC = 3, K_ATTRNAME = 4, K_ANIM_URL = 5, K_ANIM_VALUES = 6, K_STYLE = 7;
/** Precomputed per-attribute-name data. */
interface AttrSpec {
  /** Serialized prefix ` name="` (foreign "xlink href" -> "xlink:href"). */
  readonly pre: string;
  /** The serialized name, for `setAttribute`. */
  readonly dom: string;
  /** One of the K_* kinds. */
  readonly kind: number;
}
function attrKind(name: string): number {
  if (name.length >= 2 && name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) return K_EVENT; // on*
  if (URL_ATTRS.has(name) || name.endsWith(' href') || name.endsWith(':href')) return K_URL;
  if (name === 'srcdoc') return K_SRCDOC;
  if (name.length === 13 && name.toLowerCase() === 'attributename') return K_ATTRNAME;
  if (name === 'to' || name === 'from' || name === 'by') return K_ANIM_URL;
  if (name === 'values') return K_ANIM_VALUES;
  if (name === 'style') return K_STYLE;
  return K_PLAIN;
}
function makeAttrSpec(name: string): AttrSpec {
  // foreign namespaced attrs are stored as "xlink href" (space) -> "xlink:href"
  const dom = name.indexOf(' ') === -1 ? name : name.replace(' ', ':');
  return { pre: ' ' + dom + '="', dom, kind: attrKind(name) };
}
/** Memo for `allowAll` tags, whose attribute names are open-ended (attacker-chosen),
 * so it is bounded: past the cap specs are built per use and not retained. */
const anySpecMemo = new Map<string, AttrSpec>();
const ANY_SPEC_MEMO_CAP = 2048;
function anyAttrSpec(name: string): AttrSpec {
  let spec = anySpecMemo.get(name);
  if (spec === undefined) {
    spec = makeAttrSpec(name);
    if (anySpecMemo.size < ANY_SPEC_MEMO_CAP) anySpecMemo.set(name, spec);
  }
  return spec;
}

// Minimal Trusted Types shapes, not in the configured DOM lib, and we stay
// zero-dep; structurally compatible with the real browser globals.
export interface TrustedHTML {
  toString(): string;
}
interface TrustedTypePolicy {
  createHTML(input: string): TrustedHTML;
}
interface TrustedTypePolicyFactory {
  createPolicy(name: string, rules: { createHTML: (s: string) => string }): TrustedTypePolicy;
}

/** One element/attribute/value removed during sanitization (report mode). */
export interface Removal {
  readonly kind: 'tag' | 'attr' | 'url' | 'style';
  readonly name: string;
  readonly reason: string;
}
/** Result of {@link SanitizerCore.sanitizeWithReport}. */
export interface SanitizeReport {
  readonly html: string;
  readonly removed: Removal[];
}

/** A destination for {@link SanitizerCore.sanitizeTo}: either a chunk callback or
 * any object with a Node-style `write` (an HTTP response, `fs` write stream, …). */
export type SanitizeSink = ((chunk: string) => void) | { write(chunk: string): unknown };
/** Options for {@link SanitizerCore.sanitizeTo}. */
export interface SanitizeToOptions {
  /** Target write size in characters; fragments are batched up to this before a
   * flush, so the sink isn't hit with a write per tag. Default 16384. */
  readonly chunkSize?: number;
}

// ---------------------------------------------------------------------------
// SanitizerCore, the compiled, reusable base object. Abstract over the parser:
// a concrete subclass supplies `parse()` (custom WHATWG parser, or native DOM).
// ---------------------------------------------------------------------------
// Hoisted once, a regex literal in a function body allocates a new object per
// call; these run per text node / per attribute / per URL on the hot path.
const RE_CSS_CTRL = /[\u0000-\u001f]/;
const RE_WS_G = /\s+/g;
const RE_QUOTES_G = /['"]/g;
/** Serializer hand-off size for `sanitize()` (see SanitizerCore.collect). */
const OUT_CHUNK = 256;
const JS_SCHEME = 'javascript', VB_SCHEME = 'vbscript', DATA_SCHEME = 'data';
/** ASCII whitespace per JS `trim` / `\s` restricted to ASCII: TAB LF VT FF CR SP. */
const isAsciiWs = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);
// Bounds for the sanitizeStyle memo (see SanitizerCore.sanitizeStyle).
const STYLE_MEMO_CAP = 512;
const STYLE_MEMO_MAX_LEN = 256;

export class SanitizerCore {
  /** Compiled, immutable policy. */
  readonly policy: Policy;

  /** The environment default parser, supplied by the concrete entry subclass
   * (bundled WHATWG parser in Node, native `DOMParser` in the browser). */
  private readonly defaultParse: ParseAdapter;
  /** An explicit per-instance override from `.parser(adapter)`, or `null` to use
   * the environment default. Carried through `sanitizeUnsafe`'s re-parse. */
  private readonly parserOverride: ParseAdapter | null;

  /** Per-tag serialize cache, built once from the policy. Holds ONLY tags that
   * serialize as "keep" (allow-listed and not baseline-dropped); a miss routes
   * to the slow drop/unwrap path. Collapses the per-element baseline/allow-list/
   * void/raw-text `Set.has` chain and the open/close-tag concatenations into one
   * `Map.get` plus field reads on the serialize hot path. */
  // null = computed and disallowed (memoized negative); missing = not yet computed.
  private readonly tagCache: Map<string, TagSer | null>;
  /** Patterns that allow tags by name (from `allow` with a pattern), consulted only on a
   * tagCache miss. Empty in the common case, so the hot path is unchanged. */
  private readonly matchers: readonly CompiledMatcher[];
  /** Per-attribute transform hook (from `transformAttribute`), or null. */
  private readonly attrHook: AttributeTransform | null;
  /** Count of dynamically memoized tags, bounded by DYNAMIC_TAG_CACHE_CAP. */
  private dynamicCacheCount = 0;

  constructor(policy: Policy = EMPTY_POLICY, defaultParse: ParseAdapter = THROW_NO_PARSER, opts: SanitizerOptions = {}) {
    // The constructor is where the expensive compilation happens once: resolving
    // the policy into the fast structures `.sanitize()` reuses.
    this.policy = policy;
    this.defaultParse = defaultParse;
    this.parserOverride = opts.parser ?? null;
    this.matchers = opts.matchers ?? EMPTY_MATCHERS;
    this.attrHook = opts.attrHook ?? null;
    const cache = new Map<string, TagSer | null>();
    for (const tag of policy.tags) {
      // baseline-dropped tags (e.g. <script>) are NOT cached as keep → slow path.
      if (!policy.allowUnsafe && BASELINE_DROP.has(tag)) continue;
      cache.set(tag, this.buildTagSer(tag, policy.attrs.get(tag) ?? null));
    }
    this.tagCache = cache;
  }

  /** Precompute the serialize data for one kept tag, merging its own allowed
   * attributes with the `*` (any-tag) set. A `'*'` entry in `own` means "all
   * attributes" (the baseline still applies). */
  private buildTagSer(tag: string, own: ReadonlySet<string> | null): TagSer {
    const allowAll = own !== null && own.has('*');
    const star = this.policy.attrs.get('*');
    let attrSet: ReadonlySet<string> | null;
    if (allowAll) attrSet = null;
    else if (own && star) { const m = new Set(own); for (const a of star) m.add(a); attrSet = m; }
    else attrSet = own ?? star ?? null;
    let attrSpecs: Map<string, AttrSpec> | null = null;
    if (attrSet !== null && attrSet.size !== 0) {
      attrSpecs = new Map();
      for (const a of attrSet) attrSpecs.set(a, makeAttrSpec(a));
    }
    return {
      open: '<' + tag,
      close: '</' + tag + '>',
      isVoid: VOID_ELEMENTS.has(tag),
      rawText: RAW_TEXT_ELEMENTS.has(tag),
      attrSpecs,
      allowAll,
    };
  }

  /** The keep-info for a tag, or null if it should be dropped/unwrapped. Static
   * allow-listed tags hit the prebuilt cache; otherwise the matchers are consulted
   * (and the result memoized, bounded). The single tag decision for every path. */
  private tagInfo(tag: string): TagSer | null {
    const cached = this.tagCache.get(tag);
    if (cached !== undefined) return cached; // TagSer (keep) or null (memoized disallowed)
    if (this.matchers.length === 0) return null;
    let ser: TagSer | null = null;
    if (this.policy.allowUnsafe || !BASELINE_DROP.has(tag)) {
      for (let i = 0; i < this.matchers.length; i++) {
        if (this.matchers[i].test(tag)) { ser = this.buildTagSer(tag, this.matchers[i].attrs); break; }
      }
    }
    if (this.dynamicCacheCount < DYNAMIC_TAG_CACHE_CAP) {
      this.tagCache.set(tag, ser);
      this.dynamicCacheCount++;
    }
    return ser;
  }

  /**
   * Parse untrusted HTML into the common `{type,name,attrs,children}` tree, via
   * the active adapter: an explicit `.parser()` override if set, else the
   * environment default. This is the ONLY pluggable seam, the policy engine and
   * serializer downstream are identical for every parser.
   */
  /** True when `sanitize()` may stream during tree building: the environment
   * default parser is in use and html/head/body are not kept (their attributes can
   * still change after body content has been emitted, via a later duplicate tag). */
  protected canStream(): boolean {
    return this.parserOverride === null && this.tagInfo('html') === null && this.tagInfo('head') === null && this.tagInfo('body') === null;
  }

  protected parse(html: string): ParentNode {
    return (this.parserOverride ?? this.defaultParse)(html);
  }

  /** Sanitize to a string. Always applies the inviolable safe baseline. */
  sanitize(html: string): string {
    return this.collect(html, null);
  }

  /** Run the pipeline into one string. The serializer grows a short `+=` rope and
   * hands it off every OUT_CHUNK chars; the pieces are joined once at the end.
   * Measured against both alternatives: a single whole-document rope is fastest on
   * small inputs but its long cons chain makes young-gen GC 2-3x slower on
   * multi-MB documents; push-every-fragment + join pays an array slot per fragment
   * and a big join. Short ropes in an array get the best of both. */
  private collect(html: string, removed: Removal[] | null): string {
    const parts: string[] = [];
    const rest = this.run(html, removed, (c) => { parts.push(c); }, OUT_CHUNK);
    if (parts.length === 0) return rest;
    parts.push(rest);
    return parts.join('');
  }

  /** Parse + policy walk + serialize, the one string-output pipeline behind
   * `sanitize` / `sanitizeWithReport` / `sanitizeTo`. The Node entry overrides it
   * to serialize completed top-level content during tree building. Returns the
   * unflushed remainder (all of it when `flush` is null). */
  protected run(html: string, removed: Removal[] | null, flush: ((chunk: string) => void) | null, chunkSize: number): string {
    return this.emitChildren(this.parse(html), removed, flush, chunkSize);
  }

  /** Sanitize and report what was removed and why (debug / audit / telemetry). */
  sanitizeWithReport(html: string): SanitizeReport {
    const removed: Removal[] = [];
    const out = this.collect(html, removed);
    return { html: out, removed };
  }

  /**
   * Stream the sanitized HTML to a sink instead of returning one string. `sink` is
   * either a callback `(chunk) => void` or any object with a Node-style
   * `write(chunk)` method (an HTTP response, an `fs` write stream, your own).
   *
   * Same parse, same inviolable baseline, same bytes as {@link sanitize}, just
   * delivered incrementally, so no single large result string is built and large
   * documents stay friendlier on memory. Fragments are batched into
   * ~`chunkSize`-character writes (default 16 KB) so the sink isn't hit per tag.
   *
   * Synchronous: the sink is called inline while the tree is walked, and the whole
   * input is parsed first (a faithful tree is required), so this streams *output*,
   * not input. Backpressure is not awaited; for a slow consumer, buffer as needed.
   */
  sanitizeTo(html: string, sink: SanitizeSink, opts?: SanitizeToOptions): void {
    const write = typeof sink === 'function' ? sink : (c: string) => { sink.write(c); };
    const rest = this.run(html, null, write, opts?.chunkSize ?? 16384);
    if (rest !== '') write(rest);
  }

  /** Strip all markup to plain text (raw-text/script content excluded). */
  sanitizeToText(html: string): string {
    const out: string[] = [];
    SanitizerCore.collectText(this.parse(html), out);
    return out.join('');
  }

  /**
   * Sanitize directly into a `DocumentFragment` (browser only), builds DOM nodes
   * from the sanitized tree, skipping the non-idempotent serialize→reparse step
   * (the strongest-safety path). Throws outside a DOM environment.
   */
  sanitizeToFragment(html: string): DocumentFragment {
    if (typeof document === 'undefined') {
      throw new Error('neosanitize: sanitizeToFragment requires a DOM (browser-only)');
    }
    const frag = document.createDocumentFragment();
    this.buildDom(this.parse(html), frag);
    return frag;
  }

  /**
   * Sanitize and return a `TrustedHTML` via a Trusted Types policy when available
   * (browser w/ CSP Trusted Types), else the sanitized string. The string is
   * already safe; the wrapper just satisfies a TrustedHTML sink.
   */
  sanitizeToTrustedHTML(html: string): TrustedHTML | string {
    const safe = this.sanitize(html);
    const tt = (globalThis as unknown as { trustedTypes?: TrustedTypePolicyFactory }).trustedTypes;
    if (tt) {
      try {
        SanitizerCore.ttPolicy ??= tt.createPolicy('neosanitize', { createHTML: (s: string) => s });
        return SanitizerCore.ttPolicy.createHTML(safe);
      } catch {
        return safe;
      }
    }
    return safe;
  }
  private static ttPolicy: TrustedTypePolicy | undefined;

  // --- DOM + text builders (share elementAction/attrValue) -----------
  // Both iterative (explicit stack) for the same stack-overflow reason as
  // `emitChildren`. Children are pushed in reverse so they're visited in order.
  private buildDom(root: ParentNode, domRoot: Node): void {
    const nodes: TreeNode[] = [];
    const targets: Node[] = [];
    for (let k = root.children.length - 1; k >= 0; k--) { nodes.push(root.children[k]); targets.push(domRoot); }
    while (nodes.length !== 0) {
      const child = nodes.pop()!;
      const domParent = targets.pop()!;
      if (child.type === 'text') {
        domParent.appendChild(document.createTextNode(child.value));
        continue;
      }
      if (child.type !== 'element') continue;
      const info = this.tagInfo(child.name);
      let into = domParent; // unwrap: children go straight into the current parent
      if (info === null) {
        if (this.elementAction(child) === 'drop') continue;
      } else {
        const el = document.createElement(child.name);
        const attrs = child.attrs;
        for (let k = 0; k < attrs.length; k++) {
          const name = attrs[k][0];
          const spec = info.allowAll ? anyAttrSpec(name) : info.attrSpecs?.get(name);
          if (spec === undefined) continue;
          const v = this.attrValue(child.name, name, attrs[k][1], spec.kind, null);
          if (v === null) continue;
          try { el.setAttribute(spec.dom, v); } catch { /* invalid attr name */ }
        }
        domParent.appendChild(el);
        if (info.isVoid) continue;
        into = el;
      }
      const kids = child.children;
      for (let k = kids.length - 1; k >= 0; k--) { nodes.push(kids[k]); targets.push(into); }
    }
  }
  private static collectText(root: ParentNode, out: string[]): void {
    const stack: TreeNode[] = [];
    for (let k = root.children.length - 1; k >= 0; k--) stack.push(root.children[k]);
    while (stack.length !== 0) {
      const child = stack.pop()!;
      if (child.type === 'text') out.push(child.value);
      else if (child.type === 'element' && !RAW_TEXT_ELEMENTS.has(child.name)) {
        const kids = child.children;
        for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
      }
    }
  }

  // --- policy decisions (single source of truth, shared by every output path) --
  /** What to do with an element: drop (with content), unwrap (drop the tag, keep
   * sanitized children), or keep. */
  private elementAction(el: ElementNode): 'drop' | 'unwrap' | 'keep' {
    if (!this.policy.allowUnsafe && BASELINE_DROP.has(el.name)) return 'drop';
    if (!this.policy.tags.has(el.name)) return DROP_CONTENT_WHEN_DISALLOWED.has(el.name) ? 'drop' : 'unwrap';
    return 'keep';
  }
  /** The single per-attribute decision for an ALLOW-LISTED attribute (the caller
   * resolved its spec from the tag's allow-list; a miss is "not-allowed"). Runs the
   * transform hook, then the inviolable baseline by precomputed kind. Returns the
   * value to emit, or null to drop it (recording why if `removed`). Shared by every
   * output path, so string / DOM / report can't drift. */
  private attrValue(tag: string, name: string, value: string, kind: number, removed: Removal[] | null): string | null {
    let v = value;
    // transform hook runs on allow-listed attrs only (it can rewrite or drop, never
    // resurrect a denied one), and its result still goes through the baseline.
    if (this.attrHook !== null) {
      const r = this.attrHook({ tag, name, value: v });
      if (r === null) { removed?.push({ kind: 'attr', name, reason: 'transformed-out' }); return null; }
      if (r !== undefined) v = r;
    }
    if (kind === K_PLAIN || this.policy.allowUnsafe) return v;
    switch (kind) {
      case K_EVENT:
        removed?.push({ kind: 'attr', name, reason: 'event-handler' });
        return null;
      case K_URL:
        if (!SanitizerCore.dangerousUrl(v)) return v;
        removed?.push({ kind: 'url', name, reason: 'dangerous-url' });
        return null;
      case K_SRCDOC: // a srcdoc frame is a same-origin document: raw HTML, not a URL
        removed?.push({ kind: 'attr', name, reason: 'unsafe-attr' });
        return null;
      // SVG <animate>/<set> can rewrite an href to javascript: via to/from/by/values.
      // Denying an href-targeting attributeName leaves the animation with no target,
      // and the animation values themselves are URL-checked (`values` is `;`-split).
      case K_ATTRNAME:
        if (!v.trim().toLowerCase().endsWith('href')) return v;
        removed?.push({ kind: 'attr', name, reason: 'unsafe-attr' });
        return null;
      case K_ANIM_URL:
        if (!SanitizerCore.dangerousUrl(v.trim())) return v;
        removed?.push({ kind: 'url', name, reason: 'dangerous-url' });
        return null;
      case K_ANIM_VALUES:
        if (v.indexOf(':') !== -1) {
          let start = 0;
          for (;;) {
            const end = v.indexOf(';', start);
            if (SanitizerCore.dangerousUrl(v.slice(start, end === -1 ? v.length : end).trim())) {
              removed?.push({ kind: 'url', name, reason: 'dangerous-url' });
              return null;
            }
            if (end === -1) break;
            start = end + 1;
          }
        }
        return v;
      default: { // K_STYLE
        const css = SanitizerCore.sanitizeStyle(v);
        if (css === '') { removed?.push({ kind: 'style', name, reason: 'unsafe-css' }); return null; }
        if (css !== v) removed?.push({ kind: 'style', name, reason: 'unsafe-css-declaration' });
        return css;
      }
    }
  }

  // --- string serializer ----------------------------------------------------
  // Iterative, explicit-stack walk. Recursion here was a stack-overflow DoS: the
  // tree builder is iterative, but a recursive serializer blows the native stack on
  // deeply nested input (`<div>`×N), a shallow ~20 KB payload reachable with the
  // default config. The stack holds either a TreeNode to process or a pre-built
  // close-tag string; children are pushed in reverse so they emit in document order,
  // ahead of the close tag pushed before them. Byte-identical to the old recursion.
  //
  // Output is ONE string grown with `+=` (V8 cons-string rope, flattened once on
  // first use) instead of push-to-array + join: no array growth, no join pass,
  // ~1/3 less allocation on large documents. `sanitizeTo` passes `flush`: once the
  // pending string reaches chunkSize it goes to the sink and resets, so every chunk
  // but the last is >= chunkSize and memory stays bounded by ~chunkSize.
  protected emitChildren(parent: ParentNode, removed: Removal[] | null, flush: ((chunk: string) => void) | null, chunkSize: number, prefix = ''): string {
    let out = prefix;
    // Frame stack, one flat array of (children, next index, close tag or '' when
    // unwrapped) triples: no per-child push, memory bounded by depth not breadth.
    const frames: Array<TreeNode[] | number | string> = [parent.children, 0, ''];
    let top = 0;
    while (top >= 0) {
      const list = frames[top] as TreeNode[];
      const i = frames[top + 1] as number;
      if (i === list.length) {
        out += frames[top + 2] as string;
        top -= 3;
        continue;
      }
      frames[top + 1] = i + 1;
      if (flush !== null && out.length >= chunkSize) { flush(out); out = ''; }
      const item = list[i];
      if (item.type === 'text') { out = appendText(out, item.value); continue }
      if (item.type !== 'element') continue; // comments/doctype dropped
      const el = item;
      const info = this.tagInfo(el.name);
      if (info === null) {
        const action = this.elementAction(el);
        if (action === 'drop') { removed?.push({ kind: 'tag', name: el.name, reason: 'unsafe-element' }); continue; }
        // html/head/body are implicit document structure, not user-content removals
        if (removed && el.name !== 'html' && el.name !== 'head' && el.name !== 'body') {
          removed.push({ kind: 'tag', name: el.name, reason: 'not-allowed' });
        }
        // unwrap: process children in place, no wrapper tag
        top += 3; frames[top] = el.children; frames[top + 1] = 0; frames[top + 2] = '';
        continue;
      }
      out = this.emitOpen(el, info, removed, out + info.open) + '>';
      if (info.isVoid) continue;
      // SECURITY: raw-text (unescaped) emission is only correct for HTML-namespace
      // raw-text elements, whose text the tokenizer captured VERBATIM (rawtext state,
      // so it cannot contain the closing tag or decoded markup). The SAME tag name in
      // a foreign (SVG/MathML) subtree is parsed in the data state — its "text" has
      // decoded entities (e.g. `&lt;script&gt;` → `<script>`), so emitting it raw would
      // re-materialize live markup that never passed the policy (a baseline bypass).
      // Rawtext elements contain only a verbatim text run, so emit inline + close now.
      //
      // The namespace gate alone is not enough: the context the OUTPUT re-parses in
      // can differ from the one we parsed (an unwrapped foreignObject / mi / desc, a
      // dropped annotation-xml `encoding`, mglyph under mtext, or an adapter that
      // mislabels foreign elements as HTML). There the "raw" text is parsed as
      // markup. So raw text is emitted verbatim ONLY when it holds no `<`: without
      // one no tag, comment or end tag can form in any context. Otherwise it is
      // escaped, which is inert everywhere (shown literally in a real raw-text
      // context, plain text in any other).
      if (info.rawText && el.namespace === 'html') {
        const kids = el.children;
        for (let k = 0; k < kids.length; k++) {
          const c = kids[k];
          if (c.type === 'text') out = c.value.indexOf('<') === -1 ? out + c.value : appendText(out, c.value);
        }
        out += info.close;
        continue;
      }
      top += 3; frames[top] = el.children; frames[top + 1] = 0; frames[top + 2] = info.close; // close emitted after children
    }
    return out;
  }

  /** `out` + the filtered attributes of kept element `el` (the caller has already
   * appended `<name`; it appends the `>`). Fused filter + emit: no intermediate
   * kept-attrs array. The one attribute serializer for every string path. */
  private emitOpen(el: ElementNode, info: TagSer, removed: Removal[] | null, out: string): string {
    const attrs = el.attrs;
    if (attrs.length === 0) return out;
    const specs = info.attrSpecs, allowAll = info.allowAll;
    for (let k = 0; k < attrs.length; k++) {
      const pair = attrs[k];
      const name = pair[0];
      const spec = allowAll ? anyAttrSpec(name) : specs === null ? undefined : specs.get(name);
      if (spec === undefined) { removed?.push({ kind: 'attr', name, reason: 'not-allowed' }); continue; }
      const v = this.attrValue(el.name, name, pair[1], spec.kind, removed);
      if (v !== null) out = appendAttr(out + spec.pre, v) + '"';
    }
    return out;
  }

  /**
   * For streaming: the output for entering `el` as a container whose children will
   * be serialized separately, exactly as `emitChildren` would write it. Returns
   * `[open, close]` (both '' when `el` is unwrapped), or null when `el` can't be
   * streamed as a container (dropped with its content, void, or raw text); the
   * caller then leaves it in the tree for the normal walk. Records the same
   * removals, in the same order, as the walk would at this element.
   */
  protected openContainer(el: ElementNode, removed: Removal[] | null): [string, string] | null {
    const info = this.tagInfo(el.name);
    if (info === null) {
      if (this.elementAction(el) === 'drop') return null;
      if (removed && el.name !== 'html' && el.name !== 'head' && el.name !== 'body') {
        removed.push({ kind: 'tag', name: el.name, reason: 'not-allowed' });
      }
      return ['', ''];
    }
    if (info.isVoid || info.rawText) return null;
    return [this.emitOpen(el, info, removed, info.open) + '>', info.close];
  }

  private static dangerousUrl(value: string): boolean {
    const colon = value.indexOf(':');
    if (colon <= 0) return false; // no scheme (relative / fragment / leading ':') -> safe

    // FAST PATH (the hot case): if every char before the ':' is a clean scheme
    // char [A-Za-z0-9+.-], the scheme is UNAMBIGUOUS, no `new URL()` needed.
    // This is safe because any obfuscation able to smuggle a "javascript:" past
    // the browser's own URL parser MUST inject a non-scheme char (tab, newline,
    // space, control) into the scheme, which fails this scan and drops to the
    // authoritative parse below. Avoids a native URL allocation per URL attribute
    // (profiling showed `new URL()` teardown dominating on URL-heavy input).
    let clean = true;
    for (let i = 0; i < colon; i++) {
      const c = value.charCodeAt(i);
      if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) {
        clean = false;
        break;
      }
    }
    if (clean) {
      // Only javascript/vbscript/data are special — match by length + ASCII
      // case-insensitive compare, no `slice().toLowerCase()` allocation per URL.
      // (The clean scan above proved these bytes are ASCII [A-Za-z0-9+.-].)
      if (colon === 10) { if (SanitizerCore.schemeEq(value, 'javascript')) return true; }
      else if (colon === 8) { if (SanitizerCore.schemeEq(value, 'vbscript')) return true; }
      else if (colon === 4 && SanitizerCore.schemeEq(value, 'data')) return SanitizerCore.dangerousDataUrl(value);
      return false; // http/https/mailto/tel/ftp/blob/... are fine
    }

    // SLOW PATH (obfuscated scheme, or a relative URL with a ':' later on, e.g.
    // `/wiki/File:X.png`, `?t=1:30`): extract the scheme exactly as the WHATWG URL
    // parser does, in one allocation-free scan. Strip leading C0 control/space;
    // ASCII tab/LF/CR are removed anywhere (so `java\tscript:` IS javascript); a
    // scheme is an ASCII alpha then [A-Za-z0-9+.-]* up to ':'. Any other char
    // first means "no scheme": a relative URL, which cannot run script. Replaces a
    // `new URL()` call that THREW (~2.4us) for every relative URL with a colon.
    // Only difference from `new URL()`: a javascript:/vbscript:/data: URL whose
    // REST fails to parse (e.g. `\tjavascript://[`) was kept before, and is now
    // judged by its scheme and dropped, which is strictly safer.
    const n = value.length;
    let i = 0;
    while (i < n && value.charCodeAt(i) <= 0x20) i++;
    let len = 0, js = true, vb = true, data = true;
    for (; i < n; i++) {
      const c = value.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) continue;
      if (c === 58) break; // ':'
      const lc = c | 0x20;
      if (!((lc >= 97 && lc <= 122) || (len !== 0 && ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)))) return false; // no scheme
      if (js && (len >= 10 || lc !== JS_SCHEME.charCodeAt(len))) js = false;
      if (vb && (len >= 8 || lc !== VB_SCHEME.charCodeAt(len))) vb = false;
      if (data && (len >= 4 || lc !== DATA_SCHEME.charCodeAt(len))) data = false;
      len++;
    }
    // (The loop always stops at a ':': the fast path returned unless one exists,
    // and ':' is never skipped as whitespace.)
    if ((js && len === 10) || (vb && len === 8)) return true;
    if (data && len === 4) return SanitizerCore.dangerousDataUrl(value.trim());
    return false; // http/https/mailto/tel/ftp/... are fine
  }
  /** A `data:` URL is safe ONLY when it carries a RASTER image type. `image/svg+xml`
   * is rejected: an SVG document rendered from a `data:` URL in a document context
   * (`<iframe src>`, `<object data>`, `<embed src>`, SVG `<use href>`) executes its
   * script/`on*` handlers. Since the URL check can't see the sink tag, and DOMPurify
   * likewise forbids SVG data URIs by default, we deny svg+xml across all URL attrs.
   * (An `<img src="data:image/svg+xml">` is inert, but blocking it is the safe call.) */
  /** `value`'s first `lit.length` chars equal the lowercase ASCII literal `lit`,
   * case-insensitively. Caller guarantees those bytes are ASCII. Avoids the
   * per-URL `slice().toLowerCase()` allocation on the hot scheme-check path. */
  private static schemeEq(value: string, lit: string): boolean {
    for (let i = 0; i < lit.length; i++) {
      if ((value.charCodeAt(i) | 0x20) !== lit.charCodeAt(i)) return false;
    }
    return true;
  }
  private static dangerousDataUrl(value: string): boolean {
    // Browsers drop tab/LF/CR anywhere in a URL, so `data:image/s\tvg+xml` IS svg.
    // Collect the first 20 chars that survive that, lowercased, in one short scan.
    let lower = '';
    for (let i = 0; i < value.length && lower.length < 20; i++) {
      const c = value.charCodeAt(i);
      if (c !== 9 && c !== 10 && c !== 13) lower += value[i];
    }
    lower = lower.toLowerCase();
    if (!lower.startsWith('data:image/')) return true; // non-image data: → dangerous
    // reject data:image/svg and data:image/svg+xml (script-bearing document format)
    return lower.startsWith('data:image/svg');
  }
  // --- CSS safe-subset for the `style` attribute --------------------------
  /** `sanitizeStyle` is a PURE function of the value string, and real documents
   * repeat style attributes heavily (every `<td style="text-align:right">` in a
   * table, every themed card in a feed). Memoize the result, bounded so a hostile
   * stream of unique/oversized values can't grow it without limit. */
  private static readonly styleMemo = new Map<string, string>();
  private static sanitizeStyle(value: string): string {
    const memo = SanitizerCore.styleMemo;
    const hit = memo.get(value);
    if (hit !== undefined) return hit;
    const result = SanitizerCore.computeSanitizeStyle(value);
    // Don't retain attacker-sized values; cap the table size (FIFO-ish: clear when
    // full — cheap, and the hot working set re-warms immediately).
    if (value.length <= STYLE_MEMO_MAX_LEN) {
      if (memo.size >= STYLE_MEMO_CAP) memo.clear();
      memo.set(value, result);
    }
    return result;
  }
  /** ASCII fast path of {@link computeSanitizeStyleSlow}, byte-identical to it: one
   * charCode pass splits declarations (no array of slices), trims by index, and
   * only allocates the prop/value strings that are emitted. Non-ASCII input takes
   * the slow path, where Unicode `trim`/`\s`/`toLowerCase` rules differ (e.g.
   * U+00A0 is whitespace, U+212A lowercases to "k"). */
  private static computeSanitizeStyle(value: string): string {
    const n = value.length;
    let res = '';
    let depth = 0, quote = 0, start = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n) {
        const c = value.charCodeAt(i);
        if (c >= 0x80) return SanitizerCore.computeSanitizeStyleSlow(value); // not ASCII
        if (quote !== 0) { if (c === quote) quote = 0; continue; }
        if (c === 34 || c === 39) { quote = c; continue; }
        if (c === 40) { depth++; continue; }
        if (c === 41) { if (depth > 0) depth--; continue; }
        if (c !== 59 || depth !== 0) continue; // top-level ';' ends a declaration
      }
      const decl = SanitizerCore.cssDecl(value, start, i);
      if (decl !== '') res = res === '' ? decl : res + '; ' + decl;
      start = i + 1;
    }
    return res;
  }
  /** One ASCII declaration value[a, b) -> `prop: val`, or '' if dropped. */
  private static cssDecl(value: string, a: number, b: number): string {
    const colon = value.indexOf(':', a);
    if (colon === -1 || colon >= b) return '';
    let pa = a, pb = colon, va = colon + 1, vb = b;
    while (pa < pb && isAsciiWs(value.charCodeAt(pa))) pa++;
    while (pb > pa && isAsciiWs(value.charCodeAt(pb - 1))) pb--;
    while (va < vb && isAsciiWs(value.charCodeAt(va))) va++;
    while (vb > va && isAsciiWs(value.charCodeAt(vb - 1))) vb--;
    if (pa === pb || va === vb) return '';
    let prop = value.slice(pa, pb);
    for (let i = pa; i < pb; i++) { const c = value.charCodeAt(i); if (c >= 65 && c <= 90) { prop = prop.toLowerCase(); break; } }
    if (prop === 'behavior' || prop === '-moz-binding' || prop === '-ms-behavior') return '';
    // unsafe value? control chars, or (ignoring spaces/quotes, case-insensitive)
    // expression( / javascript: / vbscript: / url(data: that is not url(data:image/
    let paren = false, colon2 = false;
    for (let i = va; i < vb; i++) {
      const c = value.charCodeAt(i);
      if (c < 0x20) return ''; // control char (inner tab/newline included)
      if (c === 40) paren = true;
      else if (c === 58) colon2 = true;
    }
    const val = value.slice(va, vb);
    if (paren || colon2) {
      // Needles all contain '(' or ':'; without either nothing can match. Here the
      // only whitespace left is ' ' (other ASCII ws is < 0x20, rejected above).
      let v = '';
      for (let i = va; i < vb; i++) {
        const c = value.charCodeAt(i);
        if (c === 32 || c === 34 || c === 39) continue;
        v += String.fromCharCode(c >= 65 && c <= 90 ? c | 0x20 : c);
      }
      if (v.includes('expression(') || v.includes('javascript:') || v.includes('vbscript:')) return '';
      if (v.includes('url(data:') && !v.includes('url(data:image/')) return '';
    }
    return prop + ': ' + val;
  }
  private static computeSanitizeStyleSlow(value: string): string {
    const out: string[] = [];
    for (const decl of SanitizerCore.splitDeclarations(value)) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const val = decl.slice(colon + 1).trim();
      if (!prop || !val) continue;
      if (prop === 'behavior' || prop === '-moz-binding' || prop === '-ms-behavior') continue;
      if (SanitizerCore.unsafeCssValue(val)) continue;
      out.push(prop + ': ' + val);
    }
    return out.join('; ');
  }
  /** Split a declaration list on top-level ';' (not inside parens or strings). */
  private static splitDeclarations(s: string): string[] {
    const decls: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') { if (depth > 0) depth--; }
      else if (c === ';' && depth === 0) { decls.push(s.slice(start, i)); start = i + 1; }
    }
    decls.push(s.slice(start));
    return decls;
  }
  private static unsafeCssValue(val: string): boolean {
    if (RE_CSS_CTRL.test(val)) return true; // control chars (obfuscation)
    const v = val.replace(RE_WS_G, '').toLowerCase().replace(RE_QUOTES_G, '');
    if (v.includes('expression(') || v.includes('javascript:') || v.includes('vbscript:')) return true;
    if (v.includes('url(data:') && !v.includes('url(data:image/')) return true;
    return false;
  }
  /** Escape hatch: skip the inviolable baseline (mirrors `setHTMLUnsafe`). */
  sanitizeUnsafe(html: string): string {
    // Re-parse with the SAME concrete entry (this.constructor) and the same parser,
    // matchers, and hook, baseline off, so behaviour is otherwise identical.
    const Ctor = this.constructor as new (policy?: Policy, opts?: SanitizerOptions) => SanitizerCore;
    return new Ctor({ ...this.policy, allowUnsafe: true }, { parser: this.parserOverride, matchers: this.matchers, attrHook: this.attrHook }).sanitize(html);
  }

  /**
   * Return a new `Sanitizer` derived from this one with extra config, without
   * re-declaring the base policy. The callback receives a builder pre-seeded with
   * this instance's tags, attributes, matchers, hook, and parser. Immutable, like
   * `Array.prototype.toSorted`: this sanitizer is never changed, so a shared base
   * can be derived from per call site without affecting other importers.
   *
   *   const base = Sanitizer.builder(ugc).build();
   *   const withCustom = base.toExtended((b) => b.allow(/^(ui|wc)-/, '*'));
   */
  toExtended(configure: (builder: SanitizerBuilder<this>) => unknown): this {
    const ctor = this.constructor as new (policy?: Policy, opts?: SanitizerOptions) => this;
    const b = new SanitizerBuilder<this>(ctor, {
      tags: this.policy.tags,
      attrs: this.policy.attrs,
      allowUnsafe: this.policy.allowUnsafe,
      parser: this.parserOverride,
      matchers: this.matchers,
      attrHook: this.attrHook,
    });
    configure(b);
    return b.build();
  }

  /**
   * The one entry point. `Sanitizer.builder()` yields a builder; chain `.allow()`
   * etc. and call `.build()`. Pass a preset to seed it: `Sanitizer.builder(ugc)`.
   * Polymorphic over the concrete subclass, so `.build()` returns that same
   * `Sanitizer` (the correct environment parser stays wired).
   */
  static builder<T extends SanitizerCore>(this: new (policy?: Policy, opts?: SanitizerOptions) => T, preset?: Preset): SanitizerBuilder<T> {
    const b = new SanitizerBuilder<T>(this);
    if (preset) b.preset(preset);
    return b;
  }
}

/** Internal seed for `SanitizerBuilder`, used by `SanitizerCore.extend`. */
interface BuilderSeed {
  readonly tags: Iterable<string>;
  readonly attrs: ReadonlyMap<string, ReadonlySet<string>>;
  readonly allowUnsafe: boolean;
  readonly parser: ParseAdapter | null;
  readonly matchers: readonly CompiledMatcher[];
  readonly attrHook: AttributeTransform | null;
}

// ---------------------------------------------------------------------------
// Builder, accumulate config cheaply; compile ONCE at build(). Generic over the
// concrete Sanitizer so `build()` returns the right (parser-wired) class.
// ---------------------------------------------------------------------------
export class SanitizerBuilder<T extends SanitizerCore = SanitizerCore> {
  private _tags = new Set<string>();
  private _attrs = new Map<string, Set<string>>();
  private _allowUnsafe = false;
  private _parser: ParseAdapter | null = null;
  private _matchers: CompiledMatcher[] = [];
  private _attrHook: AttributeTransform | null = null;

  /** @param ctor the concrete `Sanitizer` subclass to instantiate at `build()`.
   *  @param seed pre-existing config to copy in (used by `SanitizerCore.extend`). */
  constructor(private readonly ctor: new (policy?: Policy, opts?: SanitizerOptions) => T, seed?: BuilderSeed) {
    if (seed) {
      for (const t of seed.tags) this._tags.add(t);
      for (const [tag, set] of seed.attrs) this._attrs.set(tag, new Set(set));
      this._allowUnsafe = seed.allowUnsafe;
      this._parser = seed.parser;
      this._matchers = [...seed.matchers];
      this._attrHook = seed.attrHook;
    }
  }

  /**
   * Override the parser. Pass an adapter (e.g. `parse5Adapter` from
   * `neosanitize/parse5`, or your own `(html) => ParentNode`) to parse with it
   * instead of the environment default. Pass `null` to restore the default.
   */
  parser(adapter: ParseAdapter | null): this {
    this._parser = adapter;
    return this;
  }

  /**
   * Allow tags. `tag` is an exact name, an array of names (bulk, no attributes), or
   * a `RegExp` / predicate to match by pattern (custom-element conventions like
   * `ui-*` whose full set isn't known up front). `attrs` is a list of attribute
   * names, or `'*'` for any attribute. `allow('*', [...])` sets attributes allowed
   * on every tag. Allowed and pattern-matched tags still pass through the inviolable
   * baseline (their `on*` handlers and dangerous URLs are stripped); pattern matches
   * are memoized so repeated tags stay fast.
   *
   *   b.allow('a', ['href', 'title'])
   *   b.allow(['p', 'b', 'i'])
   *   b.allow(/^(ui|wc)-/, '*')
   */
  allow(tag: string | string[] | TagMatcher, attrs?: '*' | Iterable<string>): this {
    if (typeof tag === 'string') {
      this.addTag(tag, attrs);
    } else if (Array.isArray(tag)) {
      for (const t of tag) this.addTag(t, attrs);
    } else {
      // a global regex has stateful lastIndex across .test() calls; use a fresh non-global copy.
      const fn = tag instanceof RegExp
        ? ((re) => (t: string) => re.test(t))(tag.global ? new RegExp(tag.source, tag.flags.replace('g', '')) : tag)
        : tag;
      this._matchers.push({ test: fn, attrs: attrs == null ? null : new Set(attrs === '*' ? ['*'] : attrs) });
    }
    return this;
  }

  /** Remove tag(s) from the static allow-list (does not touch pattern matchers). */
  deny(tag: string | string[]): this {
    for (const t of typeof tag === 'string' ? [tag] : tag) {
      this._tags.delete(t);
      this._attrs.delete(t);
    }
    return this;
  }

  /** Apply a preset: a `(builder) => void` function. Presets compose. */
  preset(p: Preset): this {
    p(this);
    return this;
  }

  /**
   * Register a per-attribute transform, run on every allow-listed attribute. Return
   * a replacement value, `null` to drop the attribute, or `undefined` to leave it.
   * The result is re-checked by the inviolable baseline, so a hook can rewrite or
   * drop but never reintroduce an `on*` handler or dangerous-scheme URL. Multiple
   * calls compose in order (a `null` from any short-circuits to a drop).
   *
   * Note: stripping `on*` handlers needs no hook, the baseline already does that.
   */
  transformAttribute(hook: AttributeTransform): this {
    const prev = this._attrHook;
    this._attrHook = prev === null ? hook : (attr) => {
      const r = prev(attr);
      if (r === null) return null;
      return hook(r === undefined ? attr : { tag: attr.tag, name: attr.name, value: r });
    };
    return this;
  }

  /** Skip the inviolable baseline for sanitizers built here. Dangerous: an allow-list
   * can then surface `on*` handlers / `javascript:` URLs. Off by default. */
  allowUnsafe(on = true): this {
    this._allowUnsafe = on;
    return this;
  }

  /** Compile the accumulated config into a reusable `Sanitizer` (once). */
  build(): T {
    return new this.ctor({
      tags: new Set(this._tags),
      attrs: new Map([...this._attrs].map(([t, s]) => [t, new Set(s)])),
      allowUnsafe: this._allowUnsafe
    }, { parser: this._parser, matchers: [...this._matchers], attrHook: this._attrHook });
  }

  /** Add one exact tag with optional attributes (`'*'` tag = global attrs only). */
  private addTag(tag: string, attrs?: '*' | Iterable<string>): void {
    if (tag !== '*') this._tags.add(tag);
    if (attrs == null) return;
    const into = this._attrs.get(tag) ?? new Set<string>();
    for (const a of attrs === '*' ? ['*'] : attrs) into.add(a);
    this._attrs.set(tag, into);
  }
}
