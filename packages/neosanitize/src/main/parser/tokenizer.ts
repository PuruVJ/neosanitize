/**
 * WHATWG HTML tokenizer (single pass) — `.` main engine.
 *
 * Implements the tokenization stage of https://html.spec.whatwg.org/#tokenization
 * Verified against the vendored html5lib-tests tokenizer suite
 * (test/main/tokenizer.test.ts). Tree construction (the other half of a
 * browser-faithful parser) drives the content-model state from outside via
 * `setState()` — exactly as the spec's tree-construction stage does.
 *
 * Parse errors are intentionally not surfaced as tokens: a sanitizer cares about
 * the token *stream* the browser would build, not error reporting. Character
 * tokens are emitted per run; the conformance harness coalesces before comparing.
 *
 * NOT YET IMPLEMENTED (rare; tracked by the harness ratchet): script-data
 * escaped / double-escaped states. Everything else (incl. RCDATA/RAWTEXT/
 * PLAINTEXT/CDATA, full comment + DOCTYPE machinery, named/numeric character
 * references) is here.
 */
import { NAMED_REFS, MAX_NAMED_REF_LEN } from './entities';

export interface Doctype {
  type: 'doctype';
  name: string | null;
  publicId: string | null;
  systemId: string | null;
  forceQuirks: boolean;
}
export interface TagToken {
  type: 'startTag' | 'endTag';
  name: string;
  attrs: Array<[string, string]>;
  selfClosing: boolean;
}
export interface CommentToken {
  type: 'comment';
  data: string;
}
export interface CharacterToken {
  type: 'character';
  data: string;
}
export interface EofToken {
  type: 'eof';
}
export type Token = Doctype | TagToken | CommentToken | CharacterToken | EofToken;

/** Content-model states the tree builder can switch the tokenizer into. */
export type ContentState = 'data' | 'rcdata' | 'rawtext' | 'scriptData' | 'plaintext' | 'cdata';

// Internal state ids ---------------------------------------------------------
const S = {
  Data: 0, RCDATA: 1, RAWTEXT: 2, ScriptData: 3, PLAINTEXT: 4,
  TagOpen: 5, EndTagOpen: 6, TagName: 7,
  RCDATALt: 8, RCDATAEndTagOpen: 9, RCDATAEndTagName: 10,
  RAWTEXTLt: 11, RAWTEXTEndTagOpen: 12, RAWTEXTEndTagName: 13,
  ScriptLt: 14, ScriptEndTagOpen: 15, ScriptEndTagName: 16,
  BeforeAttrName: 17, AttrName: 18, AfterAttrName: 19, BeforeAttrValue: 20,
  AttrValueDq: 21, AttrValueSq: 22, AttrValueUq: 23, AfterAttrValueQuoted: 24,
  SelfClosing: 25, BogusComment: 26, MarkupDeclOpen: 27,
  CommentStart: 28, CommentStartDash: 29, Comment: 30,
  CommentEndDash: 31, CommentEnd: 32, CommentEndBang: 33,
  Doctype: 34, BeforeDoctypeName: 35, DoctypeName: 36, AfterDoctypeName: 37,
  AfterDoctypePublicKw: 38, BeforeDoctypePublicId: 39, DoctypePublicIdDq: 40,
  DoctypePublicIdSq: 41, AfterDoctypePublicId: 42, BetweenDoctypePublicSystem: 43,
  AfterDoctypeSystemKw: 44, BeforeDoctypeSystemId: 45, DoctypeSystemIdDq: 46,
  DoctypeSystemIdSq: 47, AfterDoctypeSystemId: 48, BogusDoctype: 49,
  CdataSection: 50, CdataSectionBracket: 51, CdataSectionEnd: 52,
  CharRef: 53, NamedCharRef: 54, AmbiguousAmp: 55, NumericCharRef: 56,
  HexStart: 57, DecStart: 58, HexRef: 59, DecRef: 60, NumericEnd: 61,
  ScriptEscapeStart: 62, ScriptEscapeStartDash: 63, ScriptEscaped: 64,
  ScriptEscapedDash: 65, ScriptEscapedDashDash: 66, ScriptEscapedLt: 67,
  ScriptEscapedEndTagOpen: 68, ScriptEscapedEndTagName: 69, ScriptDoubleEscapeStart: 70,
  ScriptDoubleEscaped: 71, ScriptDoubleEscapedDash: 72, ScriptDoubleEscapedDashDash: 73,
  ScriptDoubleEscapedLt: 74, ScriptDoubleEscapeEnd: 75
} as const;

const REPLACEMENT = '�';
const C1: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

// CR counts as whitespace: raw CRs can reach the tag-level states (see the
// constructor), where CR/CRLF would have become an LF, which is whitespace.
const isWs = (c: number) => c === 0x09 || c === 0x0a || c === 0x0c || c === 0x20 || c === 0x0d;
const isAsciiAlpha = (c: number) =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isAsciiAlnum = (c: number) =>
  isAsciiAlpha(c) || (c >= 0x30 && c <= 0x39);
const isHexDigit = (c: number) =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const toLowerCh = (c: number) => (c >= 0x41 && c <= 0x5a ? c + 0x20 : c);
// ASCII-lowercase a tag/attr-name run that the scanner already KNOWS contains an
// uppercase letter (the scan tracks it, so we skip a redundant detection pass).
// Spec lowercasing is ASCII-only — must NOT use String.prototype.toLowerCase.
const ASCII_UPPER_G = /[A-Z]/g;
// All-ASCII runs (the norm) take native toLowerCase, which is exact on ASCII; only
// a run containing a non-ASCII code unit (where toLowerCase would also fold e.g.
// U+0130/U+212A) takes the ASCII-only regex path.
const foldAsciiUpper = (s: string): string => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return s.replace(ASCII_UPPER_G, (m) => String.fromCharCode(m.charCodeAt(0) | 0x20));
  }
  return s.toLowerCase();
};

// Known tag / attribute names, interned WITHOUT allocating. The TagName/AttrName
// scan loops hash the ASCII-lowercased run as they go; a hit is verified against the
// input and yields the canonical constant string: no slice, no case-fold copy, and
// (being internalized) its hash is precomputed and `===` against literals is a
// pointer compare downstream (tree-builder Set lookups / name compares, core policy
// maps). Unknown names fall back to slice(+fold). Identity-only change: the string
// CONTENT is exactly what slice(+fold) would have produced.
// String LITERALS (not a split() list) so the canonical names are internalized:
// `===` against other literals is then a pointer compare and their hash is cached.
const INTERN_NAMES: readonly string[] = [
    'a', 'abbr', 'accept', 'action', 'address', 'align', 'allow', 'allowfullscreen', 'alt',
    'annotation-xml', 'area', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-expanded',
    'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-live', 'article', 'aside', 'audio',
    'autocomplete', 'autofocus', 'autoplay', 'b', 'base', 'bdi', 'bdo', 'bgcolor', 'big',
    'blockquote', 'body', 'border', 'br', 'button', 'canvas', 'caption', 'cellpadding',
    'cellspacing', 'center', 'charset', 'checked', 'circle', 'cite', 'class', 'clippath', 'code',
    'col', 'colgroup', 'color', 'cols', 'colspan', 'content', 'contenteditable', 'controls',
    'coords', 'crossorigin', 'cx', 'cy', 'd', 'data', 'datalist', 'datetime', 'dd', 'decoding',
    'definitionurl', 'defs', 'del', 'desc', 'details', 'dfn', 'dialog', 'dir', 'disabled', 'div',
    'dl', 'download', 'draggable', 'dt', 'ellipse', 'em', 'embed', 'encoding', 'enctype', 'face',
    'fieldset', 'figcaption', 'figure', 'fill', 'filter', 'font', 'footer', 'for', 'foreignobject',
    'form', 'frame', 'frameborder', 'frameset', 'g', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
    'header', 'headers', 'height', 'hgroup', 'hidden', 'hr', 'href', 'hreflang', 'html',
    'http-equiv', 'i', 'id', 'iframe', 'image', 'img', 'input', 'ins', 'integrity', 'is', 'ismap',
    'kbd', 'label', 'lang', 'legend', 'li', 'line', 'lineargradient', 'link', 'listing', 'loading',
    'loop', 'main', 'malignmark', 'map', 'mark', 'marquee', 'mask', 'math', 'max', 'maxlength',
    'media', 'menu', 'meta', 'meter', 'method', 'mglyph', 'mi', 'min', 'minlength', 'mn', 'mo',
    'ms', 'mtext', 'multiple', 'muted', 'name', 'nav', 'nobr', 'noembed', 'noframes', 'nonce',
    'noscript', 'object', 'ol', 'onclick', 'onerror', 'onfocus', 'onload', 'onmouseover', 'open',
    'optgroup', 'option', 'output', 'p', 'param', 'part', 'path', 'pattern', 'picture', 'ping',
    'placeholder', 'plaintext', 'points', 'polygon', 'polyline', 'poster', 'pre', 'preload',
    'progress', 'q', 'r', 'radialgradient', 'rb', 'readonly', 'rect', 'referrerpolicy', 'rel',
    'required', 'reversed', 'role', 'rows', 'rowspan', 'rp', 'rt', 'rtc', 'ruby', 'rx', 'ry', 's',
    'samp', 'sandbox', 'scope', 'script', 'search', 'section', 'select', 'selected', 'shape',
    'size', 'sizes', 'slot', 'small', 'source', 'span', 'spellcheck', 'src', 'srcset', 'start',
    'step', 'stop', 'strike', 'stroke', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'symbol',
    'tabindex', 'table', 'target', 'tbody', 'td', 'template', 'text', 'textarea', 'tfoot', 'th',
    'thead', 'time', 'title', 'tr', 'track', 'transform', 'translate', 'tspan', 'tt', 'type', 'u',
    'ul', 'use', 'usemap', 'valign', 'value', 'var', 'video', 'viewbox', 'wbr', 'width', 'wrap',
    'x', 'x1', 'x2', 'xmlns', 'xmp', 'y', 'y1', 'y2',
];
const INTERN_MASK = 1023;
const FNV = 0x01000193;
const INTERN_TABLE: string[] = /*#__PURE__*/ (() => {
  const t: string[] = new Array(INTERN_MASK + 1).fill('');
  for (const name of INTERN_NAMES) {
    let h = 0x811c9dc5 | 0;
    for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), FNV);
    let slot = h & INTERN_MASK;
    while (t[slot] !== '') slot = (slot + 1) & INTERN_MASK;
    t[slot] = name;
  }
  return t;
})();
/** Canonical interned name for input[start, start+n) (ASCII-case-folded when `up`),
 * or undefined if it is not a known name. `h` = FNV-1a over the folded code units. */
function internRun(input: string, start: number, n: number, h: number, up: boolean): string | undefined {
  let slot = h & INTERN_MASK;
  for (;;) {
    const cand = INTERN_TABLE[slot];
    if (cand.length === 0) return undefined;
    if (cand.length === n) {
      // Manual compare (String.prototype.startsWith is a generic builtin call and
      // was ~13% of attribute-dense tokenizing).
      let k = 0;
      if (!up) { for (; k < n; k++) if (input.charCodeAt(start + k) !== cand.charCodeAt(k)) break; }
      else for (; k < n; k++) { let cc = input.charCodeAt(start + k); if (cc >= 0x41 && cc <= 0x5a) cc |= 0x20; if (cc !== cand.charCodeAt(k)) break; }
      if (k === n) return cand;
    }
    slot = (slot + 1) & INTERN_MASK;
  }
}

// Semicolon-terminated named references (`&name;`, the overwhelmingly common
// form) in an open-addressing table keyed by FNV-1a of the name incl. ';'. When the
// alnum run after '&' is followed by ';' and run+';' is a key, that key IS the
// longest match the trie walk would find (the walk stops at ';'), so it resolves
// with ONE hash probe + a charCode verify: no per-char Map.get, no allocation.
// Anything else (no ';', unknown name, legacy no-';' forms) takes the trie below.
const REF_MASK = 8191;
const [REF_KEYS, REF_VALS]: [string[], string[]] = /*#__PURE__*/ (() => {
  const keys: string[] = new Array(REF_MASK + 1).fill('');
  const vals: string[] = new Array(REF_MASK + 1).fill('');
  for (const [name, value] of NAMED_REFS) {
    if (name.charCodeAt(name.length - 1) !== 0x3b) continue;
    let h = 0x811c9dc5 | 0;
    for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), FNV);
    let slot = h & REF_MASK;
    while (keys[slot] !== '') slot = (slot + 1) & REF_MASK;
    keys[slot] = name; vals[slot] = value;
  }
  return [keys, vals];
})();

// Named-character-reference TRIE (built once from the table). Walking it by code
// unit avoids the old greedy approach's growing-string rebuild + re-hash on every
// character — the big win on entity-heavy input. (Built at load; ~13k inserts.)
interface EntityNode { v?: string; next: Map<number, EntityNode>; }
const ENTITY_TRIE: EntityNode = /*#__PURE__*/ (() => {
  const root: EntityNode = { next: new Map() };
  for (const [name, value] of NAMED_REFS) {
    let node = root;
    for (let i = 0; i < name.length; i++) {
      const cc = name.charCodeAt(i);
      let child = node.next.get(cc);
      if (child === undefined) { child = { next: new Map() }; node.next.set(cc, child); }
      node = child;
    }
    node.v = value;
  }
  return root;
})();

const NO_ATTRS = Object.freeze([]) as unknown as Array<[string, string]>;

const STATE_FROM_CONTENT: Record<ContentState, number> = {
  data: S.Data, rcdata: S.RCDATA, rawtext: S.RAWTEXT,
  scriptData: S.ScriptData, plaintext: S.PLAINTEXT, cdata: S.CdataSection
};

export interface TokenizeOptions {
  state?: ContentState;
  /** Appropriate end-tag name, for RCDATA/RAWTEXT/script end-tag matching. */
  lastStartTag?: string;
}

/** Attribute count past which duplicate detection switches from a scan to a Set. */
const ATTR_SET_MIN = 16;

/** WHATWG input-stream preprocessing for one run: CR and CRLF become LF. Jumps
 * between CRs with native `indexOf` (runs are short and numerous in a CRLF
 * document, where a regex replace per run costs more than the work). */
function normalizeCR(s: string): string {
  let i = s.indexOf('\r');
  if (i === -1) return s;
  let out = '', last = 0;
  do {
    out += s.slice(last, i) + '\n';
    last = s.charCodeAt(i + 1) === 0x0a ? i + 2 : i + 1;
    i = s.indexOf('\r', last);
  } while (i !== -1);
  return out + s.slice(last);
}
/** States that append raw input chars one at a time (not as a normalized bulk run)
 * and don't treat CR as whitespace: DOCTYPE public/system ids, CDATA, and the
 * script-data escaped / double-escaped family. A CR there triggers normalizeRest. */
const CR_COPY_STATES = new Uint8Array(76);
for (const st of [40, 41, 46, 47, 50, 64, 65, 66, 70, 71, 72, 73, 75]) CR_COPY_STATES[st] = 1;

export class Tokenizer {
  private input: string;
  private len: number;
  /** Input still holds raw CRs (see the constructor). Cleared by `normalizeRest`. */
  private hasCR: boolean;
  private i = 0;
  private state: number;
  private returnState: number = S.Data;
  // Emit queue. A single `run()` emits at most two tokens (a buffered text run
  // flushed ahead of a tag/comment/doctype), so two slots replace an array+shift
  // on the hot path. `e0` is the next token out; `e1` is the carry.
  private e0: Token | null = null;
  private e1: Token | null = null;
  /** Third slot, used only by `finish()`: at EOF a text run AND a comment/doctype
   * can both be pending (`abc<!--x`), and the EOF token must not overwrite them. */
  private e2: Token | null = null;
  private done = false;
  private foreignFlag = false;
  private lastStartTag: string;

  // current token scratch
  private tagName = '';
  private tagIsEnd = false;
  private tagSelfClosing = false;
  /** Reused attribute scratch for the current tag; only [0, nAttrs) is live. */
  private readonly attrs: Array<[string, string]> = [];
  private nAttrs = 0;
  /** Names seen on the current tag, built only once it passes ATTR_SET_MIN attrs
   * (see addAttr); null otherwise. */
  private attrSeen: Set<string> | null = null;
  private attrName = '';
  private attrValue = '';
  private comment = '';
  private dn: string | null = null; // doctype name
  private dpub: string | null = null;
  private dsys: string | null = null;
  private dquirks = false;
  private tempBuf = '';
  private charBuf = '';
  private charRefCode = 0;
  // Reused token objects: the tree builder pulls one token at a time and consumes
  // it (keeping only its strings/attrs array, never the wrapper) before pulling the
  // next, so we mutate-and-reuse instead of allocating a wrapper per token. The
  // batch `tokenize()` (test/conformance only) clones, since it retains every token.
  private readonly rtag: TagToken = { type: 'startTag', name: '', attrs: [], selfClosing: false };
  private readonly rchar: CharacterToken = { type: 'character', data: '' };

  constructor(input: string, opts: TokenizeOptions) {
    // WHATWG input-stream preprocessing (CR and CRLF become LF) is done LAZILY,
    // not as a full-input copy up front (one extra input-sized string plus a regex
    // pass, ~15% of a CRLF document's time). CR in tag whitespace is treated as
    // whitespace; bulk text / attribute-value / comment runs are normalized per run
    // (`take`); the few states that copy raw input chars one at a time switch to a
    // normalized copy of the REST of the input the first time they meet a CR
    // (`normalizeRest`). Output is identical to normalizing first.
    this.input = input;
    this.len = input.length;
    this.hasCR = input.indexOf('\r') !== -1;
    this.state = STATE_FROM_CONTENT[opts.state ?? 'data'];
    this.lastStartTag = opts.lastStartTag ?? '';
  }

  /**
   * Pull one token. Returns null at end of input. The tree builder calls this in
   * a loop, switching the content-model state (`setContentState`) between pulls —
   * exactly the tokenizer↔tree-construction coupling the WHATWG spec requires.
   */
  nextToken(): Token | null {
    if (this.e0 === null && !this.done) this.run();
    const t = this.e0;
    this.e0 = this.e1;
    this.e1 = this.e2;
    this.e2 = null;
    return t;
  }

  /** Run to completion, returning the whole token stream (used by conformance).
   * Clones each token because `rtag`/`rchar` are reused across `nextToken()` calls
   * and this retains the full stream. (The tree builder consumes one at a time, so
   * it doesn't need this.) */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    let t: Token | null;
    while ((t = this.nextToken()) !== null) {
      if (t.type === 'startTag' || t.type === 'endTag') tokens.push({ type: t.type, name: t.name, attrs: t.attrs, selfClosing: t.selfClosing });
      else if (t.type === 'character') tokens.push({ type: 'character', data: t.data });
      else tokens.push(t);
    }
    return tokens;
  }

  /** Tree builder hook: switch the content-model state (RAWTEXT/RCDATA/script…). */
  setContentState(state: ContentState): void {
    this.state = STATE_FROM_CONTENT[state];
  }
  /** Tree builder hook: set the appropriate end-tag name for raw-text matching. */
  setLastStartTag(name: string): void {
    this.lastStartTag = name;
  }
  /** Tree builder hook: in foreign content `<![CDATA[` is a real CDATA section,
   * not a bogus comment. The tree builder keeps this in sync with the adjusted
   * current node's namespace. */
  setForeignContent(v: boolean): void {
    this.foreignFlag = v;
  }

  /** `input.slice(i, j)`, with CR/CRLF normalized to LF while raw CRs remain.
   * Bulk runs never end between a CR and its LF (no run stops at LF). */
  private take(i: number, j: number): string {
    const run = this.input.slice(i, j);
    return this.hasCR ? normalizeCR(run) : run;
  }
  /** Replace the unconsumed input with its CR-normalized form (positions restart at
   * 0; nothing holds an absolute position across run() iterations). */
  private normalizeRest(): void {
    const rest = normalizeCR(this.input.slice(this.i));
    this.input = rest;
    this.len = rest.length;
    this.i = 0;
    this.hasCR = false;
  }

  // --- emit helpers ---------------------------------------------------------
  private emitChar(s: string) {
    this.charBuf += s;
  }
  /** Queue a token. At most two are ever live at once (text run + following tag). */
  private push(t: Token) {
    if (this.e0 === null) this.e0 = t;
    else this.e1 = t;
  }
  private flushChars() {
    if (this.charBuf) {
      this.rchar.data = this.charBuf;
      this.push(this.rchar);
      this.charBuf = '';
    }
  }
  private emit(t: Token) {
    this.flushChars();
    this.push(t);
  }
  private startTag() {
    this.tagName = '';
    this.tagIsEnd = false;
    this.tagSelfClosing = false;
    this.nAttrs = 0;
    this.attrSeen = null;
  }
  private startEndTag() {
    this.startTag();
    this.tagIsEnd = true;
  }
  private addAttr() {
    const name = this.attrName;
    if (name) {
      // first occurrence wins (per spec, duplicates are dropped). Small tags (the
      // norm) use a plain scan, no allocation; past ATTR_SET_MIN attrs switch to a
      // Set, else `<p a0 a1 … a59999>` is O(n²) (seconds on ~400 KB of input).
      const attrs = this.attrs, n = this.nAttrs;
      let dup = false;
      if (n < ATTR_SET_MIN) {
        for (let k = 0; k < n; k++) { if (attrs[k][0] === name) { dup = true; break; } }
      } else {
        let seen = this.attrSeen;
        if (seen === null) {
          seen = this.attrSeen = new Set();
          for (let k = 0; k < n; k++) seen.add(attrs[k][0]);
        }
        dup = seen.has(name);
        if (!dup) seen.add(name);
      }
      if (!dup) { attrs[n] = [name, this.attrValue]; this.nAttrs = n + 1; }
    }
    this.attrName = '';
    this.attrValue = '';
  }
  /** Data-state `<` at `p`, with the TagOpen / EndTagOpen decisions inlined for the
   * overwhelmingly common `<name` and `</name` shapes (same transitions as those
   * states: start the tag and reconsume the letter in TagName). Anything else
   * enters TagOpen exactly as before. */
  private tagOpenAt(p: number) {
    const input = this.input, len = this.len;
    const n1 = p + 1 < len ? input.charCodeAt(p + 1) : -1;
    if (isAsciiAlpha(n1)) { this.startTag(); this.i = p + 1; this.state = S.TagName; return; }
    if (n1 === 0x2f && p + 2 < len && isAsciiAlpha(input.charCodeAt(p + 2))) { this.startEndTag(); this.i = p + 2; this.state = S.TagName; return; }
    this.i = p + 1; this.state = S.TagOpen;
  }
  /** Closing quote consumed; `p` is the next position. Inlines the
   * AfterAttrValueQuoted transitions for the common next chars (whitespace, '>',
   * '/'); anything else (incl. EOF) enters that state exactly as before. */
  private afterQuotedValue(p: number) {
    const n = p < this.len ? this.input.charCodeAt(p) : -1;
    if (n === 0x20 || n === 0x0a || n === 0x09 || n === 0x0c || n === 0x0d) { this.i = p + 1; this.state = S.BeforeAttrName; }
    else if (n === 0x3e) { this.i = p + 1; this.state = S.Data; this.emitTag(); }
    else if (n === 0x2f) { this.i = p + 1; this.state = S.SelfClosing; }
    else { this.i = p; this.state = S.AfterAttrValueQuoted; }
  }
  private emitTag() {
    this.addAttr();
    if (!this.tagIsEnd) this.lastStartTag = this.tagName;
    const k = this.rtag;
    k.type = this.tagIsEnd ? 'endTag' : 'startTag';
    k.name = this.tagName;
    // Exact-size copy out of the reused scratch: a fresh `[]` grown by push() gets a
    // 17-slot backing store on the first attribute (~150 B/element retained in the
    // tree); slice() allocates exactly n slots and the scratch never regrows.
    // End tags never become elements (their attributes are dropped per spec), so they
    // share one frozen empty list instead of allocating a fresh `[]` each.
    k.attrs = this.nAttrs === 0 ? (this.tagIsEnd ? NO_ATTRS : []) : this.attrs.slice(0, this.nAttrs);
    k.selfClosing = this.tagSelfClosing;
    this.emit(k);
  }
  private appropriateEndTag(): boolean {
    return this.tagIsEnd && this.tagName === this.lastStartTag;
  }

  private finish(): void {
    this.done = true;
    this.flushChars();
    // explicit EOF so the tree builder finalizes; queued behind anything pending
    const eof: Token = { type: 'eof' };
    if (this.e1 !== null) this.e2 = eof;
    else this.push(eof);
  }

  // --- the state machine ----------------------------------------------------
  // Runs until a token is queued (e0) or EOF. Each state either advances `i` and
  // `continue`s, or "reconsumes" by switching state WITHOUT advancing (the loop
  // re-reads the same char). The whole machine lives in this one loop (no per-
  // transition step() call), and the case labels are NUMERIC LITERALS (state name in
  // the comment), not `S.X`: V8 only compiles a switch to a jump table when every
  // label is a Smi literal; with `S.X` labels each transition walked a linear chain
  // of compares, so late states (attr values, char refs, comments) paid ~50 each.
  // Keep the literals in sync with `S` above.
  private run(): void {
    let input = this.input, len = this.len;
    for (;;) {
    if (this.e0 !== null) return;
    const eof = this.i >= len;
    const c = eof ? -1 : input.charCodeAt(this.i);
    // A raw CR reaching a state that copies input chars one at a time: finish the
    // input-stream preprocessing for the rest of the input, then re-read.
    if (c === 0x0d && CR_COPY_STATES[this.state] === 1) { this.normalizeRest(); input = this.input; len = this.len; continue; }
    switch (this.state) {
      // Text states bulk-scan each run to the next boundary char and append it as
      // ONE slice (instead of step()+charBuf+= per character) — the dominant
      // tokenizer cost on text-heavy input. Behavior-identical: same chars, NUL
      // handling, and state transition on the boundary char.
      case 0 /* S.Data */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x26 && c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x26 || cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += this.take(this.i, j); this.i = j;
          if (j < len && input.charCodeAt(j) === 0x3c) this.tagOpenAt(j);
          continue;
        }
        if (c === 0x3c) { this.tagOpenAt(this.i); continue; }
        this.i++;
        if (c === 0x26) { this.returnState = S.Data; this.state = S.CharRef; }
        else this.emitChar(this.input[this.i - 1]); // c === 0 -> emit U+0000
        continue;
      }

      case 1 /* S.RCDATA */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x26 && c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x26 || cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (c === 0x26) { this.returnState = S.RCDATA; this.state = S.CharRef; }
        else if (c === 0x3c) this.state = S.RCDATALt;
        else this.emitChar(REPLACEMENT); // c === 0
        continue;
      }

      case 2 /* S.RAWTEXT */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (c === 0x3c) this.state = S.RAWTEXTLt;
        else this.emitChar(REPLACEMENT); // c === 0
        continue;
      }

      case 3 /* S.ScriptData */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (c === 0x3c) this.state = S.ScriptLt;
        else this.emitChar(REPLACEMENT); // c === 0
        continue;
      }

      case 4 /* S.PLAINTEXT */: {
        if (eof) { this.finish(); return; }
        if (c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { if (input.charCodeAt(j) === 0) break; j++; }
          this.charBuf += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        this.emitChar(REPLACEMENT); // c === 0
        continue;
      }

      case 5 /* S.TagOpen */:
        if (eof) { this.emitChar('<'); { this.finish(); return; } }
        if (c === 0x21) { this.i++; this.state = S.MarkupDeclOpen; }
        else if (c === 0x2f) { this.i++; this.state = S.EndTagOpen; }
        /* v8 ignore next -- `<letter` never reaches TagOpen: tagOpenAt starts the tag inline */
        else if (isAsciiAlpha(c)) { this.startTag(); this.state = S.TagName; }
        else if (c === 0x3f) { this.comment = ''; this.state = S.BogusComment; }
        else { this.emitChar('<'); this.state = S.Data; }
        continue;

      case 6 /* S.EndTagOpen */:
        if (eof) { this.emitChar('<'); this.emitChar('/'); { this.finish(); return; } }
        /* v8 ignore next -- `</letter` never reaches EndTagOpen: tagOpenAt starts the tag inline */
        if (isAsciiAlpha(c)) { this.startEndTag(); this.state = S.TagName; }
        else if (c === 0x3e) { this.i++; this.state = S.Data; }
        else { this.comment = ''; this.state = S.BogusComment; }
        continue;

      case 7 /* S.TagName */: {
        if (eof) { this.finish(); return; }
        if (!isWs(c) && c !== 0x2f && c !== 0x3e && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1, up = c >= 0x41 && c <= 0x5a;
          let h = Math.imul(0x811c9dc5 ^ (up ? c | 0x20 : c), FNV);
          while (j < len) {
            const cc = input.charCodeAt(j);
            if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x0d || cc === 0x2f || cc === 0x3e || cc === 0) break;
            if (cc >= 0x41 && cc <= 0x5a) { up = true; h = Math.imul(h ^ (cc | 0x20), FNV); } else h = Math.imul(h ^ cc, FNV);
            j++;
          }
          const k = this.tagName === '' ? internRun(input, this.i, j - this.i, h, up) : undefined;
          if (k !== undefined) this.tagName = k;
          else { const run = input.slice(this.i, j); this.tagName += up ? foldAsciiUpper(run) : run; }
          this.i = j;
          // Inline the terminator's TagName transition ('>' emits, whitespace starts
          // attributes) instead of a second dispatch just to consume it.
          if (j < len) {
            const t = input.charCodeAt(j);
            if (t === 0x3e) { this.i = j + 1; this.state = S.Data; this.emitTag(); }
            else if (t === 0x20 || t === 0x0a || t === 0x09 || t === 0x0c || t === 0x0d) { this.i = j + 1; this.state = S.BeforeAttrName; }
          }
          continue;
        }
        this.i++;
        if (isWs(c)) this.state = S.BeforeAttrName;
        else if (c === 0x2f) this.state = S.SelfClosing;
        else if (c === 0x3e) { this.state = S.Data; this.emitTag(); }
        else this.tagName += REPLACEMENT; // c === 0
        continue;
      }

      // RCDATA / RAWTEXT / Script less-than + end-tag (shared shape) ----------
      case 8 /* S.RCDATALt */:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.RCDATAEndTagOpen; }
        else { this.emitChar('<'); this.state = S.RCDATA; }
        continue;
      case 9 /* S.RCDATAEndTagOpen */:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.RCDATAEndTagName; }
        else { this.emitChar('</'); this.state = S.RCDATA; }
        continue;
      case 10 /* S.RCDATAEndTagName */:
        this.endTagNameState(c, eof, S.RCDATA); continue;

      case 11 /* S.RAWTEXTLt */:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.RAWTEXTEndTagOpen; }
        else { this.emitChar('<'); this.state = S.RAWTEXT; }
        continue;
      case 12 /* S.RAWTEXTEndTagOpen */:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.RAWTEXTEndTagName; }
        else { this.emitChar('</'); this.state = S.RAWTEXT; }
        continue;
      case 13 /* S.RAWTEXTEndTagName */:
        this.endTagNameState(c, eof, S.RAWTEXT); continue;

      case 14 /* S.ScriptLt */:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.ScriptEndTagOpen; continue; }
        if (!eof && c === 0x21) { this.i++; this.emitChar('<!'); this.state = S.ScriptEscapeStart; continue; }
        this.emitChar('<'); this.state = S.ScriptData;
        continue;
      case 15 /* S.ScriptEndTagOpen */:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.ScriptEndTagName; }
        else { this.emitChar('</'); this.state = S.ScriptData; }
        continue;
      case 16 /* S.ScriptEndTagName */:
        this.endTagNameState(c, eof, S.ScriptData); continue;

      // Script-data escaped / double-escaped (handles <script> with <!-- --> and
      // nested <script>; correct </script> boundary detection is security-relevant).
      case 62 /* S.ScriptEscapeStart */:
        if (!eof && c === 0x2d) { this.i++; this.emitChar('-'); this.state = S.ScriptEscapeStartDash; continue; }
        { this.state = S.ScriptData; continue; }
      case 63 /* S.ScriptEscapeStartDash */:
        if (!eof && c === 0x2d) { this.i++; this.emitChar('-'); this.state = S.ScriptEscapedDashDash; continue; }
        { this.state = S.ScriptData; continue; }
      case 64 /* S.ScriptEscaped */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptEscapedDash; }
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]);
        continue;
      case 65 /* S.ScriptEscapedDash */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptEscapedDashDash; }
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptEscaped; }
        continue;
      case 66 /* S.ScriptEscapedDashDash */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) this.emitChar('-');
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else if (c === 0x3e) { this.emitChar('>'); this.state = S.ScriptData; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptEscaped; }
        continue;
      case 67 /* S.ScriptEscapedLt */:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.ScriptEscapedEndTagOpen; continue; }
        if (!eof && isAsciiAlpha(c)) { this.tempBuf = ''; this.emitChar('<'); { this.state = S.ScriptDoubleEscapeStart; continue; } }
        this.emitChar('<');
        { this.state = S.ScriptEscaped; continue; }
      case 68 /* S.ScriptEscapedEndTagOpen */:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); { this.state = S.ScriptEscapedEndTagName; continue; } }
        this.emitChar('</');
        { this.state = S.ScriptEscaped; continue; }
      case 69 /* S.ScriptEscapedEndTagName */:
        this.endTagNameState(c, eof, S.ScriptEscaped); continue;
      case 70 /* S.ScriptDoubleEscapeStart */:
        if (!eof && (isWs(c) || c === 0x2f || c === 0x3e)) { this.i++; this.emitChar(this.input[this.i - 1]); this.state = this.tempBuf === 'script' ? S.ScriptDoubleEscaped : S.ScriptEscaped; continue; }
        if (!eof && isAsciiAlpha(c)) { this.i++; this.tempBuf += String.fromCharCode(toLowerCh(c)); this.emitChar(this.input[this.i - 1]); continue; }
        { this.state = S.ScriptEscaped; continue; }
      case 71 /* S.ScriptDoubleEscaped */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptDoubleEscapedDash; }
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]);
        continue;
      case 72 /* S.ScriptDoubleEscapedDash */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptDoubleEscapedDashDash; }
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptDoubleEscaped; }
        continue;
      case 73 /* S.ScriptDoubleEscapedDashDash */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x2d) this.emitChar('-');
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else if (c === 0x3e) { this.emitChar('>'); this.state = S.ScriptData; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptDoubleEscaped; }
        continue;
      case 74 /* S.ScriptDoubleEscapedLt */:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.emitChar('/'); this.state = S.ScriptDoubleEscapeEnd; continue; }
        { this.state = S.ScriptDoubleEscaped; continue; }
      case 75 /* S.ScriptDoubleEscapeEnd */:
        if (!eof && (isWs(c) || c === 0x2f || c === 0x3e)) { this.i++; this.emitChar(this.input[this.i - 1]); this.state = this.tempBuf === 'script' ? S.ScriptEscaped : S.ScriptDoubleEscaped; continue; }
        if (!eof && isAsciiAlpha(c)) { this.i++; this.tempBuf += String.fromCharCode(toLowerCh(c)); this.emitChar(this.input[this.i - 1]); continue; }
        { this.state = S.ScriptDoubleEscaped; continue; }

      // Attributes -----------------------------------------------------------
      case 17 /* S.BeforeAttrName */:
        if (eof || c === 0x2f || c === 0x3e) { this.state = S.AfterAttrName; continue; }
        if (isWs(c)) {
          // Consume the whole whitespace run in one step (attr-dense markup separates
          // attributes with newline+indent), not one step() call per ws char.
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc !== 0x09 && cc !== 0x0a && cc !== 0x0c && cc !== 0x20 && cc !== 0x0d) break; j++; }
          this.i = j; continue;
        }
        this.addAttr();
        // `=` here starts an attribute whose name begins with '=' (parse error).
        if (c === 0x3d) { this.i++; this.attrName = '='; this.state = S.AttrName; continue; }
        { this.state = S.AttrName; continue; }
      case 18 /* S.AttrName */: {
        if (eof || isWs(c) || c === 0x2f || c === 0x3e) { this.state = S.AfterAttrName; continue; }
        if (c !== 0x3d && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1, up = c >= 0x41 && c <= 0x5a;
          let h = Math.imul(0x811c9dc5 ^ (up ? c | 0x20 : c), FNV);
          while (j < len) {
            const cc = input.charCodeAt(j);
            if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x0d || cc === 0x2f || cc === 0x3e || cc === 0x3d || cc === 0) break;
            if (cc >= 0x41 && cc <= 0x5a) { up = true; h = Math.imul(h ^ (cc | 0x20), FNV); } else h = Math.imul(h ^ cc, FNV);
            j++;
          }
          const k = this.attrName === '' ? internRun(input, this.i, j - this.i, h, up) : undefined;
          if (k !== undefined) this.attrName = k;
          else { const run = input.slice(this.i, j); this.attrName += up ? foldAsciiUpper(run) : run; }
          this.i = j;
          // Inline the canonical `name="` / `name='` step (the '=' branch below).
          if (j + 1 < len && input.charCodeAt(j) === 0x3d) {
            const q = input.charCodeAt(j + 1);
            if (q === 0x22) { this.i = j + 2; this.state = S.AttrValueDq; }
            else if (q === 0x27) { this.i = j + 2; this.state = S.AttrValueSq; }
          }
          continue;
        }
        this.i++;
        if (c === 0x3d) {
          // Peek past `=`: for the canonical `name="value"` / `name='value'` shape
          // (quote immediately follows), jump straight into the quoted-value state,
          // skipping the BeforeAttrValue dispatch. Any other char (ws, unquoted, `>`)
          // falls through to BeforeAttrValue unchanged.
          const nc = this.i < this.len ? this.input.charCodeAt(this.i) : -1;
          if (nc === 0x22) { this.i++; this.state = S.AttrValueDq; }
          else if (nc === 0x27) { this.i++; this.state = S.AttrValueSq; }
          else this.state = S.BeforeAttrValue;
        }
        else this.attrName += REPLACEMENT; // c === 0
        continue;
      }
      case 19 /* S.AfterAttrName */:
        if (eof) { this.finish(); return; }
        if (isWs(c)) { this.i++; continue; }
        if (c === 0x2f) { this.i++; this.state = S.SelfClosing; continue; }
        if (c === 0x3d) { this.i++; this.state = S.BeforeAttrValue; continue; }
        if (c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); continue; }
        this.addAttr();
        this.state = S.AttrName; // reconsume c in AttrName (handles NUL→FFFD, lowercasing)
        continue;
      case 20 /* S.BeforeAttrValue */:
        if (!eof && isWs(c)) { this.i++; continue; }
        if (!eof && c === 0x22) { this.i++; this.state = S.AttrValueDq; }
        else if (!eof && c === 0x27) { this.i++; this.state = S.AttrValueSq; }
        else if (!eof && c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); }
        else { this.state = S.AttrValueUq; continue; }
        continue;
      // Attribute values are copied verbatim (no case-folding), so each run
      // bulk-slices to the next boundary char in one go — like the text states.
      case 21 /* S.AttrValueDq */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x22 && c !== 0x26 && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x22 || cc === 0x26 || cc === 0) break; j++; }
          this.attrValue += this.take(this.i, j); this.i = j;
          if (j < len && input.charCodeAt(j) === 0x22) this.afterQuotedValue(j + 1);
          continue;
        }
        if (c === 0x22) { this.afterQuotedValue(this.i + 1); continue; }
        this.i++;
        if (c === 0x26) { this.returnState = S.AttrValueDq; this.state = S.CharRef; }
        else this.attrValue += REPLACEMENT; // c === 0
        continue;
      }
      case 22 /* S.AttrValueSq */: {
        if (eof) { this.finish(); return; }
        if (c !== 0x27 && c !== 0x26 && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x27 || cc === 0x26 || cc === 0) break; j++; }
          this.attrValue += this.take(this.i, j); this.i = j;
          if (j < len && input.charCodeAt(j) === 0x27) this.afterQuotedValue(j + 1);
          continue;
        }
        if (c === 0x27) { this.afterQuotedValue(this.i + 1); continue; }
        this.i++;
        if (c === 0x26) { this.returnState = S.AttrValueSq; this.state = S.CharRef; }
        else this.attrValue += REPLACEMENT; // c === 0
        continue;
      }
      case 23 /* S.AttrValueUq */: {
        if (eof) { this.finish(); return; }
        if (!isWs(c) && c !== 0x26 && c !== 0x3e && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x0d || cc === 0x26 || cc === 0x3e || cc === 0) break; j++; }
          this.attrValue += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (isWs(c)) this.state = S.BeforeAttrName;
        else if (c === 0x26) { this.returnState = S.AttrValueUq; this.state = S.CharRef; }
        else if (c === 0x3e) { this.state = S.Data; this.emitTag(); }
        else this.attrValue += REPLACEMENT; // c === 0
        continue;
      }
      case 24 /* S.AfterAttrValueQuoted */:
        if (eof) { this.finish(); return; }
        /* v8 ignore start -- ws / '/' / '>' after a closing quote are handled inline by afterQuotedValue */
        if (isWs(c)) { this.i++; this.state = S.BeforeAttrName; }
        else if (c === 0x2f) { this.i++; this.state = S.SelfClosing; }
        else if (c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); }
        else { this.state = S.BeforeAttrName; continue; }
        continue;
        /* v8 ignore stop */
      case 25 /* S.SelfClosing */:
        if (eof) { this.finish(); return; }
        if (c === 0x3e) { this.i++; this.tagSelfClosing = true; this.state = S.Data; this.emitTag(); continue; }
        this.state = S.BeforeAttrName; // reconsume c
        continue;

      // Comments / markup declaration ----------------------------------------
      case 26 /* S.BogusComment */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c !== 0x3e && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x3e || cc === 0) break; j++; }
          this.comment += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (c === 0x3e) { this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; }
        else this.comment += REPLACEMENT; // c === 0 (every other char took the bulk path)
        continue;
      case 27 /* S.MarkupDeclOpen */:
        if (this.input.startsWith('--', this.i)) { this.i += 2; this.comment = ''; this.state = S.CommentStart; }
        else if (/^doctype/i.test(this.input.substr(this.i, 7))) { this.i += 7; this.state = S.Doctype; }
        else if (this.input.startsWith('[CDATA[', this.i)) {
          this.i += 7;
          // Foreign content → real CDATA section; HTML content → bogus comment
          // with data "[CDATA[" (per spec). The tree builder sets foreignFlag.
          if (this.foreignFlag) { this.state = S.CdataSection; }
          else { this.comment = '[CDATA['; this.state = S.BogusComment; }
        }
        else { this.comment = ''; this.state = S.BogusComment; }
        continue;
      case 28 /* S.CommentStart */:
        if (!eof && c === 0x2d) { this.i++; this.state = S.CommentStartDash; }
        else if (!eof && c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; }
        else { this.state = S.Comment; continue; }
        continue;
      case 29 /* S.CommentStartDash */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c === 0x2d) { this.i++; this.state = S.CommentEnd; continue; }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; continue; }
        this.comment += '-';
        this.state = S.Comment; // reconsume c (no advance)
        continue;
      case 30 /* S.Comment */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c !== 0x2d && c !== 0) {
          // Bulk-slice the run up to the next '-' / NUL (the only chars with their
          // own transitions here) instead of one step()+concat per character.
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x2d || cc === 0) break; j++; }
          this.comment += this.take(this.i, j); this.i = j; continue;
        }
        this.i++;
        if (c === 0x2d) this.state = S.CommentEndDash;
        else this.comment += REPLACEMENT; // c === 0 (every other char took the bulk path)
        continue;
      case 31 /* S.CommentEndDash */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c === 0x2d) { this.i++; this.state = S.CommentEnd; continue; }
        this.comment += '-';
        this.state = S.Comment; // reconsume c
        continue;
      case 32 /* S.CommentEnd */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; continue; }
        if (c === 0x21) { this.i++; this.state = S.CommentEndBang; continue; }
        if (c === 0x2d) { this.i++; this.comment += '-'; continue; }
        this.comment += '--';
        this.state = S.Comment; // reconsume c
        continue;
      case 33 /* S.CommentEndBang */:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); { this.finish(); return; } }
        if (c === 0x2d) { this.i++; this.comment += '--!'; this.state = S.CommentEndDash; continue; }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; continue; }
        this.comment += '--!';
        this.state = S.Comment; // reconsume c
        continue;

      // DOCTYPE --------------------------------------------------------------
      case 34 /* S.Doctype */:
        if (eof) { this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; this.state = S.BeforeDoctypeName; }
        else { this.state = S.BeforeDoctypeName; continue; }
        continue;
      case 35 /* S.BeforeDoctypeName */:
        if (eof) { this.dn = null; this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; continue; }
        this.i++;
        if (c === 0x3e) { this.dn = null; this.dquirks = true; this.emitDoctype(true); this.state = S.Data; continue; }
        this.dn = c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c));
        this.dpub = this.dsys = null; this.dquirks = false;
        this.state = S.DoctypeName;
        continue;
      case 36 /* S.DoctypeName */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        this.i++;
        if (isWs(c)) this.state = S.AfterDoctypeName;
        else if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else this.dn += c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c));
        continue;
      case 37 /* S.AfterDoctypeName */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; continue; }
        if (c === 0x3e) { this.i++; this.state = S.Data; this.emitDoctype(false); continue; }
        if (/^public/i.test(this.input.substr(this.i, 6))) { this.i += 6; this.state = S.AfterDoctypePublicKw; }
        else if (/^system/i.test(this.input.substr(this.i, 6))) { this.i += 6; this.state = S.AfterDoctypeSystemKw; }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        continue;
      case 38 /* S.AfterDoctypePublicKw */:
      case 39 /* S.BeforeDoctypePublicId */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypePublicKw) this.state = S.BeforeDoctypePublicId; continue; }
        this.i++;
        if (c === 0x22) { this.dpub = ''; this.state = S.DoctypePublicIdDq; }
        else if (c === 0x27) { this.dpub = ''; this.state = S.DoctypePublicIdSq; }
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        continue;
      case 40 /* S.DoctypePublicIdDq */:
      case 41 /* S.DoctypePublicIdSq */: {
        const q = this.state === S.DoctypePublicIdDq ? 0x22 : 0x27;
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        this.i++;
        if (c === q) this.state = S.AfterDoctypePublicId;
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else this.dpub = this.dpub! + (c === 0 ? REPLACEMENT : this.input[this.i - 1]); // dpub set to '' on entry (648/649)
        continue;
      }
      case 42 /* S.AfterDoctypePublicId */:
      case 43 /* S.BetweenDoctypePublicSystem */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypePublicId) this.state = S.BetweenDoctypePublicSystem; continue; }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else if (c === 0x22) { this.dsys = ''; this.state = S.DoctypeSystemIdDq; }
        else if (c === 0x27) { this.dsys = ''; this.state = S.DoctypeSystemIdSq; }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        continue;
      case 44 /* S.AfterDoctypeSystemKw */:
      case 45 /* S.BeforeDoctypeSystemId */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypeSystemKw) this.state = S.BeforeDoctypeSystemId; continue; }
        this.i++;
        if (c === 0x22) { this.dsys = ''; this.state = S.DoctypeSystemIdDq; }
        else if (c === 0x27) { this.dsys = ''; this.state = S.DoctypeSystemIdSq; }
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        continue;
      case 46 /* S.DoctypeSystemIdDq */:
      case 47 /* S.DoctypeSystemIdSq */: {
        const q = this.state === S.DoctypeSystemIdDq ? 0x22 : 0x27;
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        this.i++;
        if (c === q) this.state = S.AfterDoctypeSystemId;
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else this.dsys = this.dsys! + (c === 0 ? REPLACEMENT : this.input[this.i - 1]); // dsys set to '' on entry (669/670/678/679)
        continue;
      }
      case 48 /* S.AfterDoctypeSystemId */:
        if (eof) { this.dquirks = true; this.emitDoctype(true); { this.finish(); return; } }
        if (isWs(c)) { this.i++; continue; }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else this.state = S.BogusDoctype;
        continue;
      case 49 /* S.BogusDoctype */:
        if (eof) { this.emitDoctype(this.dquirks); { this.finish(); return; } }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(this.dquirks); }
        continue;

      // CDATA ----------------------------------------------------------------
      case 50 /* S.CdataSection */:
        if (eof) { this.finish(); return; }
        this.i++;
        if (c === 0x5d) this.state = S.CdataSectionBracket;
        else this.emitChar(this.input[this.i - 1]);
        continue;
      case 51 /* S.CdataSectionBracket */:
        if (!eof && c === 0x5d) { this.i++; this.state = S.CdataSectionEnd; }
        else { this.emitChar(']'); { this.state = S.CdataSection; continue; } }
        continue;
      case 52 /* S.CdataSectionEnd */:
        if (!eof && c === 0x5d) { this.i++; this.emitChar(']'); continue; }
        if (!eof && c === 0x3e) { this.i++; this.state = S.Data; continue; }
        this.emitChar(']]'); { this.state = S.CdataSection; continue; }

      // Character references -------------------------------------------------
      case 53 /* S.CharRef */:
        this.tempBuf = '&';
        if (!eof && isAsciiAlnum(c)) { this.state = S.NamedCharRef; continue; }
        if (!eof && c === 0x23) {
          // Fast path: `&#123;` / `&#x7B;` with at least one digit is scanned inline
          // (one loop iteration instead of one per digit); a digit-less `&#`/`&#x`
          // falls back to the spec states below (they flush the literal text).
          let j = this.i + 1, code = 0, hex = false;
          if (j < this.len) { const x = input.charCodeAt(j); if (x === 0x78 || x === 0x58) { hex = true; j++; } }
          const d0 = j;
          if (hex) { for (; j < len; j++) { const d = input.charCodeAt(j); if (d >= 0x30 && d <= 0x39) code = code * 16 + (d - 0x30); else if ((d | 0x20) >= 0x61 && (d | 0x20) <= 0x66) code = code * 16 + ((d | 0x20) - 0x61 + 10); else break; } }
          else { for (; j < len; j++) { const d = input.charCodeAt(j); if (d >= 0x30 && d <= 0x39) code = code * 10 + (d - 0x30); else break; } }
          if (j > d0) {
            if (j < len && input.charCodeAt(j) === 0x3b) j++;
            this.i = j; this.charRefCode = code; this.state = S.NumericEnd; continue;
          }
          this.i++; this.tempBuf += '#'; this.state = S.NumericCharRef; continue;
        }
        this.flushTempToCharRefTarget();
        { this.state = this.returnState; continue; }
      case 54 /* S.NamedCharRef */:
        this.namedCharRefState(); continue;
      case 55 /* S.AmbiguousAmp */:
        if (!eof && isAsciiAlnum(c)) { this.i++; this.appendCharRef(this.input[this.i - 1]); continue; }
        { this.state = this.returnState; continue; }
      case 56 /* S.NumericCharRef */:
        this.charRefCode = 0;
        if (!eof && (c === 0x78 || c === 0x58)) { this.i++; this.tempBuf += this.input[this.i - 1]; this.state = S.HexStart; }
        else this.state = S.DecStart;
        continue;
      // HexStart/DecStart are only entered when CharRef's inline numeric scan found NO
      // digit (it consumes every digit itself), so the digit branches and the
      // HexRef/DecRef states below are kept for spec-shape but never run.
      case 57 /* S.HexStart */:
        /* v8 ignore next */
        if (!eof && isHexDigit(c)) { this.state = S.HexRef; continue; }
        this.flushTempToCharRefTarget();
        { this.state = this.returnState; continue; }
      case 58 /* S.DecStart */:
        /* v8 ignore next */
        if (!eof && c >= 0x30 && c <= 0x39) { this.state = S.DecRef; continue; }
        this.flushTempToCharRefTarget();
        { this.state = this.returnState; continue; }
      /* v8 ignore start -- unreachable: see HexStart */
      case 59 /* S.HexRef */:
        if (!eof && isHexDigit(c)) {
          this.i++;
          const d = c <= 0x39 ? c - 0x30 : (toLowerCh(c) - 0x61 + 10);
          this.charRefCode = this.charRefCode * 16 + d;
          continue;
        }
        if (!eof && c === 0x3b) this.i++;
        this.state = S.NumericEnd;
        continue;
      case 60 /* S.DecRef */:
        if (!eof && c >= 0x30 && c <= 0x39) { this.i++; this.charRefCode = this.charRefCode * 10 + (c - 0x30); continue; }
        if (!eof && c === 0x3b) this.i++;
        this.state = S.NumericEnd;
        continue;
      /* v8 ignore stop */
      case 61 /* S.NumericEnd */: {
        // Does NOT consume: process the accumulated code and switch to the return
        // state; the next loop iteration reads the next char fresh.
        let code = this.charRefCode;
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
        else if (C1[code] !== undefined) code = C1[code];
        this.appendCharRef(String.fromCodePoint(code));
        this.state = this.returnState;
        continue;
      }

      /* v8 ignore next 2 -- unreachable: every state id 0..75 has a case above */
      default:
        { this.finish(); return; }
    }
  }
  }


  private endTagNameState(c: number, eof: boolean, rawState: number): boolean {
    if (!eof) {
      if ((isWs(c)) && this.appropriateEndTag()) { this.i++; this.state = S.BeforeAttrName; return true; }
      if (c === 0x2f && this.appropriateEndTag()) { this.i++; this.state = S.SelfClosing; return true; }
      if (c === 0x3e && this.appropriateEndTag()) { this.i++; this.state = S.Data; this.emitTag(); return true; }
      if (isAsciiAlpha(c)) {
        this.i++;
        this.tagName += String.fromCharCode(toLowerCh(c));
        this.tempBuf += this.input[this.i - 1];
        return true;
      }
    }
    // not an appropriate end tag — emit "</" + buffer as characters
    this.emitChar('</' + this.tempBuf);
    this.state = rawState; // reconsume c in the raw-text state (run() re-reads it)
    return true;
  }

  private emitDoctype(forceQuirks: boolean) {
    this.emit({ type: 'doctype', name: this.dn, publicId: this.dpub, systemId: this.dsys, forceQuirks });
    this.dn = this.dpub = this.dsys = null;
    this.dquirks = false;
  }

  // Character-reference output goes to the right sink (attr value vs text).
  private appendCharRef(s: string) {
    if (this.returnState === S.AttrValueDq || this.returnState === S.AttrValueSq || this.returnState === S.AttrValueUq) {
      this.attrValue += s;
    } else {
      this.emitChar(s);
    }
  }
  private flushTempToCharRefTarget() {
    this.appendCharRef(this.tempBuf);
  }
  private inAttr(): boolean {
    return this.returnState === S.AttrValueDq || this.returnState === S.AttrValueSq || this.returnState === S.AttrValueUq;
  }

  private namedCharRefState(): boolean {
    // Greedy longest match via the trie, walking code unit by code unit (no
    // growing-string rebuild/re-hash). matchLen/matchValue track the longest hit.
    const input = this.input, len = this.len, start = this.i;
    // Fast path: `&name;` resolved by one table probe (see REF_KEYS).
    {
      let j = start, h = 0x811c9dc5 | 0;
      const lim = Math.min(len, start + MAX_NAMED_REF_LEN);
      while (j < lim) { const cc = input.charCodeAt(j); if (!isAsciiAlnum(cc)) break; h = Math.imul(h ^ cc, FNV); j++; }
      if (j < len && input.charCodeAt(j) === 0x3b) {
        h = Math.imul(h ^ 0x3b, FNV);
        const n = j + 1 - start;
        for (let slot = h & REF_MASK; ; slot = (slot + 1) & REF_MASK) {
          const key = REF_KEYS[slot];
          if (key.length === 0) break;
          if (key.length === n) {
            let k = 0;
            while (k < n && input.charCodeAt(start + k) === key.charCodeAt(k)) k++;
            if (k === n) { this.appendCharRef(REF_VALS[slot]); this.i = j + 1; this.state = this.returnState; return true; }
          }
        }
      }
    }
    let matchLen = 0, matchValue = '';
    let node = ENTITY_TRIE;
    for (let k = 0; k < MAX_NAMED_REF_LEN && start + k < len; k++) {
      const cc = input.charCodeAt(start + k);
      if (!isAsciiAlnum(cc) && cc !== 0x3b) break;
      const child = node.next.get(cc);
      if (child === undefined) break;
      node = child;
      if (child.v !== undefined) { matchValue = child.v; matchLen = k + 1; }
      /* v8 ignore next -- a ';' child means run+';' is a key, which the fast path above already resolved */
      if (cc === 0x3b) break;
    }
    if (matchLen > 0) {
      const endsWithSemi = input.charCodeAt(start + matchLen - 1) === 0x3b;
      const nextCh = start + matchLen < len ? input.charCodeAt(start + matchLen) : -1;
      // Attribute special case: a name without ';' followed by '=' or alnum is
      // NOT a reference — flush the consumed chars literally.
      if (this.inAttr() && !endsWithSemi && (nextCh === 0x3d || isAsciiAlnum(nextCh))) {
        this.appendCharRef('&' + input.slice(start, start + matchLen));
        this.i += matchLen;
        this.state = this.returnState;
        return true;
      }
      this.appendCharRef(matchValue);
      this.i += matchLen;
      this.state = this.returnState;
      return true;
    }
    // No match → flush '&' and reprocess from current position as ambiguous amp.
    this.appendCharRef('&');
    this.state = S.AmbiguousAmp;
    return true;
  }
}
