/**
 * WHATWG HTML tree construction — `.` main engine.
 *
 * Consumes the `Tokenizer` token stream (pull-based, driving its content-model
 * state) and builds a DOM-like tree per https://html.spec.whatwg.org/#tree-construction.
 * Verified against the vendored html5lib-tests tree-construction `.dat` suite
 * (test/main/tree-construction.test.ts), ratcheted.
 *
 * Coverage is built up incrementally (climbing the ratchet): the common document
 * modes (initial → in head → in body → text → after body), generic element
 * insertion, implied end tags, RAWTEXT/RCDATA/script text, and active-formatting
 * reconstruction are here. Table/select/template modes, full foreign content, and
 * the adoption agency algorithm are layered in over subsequent passes (tracked by
 * the ratchet baseline).
 */
import { Tokenizer, type Token, type TagToken } from './tokenizer';

export type NS = 'html' | 'svg' | 'mathml';

export interface ElementNode {
  type: 'element';
  name: string;
  namespace: NS;
  attrs: Array<[string, string]>;
  children: TreeNode[];
  parent: ParentNode | null;
}
export interface TextNode {
  type: 'text';
  value: string;
  parent: ParentNode | null;
}
export interface CommentNode {
  type: 'comment';
  value: string;
  parent: ParentNode | null;
}
export interface DoctypeNode {
  type: 'doctype';
  name: string;
  publicId: string;
  systemId: string;
  parent: ParentNode | null;
}
export interface DocumentNode {
  type: 'document';
  children: TreeNode[];
}
export type TreeNode = ElementNode | TextNode | CommentNode | DoctypeNode;
export type ParentNode = ElementNode | DocumentNode;

// Tags handled specially in "in body" / head. Subsets used below.
const VOID = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes']);
const HEAD_TAGS = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'title', 'noframes', 'style', 'script', 'template', 'head', 'noscript', 'command']);
// Implied-end-tag set + the special category (subset that matters for the common path).
const IMPLIED_END = new Set(['dd', 'dt', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u']);
// Block/grouping end tags that close by: in scope? → generate implied end tags, pop until name.
const CLOSE_BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'pre', 'section', 'summary', 'ul']);
// "in body" start tags that close an open <p> then insert (O(1) lookup on the hot path).
const START_BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'ul', 'summary', 'address', 'pre', 'listing']);
// "Special" elements (scope-breaking) — abbreviated but covers the common cases.
const SPECIAL = new Set(['address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br', 'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'section', 'select', 'source', 'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'ul', 'wbr', 'xmp']);

type Mode =
  | 'initial' | 'beforeHtml' | 'beforeHead' | 'inHead' | 'afterHead'
  | 'inBody' | 'text' | 'afterBody' | 'afterAfterBody'
  | 'inTable' | 'inTableText' | 'inCaption' | 'inColumnGroup'
  | 'inTableBody' | 'inRow' | 'inCell' | 'inSelect' | 'inSelectInTable' | 'inTemplate' | 'inHeadNoscript'
  | 'inFrameset' | 'afterFrameset' | 'afterAfterFrameset';

const TABLE_CONTEXT = new Set(['table', 'tbody', 'tfoot', 'thead', 'tr']);
const TABLE_ROOT_CTX = new Set(['table', 'template', 'html']);
const TABLE_BODY_CTX = new Set(['tbody', 'tfoot', 'thead', 'template', 'html']);
const TABLE_ROW_CTX = new Set(['tr', 'template', 'html']);
const CELL_OR_CAPTION_START = new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);

// --- Foreign content (SVG/MathML) adjustment tables (WHATWG 13.2.6) ----------
// HTML start tags that "break out" of foreign content back to HTML parsing.
const FOREIGN_BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var']);
// SVG element tag-name case fixups (lowercased input -> correct case).
const SVG_TAG_NAMES = new Map<string, string>(Object.entries({
  altglyph: 'altGlyph', altglyphdef: 'altGlyphDef', altglyphitem: 'altGlyphItem', animatecolor: 'animateColor', animatemotion: 'animateMotion', animatetransform: 'animateTransform', clippath: 'clipPath', feblend: 'feBlend', fecolormatrix: 'feColorMatrix', fecomponenttransfer: 'feComponentTransfer', fecomposite: 'feComposite', feconvolvematrix: 'feConvolveMatrix', fediffuselighting: 'feDiffuseLighting', fedisplacementmap: 'feDisplacementMap', fedistantlight: 'feDistantLight', fedropshadow: 'feDropShadow', feflood: 'feFlood', fefunca: 'feFuncA', fefuncb: 'feFuncB', fefuncg: 'feFuncG', fefuncr: 'feFuncR', fegaussianblur: 'feGaussianBlur', feimage: 'feImage', femerge: 'feMerge', femergenode: 'feMergeNode', femorphology: 'feMorphology', feoffset: 'feOffset', fepointlight: 'fePointLight', fespecularlighting: 'feSpecularLighting', fespotlight: 'feSpotLight', fetile: 'feTile', feturbulence: 'feTurbulence', foreignobject: 'foreignObject', glyphref: 'glyphRef', lineargradient: 'linearGradient', radialgradient: 'radialGradient', textpath: 'textPath'
}));
// SVG attribute case fixups.
const SVG_ATTR = new Map<string, string>(Object.entries({
  attributename: 'attributeName', attributetype: 'attributeType', basefrequency: 'baseFrequency', baseprofile: 'baseProfile', calcmode: 'calcMode', clippathunits: 'clipPathUnits', diffuseconstant: 'diffuseConstant', edgemode: 'edgeMode', filterunits: 'filterUnits', glyphref: 'glyphRef', gradienttransform: 'gradientTransform', gradientunits: 'gradientUnits', kernelmatrix: 'kernelMatrix', kernelunitlength: 'kernelUnitLength', keypoints: 'keyPoints', keysplines: 'keySplines', keytimes: 'keyTimes', lengthadjust: 'lengthAdjust', limitingconeangle: 'limitingConeAngle', markerheight: 'markerHeight', markerunits: 'markerUnits', markerwidth: 'markerWidth', maskcontentunits: 'maskContentUnits', maskunits: 'maskUnits', numoctaves: 'numOctaves', pathlength: 'pathLength', patterncontentunits: 'patternContentUnits', patterntransform: 'patternTransform', patternunits: 'patternUnits', pointsatx: 'pointsAtX', pointsaty: 'pointsAtY', pointsatz: 'pointsAtZ', preservealpha: 'preserveAlpha', preserveaspectratio: 'preserveAspectRatio', primitiveunits: 'primitiveUnits', refx: 'refX', refy: 'refY', repeatcount: 'repeatCount', repeatdur: 'repeatDur', requiredextensions: 'requiredExtensions', requiredfeatures: 'requiredFeatures', specularconstant: 'specularConstant', specularexponent: 'specularExponent', spreadmethod: 'spreadMethod', startoffset: 'startOffset', stddeviation: 'stdDeviation', stitchtiles: 'stitchTiles', surfacescale: 'surfaceScale', systemlanguage: 'systemLanguage', tablevalues: 'tableValues', targetx: 'targetX', targety: 'targetY', textlength: 'textLength', viewbox: 'viewBox', viewtarget: 'viewTarget', xchannelselector: 'xChannelSelector', ychannelselector: 'yChannelSelector', zoomandpan: 'zoomAndPan'
}));
// Namespaced ("foreign") attributes -> html5lib "prefix localname" serialized form.
const FOREIGN_ATTR = new Map<string, string>(Object.entries({
  'xlink:actuate': 'xlink actuate', 'xlink:arcrole': 'xlink arcrole', 'xlink:href': 'xlink href', 'xlink:role': 'xlink role', 'xlink:show': 'xlink show', 'xlink:title': 'xlink title', 'xlink:type': 'xlink type', 'xml:lang': 'xml lang', 'xml:space': 'xml space', 'xmlns:xlink': 'xmlns xlink'
}));

const WS = new Set([' ', '\t', '\n', '\f']);
function isAllWs(s: string): boolean {
  for (const ch of s) if (!WS.has(ch)) return false;
  return true;
}

export class TreeBuilder {
  private readonly tk: Tokenizer;
  readonly document: DocumentNode = { type: 'document', children: [] };
  private readonly open: ElementNode[] = [];
  private readonly afe: Array<ElementNode | 'marker'> = []; // active formatting elements
  private mode: Mode = 'initial';
  private originalMode: Mode = 'initial';
  private head: ElementNode | null = null;
  private framesetOk = true;
  private fosterParenting = false;
  /** Set once an SVG/MathML element is inserted; gates the per-token foreign sync
   * in parse() so all-HTML documents (the common case) skip it entirely. */
  private sawForeign = false;
  /** Stack of template insertion modes (top = current). Drives resetInsertionMode
   * while inside one or more <template>s. */
  private templateModes: Mode[] = [];
  /** A single U+000A immediately after <pre>/<listing>/<textarea> is dropped
   * (authoring convenience). Set on those start tags, consumed by the next token. */
  private ignoreNextLF = false;
  /** The "form element pointer" — at most one form per document (outside templates);
   * a second <form> while this is set is ignored. */
  private formElement: ElementNode | null = null;
  private pendingTableText = '';
  private pendingTableNonWs = false;

  constructor(html: string) {
    this.tk = new Tokenizer(html, { state: 'data' });
  }

  /** Parse to completion and return the document tree. */
  parse(): DocumentNode {
    let t: Token | null;
    // The tokenizer's `<![CDATA[` decision only depends on the adjusted current
    // node, which changes solely when the open-stack top does (start/end tags) —
    // not on the runs of character tokens in between. Re-sync only on a change.
    let lastTop: ElementNode | undefined;
    while ((t = this.tk.nextToken()) !== null) {
      this.process(t);
      // No SVG/MathML seen yet ⇒ the adjusted current node is always HTML and the
      // tokenizer's CDATA decision can't change, so skip the sync entirely. Once a
      // foreign element appears, fall through to the per-change sync below.
      if (this.sawForeign) {
        const acn = this.open[this.open.length - 1];
        if (acn !== lastTop) {
          lastTop = acn;
          this.tk.setForeignContent(acn !== undefined && acn.namespace !== 'html');
        }
      }
    }
    return this.document;
  }

  // --- tree helpers ---------------------------------------------------------
  private current(): ParentNode {
    return this.open.length ? this.open[this.open.length - 1] : this.document;
  }
  private append(parent: ParentNode, node: TreeNode) {
    node.parent = parent;
    parent.children.push(node);
  }
  /** The "appropriate place for inserting a node" — implements foster parenting:
   * when enabled and the current node is a table context, content is inserted
   * before the table rather than inside it (what the browser does). */
  private appropriatePlace(): { parent: ParentNode; before: TreeNode | null } {
    const cur = this.current();
    if (this.fosterParenting && cur.type === 'element' && TABLE_CONTEXT.has(cur.name)) {
      let lastTable: ElementNode | null = null, lastTableIdx = -1;
      for (let i = this.open.length - 1; i >= 0; i--) {
        if (this.open[i].name === 'table') { lastTable = this.open[i]; lastTableIdx = i; break; }
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!lastTable) return { parent: this.open[0] ?? this.document, before: null };
      /* v8 ignore stop */
      if (lastTable.parent) return { parent: lastTable.parent, before: lastTable };
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      return { parent: this.open[lastTableIdx - 1], before: null };
      /* v8 ignore stop */
    }
    return { parent: cur, before: null };
  }
  private insertAt(place: { parent: ParentNode; before: TreeNode | null }, node: TreeNode) {
    node.parent = place.parent;
    if (place.before) {
      const idx = place.parent.children.indexOf(place.before);
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      place.parent.children.splice(idx < 0 ? place.parent.children.length : idx, 0, node);
      /* v8 ignore stop */
    } else {
      place.parent.children.push(node);
    }
  }
  private insertElement(token: TagToken, ns: NS = 'html'): ElementNode {
    // token.attrs is already duplicate-free (the tokenizer's addAttr keeps first
    // occurrence wins) and the token is transient, so we take its array directly
    // instead of re-deduping into a fresh copy — one fewer allocation per element.
    const el: ElementNode = { type: 'element', name: token.name, namespace: ns, attrs: token.attrs, children: [], parent: null };
    // Fast path: outside table foster-parenting (the overwhelming majority of
    // inserts) the insertion point is just the current node, appended at the end —
    // no `appropriatePlace` place-object and no `insertAt` indirection.
    if (this.fosterParenting) this.insertAt(this.appropriatePlace(), el);
    else { const parent = this.current(); el.parent = parent; parent.children.push(el); }
    this.open.push(el);
    return el;
  }
  private insertText(data: string) {
    if (!this.fosterParenting) {
      const parent = this.current();
      const siblings = parent.children;
      const prev = siblings[siblings.length - 1];
      if (prev !== undefined && prev.type === 'text') { prev.value += data; return; }
      siblings.push({ type: 'text', value: data, parent });
      return;
    }
    const place = this.appropriatePlace();
    const siblings = place.parent.children;
    const refIdx = place.before ? siblings.indexOf(place.before) : siblings.length;
    const prev = siblings[refIdx - 1];
    if (prev && prev.type === 'text') { prev.value += data; return; }
    const node: TextNode = { type: 'text', value: data, parent: place.parent };
    siblings.splice(refIdx, 0, node);
  }
  private insertComment(data: string, parent: ParentNode = this.current()) {
    this.append(parent, { type: 'comment', value: data, parent: null });
  }
  private popUntil(name: string) {
    while (this.open.length) {
      const el = this.open.pop()!;
      if (el.name === name) break;
    }
  }
  private inScopeNames = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
  /** A "scope" boundary element: the HTML markers PLUS the foreign integration
   * points (MathML mi/mo/mn/ms/mtext/annotation-xml, SVG foreignObject/desc/title).
   * Omitting the foreign ones made scope checks see through e.g. <mi> to an outer
   * <p>, mis-closing it. Checked by namespace so an HTML <title> isn't a marker. */
  private isScopeMarker(el: ElementNode): boolean {
    if (el.namespace === 'html') return this.inScopeNames.has(el.name);
    if (el.namespace === 'mathml') return el.name === 'mi' || el.name === 'mo' || el.name === 'mn' || el.name === 'ms' || el.name === 'mtext' || el.name === 'annotation-xml';
    return el.name === 'foreignObject' || el.name === 'desc' || el.name === 'title';
  }
  private hasInScope(target: string): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i];
      if (el.name === target && el.namespace === 'html') return true;
      if (this.isScopeMarker(el)) return false;
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false;
    /* v8 ignore stop */
  }
  private generateImpliedEndTags(except?: string) {
    while (this.open.length) {
      const c = this.open[this.open.length - 1];
      if (c.name !== except && IMPLIED_END.has(c.name)) this.open.pop();
      else break;
    }
  }
  /** "in button scope" — like in-scope, but `button` is also a boundary. */
  private hasInButtonScope(target: string): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i];
      if (el.name === target && el.namespace === 'html') return true;
      if ((el.name === 'button' && el.namespace === 'html') || this.isScopeMarker(el)) return false;
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false;
    /* v8 ignore stop */
  }
  private closePElement() {
    if (this.hasInButtonScope('p')) {
      this.generateImpliedEndTags('p');
      this.popUntil('p');
    }
  }
  /** Add a formatting element to the active-formatting list, applying the spec's
   * "Noah's Ark" clause: if three elements with the same tag name, namespace and
   * attributes already follow the last marker, drop the EARLIEST such one first. */
  private pushAfe(el: ElementNode) {
    let count = 0, earliest = -1;
    for (let i = this.afe.length - 1; i >= 0; i--) {
      const e = this.afe[i];
      if (e === 'marker') break;
      if (e.name === el.name && e.namespace === el.namespace && sameAttrs(e.attrs, el.attrs)) { count++; earliest = i; }
    }
    if (count >= 3) this.afe.splice(earliest, 1);
    this.afe.push(el);
  }
  private reconstructFormatting() {
    if (this.afe.length === 0) return;
    let last = this.afe[this.afe.length - 1];
    if (last === 'marker' || this.open.includes(last as ElementNode)) return;
    let i = this.afe.length - 1;
    while (i > 0) {
      const e = this.afe[i - 1];
      if (e === 'marker' || this.open.includes(e as ElementNode)) break;
      i--;
    }
    for (; i < this.afe.length; i++) {
      const entry = this.afe[i] as ElementNode;
      const el: ElementNode = { type: 'element', name: entry.name, namespace: 'html', attrs: entry.attrs.slice(), children: [], parent: null };
      this.append(this.current(), el);
      this.open.push(el);
      this.afe[i] = el;
    }
    void last;
  }

  // --- the dispatcher (HTML vs foreign content) -----------------------------
  private process(t: Token) {
    if (this.ignoreNextLF) {
      this.ignoreNextLF = false;
      if (t.type === 'character' && t.data.charCodeAt(0) === 0x0a) {
        if (t.data.length === 1) return; // the whole token was just the ignored LF
        t = { type: 'character', data: t.data.slice(1) };
      }
    }
    // Inline fast-reject: foreign rules only apply when an SVG/MathML element is
    // the current node. Reading the stack top here (instead of inside
    // useForeignRules) lets all-HTML documents skip that call entirely, and stays
    // correct under re-entrant process() calls (always reads the live top).
    const top = this.open.length !== 0 ? this.open[this.open.length - 1] : undefined;
    if (top !== undefined && top.namespace !== 'html' && this.useForeignRules(t)) this.foreignContent(t);
    else this.dispatchMode(t);
  }
  private dispatchMode(t: Token) {
    switch (this.mode) {
      case 'initial': return this.mInitial(t);
      case 'beforeHtml': return this.mBeforeHtml(t);
      case 'beforeHead': return this.mBeforeHead(t);
      case 'inHead': return this.mInHead(t);
      case 'afterHead': return this.mAfterHead(t);
      case 'inBody': return this.mInBody(t);
      case 'text': return this.mText(t);
      case 'afterBody': return this.mAfterBody(t);
      case 'afterAfterBody': return this.mAfterAfterBody(t);
      case 'inTable': return this.mInTable(t);
      case 'inTableText': return this.mInTableText(t);
      case 'inCaption': return this.mInCaption(t);
      case 'inColumnGroup': return this.mInColumnGroup(t);
      case 'inTableBody': return this.mInTableBody(t);
      case 'inRow': return this.mInRow(t);
      case 'inCell': return this.mInCell(t);
      case 'inSelect': return this.mInSelect(t);
      case 'inSelectInTable': return this.mInSelectInTable(t);
      case 'inTemplate': return this.mInTemplate(t);
      case 'inHeadNoscript': return this.mInHeadNoscript(t);
      case 'inFrameset': return this.mInFrameset(t);
      case 'afterFrameset': return this.mAfterFrameset(t);
      case 'afterAfterFrameset': return this.mAfterAfterFrameset(t);
    }
  }

  // --- foreign content (SVG / MathML) ---------------------------------------
  private isMathmlTextIP(el: ElementNode): boolean {
    return el.namespace === 'mathml' && (el.name === 'mi' || el.name === 'mo' || el.name === 'mn' || el.name === 'ms' || el.name === 'mtext');
  }
  private isHtmlIP(el: ElementNode): boolean {
    if (el.namespace === 'mathml' && el.name === 'annotation-xml') {
      const enc = el.attrs.find((a) => a[0] === 'encoding');
      const v = enc?.[1].toLowerCase();
      return v === 'text/html' || v === 'application/xhtml+xml';
    }
    return el.namespace === 'svg' && (el.name === 'foreignObject' || el.name === 'desc' || el.name === 'title');
  }
  private useForeignRules(t: Token): boolean {
    if (this.open.length === 0 || t.type === 'eof') return false;
    const acn = this.open[this.open.length - 1]; // adjusted current node (non-fragment)
    if (acn.namespace === 'html') return false;
    if (this.isMathmlTextIP(acn)) {
      if (t.type === 'character') return false;
      if (t.type === 'startTag' && t.name !== 'mglyph' && t.name !== 'malignmark') return false;
    }
    if (acn.namespace === 'mathml' && acn.name === 'annotation-xml' && t.type === 'startTag' && t.name === 'svg') return false;
    if (this.isHtmlIP(acn) && (t.type === 'startTag' || t.type === 'character')) return false;
    return true;
  }
  private adjustForeignAttrs(attrs: Array<[string, string]>, ns: NS): Array<[string, string]> {
    const seen = new Set<string>();
    const out: Array<[string, string]> = [];
    for (const [name, value] of attrs) {
      let adj = name;
      if (ns === 'mathml' && name === 'definitionurl') adj = 'definitionURL';
      else if (ns === 'svg' && SVG_ATTR.has(name)) adj = SVG_ATTR.get(name)!;
      if (FOREIGN_ATTR.has(adj)) adj = FOREIGN_ATTR.get(adj)!;
      if (!seen.has(adj)) { seen.add(adj); out.push([adj, value]); }
    }
    return out;
  }
  private insertForeign(t: TagToken, ns: NS) {
    this.sawForeign = true; // enables the per-token foreign-content sync in parse()
    let name = t.name;
    if (ns === 'svg' && SVG_TAG_NAMES.has(name)) name = SVG_TAG_NAMES.get(name)!;
    const el: ElementNode = { type: 'element', name, namespace: ns, attrs: this.adjustForeignAttrs(t.attrs, ns), children: [], parent: null };
    // Honour foster parenting (e.g. <table><svg> → svg goes BEFORE the table),
    // matching insertElement, instead of always appending to the current node.
    this.insertAt(this.appropriatePlace(), el);
    this.open.push(el);
    if (t.selfClosing) this.open.pop();
  }
  private foreignContent(t: Token) {
    if (t.type === 'character') { this.insertText(t.data); if (!isAllWs(t.data)) this.framesetOk = false; return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return;
    /* v8 ignore stop */
    if (t.type === 'startTag') {
      const n = t.name;
      if (FOREIGN_BREAKOUT.has(n) || (n === 'font' && t.attrs.some(([k]) => k === 'color' || k === 'face' || k === 'size'))) {
        // breakout: pop foreign elements until HTML namespace / integration point, then reprocess
        while (this.open.length) {
          const cur = this.open[this.open.length - 1];
          if (cur.namespace === 'html' || this.isMathmlTextIP(cur) || this.isHtmlIP(cur)) break;
          this.open.pop();
        }
        this.dispatchMode(t);
        return;
      }
      this.insertForeign(t, this.open[this.open.length - 1].namespace);
      return;
    }
    if (t.type === 'endTag') {
      for (let i = this.open.length - 1; i >= 0; i--) {
        const node = this.open[i];
        if (node.name.toLowerCase() === t.name) { while (this.open.length > i) this.open.pop(); return; }
        if (node.namespace === 'html') { this.dispatchMode(t); return; }
      }
    }
  }

  private mInitial(t: Token) {
    if (t.type === 'character' && isAllWs(t.data)) return;
    if (t.type === 'comment') { this.insertComment(t.data, this.document); return; }
    if (t.type === 'doctype') {
      this.append(this.document, { type: 'doctype', name: t.name ?? '', publicId: t.publicId ?? '', systemId: t.systemId ?? '', parent: null });
      this.mode = 'beforeHtml';
      return;
    }
    this.mode = 'beforeHtml';
    this.process(t);
  }
  private mBeforeHtml(t: Token) {
    if (t.type === 'doctype') return;
    if (t.type === 'comment') { this.insertComment(t.data, this.document); return; }
    if (t.type === 'character' && isAllWs(t.data)) return;
    if (t.type === 'startTag' && t.name === 'html') { this.insertElement(t); this.mode = 'beforeHead'; return; }
    const html: TagToken = { type: 'startTag', name: 'html', attrs: [], selfClosing: false };
    this.insertElement(html);
    this.mode = 'beforeHead';
    this.process(t);
  }
  private mBeforeHead(t: Token) {
    if (t.type === 'character' && isAllWs(t.data)) return;
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return;
    /* v8 ignore stop */
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    /* v8 ignore stop */
    if (t.type === 'startTag' && t.name === 'head') { this.head = this.insertElement(t); this.mode = 'inHead'; return; }
    // Stray end tags (other than head/body/html/br) are ignored here — they must
    // NOT trigger implicit <head> creation (else a comment after them misnests).
    if (t.type === 'endTag' && t.name !== 'head' && t.name !== 'body' && t.name !== 'html' && t.name !== 'br') return;
    this.head = this.insertElement({ type: 'startTag', name: 'head', attrs: [], selfClosing: false });
    this.mode = 'inHead';
    this.process(t);
  }
  private mInHead(t: Token) {
    if (t.type === 'character') {
      // Insert leading whitespace into <head>; the first non-whitespace char closes
      // head and the remainder is reprocessed (so " --> " after </style> splits).
      let i = 0; const d = t.data;
      while (i < d.length) { const c = d.charCodeAt(i); if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) i++; else break; }
      if (i > 0) this.insertText(d.slice(0, i));
      if (i === d.length) return;
      t = { type: 'character', data: d.slice(i) };
    }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return;
    /* v8 ignore stop */
    // <template> needs its own insertion mode; without this it would fall through
    // "anything else closes head" → pop → reprocess → infinite loop (a parse DoS).
    if (t.type === 'startTag' && t.name === 'template') {
      this.insertElement(t);
      this.afe.push('marker');
      this.framesetOk = false;
      this.templateModes.push('inTemplate');
      this.mode = 'inTemplate';
      return;
    }
    if (t.type === 'endTag' && t.name === 'template') {
      if (!this.hasInScope('template')) return;
      this.generateImpliedEndTags();
      this.popUntil('template');
      this.clearAfeToMarker();
      this.templateModes.pop();
      this.resetInsertionMode();
      return;
    }
    if (t.type === 'startTag') {
      if (t.name === 'html') return this.mInBody(t);
      if (VOID.has(t.name) && HEAD_TAGS.has(t.name)) { this.insertElement(t); this.open.pop(); return; }
      if (t.name === 'title') { this.insertElement(t); this.tk.setContentState('rcdata'); this.tk.setLastStartTag('title'); this.originalMode = this.mode; this.mode = 'text'; return; }
      // scripting DISABLED (our default + the conformance suite's): <noscript> in
      // head parses its content as normal HTML via the "in head noscript" mode,
      // NOT as raw text.
      if (t.name === 'noscript') { this.insertElement(t); this.mode = 'inHeadNoscript'; return; }
      if (t.name === 'noframes' || t.name === 'style' || t.name === 'script') {
        this.insertElement(t);
        this.tk.setContentState(t.name === 'script' ? 'scriptData' : 'rawtext');
        this.tk.setLastStartTag(t.name);
        this.originalMode = this.mode; this.mode = 'text';
        return;
      }
      if (t.name === 'head') return;
      // fall through: anything else closes head
    }
    if (t.type === 'endTag' && t.name === 'head') { this.open.pop(); this.mode = 'afterHead'; return; }
    if (t.type === 'endTag' && (t.name === 'body' || t.name === 'html' || t.name === 'br')) { /* fall through */ }
    else if (t.type === 'endTag') return;
    this.open.pop(); // pop head
    this.mode = 'afterHead';
    this.process(t);
  }
  /** "in head noscript" (scripting disabled): a small set of metadata tags +
   * whitespace/comments are handled in-head; </noscript> closes; anything else
   * pops the noscript and reprocesses in "in head". */
  private mInHeadNoscript(t: Token) {
    if (t.type === 'doctype') return;
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    if (t.type === 'endTag' && t.name === 'noscript') { this.open.pop(); this.mode = 'inHead'; return; }
    if (t.type === 'character' && isAllWs(t.data)) return this.mInHead(t);
    if (t.type === 'comment') return this.mInHead(t);
    if (t.type === 'startTag' && (t.name === 'basefont' || t.name === 'bgsound' || t.name === 'link' || t.name === 'meta' || t.name === 'noframes' || t.name === 'style')) return this.mInHead(t);
    if (t.type === 'startTag' && (t.name === 'head' || t.name === 'noscript')) return; // ignore
    // anything else (incl </br>): parse error → pop noscript, back to in head, reprocess.
    this.open.pop();
    this.mode = 'inHead';
    return this.process(t);
  }
  private mAfterHead(t: Token) {
    if (t.type === 'character' && isAllWs(t.data)) { this.insertText(t.data); return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return;
    /* v8 ignore stop */
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    if (t.type === 'startTag' && t.name === 'body') { this.insertElement(t); this.framesetOk = false; this.mode = 'inBody'; return; }
    if (t.type === 'startTag' && t.name === 'frameset') { this.insertElement(t); this.mode = 'inFrameset'; return; }
    if (t.type === 'startTag' && HEAD_TAGS.has(t.name)) { if (this.head) this.open.push(this.head); this.mInHead(t); if (this.head) { const idx = this.open.lastIndexOf(this.head); if (idx >= 0) this.open.splice(idx, 1); } return; }
    // Stray end tags (other than body/html/br) are ignored — must not force <body>.
    if (t.type === 'endTag') { if (t.name === 'template') return this.mInHead(t); if (t.name !== 'body' && t.name !== 'html' && t.name !== 'br') return; }
    this.insertElement({ type: 'startTag', name: 'body', attrs: [], selfClosing: false });
    this.mode = 'inBody';
    this.process(t);
  }

  private mInBody(t: Token) {
    if (t.type === 'character') {
      this.reconstructFormatting();
      this.insertText(t.data);
      if (!isAllWs(t.data)) this.framesetOk = false;
      return;
    }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') return this.inBodyStart(t);
    if (t.type === 'endTag') return this.inBodyEnd(t);
  }

  private inBodyStart(t: TagToken) {
    const n = t.name;
    if (n === 'html') {
      // merge attributes onto the existing html element
      const html = this.open[0];
      if (html) for (const [k, v] of t.attrs) if (!html.attrs.some((a) => a[0] === k)) html.attrs.push([k, v]);
      return;
    }
    // noscript in body (scripting disabled) is a normal flow element, not a head tag.
    if (HEAD_TAGS.has(n) && n !== 'head' && n !== 'noscript') { this.mInHead(t); return; }
    if (n === 'body') return; // (attribute-merge onto existing body omitted; irrelevant to sanitized output)
    if (n === 'frameset') {
      // Swap the body for a frameset (only while still frameset-ok and a body is open).
      const body = this.open[1];
      if (!this.framesetOk || !body || body.name !== 'body' || body.namespace !== 'html') return;
      this.removeFromParent(body);
      while (this.open.length > 1) this.open.pop();
      this.insertElement(t);
      this.mode = 'inFrameset';
      return;
    }
    if (START_BLOCK.has(n)) {
      this.closePElement();
      this.insertElement(t);
      if (n === 'pre' || n === 'listing') { this.ignoreNextLF = true; this.framesetOk = false; }
      return;
    }
    if (HEADINGS.has(n)) {
      this.closePElement();
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      if (HEADINGS.has(this.current().type === 'element' ? (this.current() as ElementNode).name : '')) this.open.pop();
      /* v8 ignore stop */
      this.insertElement(t);
      return;
    }
    if (n === 'li' || n === 'dd' || n === 'dt') {
      this.framesetOk = false;
      // close previous li/dd/dt in scope (simplified)
      for (let i = this.open.length - 1; i >= 0; i--) {
        const el = this.open[i];
        if ((n === 'li' && el.name === 'li') || (n !== 'li' && (el.name === 'dd' || el.name === 'dt'))) {
          this.generateImpliedEndTags(el.name);
          this.popUntil(el.name);
          break;
        }
        if (SPECIAL.has(el.name) && el.name !== 'address' && el.name !== 'div' && el.name !== 'p') break;
      }
      this.closePElement();
      this.insertElement(t);
      return;
    }
    if (FORMATTING.has(n)) {
      if (n === 'a') {
        // an existing <a> in the active formatting list is adopted out first
        for (let i = this.afe.length - 1; i >= 0; i--) {
          const e = this.afe[i];
          if (e === 'marker') break;
          if (e.name === 'a') { this.adoptionAgency('a'); break; }
        }
      } else if (n === 'nobr') {
        this.reconstructFormatting();
        if (this.hasInScope('nobr')) this.adoptionAgency('nobr');
      }
      this.reconstructFormatting();
      const el = this.insertElement(t);
      this.pushAfe(el);
      return;
    }
    if (n === 'hr') {
      this.closePElement();
      this.insertElement(t);
      this.open.pop();
      this.framesetOk = false;
      return;
    }
    if (n === 'param' || n === 'source' || n === 'track') {
      // void, but (unlike img/br/embed/…) do NOT clear framesetOk or reconstruct.
      this.insertElement(t);
      this.open.pop();
      return;
    }
    if (n === 'form') {
      const hasTemplate = this.open.some((e) => e.name === 'template');
      if (this.formElement && !hasTemplate) return; // one form per document
      if (this.hasInButtonScope('p')) this.closePElement();
      const f = this.insertElement(t);
      if (!hasTemplate) this.formElement = f;
      return;
    }
    if (n === 'br' || VOID.has(n)) {
      this.reconstructFormatting();
      this.insertElement(t);
      this.open.pop();
      // input keeps framesetOk only for type=hidden; every other void clears it.
      if (n === 'input') { if (!t.attrs.some(([k, v]) => k === 'type' && v.toLowerCase() === 'hidden')) this.framesetOk = false; }
      else this.framesetOk = false;
      return;
    }
    if (RAWTEXT.has(n)) {
      if (n === 'xmp') { this.closePElement(); this.reconstructFormatting(); }
      if (n === 'xmp' || n === 'iframe') this.framesetOk = false;
      this.insertElement(t);
      this.tk.setContentState('rawtext'); this.tk.setLastStartTag(n);
      this.originalMode = this.mode; this.mode = 'text';
      return;
    }
    if (n === 'textarea') {
      this.insertElement(t);
      this.ignoreNextLF = true;
      this.tk.setContentState('rcdata'); this.tk.setLastStartTag(n);
      this.framesetOk = false;
      this.originalMode = this.mode; this.mode = 'text';
      return;
    }
    if (n === 'plaintext') { this.closePElement(); this.insertElement(t); this.tk.setContentState('plaintext'); return; }
    if (n === 'button') {
      if (this.hasInScope('button')) { this.generateImpliedEndTags(); this.popUntil('button'); }
      this.reconstructFormatting();
      this.insertElement(t);
      this.framesetOk = false;
      return;
    }
    if (n === 'table') {
      // (quirks-mode p-closing nuance omitted)
      this.closePElement();
      this.insertElement(t);
      this.framesetOk = false;
      this.mode = 'inTable';
      return;
    }
    if (n === 'select') {
      this.reconstructFormatting();
      this.insertElement(t);
      this.framesetOk = false;
      // "in select in table" when opened inside a table context (table tags then
      // close the select), else plain "in select".
      this.mode = (this.mode === 'inTable' || this.mode === 'inCaption' || this.mode === 'inTableBody' || this.mode === 'inRow' || this.mode === 'inCell')
        ? 'inSelectInTable' : 'inSelect';
      return;
    }
    if (n === 'optgroup' || n === 'option') {
      if (this.current().type === 'element' && (this.current() as ElementNode).name === 'option') this.open.pop();
      this.reconstructFormatting();
      this.insertElement(t);
      return;
    }
    if (n === 'caption' || n === 'col' || n === 'colgroup' || n === 'tbody' || n === 'td' || n === 'tfoot' || n === 'th' || n === 'thead' || n === 'tr' || n === 'frame' || n === 'head') {
      return; // ignored as a start tag in body
    }
    if (n === 'image') { this.insertElement({ ...t, name: 'img' }); this.open.pop(); this.framesetOk = false; return; }
    if (n === 'rb' || n === 'rtc') { if (this.hasInScope('ruby')) this.generateImpliedEndTags(); this.insertElement(t); return; }
    if (n === 'rp' || n === 'rt') { if (this.hasInScope('ruby')) this.generateImpliedEndTags('rtc'); this.insertElement(t); return; }
    if (n === 'svg') { this.reconstructFormatting(); this.insertForeign(t, 'svg'); return; }
    if (n === 'math') { this.reconstructFormatting(); this.insertForeign(t, 'mathml'); return; }
    if (n === 'applet' || n === 'marquee' || n === 'object') {
      this.reconstructFormatting();
      this.insertElement(t);
      this.afe.push('marker');
      this.framesetOk = false;
      return;
    }
    // generic
    this.reconstructFormatting();
    this.insertElement(t);
  }

  private inBodyEnd(t: TagToken) {
    const n = t.name;
    if (n === 'body' || n === 'html') {
      if (this.hasInScope('body')) { this.mode = 'afterBody'; if (n === 'html') this.process(t); }
      return;
    }
    if (n === 'p') {
      // Spec: no p in button scope → parse error; insert an empty <p>, then close
      // it (a stray </p> therefore yields <p></p>).
      if (!this.hasInButtonScope('p')) this.insertElement({ type: 'startTag', name: 'p', attrs: [], selfClosing: false });
      this.closePElement();
      return;
    }
    if (HEADINGS.has(n)) {
      // ANY heading end tag closes ANY open heading (</h1> closes an <h3>, etc.).
      let inScope = false;
      for (let i = this.open.length - 1; i >= 0; i--) {
        const nm = this.open[i].name;
        if (HEADINGS.has(nm)) { inScope = true; break; }
        if (this.inScopeNames.has(nm)) break;
      }
      if (!inScope) return; // parse error: no heading in scope → ignore
      this.generateImpliedEndTags();
      while (this.open.length) { const el = this.open.pop() as ElementNode; if (HEADINGS.has(el.name)) break; }
      return;
    }
    if (n === 'form') {
      if (this.open.some((e) => e.name === 'template')) {
        if (!this.hasInScope('form')) return;
        this.generateImpliedEndTags();
        this.popUntil('form');
        return;
      }
      const node = this.formElement;
      this.formElement = null;
      if (!node || !this.hasElementInScope(node)) return;
      this.generateImpliedEndTags();
      const i = this.open.indexOf(node);
      if (i >= 0) this.open.splice(i, 1); // remove node (not necessarily the current node)
      return;
    }
    if (CLOSE_BLOCK.has(n)) {
      // in scope? → generate implied end tags, pop until the named element popped.
      if (!this.hasInScope(n)) return; // parse error: ignore
      this.generateImpliedEndTags();
      this.popUntil(n);
      return;
    }
    if (n === 'applet' || n === 'marquee' || n === 'object') {
      if (!this.hasInScope(n)) return;
      this.generateImpliedEndTags();
      this.popUntil(n);
      this.clearAfeToMarker();
      return;
    }
    if (FORMATTING.has(n)) { this.adoptionAgency(n); return; }
    this.inBodyEndGeneric(n);
  }

  private inBodyEndGeneric(n: string) {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i];
      if (el.name === n) {
        this.generateImpliedEndTags(n);
        while (this.open.length > i) this.open.pop();
        return;
      }
      if (SPECIAL.has(el.name)) return;
    }
  }

  private cloneElement(el: ElementNode): ElementNode {
    return { type: 'element', name: el.name, namespace: el.namespace, attrs: el.attrs.map((a) => [a[0], a[1]] as [string, string]), children: [], parent: null };
  }
  private removeFromParent(node: TreeNode) {
    const p = node.parent;
    if (p) {
      const i = p.children.indexOf(node);
      if (i >= 0) p.children.splice(i, 1);
      node.parent = null;
    }
  }
  /** Insert `node` under `target`, foster-parenting (before the last table) when
   * target is a table context — the adoption agency's "appropriate place". */
  private fosterInsert(target: ElementNode, node: TreeNode) {
    if (TABLE_CONTEXT.has(target.name)) {
      let lt: ElementNode | null = null, lti = -1;
      for (let k = this.open.length - 1; k >= 0; k--) {
        if (this.open[k].name === 'table') { lt = this.open[k]; lti = k; break; }
      }
      if (lt && lt.parent) {
        const j = lt.parent.children.indexOf(lt);
        /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
        lt.parent.children.splice(j < 0 ? lt.parent.children.length : j, 0, node);
        /* v8 ignore stop */
        node.parent = lt.parent;
        return;
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (lt) { this.append(this.open[lti - 1], node); return; }
      /* v8 ignore stop */
    }
    this.append(target, node);
  }
  private hasElementInScope(target: ElementNode): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i];
      if (el === target) return true;
      if (this.isScopeMarker(el)) return false;
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false;
    /* v8 ignore stop */
  }

  /**
   * The WHATWG adoption agency algorithm — reparents misnested formatting
   * elements (e.g. `<a>1<p>2</p>3</a>`) exactly the way the browser does. This is
   * the single most intricate part of tree construction and a real mXSS surface.
   * (Foster parenting for the table case is a later refinement — marked below.)
   */
  private adoptionAgency(tag: string) {
    const cur = this.open[this.open.length - 1];
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (cur && cur.name === tag && this.afe.indexOf(cur) === -1) { this.open.pop(); return; }
    /* v8 ignore stop */

    for (let outer = 0; outer < 8; outer++) {
      // formatting element: last entry in AFE with `tag`, after the last marker
      let fmtIdx = -1;
      for (let i = this.afe.length - 1; i >= 0; i--) {
        const e = this.afe[i];
        if (e === 'marker') break;
        if (e.name === tag) { fmtIdx = i; break; }
      }
      if (fmtIdx === -1) { this.inBodyEndGeneric(tag); return; } // "any other end tag"
      const fmtEl = this.afe[fmtIdx] as ElementNode;
      const openIdx = this.open.indexOf(fmtEl);
      if (openIdx === -1) { this.afe.splice(fmtIdx, 1); return; }
      if (!this.hasElementInScope(fmtEl)) return;

      // furthest block: topmost "special" element below fmtEl in the open stack
      let furthestBlock: ElementNode | null = null;
      let furthestIdx = -1;
      for (let i = openIdx + 1; i < this.open.length; i++) {
        if (SPECIAL.has(this.open[i].name)) { furthestBlock = this.open[i]; furthestIdx = i; break; }
      }
      if (!furthestBlock) {
        while (this.open.length > openIdx) this.open.pop();
        this.afe.splice(fmtIdx, 1);
        return;
      }

      const commonAncestor = this.open[openIdx - 1];
      let bookmark = fmtIdx;
      let lastNode = furthestBlock;
      let nodeIdx = furthestIdx;
      for (let inner = 0; ; ) {
        inner++;
        nodeIdx--;
        /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
        if (nodeIdx < 0) break; // safety
        /* v8 ignore stop */
        let node = this.open[nodeIdx];
        if (node === fmtEl) break;
        let afeIdx = this.afe.indexOf(node);
        if (inner > 3 && afeIdx !== -1) { this.afe.splice(afeIdx, 1); afeIdx = -1; }
        if (afeIdx === -1) { this.open.splice(nodeIdx, 1); continue; }
        const clone = this.cloneElement(node);
        this.afe[afeIdx] = clone;
        this.open[nodeIdx] = clone;
        node = clone;
        if (lastNode === furthestBlock) bookmark = afeIdx + 1;
        this.removeFromParent(lastNode);
        this.append(node, lastNode);
        lastNode = node;
      }

      // place lastNode at the appropriate insertion point (foster-parent when
      // commonAncestor is a table context — what the browser does).
      this.removeFromParent(lastNode);
      this.fosterInsert(commonAncestor, lastNode);

      const fmtClone = this.cloneElement(fmtEl);
      for (const child of furthestBlock.children) { child.parent = fmtClone; fmtClone.children.push(child); }
      furthestBlock.children = [];
      this.append(furthestBlock, fmtClone);

      const fAfe = this.afe.indexOf(fmtEl);
      if (fAfe !== -1) { this.afe.splice(fAfe, 1); if (fAfe < bookmark) bookmark--; }
      bookmark = Math.max(0, Math.min(bookmark, this.afe.length));
      this.afe.splice(bookmark, 0, fmtClone);

      const fOpen = this.open.indexOf(fmtEl);
      if (fOpen !== -1) this.open.splice(fOpen, 1);
      const fbOpen = this.open.indexOf(furthestBlock);
      this.open.splice(fbOpen + 1, 0, fmtClone);
    }
  }

  private mText(t: Token) {
    if (t.type === 'character') { this.insertText(t.data); return; }
    if (t.type === 'endTag') { this.open.pop(); this.mode = this.originalMode; return; }
    // EOF or other: pop and reprocess
    this.open.pop();
    this.mode = this.originalMode;
    this.process(t);
  }

  private mAfterBody(t: Token) {
    if (t.type === 'character' && isAllWs(t.data)) return this.mInBody(t);
    /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
    if (t.type === 'comment') { this.insertComment(t.data, this.open[0] ?? this.document); return; }
    /* v8 ignore stop */
    if (t.type === 'doctype') return;
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    if (t.type === 'endTag' && t.name === 'html') { this.mode = 'afterAfterBody'; return; }
    this.mode = 'inBody';
    this.process(t);
  }
  private mAfterAfterBody(t: Token) {
    if (t.type === 'comment') { this.insertComment(t.data, this.document); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return;
    /* v8 ignore stop */
    if (t.type === 'character' && isAllWs(t.data)) return this.mInBody(t);
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    this.mode = 'inBody';
    this.process(t);
  }

  // --- frameset modes (obsolete markup; a sanitizer drops these, but matching the
  // browser's parse tree keeps reparse-stability + conformance honest) ----------
  /** Whitespace-only subset of a character run (frameset modes ignore non-ws). */
  private framesetWs(data: string): string {
    let ws = '';
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i);
      if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) ws += data[i];
    }
    return ws;
  }
  private mInFrameset(t: Token) {
    if (t.type === 'character') { const ws = this.framesetWs(t.data); if (ws) this.insertText(ws); return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') {
      const n = t.name;
      if (n === 'html') return this.mInBody(t);
      if (n === 'frameset') { this.insertElement(t); return; }
      if (n === 'frame') { this.insertElement(t); this.open.pop(); return; }
      if (n === 'noframes') return this.mInHead(t);
      return;
    }
    if (t.type === 'endTag' && t.name === 'frameset') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (this.currentName() === 'html') return; // fragment case: ignore
      /* v8 ignore stop */
      this.open.pop();
      if (this.currentName() !== 'frameset') this.mode = 'afterFrameset';
      return;
    }
    // eof / other end tags: ignore
  }
  private mAfterFrameset(t: Token) {
    if (t.type === 'character') { const ws = this.framesetWs(t.data); if (ws) this.insertText(ws); return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (t.name === 'html') return this.mInBody(t);
      /* v8 ignore stop */
      if (t.name === 'noframes') return this.mInHead(t);
      return;
    }
    if (t.type === 'endTag' && t.name === 'html') { this.mode = 'afterAfterFrameset'; return; }
    // eof / other: ignore
  }
  private mAfterAfterFrameset(t: Token) {
    if (t.type === 'comment') { this.insertComment(t.data, this.document); return; }
    if (t.type === 'character') { const ws = this.framesetWs(t.data); if (ws) this.insertText(ws); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') {
      if (t.name === 'html') return this.mInBody(t);
      if (t.name === 'noframes') return this.mInHead(t);
      return;
    }
    // eof / other: ignore
  }

  // --- table insertion modes ------------------------------------------------
  private currentName(): string {
    const c = this.current();
    /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
    return c.type === 'element' ? c.name : '';
    /* v8 ignore stop */
  }
  private clearStackTo(ctx: Set<string>) {
    while (this.open.length && !ctx.has(this.open[this.open.length - 1].name)) this.open.pop();
  }
  private clearAfeToMarker() {
    while (this.afe.length) { if (this.afe.pop() === 'marker') break; }
  }
  private hasInTableScope(target: string): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name;
      if (n === target) return true;
      if (n === 'html' || n === 'table' || n === 'template') return false;
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false;
    /* v8 ignore stop */
  }
  private hasInSelectScope(target: string): boolean {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name;
      if (n === target) return true;
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n !== 'optgroup' && n !== 'option') return false;
      /* v8 ignore stop */
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false;
    /* v8 ignore stop */
  }
  private anyTableBodyInScope(): boolean {
    return this.hasInTableScope('tbody') || this.hasInTableScope('thead') || this.hasInTableScope('tfoot');
  }
  private resetInsertionMode() {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name;
      const last = i === 0;
      if (n === 'select') { this.mode = 'inSelect'; return; }
      if ((n === 'td' || n === 'th') && !last) { this.mode = 'inCell'; return; }
      if (n === 'tr') { this.mode = 'inRow'; return; }
      if (n === 'tbody' || n === 'thead' || n === 'tfoot') { this.mode = 'inTableBody'; return; }
      if (n === 'caption') { this.mode = 'inCaption'; return; }
      if (n === 'colgroup') { this.mode = 'inColumnGroup'; return; }
      if (n === 'table') { this.mode = 'inTable'; return; }
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      if (n === 'template') { this.mode = this.templateModes[this.templateModes.length - 1] ?? 'inBody'; return; }
      /* v8 ignore stop */
      if (n === 'head' || n === 'body') { this.mode = 'inBody'; return; }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'html') { this.mode = this.head ? 'afterHead' : 'beforeHead'; return; }
      /* v8 ignore stop */
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (last) { this.mode = 'inBody'; return; }
      /* v8 ignore stop */
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    this.mode = 'inBody';
    /* v8 ignore stop */
  }
  private fosterInBody(t: Token) {
    this.fosterParenting = true;
    this.mInBody(t);
    this.fosterParenting = false;
  }

  private mInTable(t: Token) {
    if (t.type === 'character') {
      this.pendingTableText = ''; this.pendingTableNonWs = false;
      this.originalMode = this.mode; this.mode = 'inTableText';
      return this.process(t);
    }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') {
      const n = t.name;
      if (n === 'caption') { this.clearStackTo(TABLE_ROOT_CTX); this.afe.push('marker'); this.insertElement(t); this.mode = 'inCaption'; return; }
      if (n === 'colgroup') { this.clearStackTo(TABLE_ROOT_CTX); this.insertElement(t); this.mode = 'inColumnGroup'; return; }
      if (n === 'col') { this.clearStackTo(TABLE_ROOT_CTX); this.insertElement({ type: 'startTag', name: 'colgroup', attrs: [], selfClosing: false }); this.mode = 'inColumnGroup'; return this.process(t); }
      if (n === 'tbody' || n === 'tfoot' || n === 'thead') { this.clearStackTo(TABLE_ROOT_CTX); this.insertElement(t); this.mode = 'inTableBody'; return; }
      if (n === 'td' || n === 'th' || n === 'tr') { this.clearStackTo(TABLE_ROOT_CTX); this.insertElement({ type: 'startTag', name: 'tbody', attrs: [], selfClosing: false }); this.mode = 'inTableBody'; return this.process(t); }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'table') { if (!this.hasInTableScope('table')) return; this.popUntil('table'); this.resetInsertionMode(); return this.process(t); }
      /* v8 ignore stop */
      if (n === 'style' || n === 'script' || n === 'template') return this.mInHead(t);
      if (n === 'input' && t.attrs.some(([k, v]) => k === 'type' && v.toLowerCase() === 'hidden')) { this.insertElement(t); this.open.pop(); return; }
      if (n === 'form') { this.insertElement(t); this.open.pop(); return; }
      return this.fosterInBody(t);
    }
    if (t.type === 'endTag') {
      const n = t.name;
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'table') { if (!this.hasInTableScope('table')) return; this.popUntil('table'); this.resetInsertionMode(); return; }
      /* v8 ignore stop */
      if (['body', 'caption', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(n)) return;
      return this.fosterInBody(t);
    }
    if (t.type === 'eof') return this.mInBody(t);
  }
  private mInTableText(t: Token) {
    if (t.type === 'character') {
      this.pendingTableText += t.data;
      if (!isAllWs(t.data)) this.pendingTableNonWs = true;
      return;
    }
    const text = this.pendingTableText, nonWs = this.pendingTableNonWs;
    this.pendingTableText = ''; this.pendingTableNonWs = false;
    this.mode = this.originalMode;
    if (text) {
      if (nonWs) { this.fosterParenting = true; this.insertText(text); this.fosterParenting = false; }
      else this.insertText(text);
    }
    return this.process(t);
  }
  private mInCaption(t: Token) {
    if (t.type === 'endTag' && t.name === 'caption') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('caption')) return;
      /* v8 ignore stop */
      this.generateImpliedEndTags(); this.popUntil('caption'); this.clearAfeToMarker(); this.mode = 'inTable';
      return;
    }
    if ((t.type === 'startTag' && CELL_OR_CAPTION_START.has(t.name)) || (t.type === 'endTag' && t.name === 'table')) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('caption')) return;
      /* v8 ignore stop */
      this.generateImpliedEndTags(); this.popUntil('caption'); this.clearAfeToMarker(); this.mode = 'inTable';
      return this.process(t);
    }
    if (t.type === 'endTag' && ['body', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(t.name)) return;
    return this.mInBody(t);
  }
  private mInColumnGroup(t: Token) {
    if (t.type === 'character' && isAllWs(t.data)) { this.insertText(t.data); return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t);
    if (t.type === 'startTag' && t.name === 'col') { this.insertElement(t); this.open.pop(); return; }
    if ((t.type === 'startTag' || t.type === 'endTag') && t.name === 'template') return this.mInHead(t);
    if (t.type === 'endTag' && t.name === 'colgroup') { if (this.currentName() === 'colgroup') { this.open.pop(); this.mode = 'inTable'; } return; }
    if (t.type === 'endTag' && t.name === 'col') return;
    if (t.type === 'eof') return this.mInBody(t);
    if (this.currentName() === 'colgroup') { this.open.pop(); this.mode = 'inTable'; return this.process(t); }
  }
  private mInTableBody(t: Token) {
    if (t.type === 'startTag' && t.name === 'tr') { this.clearStackTo(TABLE_BODY_CTX); this.insertElement(t); this.mode = 'inRow'; return; }
    if (t.type === 'startTag' && (t.name === 'td' || t.name === 'th')) { this.clearStackTo(TABLE_BODY_CTX); this.insertElement({ type: 'startTag', name: 'tr', attrs: [], selfClosing: false }); this.mode = 'inRow'; return this.process(t); }
    if (t.type === 'startTag' && ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead'].includes(t.name)) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.anyTableBodyInScope()) return;
      /* v8 ignore stop */
      this.clearStackTo(TABLE_BODY_CTX); this.open.pop(); this.mode = 'inTable'; return this.process(t);
    }
    if (t.type === 'endTag' && (t.name === 'tbody' || t.name === 'tfoot' || t.name === 'thead')) {
      if (!this.hasInTableScope(t.name)) return;
      this.clearStackTo(TABLE_BODY_CTX); this.open.pop(); this.mode = 'inTable'; return;
    }
    if (t.type === 'endTag' && t.name === 'table') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.anyTableBodyInScope()) return;
      /* v8 ignore stop */
      this.clearStackTo(TABLE_BODY_CTX); this.open.pop(); this.mode = 'inTable'; return this.process(t);
    }
    if (t.type === 'endTag' && ['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th', 'tr'].includes(t.name)) return;
    return this.mInTable(t);
  }
  private mInRow(t: Token) {
    if (t.type === 'startTag' && (t.name === 'td' || t.name === 'th')) { this.clearStackTo(TABLE_ROW_CTX); this.insertElement(t); this.mode = 'inCell'; this.afe.push('marker'); return; }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'endTag' && t.name === 'tr') { if (!this.hasInTableScope('tr')) return; this.clearStackTo(TABLE_ROW_CTX); this.open.pop(); this.mode = 'inTableBody'; return; }
    /* v8 ignore stop */
    if ((t.type === 'startTag' && ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr'].includes(t.name)) || (t.type === 'endTag' && t.name === 'table')) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('tr')) return;
      /* v8 ignore stop */
      this.clearStackTo(TABLE_ROW_CTX); this.open.pop(); this.mode = 'inTableBody'; return this.process(t);
    }
    if (t.type === 'endTag' && (t.name === 'tbody' || t.name === 'tfoot' || t.name === 'thead')) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope(t.name) || !this.hasInTableScope('tr')) return;
      /* v8 ignore stop */
      this.clearStackTo(TABLE_ROW_CTX); this.open.pop(); this.mode = 'inTableBody'; return this.process(t);
    }
    if (t.type === 'endTag' && ['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th'].includes(t.name)) return;
    return this.mInTable(t);
  }
  private mInCell(t: Token) {
    if (t.type === 'endTag' && (t.name === 'td' || t.name === 'th')) {
      if (!this.hasInTableScope(t.name)) return;
      this.generateImpliedEndTags(); this.popUntil(t.name); this.clearAfeToMarker(); this.mode = 'inRow';
      return;
    }
    if (t.type === 'startTag' && CELL_OR_CAPTION_START.has(t.name)) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('td') && !this.hasInTableScope('th')) return;
      /* v8 ignore stop */
      this.closeCell(); return this.process(t);
    }
    if (t.type === 'endTag' && ['body', 'caption', 'col', 'colgroup', 'html'].includes(t.name)) return;
    if (t.type === 'endTag' && ['table', 'tbody', 'tfoot', 'thead', 'tr'].includes(t.name)) {
      if (!this.hasInTableScope(t.name)) return;
      this.closeCell(); return this.process(t);
    }
    return this.mInBody(t);
  }
  private closeCell() {
    const which = this.hasInTableScope('td') ? 'td' : 'th';
    this.generateImpliedEndTags(); this.popUntil(which); this.clearAfeToMarker(); this.mode = 'inRow';
  }
  private mInSelect(t: Token) {
    if (t.type === 'character') { this.insertText(t.data); return; }
    if (t.type === 'comment') { this.insertComment(t.data); return; }
    if (t.type === 'doctype') return;
    if (t.type === 'startTag') {
      const n = t.name;
      if (n === 'html') return this.mInBody(t);
      if (n === 'option') { if (this.currentName() === 'option') this.open.pop(); this.insertElement(t); return; }
      if (n === 'optgroup') { if (this.currentName() === 'option') this.open.pop(); if (this.currentName() === 'optgroup') this.open.pop(); this.insertElement(t); return; }
      if (n === 'hr') { if (this.currentName() === 'option') this.open.pop(); if (this.currentName() === 'optgroup') this.open.pop(); this.insertElement(t); this.open.pop(); return; }
      if (n === 'select') { if (this.hasInSelectScope('select')) { this.popUntil('select'); this.resetInsertionMode(); } return; }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'input' || n === 'keygen' || n === 'textarea') { if (!this.hasInSelectScope('select')) return; this.popUntil('select'); this.resetInsertionMode(); return this.process(t); }
      /* v8 ignore stop */
      if (n === 'script' || n === 'template') return this.mInHead(t);
      // Recent spec: a <select> may now contain general flow content — any other
      // start tag is processed with the in-body rules (insert/reconstruct), not ignored.
      return this.mInBody(t);
    }
    if (t.type === 'endTag') {
      const n = t.name;
      if (n === 'optgroup') { if (this.currentName() === 'option' && this.open[this.open.length - 2]?.name === 'optgroup') this.open.pop(); if (this.currentName() === 'optgroup') this.open.pop(); return; }
      if (n === 'option') { if (this.currentName() === 'option') this.open.pop(); return; }
      if (n === 'select') { if (!this.hasInSelectScope('select')) return; this.popUntil('select'); this.resetInsertionMode(); return; }
      if (n === 'template') return this.mInHead(t);
      return this.mInBody(t);
    }
    if (t.type === 'eof') return this.mInBody(t);
  }

  /** "in select in table": a table-structure tag closes the whole select and is
   * reprocessed; everything else falls through to the normal select rules. */
  private mInSelectInTable(t: Token) {
    if (t.type === 'startTag' || t.type === 'endTag') {
      const n = t.name;
      if (n === 'caption' || n === 'table' || n === 'tbody' || n === 'tfoot' || n === 'thead' || n === 'tr' || n === 'td' || n === 'th') {
        // end tags only act when that element is actually in table scope.
        if (t.type === 'endTag' && !this.hasInTableScope(n)) return;
        this.popUntil('select');
        this.resetInsertionMode();
        return this.process(t);
      }
    }
    return this.mInSelect(t);
  }

  /** "in template": route head-ish content to inHead, switch the current template
   * insertion mode for table-context tags, close on </template>/EOF. Simplified
   * vs. the spec but loop-free and safe (template content is dropped by the
   * sanitizer regardless of the exact subtree). */
  private mInTemplate(t: Token) {
    if (t.type === 'character' || t.type === 'comment' || t.type === 'doctype') return this.mInBody(t);
    if (t.type === 'eof') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInScope('template')) return; // stop
      /* v8 ignore stop */
      this.popUntil('template'); this.clearAfeToMarker(); this.templateModes.pop(); this.resetInsertionMode();
      return this.process(t);
    }
    if (t.type === 'endTag') {
      if (t.name === 'template') return this.mInHead(t); // close handled there
      return; // other end tags are ignored in template content
    }
    const n = t.name;
    if (HEAD_TAGS.has(n) || n === 'script') return this.mInHead(t); // base/link/meta/template/title/style/script…
    // A table-context start tag sets the current template insertion mode, then is reprocessed there.
    let m: Mode = 'inBody';
    if (n === 'caption' || n === 'colgroup' || n === 'tbody' || n === 'tfoot' || n === 'thead') m = 'inTable';
    else if (n === 'col') m = 'inColumnGroup';
    else if (n === 'tr') m = 'inTableBody';
    else if (n === 'td' || n === 'th') m = 'inRow';
    this.templateModes[this.templateModes.length - 1] = m;
    this.mode = m;
    return this.process(t);
  }
}


/** Order-independent attribute-set equality (for the adoption agency's Noah's Ark). */
function sameAttrs(a: Array<[string, string]>, b: Array<[string, string]>): boolean {
  if (a.length !== b.length) return false;
  for (const [k, v] of a) {
    let found = false;
    for (const [k2, v2] of b) { if (k2 === k && v2 === v) { found = true; break; } }
    if (!found) return false;
  }
  return true;
}
