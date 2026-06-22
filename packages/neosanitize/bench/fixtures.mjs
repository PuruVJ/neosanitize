/**
 * Benchmark fixtures: realistic + adversarial HTML workloads.
 *
 * Each scenario pairs an input with the options both libraries receive, so the
 * two implementations always do the exact same work. Inputs are generated
 * deterministically (no Math.random) so runs are reproducible and comparable.
 */

const repeat = (fn, n) => Array.from({ length: n }, (_, i) => fn(i)).join('');

// --- realistic article block -------------------------------------------------
const articleBlock = (i) => `
<h2>Section heading number ${i}</h2>
<p>Lorem ipsum <strong>dolor</strong> sit <em>amet</em>, consectetur
<a href="https://example.com/articles/${i}?ref=feed&amp;page=2">adipiscing elit</a>.
Sed do <code>eiusmod(${i})</code> tempor incididunt ut labore et dolore magna aliqua.</p>
<ul>
  <li>First point about item ${i}</li>
  <li>Second point with <b>emphasis</b> and a <a href="/relative/${i}">relative link</a></li>
  <li>Third point &mdash; with an entity &amp; some <i>nuance</i></li>
</ul>
<blockquote>
  <p>&ldquo;A memorable quote ${i}&rdquo; &mdash;
  <a href="mailto:author${i}@example.com">the author</a></p>
</blockquote>
<figure>
  <img src="https://cdn.example.com/images/${i}.jpg" alt="Figure ${i}" width="640" height="480" />
  <figcaption>Caption text for figure ${i}</figcaption>
</figure>
<table>
  <thead><tr><th>Key</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>row ${i}</td><td>${i * 7}</td></tr>
    <tr><td>row ${i}b</td><td>${i * 13}</td></tr>
  </tbody>
</table>`;

// --- adversarial / XSS payload block ----------------------------------------
const xssBlock = (i) => `
<div class="post">Legitimate looking content block ${i}</div>
<script>alert('xss ${i}'); document.cookie;</script>
<img src="x" onerror="fetch('//evil.example/${i}')">
<a href="javascript:alert(${i})">innocent text</a>
<a href="  jAvAsCrIpT:void(0)">obfuscated scheme ${i}</a>
<iframe src="https://evil.example/frame/${i}" width="0" height="0"></iframe>
<svg onload="alert(${i})"><script>alert(1)</script></svg>
<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>
<p style="background-image:url(javascript:alert(${i}))">styled paragraph</p>
<form action="javascript:evil()"><input type="text" onfocus="steal()"></form>
<!-- a comment with <script>alert('in comment ${i}')</script> -->
<base href="//evil.example/">
<style>body { background: url('javascript:alert(1)') }</style>`;

// --- attribute-heavy block ---------------------------------------------------
const attrBlock = (i) => `
<div id="block-${i}" class="card featured highlight" data-index="${i}" data-track="impression"
     data-experiment="A/B" role="region" aria-label="Card ${i}" title="Card title ${i}"
     onclick="trackClick(${i})" style="color:#333;padding:8px" custom-attr="should-strip"
     tabindex="0" contenteditable="false">
  <span class="badge" data-id="${i}" data-secret="hidden" onmouseover="leak()">badge ${i}</span>
  <input type="text" name="field-${i}" value="default value" placeholder="Type here…"
         maxlength="120" required disabled autocomplete="off" onfocus="grab()" />
  <a href="https://example.com/${i}" target="_blank" rel="noopener" data-utm="campaign"
     onmousedown="track()" class="link primary">link ${i}</a>
</div>`;

// --- URL / scheme filtering block -------------------------------------------
const urlBlock = (i) => `
<p>
  <a href="https://example.com/${i}">https</a>
  <a href="http://example.com/${i}">http</a>
  <a href="//cdn.example.com/${i}">protocol-relative</a>
  <a href="/path/${i}">root-relative</a>
  <a href="relative/${i}.html">relative</a>
  <a href="mailto:user${i}@example.com">mailto</a>
  <a href="tel:+1555000${i}">tel</a>
  <a href="ftp://files.example.com/${i}">ftp</a>
  <a href="javascript:alert(${i})">javascript</a>
  <a href="data:text/html,<b>${i}</b>">data</a>
  <img src="https://cdn.example.com/${i}.png" srcset="https://cdn.example.com/${i}@2x.png 2x" />
</p>`;

// --- inline-style filtering block -------------------------------------------
const styleBlock = (i) => `
<p style="color: #ff0000; font-size: ${10 + (i % 8)}px; text-align: center; margin: 0 auto;
   background-color: rgb(${i % 255}, 100, 200); font-weight: bold; line-height: 1.5;
   position: absolute; z-index: 999; background-image: url(javascript:alert(${i}))">
  Styled paragraph ${i} with several declarations, some allowed and some not.
</p>
<span style="color:blue;text-decoration:underline;display:inline-block;width:50%">span ${i}</span>`;

// --- transformTags block -----------------------------------------------------
const transformBlock = (i) => `
<b>bold ${i}</b> and <i>italic ${i}</i> in a paragraph.
<ol><li>ordered a</li><li>ordered b</li></ol>
<a href="https://example.com/${i}">a link to transform</a>
<font size="3" color="red">old font tag ${i}</font>`;

// --- table-heavy block (single big table) -----------------------------------
const bigTable = (rows, cols) =>
  `<table border="1" cellpadding="4" class="data-grid">
    <thead><tr>${repeat((c) => `<th scope="col" data-col="${c}">Column ${c}</th>`, cols)}</tr></thead>
    <tbody>${repeat(
      (r) =>
        `<tr class="${r % 2 ? 'odd' : 'even'}" data-row="${r}">${repeat(
          (c) =>
            `<td data-cell="${r}-${c}" style="text-align:right" title="cell ${r},${c}">${r * c}</td>`,
          cols
        )}</tr>`,
      rows
    )}</tbody>
  </table>`;

// --- entity-heavy text -------------------------------------------------------
const entityBlock = (i) =>
  `<p>5 &lt; 6 &amp;&amp; 7 &gt; 3 &mdash; he said &ldquo;don&apos;t&rdquo; &amp; she &#x27;agreed&#x27; &nbsp;&nbsp; caf&eacute; na&iuml;ve r&eacute;sum&eacute; ${i} &copy;&trade;&reg; &hellip; &rarr; &larr; &times; &divide; &frac12; price: 50&cent; or &pound;40 or &euro;30 &#8364; emoji-ish &#x1F600;</p>`;

// --- deeply nested -----------------------------------------------------------
const nested = (depth) =>
  '<div class="wrap">'.repeat(depth) +
  '<p>deep content</p>' +
  '</div>'.repeat(depth);

// ============================================================================
// Scenario table, each: { name, description, html, options }
// ============================================================================

export const scenarios = [
  {
    name: 'simple-comment',
    description: 'small user comment, default options (fixed-overhead path)',
    html: '<p>Thanks for the write-up! Really <strong>helpful</strong>. See <a href="https://example.com/ref">this link</a> &amp; the <em>docs</em>.</p>',
    options: undefined,
  },
  {
    name: 'blog-post',
    description: 'realistic ~6KB article, default options',
    html: `<article>${repeat(articleBlock, 6)}</article>`,
    options: undefined,
  },
  {
    name: 'large-document',
    description: 'large ~120KB page, default options (sustained throughput)',
    html: `<main>${repeat(articleBlock, 120)}</main>`,
    options: undefined,
  },
  {
    name: 'xss-attack',
    description: 'adversarial payloads, default filtering (discard path)',
    html: `<body>${repeat(xssBlock, 25)}</body>`,
    options: undefined,
  },
  {
    name: 'attribute-filtering',
    description: 'attribute-dense markup with a custom allow-list',
    html: `<section>${repeat(attrBlock, 40)}</section>`,
    options: {
      allowedTags: ['div', 'span', 'input', 'a'],
      allowedAttributes: {
        div: ['id', 'class', 'data-index', 'role', 'aria-label', 'title'],
        span: ['class', 'data-id'],
        input: ['type', 'name', 'value', 'placeholder', 'maxlength', 'required', 'disabled'],
        a: ['href', 'target', 'rel', 'class'],
      },
    },
  },
  {
    name: 'url-scheme-filter',
    description: 'many anchors/imgs with varied URL schemes',
    html: `<div>${repeat(urlBlock, 40)}</div>`,
    options: undefined,
  },
  {
    name: 'style-filtering',
    description: 'inline styles validated against allowedStyles regexes',
    html: `<div>${repeat(styleBlock, 50)}</div>`,
    options: {
      allowedTags: ['p', 'span', 'div'],
      allowedAttributes: { '*': ['style'] },
      parseStyleAttributes: true,
      allowedStyles: {
        '*': {
          color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^[a-z]+$/i],
          'background-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/i],
          'font-size': [/^\d+(?:px|em|rem|%)$/],
          'text-align': [/^(?:left|right|center|justify)$/],
          'font-weight': [/^(?:normal|bold|\d{3})$/],
          'line-height': [/^[\d.]+$/],
          'text-decoration': [/^[a-z\- ]+$/i],
          display: [/^[a-z\-]+$/i],
          width: [/^\d+(?:px|%)$/],
        },
      },
    },
  },
  {
    name: 'transform-tags',
    description: 'transformTags + simpleTransform rewriting',
    html: `<div>${repeat(transformBlock, 50)}</div>`,
    // options.transformTags is built per-run in index.mjs (uses simpleTransform)
    needsTransform: true,
  },
  {
    name: 'escape-mode',
    description: 'disallowedTagsMode "escape" over disallowed-tag-heavy input',
    html: `<div>${repeat(xssBlock, 20)}</div>`,
    options: { disallowedTagsMode: 'escape' },
  },
  {
    name: 'passthrough',
    description: 'allowedTags/allowedAttributes false, raw parser throughput',
    html: `<article>${repeat(articleBlock, 30)}</article>`,
    // allowVulnerableTags acknowledges "allow everything" so neither library
    // logs a per-call vulnerability warning (which would skew timing with I/O).
    options: { allowedTags: false, allowedAttributes: false, allowVulnerableTags: true },
  },
  {
    name: 'entity-heavy',
    description: 'entity-dense text (decode + re-encode)',
    html: `<div>${repeat(entityBlock, 80)}</div>`,
    options: undefined,
  },
  {
    name: 'big-table',
    description: 'single large 60×8 table with cell attributes',
    html: bigTable(60, 8),
    options: {
      allowedTags: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
      allowedAttributes: { th: ['scope'], td: ['title'], '*': ['class'] },
    },
  },
  {
    name: 'deeply-nested',
    description: '250-level nested divs (recursion / nestingLimit path)',
    html: nested(250),
    options: undefined,
  },
];
