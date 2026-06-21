/**
 * Shared generator for the differential fuzz: a seeded, dependency-free producer
 * of realistic HTML documents plus a matrix of option configurations that
 * exercises every sanitize-html option. Used by BOTH the exploratory harness
 * (audit/fuzz.mjs, runs huge counts to discover divergences) and the locked-in
 * regression test (test/differential-fuzz.test.ts).
 *
 * The generator stays WELL-FORMED (balanced tags, void tags self-closed, no bare
 * `<!`/`<a ==b>` style garbage) so that — by design — our reimplementation and
 * the original sanitize-html must produce byte-identical output. Any divergence
 * a run surfaces is therefore a REAL drop-in bug, not a documented tokenizer
 * quirk (those live in the htmlparser2/postcss/parse-srcset corpora).
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible, so a failing case is fixed by
// its seed.
// ---------------------------------------------------------------------------
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const chance = (rand, p) => rand() < p;
const int = (rand, n) => Math.floor(rand() * n);

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
// Container tags that take children. Mix of default-allowed and default-stripped
// so the allow-list / disallowedTagsMode paths get exercised.
const CONTAINER_TAGS = [
  'div', 'p', 'section', 'article', 'span', 'a', 'b', 'i', 'em', 'strong',
  'code', 'small', 'sub', 'sup', 'mark', 'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'pre',
  // default-disallowed → stripped/escaped depending on mode:
  'script', 'style', 'form', 'button', 'object', 'iframe', 'textarea', 'title',
  'svg', 'math', 'figure', 'figcaption', 'header', 'footer', 'nav'
];
const VOID_TAGS = ['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col'];

const CLASS_TOKENS = ['card', 'featured', 'big', 'foo', 'bar', 'highlight', 'is-active', 'col-6'];
const SCHEMES_VALUES = [
  'https://example.com/p?a=1&amp;b=2', 'http://example.com/x', '//cdn.example.com/y',
  '/root/rel', 'relative/path.html', 'mailto:u@example.com', 'tel:+15550001',
  'ftp://files.example.com/z', 'javascript:alert(1)', 'data:text/html,<b>x</b>',
  'data:image/png;base64,iVBOR', 'vbscript:msgbox(1)', '#frag', '?q=1',
  ' https://leadingspace.example.com ', 'HTTPS://UPPER.example.com',
  // Hostnames that MATCH the iframe/script allow-lists in CONFIGS, so those
  // configs exercise the keep-path (not only the strip-path).
  'https://www.youtube.com/embed/abc', 'https://player.vimeo.com/video/42',
  'https://evil.youtube.com.attacker.net/x', 'http://example.com/app.js',
  'https://sub.example.com/x', '//www.youtube.com/embed/y'
];
const STYLE_VALUES = [
  'color:#333;padding:8px', 'color: red; font-size: 14px', 'background-image:url(javascript:alert(1))',
  'position:absolute;z-index:9', 'margin:0 auto', 'width:50%;display:block',
  'color:blue !important', 'font-weight:bold;line-height:1.5', 'background:url(/img.png)',
  'content:"x"', 'color:rgb(1,2,3)', 'COLOR:RED', '--custom-prop: 5px', 'unknown-prop: weird'
];
const TEXT_BITS = [
  'Hello world', 'foo & bar', '5 < 6 > 3', 'café', 'naïve',
  '&amp; &lt; &gt; &quot;', 'don&apos;t &mdash; do', '&copy;&trade;&reg;',
  '&#169; &#x27; &#x1F600;', '&nbsp;&nbsp;spaced', 'quote " and \' apos',
  'less < than', 'amp & ersand', 'tag-ish </x> text', 'emoji \u{1F600} here',
  '&unknownentity; &amp', 'line\nbreak\ttab', 'trailing &'
];
// Attribute name → value generators. Mix of always-stripped (on*), scheme attrs,
// style, class, data/aria, booleans, numeric, and a couple odd ones.
const ATTRS = [
  ['class', (r) => Array.from({ length: 1 + int(r, 3) }, () => pick(r, CLASS_TOKENS)).join(' ')],
  ['id', (r) => 'id' + int(r, 100)],
  ['href', (r) => pick(r, SCHEMES_VALUES)],
  ['src', (r) => pick(r, SCHEMES_VALUES)],
  ['style', (r) => pick(r, STYLE_VALUES)],
  ['title', (r) => pick(r, TEXT_BITS)],
  ['alt', (r) => pick(r, TEXT_BITS)],
  ['target', () => '_blank'],
  ['rel', () => 'noopener noreferrer'],
  ['role', () => 'region'],
  ['data-x', (r) => 'd' + int(r, 50)],
  ['aria-label', (r) => pick(r, TEXT_BITS)],
  ['width', (r) => '' + int(r, 500)],
  ['height', (r) => '' + int(r, 500)],
  ['colspan', (r) => '' + (1 + int(r, 4))],
  ['type', () => 'text'],
  ['name', (r) => 'field' + int(r, 20)],
  ['value', (r) => pick(r, TEXT_BITS)],
  ['placeholder', (r) => pick(r, TEXT_BITS)],
  ['disabled', () => ''],
  ['checked', () => ''],
  ['required', () => ''],
  ['srcset', () => 'https://cdn.example.com/a.png 1x, https://cdn.example.com/a2.png 2x'],
  ['onclick', () => 'doEvil()'],
  ['onmouseover', () => 'leak()'],
  ['xmlns', () => 'http://www.w3.org/2000/svg'],
  ['contenteditable', () => 'false'],
  ['tabindex', (r) => '' + int(r, 5)]
];

function genAttrs(rand) {
  const n = int(rand, 5);
  const used = new Set();
  let out = '';
  for (let i = 0; i < n; i++) {
    const [name, val] = pick(rand, ATTRS);
    if (used.has(name)) continue;
    used.add(name);
    const v = val(rand);
    // Vary quoting: double, single, unquoted (only when safe), or valueless.
    const q = rand();
    if (v === '') {
      out += ' ' + name; // boolean-style
    } else if (q < 0.6) {
      out += ` ${name}="${v.replace(/"/g, '&quot;')}"`;
    } else if (q < 0.85) {
      out += ` ${name}='${v.replace(/'/g, '&#39;')}'`;
    } else if (/^[A-Za-z0-9./:_#?=&;%+-]+$/.test(v)) {
      out += ` ${name}=${v}`; // unquoted, only simple values
    } else {
      out += ` ${name}="${v.replace(/"/g, '&quot;')}"`;
    }
  }
  return out;
}

function genText(rand) {
  const n = 1 + int(rand, 3);
  return Array.from({ length: n }, () => pick(rand, TEXT_BITS)).join(' ');
}

function genNode(rand, depth, budget) {
  budget.n--;
  if (budget.n <= 0 || depth > 5) return genText(rand);
  const roll = rand();
  if (roll < 0.18) return genText(rand);
  if (roll < 0.24) return `<!-- ${pick(rand, TEXT_BITS)} -->`;
  if (roll < 0.34) {
    const tag = pick(rand, VOID_TAGS);
    const slash = chance(rand, 0.5) ? ' /' : '';
    return `<${tag}${genAttrs(rand)}${slash}>`;
  }
  const tag = pick(rand, CONTAINER_TAGS);
  const childCount = int(rand, 4);
  let inner = '';
  // Raw-text tags (script/style/textarea/title) get text-only bodies.
  const rawText = tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title';
  for (let i = 0; i < childCount && budget.n > 0; i++) {
    inner += rawText ? genText(rand) : genNode(rand, depth + 1, budget);
  }
  return `<${tag}${genAttrs(rand)}>${inner}</${tag}>`;
}

/** Generate one well-formed document string. */
export function genDoc(rand) {
  const budget = { n: 6 + int(rand, 18) };
  let html = '';
  const top = 1 + int(rand, 3);
  for (let i = 0; i < top; i++) html += genNode(rand, 0, budget);
  // Occasionally wrap in html/body so `enforceHtmlBoundary` has a boundary to act
  // on, and bare structural tags get exercised.
  const wrap = rand();
  if (wrap < 0.06) return `<html><head><title>t</title></head><body>${html}</body></html>`;
  if (wrap < 0.1) return `<body>${html}</body>`;
  return html;
}

// ---------------------------------------------------------------------------
// Option-config matrix — every config is passed IDENTICALLY to both libraries,
// so any output difference is a true divergence. All callbacks are pure &
// deterministic.
// ---------------------------------------------------------------------------
const dropEmpty = (frame) => frame.tag === 'p' && !frame.text.trim();
const upper = (text) => text.toUpperCase();
const bToStrong = { b: 'strong', i: 'em' };

export const CONFIGS = [
  { label: 'defaults', opts: {} },
  {
    label: 'passthrough',
    opts: {
      allowedTags: false,
      allowedAttributes: false,
      allowVulnerableTags: true
    }
  },
  {
    label: 'restrictive',
    opts: { allowedTags: ['p', 'a', 'b', 'i', 'span', 'ul', 'li'], allowedAttributes: { a: ['href'] } }
  },
  { label: 'mode-escape', opts: { disallowedTagsMode: 'escape' } },
  { label: 'mode-recursiveEscape', opts: { disallowedTagsMode: 'recursiveEscape' } },
  { label: 'mode-completelyDiscard', opts: { disallowedTagsMode: 'completelyDiscard' } },
  {
    label: 'allowedClasses',
    opts: {
      allowedClasses: { '*': ['card', 'featured'], div: ['big', /^col-\d+$/] }
    }
  },
  {
    label: 'allowedStyles',
    opts: {
      allowedAttributes: { '*': ['style', 'class'] },
      allowedStyles: { '*': { color: [/.*/], 'font-size': [/^\d+px$/] }, div: { 'background-image': [/.*/] } }
    }
  },
  { label: 'transformTags-str', opts: { transformTags: bToStrong } },
  {
    label: 'transformTags-fn',
    opts: {
      transformTags: {
        a: (tagName, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'nofollow' } })
      }
    }
  },
  {
    label: 'schemes',
    opts: { allowedSchemes: ['https'], allowProtocolRelative: false }
  },
  {
    label: 'schemesByTag',
    opts: {
      allowedSchemesByTag: { a: ['https', 'mailto'], img: ['data', 'https'] },
      allowedAttributes: { a: ['href'], img: ['src'] }
    }
  },
  { label: 'enforceHtmlBoundary', opts: { enforceHtmlBoundary: true } },
  {
    label: 'parser-no-lowercase',
    opts: { parser: { lowerCaseTags: false, lowerCaseAttributeNames: false } }
  },
  { label: 'parser-no-decode', opts: { parser: { decodeEntities: false } } },
  { label: 'nestingLimit', opts: { nestingLimit: 3 } },
  { label: 'exclusiveFilter', opts: { exclusiveFilter: dropEmpty } },
  { label: 'textFilter', opts: { textFilter: upper } },
  {
    label: 'preserveEscaped',
    opts: { disallowedTagsMode: 'escape', preserveEscapedAttributes: true }
  },
  {
    label: 'selfClosing+nonBoolean+emptyAttrs',
    opts: {
      selfClosing: ['img', 'br', 'hr', 'source'],
      nonBooleanAttributes: ['*'],
      allowedEmptyAttributes: ['alt', 'value']
    }
  },
  { label: 'nonTextTags', opts: { nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'] } },
  {
    label: 'iframe-hostnames',
    opts: {
      allowedTags: ['iframe', 'div', 'p'],
      allowedAttributes: { iframe: ['src'] },
      allowedIframeHostnames: ['www.youtube.com', 'player.vimeo.com'],
      allowIframeRelativeUrls: false
    }
  },
  {
    label: 'script-hostnames',
    opts: {
      allowedTags: ['script', 'div', 'p'],
      allowedAttributes: { script: ['src'] },
      allowedScriptHostnames: ['example.com'],
      allowVulnerableTags: true
    }
  },
  {
    label: 'allowedAttributes-glob',
    opts: { allowedAttributes: { '*': ['data-*', 'class'], a: ['href'] } }
  },
  { label: 'parseStyleAttributes-off', opts: { parseStyleAttributes: false, allowedAttributes: { '*': ['style'] } } }
];
