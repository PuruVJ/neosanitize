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
import type { ElementNode, ParentNode } from './parser/tree-builder';

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
/** Raw-text elements, their text children serialize unescaped. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
/** Attributes interpreted as URLs (for the baseline scheme check). `xlink href`
 * is the space-stored form of the foreign `xlink:href`. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background', 'cite', 'longdesc', 'poster', 'data', 'srcdoc', 'manifest', 'xlink href']);

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

/** A partial policy or a named preset, accepted anywhere a policy is. */
export type PolicyInput = Partial<MutablePolicy> | Preset;

/**
 * Brand symbol identifying a value as a built {@link Preset}. Exported so preset
 * modules (e.g. `neosanitize/presets/*`) and advanced users authoring their own
 * presets can stamp it, the `UNSAFE_` name signals that hand-stamping bypasses
 * normal `Sanitizer` construction and is the caller's responsibility.
 */
export const UNSAFE_PRESET_SYMBOL: unique symbol = Symbol('neosanitize.preset');

export interface Preset {
  readonly [UNSAFE_PRESET_SYMBOL]: true;
  readonly name: string;
  readonly policy: Policy;
}

interface MutablePolicy {
  tags: Iterable<string>;
  attrs: Record<string, Iterable<string>>;
  allowUnsafe: boolean;
}

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
  /** Resolved allow-listed attributes (tag-specific ∪ `*`); null = none allowed. */
  readonly attrSet: ReadonlySet<string> | null;
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

/** Minimal push target the serializer writes fragments to, satisfied by both a
 * plain `string[]` (collect-then-join) and {@link ChunkWriter} (stream). */
interface StringSink {
  push(s: string): void;
}

/** Streaming sink for `sanitizeTo`: batches serializer fragments and flushes them
 * to the user's sink in ~chunkSize-character writes. */
class ChunkWriter implements StringSink {
  private parts: string[] = [];
  private pending = 0;
  constructor(private readonly sink: (chunk: string) => void, private readonly chunkSize: number) {}
  push(s: string): void {
    this.parts.push(s);
    this.pending += s.length;
    if (this.pending >= this.chunkSize) this.flush();
  }
  flush(): void {
    if (this.parts.length !== 0) {
      this.sink(this.parts.join(''));
      this.parts = [];
      this.pending = 0;
    }
  }
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
const RE_TEXT_NEEDS = /[&<>\u00a0]/;
const RE_ATTR_NEEDS = /[&"\u00a0]/;
const RE_AMP_G = /&/g;
const RE_LT_G = /</g;
const RE_GT_G = />/g;
const RE_QUOT_G = /"/g;
const RE_NBSP_G = /\u00a0/g;

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
  private readonly tagCache: Map<string, TagSer>;

  constructor(policy: Policy = EMPTY_POLICY, defaultParse: ParseAdapter = THROW_NO_PARSER, parserOverride: ParseAdapter | null = null) {
    // The constructor is where the expensive compilation happens once: resolving
    // the policy into the fast structures `.sanitize()` reuses.
    this.policy = policy;
    this.defaultParse = defaultParse;
    this.parserOverride = parserOverride;
    const cache = new Map<string, TagSer>();
    const star = policy.attrs.get('*');
    for (const tag of policy.tags) {
      // baseline-dropped tags (e.g. <script>) are NOT cached as keep → slow path.
      if (!policy.allowUnsafe && BASELINE_DROP.has(tag)) continue;
      const own = policy.attrs.get(tag);
      let attrSet: ReadonlySet<string> | null;
      if (own && star) { const m = new Set(own); for (const a of star) m.add(a); attrSet = m; }
      else attrSet = own ?? star ?? null;
      cache.set(tag, {
        open: '<' + tag,
        close: '</' + tag + '>',
        isVoid: VOID_ELEMENTS.has(tag),
        rawText: RAW_TEXT_ELEMENTS.has(tag),
        attrSet,
      });
    }
    this.tagCache = cache;
  }

  /**
   * Parse untrusted HTML into the common `{type,name,attrs,children}` tree, via
   * the active adapter: an explicit `.parser()` override if set, else the
   * environment default. This is the ONLY pluggable seam, the policy engine and
   * serializer downstream are identical for every parser.
   */
  protected parse(html: string): ParentNode {
    return (this.parserOverride ?? this.defaultParse)(html);
  }

  /** Sanitize to a string. Always applies the inviolable safe baseline. */
  sanitize(html: string): string {
    const out: string[] = [];
    this.emitChildren(this.parse(html), out, false, null);
    return out.join('');
  }

  /** Sanitize and report what was removed and why (debug / audit / telemetry). */
  sanitizeWithReport(html: string): SanitizeReport {
    const out: string[] = [];
    const removed: Removal[] = [];
    this.emitChildren(this.parse(html), out, false, removed);
    return { html: out.join(''), removed };
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
    const writer = new ChunkWriter(write, opts?.chunkSize ?? 16384);
    this.emitChildren(this.parse(html), writer, false, null);
    writer.flush();
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

  // --- DOM + text builders (share elementAction/filterAttrs above) -----------
  private buildDom(parent: ParentNode, domParent: Node): void {
    for (const child of parent.children) {
      if (child.type === 'text') {
        domParent.appendChild(document.createTextNode(child.value));
      } else if (child.type === 'element') {
        const action = this.elementAction(child);
        if (action === 'drop') continue;
        if (action === 'unwrap') { this.buildDom(child, domParent); continue; }
        const el = document.createElement(child.name);
        for (const [name, v] of this.filterAttrs(child, null)) {
          try { el.setAttribute(SanitizerCore.serializeAttrName(name), v); } catch { /* invalid attr name */ }
        }
        domParent.appendChild(el);
        if (!VOID_ELEMENTS.has(child.name)) this.buildDom(child, el);
      }
    }
  }
  private static collectText(parent: ParentNode, out: string[]): void {
    for (const child of parent.children) {
      if (child.type === 'text') out.push(child.value);
      else if (child.type === 'element' && !RAW_TEXT_ELEMENTS.has(child.name)) {
        SanitizerCore.collectText(child, out);
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
  /** Filtered, sanitized attributes for a kept element; records drops if `removed`.
   * Lazily allocates: when nothing is dropped or rewritten (the common case) it
   * returns `el.attrs` itself, so attribute-clean elements cost zero allocations. */
  private filterAttrs(el: ElementNode, removed: Removal[] | null, allowed?: ReadonlySet<string> | null): Array<[string, string]> {
    const baseline = !this.policy.allowUnsafe;
    const src = el.attrs;
    // `allowed` precomputed by the string serializer (set, or null = none);
    // `undefined` means the caller (buildDom) didn't, so fall back to attrAllowed.
    const useSet = allowed !== undefined;
    let kept: Array<[string, string]> | null = null;
    for (let i = 0; i < src.length; i++) {
      const pair = src[i];
      const name = pair[0], value = pair[1];
      let drop = false;
      let v = value;
      if (useSet ? !(allowed !== null && allowed.has(name)) : !this.attrAllowed(el.name, name)) { removed?.push({ kind: 'attr', name, reason: 'not-allowed' }); drop = true; }
      else if (baseline && SanitizerCore.attrUnsafe(name, value)) {
        const ev = name[0] === 'o' && name[1] === 'n';
        removed?.push({ kind: ev ? 'attr' : 'url', name, reason: ev ? 'event-handler' : 'dangerous-url' });
        drop = true;
      } else if (baseline && name === 'style') {
        v = SanitizerCore.sanitizeStyle(value);
        if (v === '') { removed?.push({ kind: 'style', name, reason: 'unsafe-css' }); drop = true; }
        else if (v !== value) removed?.push({ kind: 'style', name, reason: 'unsafe-css-declaration' });
      }
      if (drop || v !== value) {
        if (kept === null) kept = src.slice(0, i); // first divergence → copy the kept prefix
        if (!drop) kept.push(v === value ? pair : [name, v]);
      } else if (kept !== null) {
        kept.push(pair);
      }
    }
    return kept ?? src;
  }

  // --- string serializer ----------------------------------------------------
  private emitChildren(parent: ParentNode, out: StringSink, rawText: boolean, removed: Removal[] | null): void {
    // Index loop, not for-of: this runs once per parent element on the serialize
    // hot path, and a for-of iterator object per call shows up under the profiler.
    const children = parent.children;
    for (let k = 0; k < children.length; k++) {
      const child = children[k];
      if (child.type === 'text') out.push(rawText ? child.value : SanitizerCore.escapeText(child.value));
      else if (child.type === 'element') this.emitElement(child, out, removed);
      // comments and doctype are dropped (output is a clean fragment)
    }
  }
  private emitElement(el: ElementNode, out: StringSink, removed: Removal[] | null): void {
    const info = this.tagCache.get(el.name);
    if (info === undefined) {
      // Slow path: not an allow-listed keep tag → drop (with content) or unwrap.
      const action = this.elementAction(el);
      if (action === 'drop') { removed?.push({ kind: 'tag', name: el.name, reason: 'unsafe-element' }); return; }
      // html/head/body are implicit document structure, not user-content removals
      if (removed && el.name !== 'html' && el.name !== 'head' && el.name !== 'body') {
        removed.push({ kind: 'tag', name: el.name, reason: 'not-allowed' });
      }
      this.emitChildren(el, out, false, removed);
      return;
    }
    out.push(info.open);
    if (el.attrs.length !== 0) {
      const attrs = this.filterAttrs(el, removed, info.attrSet);
      for (let k = 0; k < attrs.length; k++) {
        const a = attrs[k];
        out.push(' ' + SanitizerCore.serializeAttrName(a[0]) + '="' + SanitizerCore.escapeAttr(a[1]) + '"');
      }
    }
    out.push('>');
    if (info.isVoid) return;
    this.emitChildren(el, out, info.rawText, removed);
    out.push(info.close);
  }

  private attrAllowed(tag: string, attr: string): boolean {
    const t = this.policy.attrs.get(tag);
    if (t && t.has(attr)) return true;
    const star = this.policy.attrs.get('*');
    return star !== undefined && star.has(attr);
  }

  private static attrUnsafe(name: string, value: string): boolean {
    if (name.length >= 2 && name[0] === 'o' && name[1] === 'n') return true; // on* event handlers
    if (URL_ATTRS.has(name) && SanitizerCore.dangerousUrl(value)) return true;
    return false;
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
      const scheme = value.slice(0, colon).toLowerCase();
      if (scheme === 'javascript' || scheme === 'vbscript') return true;
      if (scheme === 'data') return value.slice(0, 11).toLowerCase() !== 'data:image/';
      return false; // http/https/mailto/tel/ftp/blob/... are fine
    }

    // SLOW PATH (obfuscated / weird scheme): the native URL parser matches how the
    // browser resolves the attribute (it strips tab/newline + leading/trailing C0
    // controls), so it sees the real scheme even through a tab inside "javascript:".
    let scheme: string | null = null;
    try {
      scheme = new URL(value).protocol.slice(0, -1).toLowerCase();
    } catch {
      scheme = null;
    }
    if (scheme !== null) {
      if (scheme === 'javascript' || scheme === 'vbscript') return true;
      if (scheme === 'data') return !value.trim().toLowerCase().startsWith('data:image/');
      return false; // http/https/mailto/tel/ftp/... are fine
    }
    // `new URL()` rejected the value outright → it is not a parseable absolute URL,
    // so a browser won't execute it as a dangerous scheme either. Treat as safe.
    // (Every real javascript:/vbscript:/data: obfuscation parses, so it was already
    // resolved above; nothing dangerous reaches here.)
    return false;
  }
  // --- CSS safe-subset for the `style` attribute --------------------------
  private static sanitizeStyle(value: string): string {
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
  private static serializeAttrName(name: string): string {
    // foreign namespaced attrs are stored as "xlink href" (space) → "xlink:href"
    return name.indexOf(' ') === -1 ? name : name.replace(' ', ':');
  }
  private static escapeText(s: string): string {
    if (!RE_TEXT_NEEDS.test(s)) return s;
    return s.replace(RE_AMP_G, '&amp;').replace(RE_LT_G, '&lt;').replace(RE_GT_G, '&gt;').replace(RE_NBSP_G, '&nbsp;');
  }
  private static escapeAttr(s: string): string {
    if (!RE_ATTR_NEEDS.test(s)) return s;
    return s.replace(RE_AMP_G, '&amp;').replace(RE_QUOT_G, '&quot;').replace(RE_NBSP_G, '&nbsp;');
  }

  /** Escape hatch: skip the inviolable baseline (mirrors `setHTMLUnsafe`). */
  sanitizeUnsafe(html: string): string {
    // Re-parse with the SAME concrete entry (this.constructor) AND the same parser
    // override, baseline off, so the active adapter is preserved.
    const Ctor = this.constructor as new (policy?: Policy, parser?: ParseAdapter | null) => SanitizerCore;
    return new Ctor({ ...this.policy, allowUnsafe: true }, this.parserOverride).sanitize(html);
  }

  /**
   * Class-based factory, the entry point: `Sanitizer.builder().preset(…).build()`.
   * Polymorphic over the concrete subclass: `Sanitizer.builder()` yields a builder
   * whose `.build()` returns that same `Sanitizer` (so the correct parser is wired).
   */
  static builder<T extends SanitizerCore>(this: new (policy?: Policy, parser?: ParseAdapter | null) => T, base?: PolicyInput): SanitizerBuilder<T> {
    const b = new SanitizerBuilder<T>(this);
    return base ? b.preset(base) : b;
  }
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

  /** @param ctor the concrete `Sanitizer` subclass to instantiate at `build()`. */
  constructor(private readonly ctor: new (policy?: Policy, parser?: ParseAdapter | null) => T) {}

  /**
   * Override the parser. Pass an adapter (e.g. `parse5Adapter` from
   * `neosanitize/parse5`, or your own `(html) => ParentNode`) to parse with it
   * instead of the environment default. Pass `null` to restore the default.
   */
  parser(adapter: ParseAdapter | null): this {
    this._parser = adapter;
    return this;
  }

  /** Start from a preset (or another policy), then refine. */
  preset(p: PolicyInput): this {
    const pol = SanitizerBuilder.resolve(p);
    for (const t of pol.tags) this._tags.add(t);
    for (const [tag, set] of pol.attrs) {
      const into = this._attrs.get(tag) ?? new Set<string>();
      for (const a of set) into.add(a);
      this._attrs.set(tag, into);
    }
    return this;
  }

  /** Allow a tag (optionally with attributes). */
  allow(tag: string, attrs?: Iterable<string>): this {
    this._tags.add(tag);
    if (attrs) {
      const into = this._attrs.get(tag) ?? new Set<string>();
      for (const a of attrs) into.add(a);
      this._attrs.set(tag, into);
    }
    return this;
  }

  /** Remove a tag from the allow-list. */
  deny(tag: string): this {
    this._tags.delete(tag);
    this._attrs.delete(tag);
    return this;
  }

  /** Compile the accumulated config into a reusable `Sanitizer` (once). */
  build(): T {
    return new this.ctor({
      tags: new Set(this._tags),
      attrs: new Map([...this._attrs].map(([t, s]) => [t, new Set(s)])),
      allowUnsafe: this._allowUnsafe
    }, this._parser);
  }

  /** Resolve a preset or partial-policy input into an immutable `Policy`. */
  private static resolve(p: PolicyInput): Policy {
    if ((p as Preset)[UNSAFE_PRESET_SYMBOL] === true) return (p as Preset).policy;
    const m = p as Partial<MutablePolicy>;
    return {
      tags: new Set(m.tags ?? []),
      attrs: new Map(Object.entries(m.attrs ?? {}).map(([t, s]) => [t, new Set(s)])),
      allowUnsafe: m.allowUnsafe ?? false
    };
  }
}
