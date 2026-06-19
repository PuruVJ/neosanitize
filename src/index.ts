/**
 * sanitize-html: zero-dependency TypeScript rewrite.
 * Public API matches the original (apostrophecms/sanitize-html).
 */

// =============================================================================
// Public types
// =============================================================================

export type Attributes = Record<string, string>;

export interface AllowedAttributeObject {
  name: string;
  multiple?: boolean;
  values: string[];
}

export type AllowedAttribute = string | AllowedAttributeObject;

export type DisallowedTagsMode =
  | 'discard'
  | 'escape'
  | 'recursiveEscape'
  | 'completelyDiscard';

export interface IFrame {
  tag: string;
  attribs: Attributes;
  text: string;
  tagPosition: number;
  mediaChildren: string[];
  /** Set by transformTags when the transformer returns `text`. */
  innerText?: string;
  /** Set when the transformer changed the tag name. */
  name?: string;
}

export interface TransformResult {
  tagName: string;
  attribs: Attributes;
  text?: string;
}

export type Transformer = (
  tagName: string,
  attribs: Attributes
) => TransformResult;

export interface ParserOptions {
  decodeEntities?: boolean;
  lowerCaseTags?: boolean;
  lowerCaseAttributeNames?: boolean;
}

export interface AllowedStyles {
  [tagOrStar: string]: { [property: string]: RegExp[] };
}

export interface IOptions {
  allowedTags?: string[] | false | null;
  disallowedTagsMode?: DisallowedTagsMode;
  allowedAttributes?: Record<string, AllowedAttribute[]> | false | null;
  allowedClasses?: Record<string, Array<string | RegExp> | false>;
  allowedStyles?: AllowedStyles;
  allowedSchemes?: string[];
  allowedSchemesByTag?: Record<string, string[]>;
  allowedSchemesAppliedToAttributes?: string[];
  allowProtocolRelative?: boolean;
  allowedIframeHostnames?: string[];
  allowedIframeDomains?: string[];
  allowIframeRelativeUrls?: boolean;
  allowedScriptHostnames?: string[];
  allowedScriptDomains?: string[];
  allowVulnerableTags?: boolean;
  enforceHtmlBoundary?: boolean;
  parseStyleAttributes?: boolean;
  preserveEscapedAttributes?: boolean;
  selfClosing?: string[];
  nonTextTags?: string[];
  nonBooleanAttributes?: string[];
  allowedEmptyAttributes?: string[];
  transformTags?: Record<string, string | Transformer>;
  textFilter?: (text: string, tagName?: string) => string;
  exclusiveFilter?: (frame: IFrame) => boolean | 'excludeTag';
  onOpenTag?: (name: string, attribs: Attributes) => void;
  onCloseTag?: (name: string, isImplied: boolean) => void;
  nestingLimit?: number;
  parser?: ParserOptions;
}

export interface Defaults {
  allowedTags: string[];
  nonBooleanAttributes: string[];
  disallowedTagsMode: DisallowedTagsMode;
  allowedAttributes: Record<string, AllowedAttribute[]>;
  allowedEmptyAttributes: string[];
  selfClosing: string[];
  allowedSchemes: string[];
  allowedSchemesByTag: Record<string, string[]>;
  allowedSchemesAppliedToAttributes: string[];
  allowProtocolRelative: boolean;
  enforceHtmlBoundary: boolean;
  parseStyleAttributes: boolean;
  preserveEscapedAttributes: boolean;
}

export interface SanitizeHtml {
  (
    html: string | number | null | undefined,
    options?: IOptions,
    _recursing?: boolean
  ): string;
  defaults: Defaults;
  simpleTransform: (
    newTagName: string,
    newAttribs?: Attributes,
    merge?: boolean
  ) => Transformer;
}

// =============================================================================
// Small helpers
// =============================================================================

function escapeStringRegexp(s: string): string {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
}

function deepmerge<A, B>(a: A, b: B): A | B | (A & B) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (a as unknown[]).concat(b as unknown[]) as unknown as A & B;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a as object)) out[k] = (a as Record<string, unknown>)[k];
    for (const k of Object.keys(b as object)) {
      if (k in out) out[k] = deepmerge(out[k], (b as Record<string, unknown>)[k]);
      else out[k] = (b as Record<string, unknown>)[k];
    }
    return out as unknown as A & B;
  }
  return (b === undefined ? a : b) as A | B;
}

function each<T>(
  obj: Record<string, T> | undefined | null,
  cb: (value: T, key: string) => void
): void {
  if (obj) {
    Object.keys(obj).forEach((key) => cb(obj[key], key));
  }
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function filter<T>(a: T[], cb: (v: T) => boolean): T[] {
  const n: T[] = [];
  for (const v of a) if (cb(v)) n.push(v);
  return n;
}

function isEmptyObject(obj: object): boolean {
  for (const key in obj) {
    if (has(obj, key)) return false;
  }
  return true;
}

// =============================================================================
// HTML entity decoding
// =============================================================================

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', AMP: '&',
  lt: '<', LT: '<',
  gt: '>', GT: '>',
  quot: '"', QUOT: '"',
  apos: "'", APOS: "'",
  nbsp: ' ',
  copy: '©', COPY: '©',
  reg: '®', REG: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  iexcl: '¡',
  cent: '¢',
  pound: '£',
  yen: '¥',
  euro: '€',
  sect: '§',
  para: '¶',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ'
};

const NUMERIC_REMAP: Record<number, number> = {
  0x00: 0xfffd,
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

function codePointToString(cp: number): string {
  if (cp in NUMERIC_REMAP) cp = NUMERIC_REMAP[cp];
  if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '�';
  }
}

interface EntityMatch {
  value: string;
  length: number;
}

function decodeEntity(input: string, i: number): EntityMatch | null {
  if (input[i] !== '&') return null;
  if (input[i + 1] === '#') {
    let j = i + 2;
    let hex = false;
    if (input[j] === 'x' || input[j] === 'X') { hex = true; j++; }
    const start = j;
    const re = hex ? /[0-9a-fA-F]/ : /[0-9]/;
    while (j < input.length && re.test(input[j])) j++;
    if (j === start) return null;
    const num = parseInt(input.substring(start, j), hex ? 16 : 10);
    let length = j - i;
    if (input[j] === ';') length++;
    return { value: codePointToString(num), length };
  }
  let j = i + 1;
  if (!/[a-zA-Z]/.test(input[j] || '')) return null;
  while (j < input.length && /[a-zA-Z0-9]/.test(input[j])) j++;
  if (input[j] !== ';') return null;
  const name = input.substring(i + 1, j);
  if (has(NAMED_ENTITIES, name)) {
    return { value: NAMED_ENTITIES[name], length: j - i + 1 };
  }
  return null;
}

function decodeEntitiesString(s: string): string {
  if (s.indexOf('&') === -1) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '&') {
      const r = decodeEntity(s, i);
      if (r) {
        out += r.value;
        i += r.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// =============================================================================
// Minimal HTML parser
// =============================================================================

const VOID_TAGS = new Set<string>([
  'area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr',
  'img', 'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source',
  'track', 'wbr'
]);

const RAW_TEXT_TAGS = new Set<string>([
  'script', 'style', 'textarea', 'xmp', 'title', 'noscript', 'noembed',
  'noframes', 'iframe', 'plaintext'
]);

const OPEN_IMPLIES_CLOSE: Record<string, Set<string>> = (() => {
  const m: Record<string, Set<string>> = {};
  const list = (tags: string[], closes: string[]) => {
    tags.forEach((t) => { m[t] = new Set(closes); });
  };
  const pClosers = [
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol',
    'p', 'pre', 'section', 'table', 'ul'
  ];
  list(pClosers, [ 'p' ]);
  m.li = new Set([ 'li' ]);
  m.dt = new Set([ 'dt', 'dd' ]);
  m.dd = new Set([ 'dt', 'dd' ]);
  m.rb = new Set([ 'rb', 'rt', 'rtc', 'rp' ]);
  m.rt = new Set([ 'rb', 'rt', 'rp' ]);
  m.rtc = new Set([ 'rb', 'rt', 'rtc', 'rp' ]);
  m.rp = new Set([ 'rb', 'rt', 'rp' ]);
  m.optgroup = new Set([ 'optgroup', 'option' ]);
  m.option = new Set([ 'option' ]);
  m.tbody = new Set([ 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th' ]);
  m.tfoot = new Set([ 'thead', 'tbody', 'tr', 'td', 'th' ]);
  m.thead = new Set([ 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th' ]);
  m.tr = new Set([ 'tr', 'td', 'th' ]);
  m.td = new Set([ 'td', 'th' ]);
  m.th = new Set([ 'td', 'th' ]);
  return m;
})();

const NAME_START_RE = /[A-Za-z]/;
const NAME_RE = /[A-Za-z0-9]/;
const ATTR_NAME_END_RE = /[\s/>=]/;
const WS_RE = /\s/;

interface ParserHandlers {
  onopentag?: (name: string, attribs: Attributes) => void;
  ontext?: (text: string) => void;
  onclosetag?: (name: string, isImplied: boolean) => void;
  oncomment?: (text: string) => void;
}

interface RawAttribute {
  name: string;
  value: string;
}

class Parser {
  private h: ParserHandlers;
  private lowerCaseTags: boolean;
  private lowerCaseAttribs: boolean;
  private decode: boolean;
  private input = '';
  endIndex = -1;
  private stack: string[] = [];

  constructor(handlers: ParserHandlers, opts: ParserOptions = {}) {
    this.h = handlers;
    this.lowerCaseTags = opts.lowerCaseTags !== false;
    this.lowerCaseAttribs = typeof opts.lowerCaseAttributeNames === 'boolean'
      ? opts.lowerCaseAttributeNames
      : this.lowerCaseTags;
    this.decode = opts.decodeEntities !== false;
  }

  private emitText(text: string, decodeOverride?: boolean): void {
    if (!text) return;
    if (this.decode && decodeOverride !== false) text = decodeEntitiesString(text);
    if (this.h.ontext) this.h.ontext(text);
  }

  private emitOpen(rawName: string, attribs: RawAttribute[], _selfClosing: boolean): void {
    const name = this.lowerCaseTags ? rawName.toLowerCase() : rawName;
    if (has(OPEN_IMPLIES_CLOSE, name)) {
      const closers = OPEN_IMPLIES_CLOSE[name];
      while (this.stack.length && closers.has(this.stack[this.stack.length - 1])) {
        const top = this.stack.pop()!;
        if (this.h.onclosetag) this.h.onclosetag(top, true);
      }
    }
    const attrObj: Attributes = {};
    for (const a of attribs) {
      const key = this.lowerCaseAttribs ? a.name.toLowerCase() : a.name;
      if (!(key in attrObj)) {
        attrObj[key] = this.decode ? decodeEntitiesString(a.value) : a.value;
      }
    }
    if (this.h.onopentag) this.h.onopentag(name, attrObj);
    // Per HTML5, only void tags auto-close on `/>`; the slash on a non-void
    // tag is silently ignored.
    if (VOID_TAGS.has(name)) {
      if (this.h.onclosetag) this.h.onclosetag(name, true);
      return;
    }
    this.stack.push(name);
  }

  private emitClose(rawName: string, isImplied: boolean): void {
    const name = this.lowerCaseTags ? rawName.toLowerCase() : rawName;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i] === name) {
        while (this.stack.length > i + 1) {
          const top = this.stack.pop()!;
          if (this.h.onclosetag) this.h.onclosetag(top, true);
        }
        this.stack.pop();
        if (this.h.onclosetag) this.h.onclosetag(name, !!isImplied);
        return;
      }
    }
    // Tag not on stack — drop the close event.
  }

  write(chunk: string): void {
    this.input += chunk;
  }

  end(): void {
    this.parse();
    while (this.stack.length) {
      const top = this.stack.pop()!;
      if (this.h.onclosetag) this.h.onclosetag(top, true);
    }
  }

  /** Single-pass tokenizer. Sets `endIndex` as it goes. */
  private parse(): void {
    const input = this.input;
    const len = input.length;
    let i = 0;
    let textStart = 0;
    this.endIndex = -1;

    const flushText = (until: number, decode?: boolean) => {
      if (until > textStart) {
        const text = input.substring(textStart, until);
        this.emitText(text, decode);
        this.endIndex = until;
      }
      textStart = until;
    };

    while (i < len) {
      if (input[i] !== '<') { i++; continue; }
      const next = input[i + 1];
      // Comment <!-- ... -->
      if (next === '!' && input.substr(i + 2, 2) === '--') {
        flushText(i);
        const end = input.indexOf('-->', i + 4);
        if (end === -1) return;
        if (this.h.oncomment) this.h.oncomment(input.substring(i + 4, end));
        i = end + 3;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // DOCTYPE / processing instruction / CDATA — bogus comment to next '>'.
      if (next === '!' || next === '?') {
        flushText(i);
        const end = input.indexOf('>', i + 2);
        if (end === -1) return;
        i = end + 1;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // Closing tag </name>
      if (next === '/') {
        flushText(i);
        let j = i + 2;
        if (j >= len) return;
        if (!NAME_START_RE.test(input[j])) {
          const end = input.indexOf('>', j);
          if (end === -1) return;
          i = end + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        const nameStart = j;
        while (j < len && !/[\s>/]/.test(input[j])) j++;
        const nameEnd = j;
        while (j < len && input[j] !== '>') j++;
        if (j >= len) return;
        const rawName = input.substring(nameStart, nameEnd);
        this.emitClose(rawName, false);
        i = j + 1;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // Opening tag <name ...>
      if (NAME_START_RE.test(next)) {
        flushText(i);
        const tokenStart = i;
        let j = i + 1;
        const nameStart = j;
        while (j < len && NAME_RE.test(input[j])) j++;
        const rawName = input.substring(nameStart, j);
        const attribs: RawAttribute[] = [];
        let selfClosing = false;
        let finished = false;
        while (j < len) {
          while (j < len && WS_RE.test(input[j])) j++;
          if (j >= len) break;
          const c = input[j];
          if (c === '>') { j++; finished = true; break; }
          if (c === '/') {
            j++;
            while (j < len && WS_RE.test(input[j])) j++;
            if (input[j] === '>') {
              selfClosing = true; j++; finished = true; break;
            }
            continue;
          }
          const attrNameStart = j;
          while (j < len && !ATTR_NAME_END_RE.test(input[j])) j++;
          const attrName = input.substring(attrNameStart, j);
          if (!attrName) {
            j++;
            continue;
          }
          while (j < len && WS_RE.test(input[j])) j++;
          let attrValue = '';
          if (input[j] === '=') {
            j++;
            while (j < len && WS_RE.test(input[j])) j++;
            if (input[j] === '"' || input[j] === "'") {
              const q = input[j];
              j++;
              const valStart = j;
              while (j < len && input[j] !== q) j++;
              attrValue = input.substring(valStart, j);
              if (input[j] === q) j++;
            } else {
              const valStart = j;
              while (j < len && !WS_RE.test(input[j]) && input[j] !== '>') j++;
              attrValue = input.substring(valStart, j);
            }
          }
          attribs.push({ name: attrName, value: attrValue });
        }
        if (!finished) {
          // Match htmlparser2 quirk: emit any `/` chars in the unfinished tag
          // as text. (e.g. `<div/` produces a `/` text event.)
          const unfinished = input.substring(tokenStart, len);
          if (unfinished.indexOf('/') !== -1) {
            const slashCount = (unfinished.match(/\//g) || []).length;
            for (let s = 0; s < slashCount; s++) this.emitText('/', false);
            this.endIndex = len;
            textStart = len;
            return;
          }
          textStart = tokenStart;
          return;
        }
        this.emitOpen(rawName, attribs, selfClosing);
        i = j;
        textStart = i;
        this.endIndex = i;

        const tagNameNorm = this.lowerCaseTags ? rawName.toLowerCase() : rawName;
        const rawNameLower = rawName.toLowerCase();
        if (!selfClosing && !VOID_TAGS.has(tagNameNorm) && RAW_TEXT_TAGS.has(rawNameLower)) {
          const lowerInput = input.toLowerCase();
          const closeNeedle = '</' + rawNameLower;
          let searchFrom = i;
          let found = -1;
          while (true) {
            const idx = lowerInput.indexOf(closeNeedle, searchFrom);
            if (idx === -1) break;
            const after = input.charAt(idx + closeNeedle.length);
            if (after === '' || after === '>' || after === '/' || WS_RE.test(after)) {
              found = idx;
              break;
            }
            searchFrom = idx + 1;
          }
          if (found === -1) {
            const raw = input.substring(i);
            if (raw) this.emitText(raw, false);
            this.endIndex = len;
            if (this.stack[this.stack.length - 1] === tagNameNorm) {
              this.stack.pop();
              if (this.h.onclosetag) this.h.onclosetag(tagNameNorm, true);
            }
            i = len;
            textStart = i;
            continue;
          }
          if (found > i) {
            const raw = input.substring(i, found);
            this.emitText(raw, false);
          }
          let k = found + closeNeedle.length;
          while (k < len && input[k] !== '>') k++;
          if (k >= len) {
            textStart = found;
            return;
          }
          this.emitClose(rawNameLower, false);
          i = k + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        continue;
      }
      // Stray `<` — emit as text, advance one char, keep parsing.
      flushText(i);
      this.emitText('<', false);
      i++;
      textStart = i;
      this.endIndex = i;
    }
    if (textStart < len) {
      const text = input.substring(textStart);
      this.emitText(text);
      this.endIndex = len;
    } else if (this.endIndex < 0) {
      this.endIndex = textStart;
    }
  }
}

// =============================================================================
// URL safety helper (replaces launder.naughtyHref)
// =============================================================================

function cleanHref(href: string): string {
  // eslint-disable-next-line no-control-regex
  href = href.replace(/[\x00-\x20]+/g, '');
  while (true) {
    const firstIndex = href.indexOf('<!--');
    if (firstIndex === -1) break;
    const lastIndex = href.indexOf('-->', firstIndex + 4);
    if (lastIndex === -1) break;
    href = href.substring(0, firstIndex) + href.substring(lastIndex + 3);
  }
  return href;
}

interface NaughtyHrefOptions {
  allowedSchemes?: string[];
  allowProtocolRelative?: boolean;
}

function naughtyHrefImpl(
  href: unknown,
  options: NaughtyHrefOptions = {}
): boolean {
  const allowedSchemes = options.allowedSchemes ||
    [ 'http', 'https', 'ftp', 'mailto', 'tel', 'sms' ];
  const allowProtocolRelative = options.allowProtocolRelative !== false;
  if (typeof href !== 'string') return false;
  href = cleanHref(href);
  const matches = (href as string).match(/^([a-zA-Z][a-zA-Z0-9.\-+]*):/);
  if (!matches) {
    if ((href as string).match(/^[/\\]{2}/)) return !allowProtocolRelative;
    return false;
  }
  const scheme = matches[1].toLowerCase();
  return allowedSchemes.indexOf(scheme) === -1;
}

// =============================================================================
// srcset parser (replaces parse-srcset)
// =============================================================================

interface SrcsetEntry {
  url: string;
  w?: number;
  h?: number;
  d?: number;
  evil?: boolean;
}

function parseSrcset(input: string): SrcsetEntry[] {
  const result: SrcsetEntry[] = [];
  const len = input.length;
  let i = 0;
  while (i < len) {
    while (i < len && /[\s,]/.test(input[i])) i++;
    if (i >= len) break;
    const urlStart = i;
    while (i < len && !/\s/.test(input[i])) i++;
    let url = input.substring(urlStart, i);
    let hadTrailingComma = false;
    while (url.endsWith(',')) {
      url = url.slice(0, -1);
      hadTrailingComma = true;
    }
    if (!url) continue;
    const entry: SrcsetEntry = { url };
    if (hadTrailingComma) {
      result.push(entry);
      continue;
    }
    let invalid = false;
    while (i < len) {
      while (i < len && /\s/.test(input[i])) i++;
      if (i >= len) break;
      if (input[i] === ',') { i++; break; }
      const descStart = i;
      while (i < len && input[i] !== ',' && !/\s/.test(input[i])) i++;
      const desc = input.substring(descStart, i);
      const m = /^([0-9]+(?:\.[0-9]+)?)([wxhWXH])$/.exec(desc);
      if (m) {
        const kind = m[2].toLowerCase();
        const key = kind === 'x' ? 'd' : kind;
        if (entry.w != null || entry.h != null || entry.d != null) {
          invalid = true;
        }
        (entry as unknown as Record<string, unknown>)[key] = parseFloat(m[1]);
      } else if (desc) {
        invalid = true;
      }
    }
    if (!invalid) result.push(entry);
  }
  return result;
}

function stringifySrcset(parsed: SrcsetEntry[]): string {
  return parsed.map((part) => {
    if (!part.url) throw new Error('URL missing');
    return (
      part.url +
      (part.w ? ` ${part.w}w` : '') +
      (part.h ? ` ${part.h}h` : '') +
      (part.d ? ` ${part.d}x` : '')
    );
  }).join(', ');
}

// =============================================================================
// Style attribute parser (replaces postcss)
// =============================================================================

interface StyleDecl {
  prop: string;
  value: string;
  important: boolean;
}

interface StyleRule {
  selector: string;
  nodes: StyleDecl[];
}

interface StyleAst {
  nodes: StyleRule[];
}

function parseStyleAst(name: string, value: string): StyleAst {
  const decls: StyleDecl[] = [];
  const len = value.length;
  let i = 0;
  while (i < len) {
    while (i < len && (value[i] === ';' || /\s/.test(value[i]))) i++;
    if (i >= len) break;
    const propStart = i;
    while (i < len && value[i] !== ':' && value[i] !== ';') i++;
    if (i >= len || value[i] === ';') {
      continue;
    }
    const prop = value.substring(propStart, i).trim();
    i++; // skip ':'
    while (i < len && /\s/.test(value[i])) i++;
    const valStart = i;
    let depth = 0;
    let inString: string | null = null;
    while (i < len) {
      const c = value[i];
      if (inString) {
        if (c === '\\' && i + 1 < len) { i += 2; continue; }
        if (c === inString) inString = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; i++; continue; }
      if (c === '(') { depth++; i++; continue; }
      if (c === ')') { if (depth > 0) depth--; i++; continue; }
      if (c === ';' && depth === 0) break;
      i++;
    }
    let val = value.substring(valStart, i).replace(/\s+$/, '');
    if (i < len && value[i] === ';') i++;
    let important = false;
    const impMatch = val.match(/(\s|^)!important\s*$/i);
    if (impMatch) {
      important = true;
      val = val.substring(0, impMatch.index).replace(/\s+$/, '');
    }
    if (prop && val !== '') {
      decls.push({ prop: prop.toLowerCase(), value: val, important });
    }
  }
  return { nodes: [ { selector: name, nodes: decls } ] };
}

// =============================================================================
// Main sanitizer
// =============================================================================

const mediaTags = [
  'img', 'audio', 'video', 'picture', 'svg',
  'object', 'map', 'iframe', 'embed'
];
const vulnerableTags = [ 'script', 'style' ];

const VALID_HTML_ATTRIBUTE_NAME = /^[^\0\t\n\f\r /<=>]+$/;

const htmlParserDefaults: ParserOptions = {
  decodeEntities: true
};

interface Frame {
  tag: string;
  attribs: Attributes;
  tagPosition: number;
  text: string;
  openingTagLength: number;
  mediaChildren: string[];
  innerText?: string;
  name?: string;
  updateParentNodeText: () => void;
  updateParentNodeMediaChildren: () => void;
}

const sanitizeHtmlFn = function sanitizeHtml(
  html: string | number | null | undefined,
  options?: IOptions,
  _recursing?: boolean
): string {
  if (html == null) return '';
  if (typeof html === 'number') html = html.toString();
  const inputHtml = html as string;

  let result = '';
  let tempResult = '';

  // Resolve options against defaults.
  const opts: Required<Defaults> & IOptions =
    Object.assign({}, sanitizeHtmlFn.defaults, options) as Required<Defaults> & IOptions;
  opts.parser = Object.assign({}, htmlParserDefaults, opts.parser);

  function makeFrame(tag: string, attribs: Attributes): Frame {
    const frame: Frame = {
      tag,
      attribs: attribs || {},
      tagPosition: result.length,
      text: '',
      openingTagLength: 0,
      mediaChildren: [],
      updateParentNodeText() {
        if (stack.length) {
          const parentFrame = stack[stack.length - 1];
          parentFrame.text += frame.text;
        }
      },
      updateParentNodeMediaChildren() {
        if (stack.length && mediaTags.includes(frame.tag)) {
          const parentFrame = stack[stack.length - 1];
          parentFrame.mediaChildren.push(frame.tag);
        }
      }
    };
    return frame;
  }

  const tagAllowed = (name: string | undefined): boolean => {
    if (opts.allowedTags === false) return true;
    return ((opts.allowedTags as string[] | undefined) || []).indexOf(name as string) > -1;
  };

  vulnerableTags.forEach((tag) => {
    if (tagAllowed(tag) && !opts.allowVulnerableTags) {
      // eslint-disable-next-line no-console
      console.warn(`\n\n⚠️ Your \`allowedTags\` option includes, \`${tag}\`, which is inherently\nvulnerable to XSS attacks. Please remove it from \`allowedTags\`.\nOr, to disable this warning, add the \`allowVulnerableTags\` option\nand ensure you are accounting for this risk.\n\n`);
    }
  });

  const nonTextTagsArray = opts.nonTextTags || [
    'script', 'style', 'textarea', 'option', 'xmp'
  ];

  let allowedAttributesMap: Record<string, AllowedAttribute[]> | undefined;
  let allowedAttributesGlobMap: Record<string, RegExp> | undefined;
  if (opts.allowedAttributes) {
    allowedAttributesMap = {};
    allowedAttributesGlobMap = {};
    each(opts.allowedAttributes as Record<string, AllowedAttribute[]>, (attributes, tag) => {
      allowedAttributesMap![tag] = [];
      const globRegex: string[] = [];
      attributes.forEach((obj) => {
        if (typeof obj === 'string' && obj.indexOf('*') >= 0) {
          globRegex.push(escapeStringRegexp(obj).replace(/\\\*/g, '.*'));
        } else {
          allowedAttributesMap![tag].push(obj);
        }
      });
      if (globRegex.length) {
        allowedAttributesGlobMap![tag] = new RegExp('^(' + globRegex.join('|') + ')$');
      }
    });
  }

  const allowedClassesMap: Record<string, string[] | false> = {};
  const allowedClassesGlobMap: Record<string, RegExp> = {};
  const allowedClassesRegexMap: Record<string, RegExp[]> = {};
  each(opts.allowedClasses, (classes, tag) => {
    if (allowedAttributesMap) {
      if (!has(allowedAttributesMap, tag)) {
        allowedAttributesMap[tag] = [];
      }
      allowedAttributesMap[tag].push('class');
    }
    allowedClassesMap[tag] = classes as string[] | false;
    if (Array.isArray(classes)) {
      const globRegex: string[] = [];
      allowedClassesMap[tag] = [];
      allowedClassesRegexMap[tag] = [];
      classes.forEach((obj) => {
        if (typeof obj === 'string' && obj.indexOf('*') >= 0) {
          globRegex.push(escapeStringRegexp(obj).replace(/\\\*/g, '.*'));
        } else if (obj instanceof RegExp) {
          allowedClassesRegexMap[tag].push(obj);
        } else {
          (allowedClassesMap[tag] as string[]).push(obj as string);
        }
      });
      if (globRegex.length) {
        allowedClassesGlobMap[tag] = new RegExp('^(' + globRegex.join('|') + ')$');
      }
    }
  });

  const transformTagsMap: Record<string, Transformer> = {};
  let transformTagsAll: Transformer | undefined;
  each(opts.transformTags, (transform, tag) => {
    let transFun: Transformer | undefined;
    if (typeof transform === 'function') {
      transFun = transform as Transformer;
    } else if (typeof transform === 'string') {
      transFun = sanitizeHtmlFn.simpleTransform(transform);
    }
    if (!transFun) return;
    if (tag === '*') transformTagsAll = transFun;
    else transformTagsMap[tag] = transFun;
  });

  let depth = 0;
  let stack: Frame[] = [];
  let skipMap: Record<number, boolean> = {};
  let transformMap: Record<number, string> = {};
  let skipText = false;
  let skipTextDepth = 0;
  let addedText = false;

  function initializeState(): void {
    result = '';
    depth = 0;
    stack = [];
    skipMap = {};
    transformMap = {};
    skipText = false;
    skipTextDepth = 0;
  }

  initializeState();

  function escapeHtml(s: string | number | undefined, quote?: boolean): string {
    let str = typeof s !== 'string' ? '' + s : s;
    if (opts.parser?.decodeEntities) {
      str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (quote) str = str.replace(/"/g, '&quot;');
    }
    str = str.replace(/&(?![a-zA-Z0-9#]{1,20};)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (quote) str = str.replace(/"/g, '&quot;');
    return str;
  }

  function naughtyHref(name: string, href: string): boolean {
    const allowedSchemes = has(opts.allowedSchemesByTag, name)
      ? opts.allowedSchemesByTag[name]
      : (opts.allowedSchemes || []);
    return naughtyHrefImpl(href, {
      allowedSchemes,
      allowProtocolRelative: opts.allowProtocolRelative
    });
  }

  interface ParsedUrlResult {
    isRelativeUrl: boolean;
    url: URL;
  }

  function parseUrl(value: string): ParsedUrlResult {
    value = value.replace(/^(\w+:)?\s*[\\/]\s*[\\/]/, '$1//');
    if (value.startsWith('relative:')) {
      throw new Error('relative: exploit attempt');
    }
    let base = 'relative://relative-site';
    for (let i = 0; i < 100; i++) base += `/${i}`;
    const parsed = new URL(value, base);
    const isRelativeUrl = !!parsed && parsed.hostname === 'relative-site' && parsed.protocol === 'relative:';
    return { isRelativeUrl, url: parsed };
  }

  function filterCss(ast: StyleAst, allowedStyles: AllowedStyles | undefined): StyleAst {
    if (!allowedStyles) return ast;
    const astRules = ast.nodes[0];
    let selectedRule: Record<string, RegExp[]> | undefined;
    if (allowedStyles[astRules.selector] && allowedStyles['*']) {
      selectedRule = deepmerge(
        allowedStyles[astRules.selector],
        allowedStyles['*']
      ) as Record<string, RegExp[]>;
    } else {
      selectedRule = allowedStyles[astRules.selector] || allowedStyles['*'];
    }
    if (selectedRule) {
      ast.nodes[0].nodes = astRules.nodes.reduce(filterDeclarations(selectedRule), [] as StyleDecl[]);
    }
    return ast;
  }

  function stringifyStyleAttributes(filteredAst: StyleAst): string {
    return filteredAst.nodes[0].nodes
      .reduce<string[]>((acc, decl) => {
        acc.push(`${decl.prop}:${decl.value}${decl.important ? ' !important' : ''}`);
        return acc;
      }, [])
      .join(';');
  }

  function filterDeclarations(selectedRule: Record<string, RegExp[]>) {
    return (acc: StyleDecl[], decl: StyleDecl): StyleDecl[] => {
      if (has(selectedRule, decl.prop)) {
        const matchesRegex = selectedRule[decl.prop].some((re) => re.test(decl.value));
        if (matchesRegex) acc.push(decl);
      }
      return acc;
    };
  }

  function filterClasses(
    classes: string,
    allowed: string[] | false | undefined,
    allowedGlobs: RegExp[]
  ): string {
    if (!allowed) return classes;
    return classes.split(/\s+/).filter((clss) => {
      return allowed.indexOf(clss) !== -1 ||
        allowedGlobs.some((glob) => glob.test(clss));
    }).join(' ');
  }

  const parser = new Parser({
    onopentag(name, attribs) {
      if (opts.onOpenTag) opts.onOpenTag(name, attribs);

      if (opts.enforceHtmlBoundary && name === 'html') {
        initializeState();
      }

      if (skipText) {
        skipTextDepth++;
        return;
      }

      const frame = makeFrame(name, attribs);
      stack.push(frame);

      let skip = false;
      const hasText = !!frame.text;
      let transformedTag: TransformResult | undefined;
      if (has(transformTagsMap, name)) {
        transformedTag = transformTagsMap[name](name, attribs);
        frame.attribs = attribs = transformedTag.attribs;
        if (transformedTag.text !== undefined) {
          frame.innerText = transformedTag.text;
        }
        if (name !== transformedTag.tagName) {
          frame.name = name = transformedTag.tagName;
          transformMap[depth] = transformedTag.tagName;
        }
      }
      if (transformTagsAll) {
        transformedTag = transformTagsAll(name, attribs);
        frame.attribs = attribs = transformedTag.attribs;
        if (name !== transformedTag.tagName) {
          frame.name = name = transformedTag.tagName;
          transformMap[depth] = transformedTag.tagName;
        }
      }

      if (!tagAllowed(name) ||
        (opts.disallowedTagsMode === 'recursiveEscape' && !isEmptyObject(skipMap)) ||
        (opts.nestingLimit != null && depth >= opts.nestingLimit)) {
        skip = true;
        skipMap[depth] = true;
        if (opts.disallowedTagsMode === 'discard' || opts.disallowedTagsMode === 'completelyDiscard') {
          if (nonTextTagsArray.indexOf(name) !== -1) {
            skipText = true;
            skipTextDepth = 1;
          }
        }
      }
      depth++;
      if (skip) {
        if (opts.disallowedTagsMode === 'discard' || opts.disallowedTagsMode === 'completelyDiscard') {
          if (frame.innerText && !hasText) {
            const escaped = escapeHtml(frame.innerText);
            if (opts.textFilter) result += opts.textFilter(escaped, name);
            else result += escaped;
            addedText = true;
          }
          return;
        }
        tempResult = result;
        result = '';
      }
      result += '<' + name;

      if (name === 'script') {
        if (opts.allowedScriptHostnames || opts.allowedScriptDomains) {
          frame.innerText = '';
        }
      }

      const isBeingEscaped = skip && (opts.disallowedTagsMode === 'escape' || opts.disallowedTagsMode === 'recursiveEscape');
      const shouldPreserveEscapedAttributes = isBeingEscaped && opts.preserveEscapedAttributes;

      if (shouldPreserveEscapedAttributes) {
        each(attribs, (value, a) => {
          result += ' ' + a + '="' + escapeHtml(value || '', true) + '"';
        });
      } else if (!allowedAttributesMap || has(allowedAttributesMap, name) || allowedAttributesMap['*']) {
        each(attribs, (value, a) => {
          if (!VALID_HTML_ATTRIBUTE_NAME.test(a)) {
            delete frame.attribs[a];
            return;
          }
          if (value === '' && (!opts.allowedEmptyAttributes.includes(a)) &&
            (opts.nonBooleanAttributes.includes(a) || opts.nonBooleanAttributes.includes('*'))) {
            delete frame.attribs[a];
            return;
          }
          let passedAllowedAttributesMapCheck = false;
          if (!allowedAttributesMap ||
            (has(allowedAttributesMap, name) && (allowedAttributesMap[name] as AllowedAttribute[]).indexOf(a) !== -1) ||
            (allowedAttributesMap['*'] && (allowedAttributesMap['*'] as AllowedAttribute[]).indexOf(a) !== -1) ||
            (allowedAttributesGlobMap && has(allowedAttributesGlobMap, name) && allowedAttributesGlobMap[name].test(a)) ||
            (allowedAttributesGlobMap && allowedAttributesGlobMap['*'] && allowedAttributesGlobMap['*'].test(a))) {
            passedAllowedAttributesMapCheck = true;
          } else if (allowedAttributesMap && allowedAttributesMap[name]) {
            for (const o of allowedAttributesMap[name]) {
              if (isPlainObject(o)) {
                const obj = o as unknown as AllowedAttributeObject;
                if (obj.name && obj.name === a) {
                  passedAllowedAttributesMapCheck = true;
                  let newValue = '';
                  if (obj.multiple === true) {
                    const parts = value.split(' ');
                    for (const s of parts) {
                      if (obj.values.indexOf(s) !== -1) {
                        newValue = newValue === '' ? s : newValue + ' ' + s;
                      }
                    }
                  } else if (obj.values.indexOf(value) >= 0) {
                    newValue = value;
                  }
                  value = newValue;
                }
              }
            }
          }
          if (passedAllowedAttributesMapCheck) {
            if (opts.allowedSchemesAppliedToAttributes.indexOf(a) !== -1) {
              if (naughtyHref(name, value)) {
                delete frame.attribs[a];
                return;
              }
            }

            if (name === 'script' && a === 'src') {
              let allowed: unknown = true;
              try {
                const parsed = parseUrl(value);
                if (opts.allowedScriptHostnames || opts.allowedScriptDomains) {
                  const allowedHostname = (opts.allowedScriptHostnames || [])
                    .find((hostname) => hostname === parsed.url.hostname);
                  const allowedDomain = (opts.allowedScriptDomains || [])
                    .find((domain) => parsed.url.hostname === domain || parsed.url.hostname.endsWith(`.${domain}`));
                  allowed = allowedHostname || allowedDomain;
                }
              } catch {
                allowed = false;
              }
              if (!allowed) {
                delete frame.attribs[a];
                return;
              }
            }

            if (name === 'iframe' && a === 'src') {
              let allowed: unknown = true;
              try {
                const parsed = parseUrl(value);
                if (parsed.isRelativeUrl) {
                  allowed = has(opts, 'allowIframeRelativeUrls')
                    ? opts.allowIframeRelativeUrls
                    : (!opts.allowedIframeHostnames && !opts.allowedIframeDomains);
                } else if (opts.allowedIframeHostnames || opts.allowedIframeDomains) {
                  const allowedHostname = (opts.allowedIframeHostnames || [])
                    .find((hostname) => hostname === parsed.url.hostname);
                  const allowedDomain = (opts.allowedIframeDomains || [])
                    .find((domain) => parsed.url.hostname === domain || parsed.url.hostname.endsWith(`.${domain}`));
                  allowed = allowedHostname || allowedDomain;
                }
              } catch {
                allowed = false;
              }
              if (!allowed) {
                delete frame.attribs[a];
                return;
              }
            }

            if (a === 'srcset') {
              try {
                let parsed = parseSrcset(value);
                parsed.forEach((v) => {
                  if (naughtyHref('srcset', v.url)) v.evil = true;
                });
                parsed = filter(parsed, (v) => !v.evil);
                if (!parsed.length) {
                  delete frame.attribs[a];
                  return;
                } else {
                  value = stringifySrcset(filter(parsed, (v) => !v.evil));
                  frame.attribs[a] = value;
                }
              } catch {
                delete frame.attribs[a];
                return;
              }
            }

            if (a === 'class') {
              const allowedSpecificClasses = allowedClassesMap[name];
              const allowedWildcardClasses = allowedClassesMap['*'];
              const allowedSpecificClassesGlob = allowedClassesGlobMap[name];
              const allowedSpecificClassesRegex = allowedClassesRegexMap[name];
              const allowedWildcardClassesRegex = allowedClassesRegexMap['*'];
              const allowedWildcardClassesGlob = allowedClassesGlobMap['*'];
              const allowedClassesGlobs: RegExp[] = [
                allowedSpecificClassesGlob,
                allowedWildcardClassesGlob
              ]
                .concat(allowedSpecificClassesRegex, allowedWildcardClassesRegex)
                .filter((t): t is RegExp => !!t);
              if (allowedSpecificClasses && allowedWildcardClasses) {
                value = filterClasses(
                  value,
                  deepmerge(allowedSpecificClasses as string[], allowedWildcardClasses as string[]) as string[],
                  allowedClassesGlobs
                );
              } else {
                value = filterClasses(
                  value,
                  (allowedSpecificClasses || allowedWildcardClasses) as string[] | false | undefined,
                  allowedClassesGlobs
                );
              }
              if (!value.length) {
                delete frame.attribs[a];
                return;
              }
            }

            if (a === 'style') {
              if (opts.parseStyleAttributes) {
                try {
                  const ast = parseStyleAst(name, value);
                  const filteredAst = filterCss(ast, opts.allowedStyles);
                  value = stringifyStyleAttributes(filteredAst);
                  if (value.length === 0) {
                    delete frame.attribs[a];
                    return;
                  }
                } catch {
                  delete frame.attribs[a];
                  return;
                }
              } else if (opts.allowedStyles) {
                throw new Error('allowedStyles option cannot be used together with parseStyleAttributes: false.');
              }
            }

            result += ' ' + a;
            if (value && value.length) {
              result += '="' + escapeHtml(value, true) + '"';
            } else if (opts.allowedEmptyAttributes.includes(a)) {
              result += '=""';
            }
          } else {
            delete frame.attribs[a];
          }
        });
      }
      if (opts.selfClosing.indexOf(name) !== -1) {
        result += ' />';
      } else {
        result += '>';
        if (frame.innerText && !hasText && !opts.textFilter) {
          result += escapeHtml(frame.innerText);
          addedText = true;
        }
      }
      if (skip) {
        result = tempResult + escapeHtml(result);
        tempResult = '';
      }
      frame.openingTagLength = result.length - frame.tagPosition;
    },
    ontext(text) {
      if (skipText) return;
      const lastFrame = stack[stack.length - 1];
      let tag: string | undefined;
      if (lastFrame) {
        tag = lastFrame.tag;
        text = lastFrame.innerText !== undefined ? lastFrame.innerText : text;
      }
      if (opts.disallowedTagsMode === 'completelyDiscard' && !tagAllowed(tag)) {
        text = '';
      } else if ((opts.disallowedTagsMode === 'discard' || opts.disallowedTagsMode === 'completelyDiscard') && (tag === 'script' || tag === 'style')) {
        result += text;
      } else if ((opts.disallowedTagsMode === 'discard' || opts.disallowedTagsMode === 'completelyDiscard') && (tag === 'textarea' || tag === 'xmp')) {
        result += text;
      } else if (!addedText) {
        const escaped = escapeHtml(text, false);
        if (opts.textFilter) result += opts.textFilter(escaped, tag);
        else result += escaped;
      }
      if (stack.length) {
        const frame = stack[stack.length - 1];
        frame.text += text;
      }
    },
    onclosetag(name, isImplied) {
      if (opts.onCloseTag) opts.onCloseTag(name, isImplied);

      if (skipText) {
        skipTextDepth--;
        if (!skipTextDepth) {
          skipText = false;
        } else {
          return;
        }
      }

      const frame = stack.pop();
      if (!frame) return;
      if (frame.tag !== name) {
        stack.push(frame);
        return;
      }

      skipText = opts.enforceHtmlBoundary ? name === 'html' : false;
      depth--;
      const skip = skipMap[depth];
      if (skip) {
        delete skipMap[depth];
        if (opts.disallowedTagsMode === 'discard' || opts.disallowedTagsMode === 'completelyDiscard') {
          frame.updateParentNodeText();
          return;
        }
        tempResult = result;
        result = '';
      }

      if (transformMap[depth]) {
        name = transformMap[depth];
        delete transformMap[depth];
      }

      if (opts.exclusiveFilter) {
        const filterResult = opts.exclusiveFilter(frame as unknown as IFrame);
        if (filterResult === 'excludeTag') {
          if (skip) {
            result = tempResult;
            tempResult = '';
          }
          result = result.substring(0, frame.tagPosition) +
            result.substring(frame.tagPosition + frame.openingTagLength);
          return;
        } else if (filterResult) {
          result = result.substring(0, frame.tagPosition);
          return;
        }
      }

      frame.updateParentNodeMediaChildren();
      frame.updateParentNodeText();

      if (
        opts.selfClosing.indexOf(name) !== -1 ||
        (isImplied && !tagAllowed(name) && [ 'escape', 'recursiveEscape' ].indexOf(opts.disallowedTagsMode as string) >= 0)
      ) {
        if (skip) {
          result = tempResult;
          tempResult = '';
        }
        return;
      }

      result += '</' + name + '>';
      if (skip) {
        result = tempResult + escapeHtml(result);
        tempResult = '';
      }
      addedText = false;
    }
  }, opts.parser);

  parser.write(inputHtml);
  parser.end();

  if (opts.disallowedTagsMode === 'escape' || opts.disallowedTagsMode === 'recursiveEscape') {
    const lastParsedIndex = parser.endIndex;
    if (lastParsedIndex != null && lastParsedIndex >= 0 && lastParsedIndex < inputHtml.length) {
      const unparsed = inputHtml.substring(lastParsedIndex);
      result += escapeHtml(unparsed);
    } else if ((lastParsedIndex == null || lastParsedIndex < 0) && inputHtml.length > 0 && result === '') {
      result = escapeHtml(inputHtml);
    }
  }

  return result;
} as SanitizeHtml;

// =============================================================================
// Defaults & static helpers
// =============================================================================

sanitizeHtmlFn.defaults = {
  allowedTags: [
    'address', 'article', 'aside', 'footer', 'header',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup',
    'main', 'nav', 'section',
    'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
    'hr', 'li', 'menu', 'ol', 'p', 'pre', 'ul',
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
    'em', 'i', 'kbd', 'mark', 'q',
    'rb', 'rp', 'rt', 'rtc', 'ruby',
    's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
    'caption', 'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr'
  ],
  nonBooleanAttributes: [
    'abbr', 'accept', 'accept-charset', 'accesskey', 'action',
    'allow', 'alt', 'as', 'autocapitalize', 'autocomplete',
    'blocking', 'charset', 'cite', 'class', 'color', 'cols',
    'colspan', 'content', 'contenteditable', 'coords', 'crossorigin',
    'data', 'datetime', 'decoding', 'dir', 'dirname', 'download',
    'draggable', 'enctype', 'enterkeyhint', 'fetchpriority', 'for',
    'form', 'formaction', 'formenctype', 'formmethod', 'formtarget',
    'headers', 'height', 'hidden', 'high', 'href', 'hreflang',
    'http-equiv', 'id', 'imagesizes', 'imagesrcset', 'inputmode',
    'integrity', 'is', 'itemid', 'itemprop', 'itemref', 'itemtype',
    'kind', 'label', 'lang', 'list', 'loading', 'low', 'max',
    'maxlength', 'media', 'method', 'min', 'minlength', 'name',
    'nonce', 'optimum', 'pattern', 'ping', 'placeholder', 'popover',
    'popovertarget', 'popovertargetaction', 'poster', 'preload',
    'referrerpolicy', 'rel', 'rows', 'rowspan', 'sandbox', 'scope',
    'shape', 'size', 'sizes', 'slot', 'span', 'spellcheck', 'src',
    'srcdoc', 'srclang', 'srcset', 'start', 'step', 'style',
    'tabindex', 'target', 'title', 'translate', 'type', 'usemap',
    'value', 'width', 'wrap',
    'onauxclick', 'onafterprint', 'onbeforematch', 'onbeforeprint',
    'onbeforeunload', 'onbeforetoggle', 'onblur', 'oncancel',
    'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose',
    'oncontextlost', 'oncontextmenu', 'oncontextrestored', 'oncopy',
    'oncuechange', 'oncut', 'ondblclick', 'ondrag', 'ondragend',
    'ondragenter', 'ondragleave', 'ondragover', 'ondragstart',
    'ondrop', 'ondurationchange', 'onemptied', 'onended',
    'onerror', 'onfocus', 'onformdata', 'onhashchange', 'oninput',
    'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup',
    'onlanguagechange', 'onload', 'onloadeddata', 'onloadedmetadata',
    'onloadstart', 'onmessage', 'onmessageerror', 'onmousedown',
    'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout',
    'onmouseover', 'onmouseup', 'onoffline', 'ononline', 'onpagehide',
    'onpageshow', 'onpaste', 'onpause', 'onplay', 'onplaying',
    'onpopstate', 'onprogress', 'onratechange', 'onreset', 'onresize',
    'onrejectionhandled', 'onscroll', 'onscrollend',
    'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect',
    'onslotchange', 'onstalled', 'onstorage', 'onsubmit', 'onsuspend',
    'ontimeupdate', 'ontoggle', 'onunhandledrejection', 'onunload',
    'onvolumechange', 'onwaiting', 'onwheel'
  ],
  disallowedTagsMode: 'discard',
  allowedAttributes: {
    a: [ 'href', 'name', 'target' ],
    img: [ 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading' ]
  },
  allowedEmptyAttributes: [ 'alt' ],
  selfClosing: [ 'img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta' ],
  allowedSchemes: [ 'http', 'https', 'ftp', 'mailto', 'tel' ],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: [ 'href', 'src', 'cite' ],
  allowProtocolRelative: true,
  enforceHtmlBoundary: false,
  parseStyleAttributes: true,
  preserveEscapedAttributes: false
};

sanitizeHtmlFn.simpleTransform = function (newTagName: string, newAttribs?: Attributes, merge?: boolean): Transformer {
  const doMerge = merge === undefined ? true : merge;
  const attribsToAdd = newAttribs || {};
  return function (_tagName: string, attribs: Attributes): TransformResult {
    let outAttribs: Attributes;
    if (doMerge) {
      outAttribs = attribs;
      for (const k of Object.keys(attribsToAdd)) outAttribs[k] = attribsToAdd[k];
    } else {
      outAttribs = attribsToAdd;
    }
    return { tagName: newTagName, attribs: outAttribs };
  };
};

const sanitizeHtml = sanitizeHtmlFn;

export default sanitizeHtml;
export { sanitizeHtml };
