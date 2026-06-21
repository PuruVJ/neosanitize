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

const isWs = (c: number) => c === 0x09 || c === 0x0a || c === 0x0c || c === 0x20;
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
const foldAsciiUpper = (s: string): string =>
  s.replace(ASCII_UPPER_G, (m) => String.fromCharCode(m.charCodeAt(0) | 0x20));

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

const STATE_FROM_CONTENT: Record<ContentState, number> = {
  data: S.Data, rcdata: S.RCDATA, rawtext: S.RAWTEXT,
  scriptData: S.ScriptData, plaintext: S.PLAINTEXT, cdata: S.CdataSection
};

export interface TokenizeOptions {
  state?: ContentState;
  /** Appropriate end-tag name, for RCDATA/RAWTEXT/script end-tag matching. */
  lastStartTag?: string;
}

export class Tokenizer {
  private readonly input: string;
  private readonly len: number;
  private i = 0;
  private state: number;
  private returnState: number = S.Data;
  // Emit queue. A single `step()` emits at most two tokens (a buffered text run
  // flushed ahead of a tag/comment/doctype), so two slots replace an array+shift
  // on the hot path. `e0` is the next token out; `e1` is the carry.
  private e0: Token | null = null;
  private e1: Token | null = null;
  private done = false;
  private foreignFlag = false;
  private lastStartTag: string;

  // current token scratch
  private tagName = '';
  private tagIsEnd = false;
  private tagSelfClosing = false;
  private attrs: Array<[string, string]> = [];
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
    // WHATWG input-stream preprocessing: normalize CR and CRLF to LF.
    const normalized = input.indexOf('\r') === -1 ? input : input.replace(/\r\n?/g, '\n');
    this.input = normalized;
    this.len = normalized.length;
    this.state = STATE_FROM_CONTENT[opts.state ?? 'data'];
    this.lastStartTag = opts.lastStartTag ?? '';
  }

  /**
   * Pull one token. Returns null at end of input. The tree builder calls this in
   * a loop, switching the content-model state (`setContentState`) between pulls —
   * exactly the tokenizer↔tree-construction coupling the WHATWG spec requires.
   */
  nextToken(): Token | null {
    while (this.e0 === null && !this.done) {
      const eof = this.i >= this.len;
      const c = eof ? -1 : this.input.charCodeAt(this.i);
      if (!this.step(c, eof)) {
        this.done = true;
        this.flushChars();
        this.push({ type: 'eof' }); // explicit EOF so the tree builder finalizes
      }
    }
    const t = this.e0;
    this.e0 = this.e1;
    this.e1 = null;
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
    this.attrs = [];
  }
  private startEndTag() {
    this.startTag();
    this.tagIsEnd = true;
  }
  private addAttr() {
    const name = this.attrName;
    if (name) {
      // first occurrence wins (per spec, duplicates are dropped). Plain loop,
      // not `.some(closure)`, to avoid a closure allocation per attribute.
      const attrs = this.attrs;
      let dup = false;
      for (let k = 0; k < attrs.length; k++) { if (attrs[k][0] === name) { dup = true; break; } }
      if (!dup) attrs.push([name, this.attrValue]);
    }
    this.attrName = '';
    this.attrValue = '';
  }
  private emitTag() {
    this.addAttr();
    if (!this.tagIsEnd) this.lastStartTag = this.tagName;
    const k = this.rtag;
    k.type = this.tagIsEnd ? 'endTag' : 'startTag';
    k.name = this.tagName;
    k.attrs = this.attrs;
    k.selfClosing = this.tagSelfClosing;
    this.emit(k);
  }
  private appropriateEndTag(): boolean {
    return this.tagIsEnd && this.tagName === this.lastStartTag;
  }

  private reconsume(state: number, c: number, eof: boolean): boolean {
    this.state = state;
    return this.step(c, eof);
  }

  // --- the state machine ----------------------------------------------------
  // Returns false to stop (EOF terminal); true to continue. `i` is advanced by
  // each state unless it reconsumes.
  private step(c: number, eof: boolean): boolean {
    switch (this.state) {
      // Text states bulk-scan each run to the next boundary char and append it as
      // ONE slice (instead of step()+charBuf+= per character) — the dominant
      // tokenizer cost on text-heavy input. Behavior-identical: same chars, NUL
      // handling, and state transition on the boundary char.
      case S.Data: {
        if (eof) return false;
        if (c !== 0x26 && c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x26 || cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x26) { this.returnState = S.Data; this.state = S.CharRef; }
        else if (c === 0x3c) this.state = S.TagOpen;
        else this.emitChar(this.input[this.i - 1]); // c === 0 -> emit U+0000
        return true;
      }

      case S.RCDATA: {
        if (eof) return false;
        if (c !== 0x26 && c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x26 || cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x26) { this.returnState = S.RCDATA; this.state = S.CharRef; }
        else if (c === 0x3c) this.state = S.RCDATALt;
        else this.emitChar(REPLACEMENT); // c === 0
        return true;
      }

      case S.RAWTEXT: {
        if (eof) return false;
        if (c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x3c) this.state = S.RAWTEXTLt;
        else this.emitChar(REPLACEMENT); // c === 0
        return true;
      }

      case S.ScriptData: {
        if (eof) return false;
        if (c !== 0x3c && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x3c || cc === 0) break; j++; }
          this.charBuf += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x3c) this.state = S.ScriptLt;
        else this.emitChar(REPLACEMENT); // c === 0
        return true;
      }

      case S.PLAINTEXT: {
        if (eof) return false;
        if (c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { if (input.charCodeAt(j) === 0) break; j++; }
          this.charBuf += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        this.emitChar(REPLACEMENT); // c === 0
        return true;
      }

      case S.TagOpen:
        if (eof) { this.emitChar('<'); return false; }
        if (c === 0x21) { this.i++; this.state = S.MarkupDeclOpen; }
        else if (c === 0x2f) { this.i++; this.state = S.EndTagOpen; }
        else if (isAsciiAlpha(c)) { this.startTag(); this.state = S.TagName; }
        else if (c === 0x3f) { this.comment = ''; this.state = S.BogusComment; }
        else { this.emitChar('<'); this.state = S.Data; }
        return true;

      case S.EndTagOpen:
        if (eof) { this.emitChar('<'); this.emitChar('/'); return false; }
        if (isAsciiAlpha(c)) { this.startEndTag(); this.state = S.TagName; }
        else if (c === 0x3e) { this.i++; this.state = S.Data; }
        else { this.comment = ''; this.state = S.BogusComment; }
        return true;

      case S.TagName: {
        if (eof) return false;
        if (!isWs(c) && c !== 0x2f && c !== 0x3e && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1, up = c >= 0x41 && c <= 0x5a;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x2f || cc === 0x3e || cc === 0) break; if (cc >= 0x41 && cc <= 0x5a) up = true; j++; }
          const run = input.slice(this.i, j); this.tagName += up ? foldAsciiUpper(run) : run; this.i = j; return true;
        }
        this.i++;
        if (isWs(c)) this.state = S.BeforeAttrName;
        else if (c === 0x2f) this.state = S.SelfClosing;
        else if (c === 0x3e) { this.state = S.Data; this.emitTag(); }
        else this.tagName += REPLACEMENT; // c === 0
        return true;
      }

      // RCDATA / RAWTEXT / Script less-than + end-tag (shared shape) ----------
      case S.RCDATALt:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.RCDATAEndTagOpen; }
        else { this.emitChar('<'); this.state = S.RCDATA; }
        return true;
      case S.RCDATAEndTagOpen:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.RCDATAEndTagName; }
        else { this.emitChar('</'); this.state = S.RCDATA; }
        return true;
      case S.RCDATAEndTagName:
        return this.endTagNameState(c, eof, S.RCDATA);

      case S.RAWTEXTLt:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.RAWTEXTEndTagOpen; }
        else { this.emitChar('<'); this.state = S.RAWTEXT; }
        return true;
      case S.RAWTEXTEndTagOpen:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.RAWTEXTEndTagName; }
        else { this.emitChar('</'); this.state = S.RAWTEXT; }
        return true;
      case S.RAWTEXTEndTagName:
        return this.endTagNameState(c, eof, S.RAWTEXT);

      case S.ScriptLt:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.ScriptEndTagOpen; return true; }
        if (!eof && c === 0x21) { this.i++; this.emitChar('<!'); this.state = S.ScriptEscapeStart; return true; }
        this.emitChar('<'); this.state = S.ScriptData;
        return true;
      case S.ScriptEndTagOpen:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); this.state = S.ScriptEndTagName; }
        else { this.emitChar('</'); this.state = S.ScriptData; }
        return true;
      case S.ScriptEndTagName:
        return this.endTagNameState(c, eof, S.ScriptData);

      // Script-data escaped / double-escaped (handles <script> with <!-- --> and
      // nested <script>; correct </script> boundary detection is security-relevant).
      case S.ScriptEscapeStart:
        if (!eof && c === 0x2d) { this.i++; this.emitChar('-'); this.state = S.ScriptEscapeStartDash; return true; }
        return this.reconsume(S.ScriptData, c, eof);
      case S.ScriptEscapeStartDash:
        if (!eof && c === 0x2d) { this.i++; this.emitChar('-'); this.state = S.ScriptEscapedDashDash; return true; }
        return this.reconsume(S.ScriptData, c, eof);
      case S.ScriptEscaped:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptEscapedDash; }
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]);
        return true;
      case S.ScriptEscapedDash:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptEscapedDashDash; }
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptEscaped; }
        return true;
      case S.ScriptEscapedDashDash:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) this.emitChar('-');
        else if (c === 0x3c) this.state = S.ScriptEscapedLt;
        else if (c === 0x3e) { this.emitChar('>'); this.state = S.ScriptData; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptEscaped; }
        return true;
      case S.ScriptEscapedLt:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.state = S.ScriptEscapedEndTagOpen; return true; }
        if (!eof && isAsciiAlpha(c)) { this.tempBuf = ''; this.emitChar('<'); return this.reconsume(S.ScriptDoubleEscapeStart, c, eof); }
        this.emitChar('<');
        return this.reconsume(S.ScriptEscaped, c, eof);
      case S.ScriptEscapedEndTagOpen:
        if (!eof && isAsciiAlpha(c)) { this.startEndTag(); return this.reconsume(S.ScriptEscapedEndTagName, c, eof); }
        this.emitChar('</');
        return this.reconsume(S.ScriptEscaped, c, eof);
      case S.ScriptEscapedEndTagName:
        return this.endTagNameState(c, eof, S.ScriptEscaped);
      case S.ScriptDoubleEscapeStart:
        if (!eof && (isWs(c) || c === 0x2f || c === 0x3e)) { this.i++; this.emitChar(this.input[this.i - 1]); this.state = this.tempBuf === 'script' ? S.ScriptDoubleEscaped : S.ScriptEscaped; return true; }
        if (!eof && isAsciiAlpha(c)) { this.i++; this.tempBuf += String.fromCharCode(toLowerCh(c)); this.emitChar(this.input[this.i - 1]); return true; }
        return this.reconsume(S.ScriptEscaped, c, eof);
      case S.ScriptDoubleEscaped:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptDoubleEscapedDash; }
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]);
        return true;
      case S.ScriptDoubleEscapedDash:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) { this.emitChar('-'); this.state = S.ScriptDoubleEscapedDashDash; }
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptDoubleEscaped; }
        return true;
      case S.ScriptDoubleEscapedDashDash:
        if (eof) return false;
        this.i++;
        if (c === 0x2d) this.emitChar('-');
        else if (c === 0x3c) { this.emitChar('<'); this.state = S.ScriptDoubleEscapedLt; }
        else if (c === 0x3e) { this.emitChar('>'); this.state = S.ScriptData; }
        else { this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1]); this.state = S.ScriptDoubleEscaped; }
        return true;
      case S.ScriptDoubleEscapedLt:
        if (!eof && c === 0x2f) { this.i++; this.tempBuf = ''; this.emitChar('/'); this.state = S.ScriptDoubleEscapeEnd; return true; }
        return this.reconsume(S.ScriptDoubleEscaped, c, eof);
      case S.ScriptDoubleEscapeEnd:
        if (!eof && (isWs(c) || c === 0x2f || c === 0x3e)) { this.i++; this.emitChar(this.input[this.i - 1]); this.state = this.tempBuf === 'script' ? S.ScriptEscaped : S.ScriptDoubleEscaped; return true; }
        if (!eof && isAsciiAlpha(c)) { this.i++; this.tempBuf += String.fromCharCode(toLowerCh(c)); this.emitChar(this.input[this.i - 1]); return true; }
        return this.reconsume(S.ScriptDoubleEscaped, c, eof);

      // Attributes -----------------------------------------------------------
      case S.BeforeAttrName:
        if (eof || c === 0x2f || c === 0x3e) return this.reconsume(S.AfterAttrName, c, eof);
        if (isWs(c)) { this.i++; return true; }
        this.addAttr();
        // `=` here starts an attribute whose name begins with '=' (parse error).
        if (c === 0x3d) { this.i++; this.attrName = '='; this.state = S.AttrName; return true; }
        return this.reconsume(S.AttrName, c, eof);
      case S.AttrName: {
        if (eof || isWs(c) || c === 0x2f || c === 0x3e) return this.reconsume(S.AfterAttrName, c, eof);
        if (c !== 0x3d && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1, up = c >= 0x41 && c <= 0x5a;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x2f || cc === 0x3e || cc === 0x3d || cc === 0) break; if (cc >= 0x41 && cc <= 0x5a) up = true; j++; }
          const run = input.slice(this.i, j); this.attrName += up ? foldAsciiUpper(run) : run; this.i = j; return true;
        }
        this.i++;
        if (c === 0x3d) this.state = S.BeforeAttrValue;
        else this.attrName += REPLACEMENT; // c === 0
        return true;
      }
      case S.AfterAttrName:
        if (eof) return false;
        if (isWs(c)) { this.i++; return true; }
        if (c === 0x2f) { this.i++; this.state = S.SelfClosing; return true; }
        if (c === 0x3d) { this.i++; this.state = S.BeforeAttrValue; return true; }
        if (c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); return true; }
        this.addAttr();
        this.state = S.AttrName; // reconsume c in AttrName (handles NUL→FFFD, lowercasing)
        return true;
      case S.BeforeAttrValue:
        if (!eof && isWs(c)) { this.i++; return true; }
        if (!eof && c === 0x22) { this.i++; this.state = S.AttrValueDq; }
        else if (!eof && c === 0x27) { this.i++; this.state = S.AttrValueSq; }
        else if (!eof && c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); }
        else return this.reconsume(S.AttrValueUq, c, eof);
        return true;
      // Attribute values are copied verbatim (no case-folding), so each run
      // bulk-slices to the next boundary char in one go — like the text states.
      case S.AttrValueDq: {
        if (eof) return false;
        if (c !== 0x22 && c !== 0x26 && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x22 || cc === 0x26 || cc === 0) break; j++; }
          this.attrValue += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x22) this.state = S.AfterAttrValueQuoted;
        else if (c === 0x26) { this.returnState = S.AttrValueDq; this.state = S.CharRef; }
        else this.attrValue += REPLACEMENT; // c === 0
        return true;
      }
      case S.AttrValueSq: {
        if (eof) return false;
        if (c !== 0x27 && c !== 0x26 && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x27 || cc === 0x26 || cc === 0) break; j++; }
          this.attrValue += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (c === 0x27) this.state = S.AfterAttrValueQuoted;
        else if (c === 0x26) { this.returnState = S.AttrValueSq; this.state = S.CharRef; }
        else this.attrValue += REPLACEMENT; // c === 0
        return true;
      }
      case S.AttrValueUq: {
        if (eof) return false;
        if (!isWs(c) && c !== 0x26 && c !== 0x3e && c !== 0) {
          const input = this.input, len = this.len; let j = this.i + 1;
          while (j < len) { const cc = input.charCodeAt(j); if (cc === 0x09 || cc === 0x0a || cc === 0x0c || cc === 0x20 || cc === 0x26 || cc === 0x3e || cc === 0) break; j++; }
          this.attrValue += input.slice(this.i, j); this.i = j; return true;
        }
        this.i++;
        if (isWs(c)) this.state = S.BeforeAttrName;
        else if (c === 0x26) { this.returnState = S.AttrValueUq; this.state = S.CharRef; }
        else if (c === 0x3e) { this.state = S.Data; this.emitTag(); }
        else this.attrValue += REPLACEMENT; // c === 0
        return true;
      }
      case S.AfterAttrValueQuoted:
        if (eof) return false;
        if (isWs(c)) { this.i++; this.state = S.BeforeAttrName; }
        else if (c === 0x2f) { this.i++; this.state = S.SelfClosing; }
        else if (c === 0x3e) { this.i++; this.state = S.Data; this.emitTag(); }
        else return this.reconsume(S.BeforeAttrName, c, eof);
        return true;
      case S.SelfClosing:
        if (eof) return false;
        if (c === 0x3e) { this.i++; this.tagSelfClosing = true; this.state = S.Data; this.emitTag(); return true; }
        this.state = S.BeforeAttrName; // reconsume c
        return true;

      // Comments / markup declaration ----------------------------------------
      case S.BogusComment:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        this.i++;
        if (c === 0x3e) { this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; }
        else this.comment += c === 0 ? REPLACEMENT : this.input[this.i - 1];
        return true;
      case S.MarkupDeclOpen:
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
        return true;
      case S.CommentStart:
        if (!eof && c === 0x2d) { this.i++; this.state = S.CommentStartDash; }
        else if (!eof && c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; }
        else return this.reconsume(S.Comment, c, eof);
        return true;
      case S.CommentStartDash:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        if (c === 0x2d) { this.i++; this.state = S.CommentEnd; return true; }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; return true; }
        this.comment += '-';
        this.state = S.Comment; // reconsume c (no advance)
        return true;
      case S.Comment:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        this.i++;
        if (c === 0x2d) this.state = S.CommentEndDash;
        else if (c === 0) this.comment += REPLACEMENT;
        else this.comment += this.input[this.i - 1];
        return true;
      case S.CommentEndDash:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        if (c === 0x2d) { this.i++; this.state = S.CommentEnd; return true; }
        this.comment += '-';
        this.state = S.Comment; // reconsume c
        return true;
      case S.CommentEnd:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; return true; }
        if (c === 0x21) { this.i++; this.state = S.CommentEndBang; return true; }
        if (c === 0x2d) { this.i++; this.comment += '-'; return true; }
        this.comment += '--';
        this.state = S.Comment; // reconsume c
        return true;
      case S.CommentEndBang:
        if (eof) { this.emit({ type: 'comment', data: this.comment }); return false; }
        if (c === 0x2d) { this.i++; this.comment += '--!'; this.state = S.CommentEndDash; return true; }
        if (c === 0x3e) { this.i++; this.emit({ type: 'comment', data: this.comment }); this.state = S.Data; return true; }
        this.comment += '--!';
        this.state = S.Comment; // reconsume c
        return true;

      // DOCTYPE --------------------------------------------------------------
      case S.Doctype:
        if (eof) { this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; this.state = S.BeforeDoctypeName; }
        else return this.reconsume(S.BeforeDoctypeName, c, eof);
        return true;
      case S.BeforeDoctypeName:
        if (eof) { this.dn = null; this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; return true; }
        this.i++;
        if (c === 0x3e) { this.dn = null; this.dquirks = true; this.emitDoctype(true); this.state = S.Data; return true; }
        this.dn = c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c));
        this.dpub = this.dsys = null; this.dquirks = false;
        this.state = S.DoctypeName;
        return true;
      case S.DoctypeName:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        this.i++;
        if (isWs(c)) this.state = S.AfterDoctypeName;
        else if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else this.dn += c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c));
        return true;
      case S.AfterDoctypeName:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; return true; }
        if (c === 0x3e) { this.i++; this.state = S.Data; this.emitDoctype(false); return true; }
        if (/^public/i.test(this.input.substr(this.i, 6))) { this.i += 6; this.state = S.AfterDoctypePublicKw; }
        else if (/^system/i.test(this.input.substr(this.i, 6))) { this.i += 6; this.state = S.AfterDoctypeSystemKw; }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        return true;
      case S.AfterDoctypePublicKw:
      case S.BeforeDoctypePublicId:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypePublicKw) this.state = S.BeforeDoctypePublicId; return true; }
        this.i++;
        if (c === 0x22) { this.dpub = ''; this.state = S.DoctypePublicIdDq; }
        else if (c === 0x27) { this.dpub = ''; this.state = S.DoctypePublicIdSq; }
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        return true;
      case S.DoctypePublicIdDq:
      case S.DoctypePublicIdSq: {
        const q = this.state === S.DoctypePublicIdDq ? 0x22 : 0x27;
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        this.i++;
        if (c === q) this.state = S.AfterDoctypePublicId;
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else this.dpub = this.dpub! + (c === 0 ? REPLACEMENT : this.input[this.i - 1]); // dpub set to '' on entry (648/649)
        return true;
      }
      case S.AfterDoctypePublicId:
      case S.BetweenDoctypePublicSystem:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypePublicId) this.state = S.BetweenDoctypePublicSystem; return true; }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else if (c === 0x22) { this.dsys = ''; this.state = S.DoctypeSystemIdDq; }
        else if (c === 0x27) { this.dsys = ''; this.state = S.DoctypeSystemIdSq; }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        return true;
      case S.AfterDoctypeSystemKw:
      case S.BeforeDoctypeSystemId:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; if (this.state === S.AfterDoctypeSystemKw) this.state = S.BeforeDoctypeSystemId; return true; }
        this.i++;
        if (c === 0x22) { this.dsys = ''; this.state = S.DoctypeSystemIdDq; }
        else if (c === 0x27) { this.dsys = ''; this.state = S.DoctypeSystemIdSq; }
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else { this.dquirks = true; this.state = S.BogusDoctype; }
        return true;
      case S.DoctypeSystemIdDq:
      case S.DoctypeSystemIdSq: {
        const q = this.state === S.DoctypeSystemIdDq ? 0x22 : 0x27;
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        this.i++;
        if (c === q) this.state = S.AfterDoctypeSystemId;
        else if (c === 0x3e) { this.dquirks = true; this.state = S.Data; this.emitDoctype(true); }
        else this.dsys = this.dsys! + (c === 0 ? REPLACEMENT : this.input[this.i - 1]); // dsys set to '' on entry (669/670/678/679)
        return true;
      }
      case S.AfterDoctypeSystemId:
        if (eof) { this.dquirks = true; this.emitDoctype(true); return false; }
        if (isWs(c)) { this.i++; return true; }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(false); }
        else this.state = S.BogusDoctype;
        return true;
      case S.BogusDoctype:
        if (eof) { this.emitDoctype(this.dquirks); return false; }
        this.i++;
        if (c === 0x3e) { this.state = S.Data; this.emitDoctype(this.dquirks); }
        return true;

      // CDATA ----------------------------------------------------------------
      case S.CdataSection:
        if (eof) return false;
        this.i++;
        if (c === 0x5d) this.state = S.CdataSectionBracket;
        else this.emitChar(this.input[this.i - 1]);
        return true;
      case S.CdataSectionBracket:
        if (!eof && c === 0x5d) { this.i++; this.state = S.CdataSectionEnd; }
        else { this.emitChar(']'); return this.reconsume(S.CdataSection, c, eof); }
        return true;
      case S.CdataSectionEnd:
        if (!eof && c === 0x5d) { this.i++; this.emitChar(']'); return true; }
        if (!eof && c === 0x3e) { this.i++; this.state = S.Data; return true; }
        this.emitChar(']]'); return this.reconsume(S.CdataSection, c, eof);

      // Character references -------------------------------------------------
      case S.CharRef:
        this.tempBuf = '&';
        if (!eof && isAsciiAlnum(c)) return this.reconsume(S.NamedCharRef, c, eof);
        if (!eof && c === 0x23) { this.i++; this.tempBuf += '#'; this.state = S.NumericCharRef; return true; }
        this.flushTempToCharRefTarget();
        return this.reconsume(this.returnState, c, eof);
      case S.NamedCharRef:
        return this.namedCharRefState();
      case S.AmbiguousAmp:
        if (!eof && isAsciiAlnum(c)) { this.i++; this.appendCharRef(this.input[this.i - 1]); return true; }
        return this.reconsume(this.returnState, c, eof);
      case S.NumericCharRef:
        this.charRefCode = 0;
        if (!eof && (c === 0x78 || c === 0x58)) { this.i++; this.tempBuf += this.input[this.i - 1]; this.state = S.HexStart; }
        else this.state = S.DecStart;
        return true;
      case S.HexStart:
        if (!eof && isHexDigit(c)) return this.reconsume(S.HexRef, c, eof);
        this.flushTempToCharRefTarget();
        return this.reconsume(this.returnState, c, eof);
      case S.DecStart:
        if (!eof && c >= 0x30 && c <= 0x39) return this.reconsume(S.DecRef, c, eof);
        this.flushTempToCharRefTarget();
        return this.reconsume(this.returnState, c, eof);
      case S.HexRef:
        if (!eof && isHexDigit(c)) {
          this.i++;
          const d = c <= 0x39 ? c - 0x30 : (toLowerCh(c) - 0x61 + 10);
          this.charRefCode = this.charRefCode * 16 + d;
          return true;
        }
        if (!eof && c === 0x3b) this.i++;
        this.state = S.NumericEnd;
        return true;
      case S.DecRef:
        if (!eof && c >= 0x30 && c <= 0x39) { this.i++; this.charRefCode = this.charRefCode * 10 + (c - 0x30); return true; }
        if (!eof && c === 0x3b) this.i++;
        this.state = S.NumericEnd;
        return true;
      case S.NumericEnd: {
        // Does NOT consume: process the accumulated code and switch to the return
        // state; the next loop iteration reads the next char fresh.
        let code = this.charRefCode;
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
        else if (C1[code] !== undefined) code = C1[code];
        this.appendCharRef(String.fromCodePoint(code));
        this.state = this.returnState;
        return true;
      }

      /* v8 ignore next 2 -- unreachable: every state id 0..75 has a case above */
      default:
        return false;
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
    return this.reconsume(rawState, c, eof);
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
    let matchLen = 0, matchValue = '';
    let node = ENTITY_TRIE;
    for (let k = 0; k < MAX_NAMED_REF_LEN && start + k < len; k++) {
      const cc = input.charCodeAt(start + k);
      if (!isAsciiAlnum(cc) && cc !== 0x3b) break;
      const child = node.next.get(cc);
      if (child === undefined) break;
      node = child;
      if (child.v !== undefined) { matchValue = child.v; matchLen = k + 1; }
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
