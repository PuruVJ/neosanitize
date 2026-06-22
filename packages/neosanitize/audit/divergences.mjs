/**
 * Differential parity harness: our rewrite (dist/index.mjs) vs. the ORIGINAL
 * sanitize-html. Every case below is a concrete divergence (or parity check)
 * surfaced while auditing the rewrite for drop-in replacement.
 *
 *   pnpm build && node audit/divergences.mjs            # all areas
 *   node audit/divergences.mjs parser style scheme url  # filter by area tag
 *
 * Output: for each case where orig !== ours, prints input + both outputs and
 * which side is MORE PERMISSIVE (security signal). Exit code = # of divergences
 * in the "security" risk tier (so CI can gate on it).
 *
 * This is the artifact behind the audit — read it, run it, extend it.
 */
import original from 'sanitize-html';
import ours from '../dist/legacy/index.mjs';

// passthrough exposes the raw parser; vuln flag silences the per-call warning
const PASS = { allowedTags: false, allowedAttributes: false, allowVulnerableTags: true };
const TEXT = { allowedTags: ['p'], allowedAttributes: {} };

/**
 * area  : tag for filtering
 * risk  : 'security' (ours more permissive on dangerous input) | 'correctness' | 'parity'
 * html  : input
 * opts  : sanitize options (default: PASS)
 * note  : what it demonstrates
 */
const CASES = [
  // ---- PARSER: tag-name handling ------------------------------------------
  { area: 'parser', risk: 'security', note: 'tag-name truncated → disallowed tag admitted',
    html: '<a]style="x" href="ok">y</a]>', opts: { allowedTags: ['a'], allowedAttributes: { a: ['href'] } } },
  { area: 'parser', risk: 'correctness', note: 'tag name split at non-alnum',
    html: '<foo-bar baz>x</foo-bar>' },
  { area: 'parser', risk: 'correctness', note: 'NUL byte truncates tag name',
    html: '<a\x00b>x</a>' },

  // ---- PARSER: special regions --------------------------------------------
  { area: 'parser', risk: 'security', note: 'CDATA inner markup leaks instead of being discarded',
    html: 'x<![CDATA[<script>evil</script>]]>y' },
  { area: 'parser', risk: 'correctness', note: 'short comment <!--> boundary',
    html: '<!--->x-->y' },
  { area: 'parser', risk: 'correctness', note: '</> emitted as text by original',
    html: 'a</>b' },

  // ---- PARSER: raw-text tag set -------------------------------------------
  { area: 'parser', risk: 'parity', note: 'noscript wrongly treated as raw-text',
    html: '<noscript><b>hi</b></noscript>', opts: { allowedTags: ['noscript', 'b'], allowedAttributes: {} } },
  { area: 'parser', risk: 'parity', note: 'title content should be entity-decoded',
    html: '<title>a&amp;b &#65;</title>', opts: { allowedTags: ['title'], allowedAttributes: {} } },

  // ---- PARSER: implicit open/close ----------------------------------------
  { area: 'parser', risk: 'correctness', note: 'stray </p> → implicit <p></p>',
    html: 'x</p>y' },
  { area: 'parser', risk: 'correctness', note: 'stray </br> → <br />',
    html: 'x</br>y' },
  { area: 'parser', risk: 'correctness', note: 'trailing < should become &lt;',
    html: 'a<' },
  { area: 'parser', risk: 'correctness', note: 'td should close th (implies-close table)',
    html: '<table><tr><td>a<th>b</tr></table>', opts: { allowedTags: ['table', 'tr', 'td', 'th'], allowedAttributes: {} } },
  { area: 'parser', risk: 'correctness', note: 'select/input implies-close (formTags) missing',
    html: '<select>a<input>b', opts: { allowedTags: ['select', 'input'], allowedAttributes: {} } },

  // ---- STYLE / CSS ---------------------------------------------------------
  { area: 'style', risk: 'security', note: 'property-name case-fold bypasses case-sensitive allowedStyles',
    html: '<p style="COLOR: #ff0000">x</p>',
    opts: { allowedTags: ['p'], allowedAttributes: { p: ['style'] }, allowedStyles: { '*': { color: [/^#[0-9a-f]{6}$/i] } } } },
  { area: 'style', risk: 'correctness', note: 'malformed CSS should drop whole attribute (postcss throws)',
    html: '<p style="content: \'unclosed">x</p>', opts: { allowedTags: ['p'], allowedAttributes: { p: ['style'] } } },
  { area: 'style', risk: 'correctness', note: 'CSS comment should be stripped',
    html: '<p style="color: red /* c */">x</p>', opts: { allowedTags: ['p'], allowedAttributes: { p: ['style'] } } },
  { area: 'style', risk: 'correctness', note: '! important (spaced) normalization',
    html: '<p style="color: red ! important">x</p>', opts: { allowedTags: ['p'], allowedAttributes: { p: ['style'] } } },
  { area: 'style', risk: 'correctness', note: 'empty value kept by postcss',
    html: '<p style="color:">x</p>', opts: { allowedTags: ['p'], allowedAttributes: { p: ['style'] } } },

  // ---- SCHEME / DEFAULTS ---------------------------------------------------
  { area: 'scheme', risk: 'security', note: 'default allowedSchemesAppliedToAttributes truncated 20→3: poster',
    html: '<video poster="javascript:alert(1)">x</video>', opts: { allowedTags: ['video'], allowedAttributes: { video: ['poster'] } } },
  { area: 'scheme', risk: 'security', note: '...: form action',
    html: '<form action="javascript:alert(1)">x</form>', opts: { allowedTags: ['form'], allowedAttributes: { form: ['action'] } } },
  { area: 'scheme', risk: 'security', note: '...: object data',
    html: '<object data="javascript:alert(1)">x</object>', opts: { allowedTags: ['object'], allowedAttributes: { object: ['data'] } } },
  { area: 'scheme', risk: 'security', note: '...: a xlink:href',
    html: '<a xlink:href="javascript:alert(1)">x</a>', opts: { allowedTags: ['a'], allowedAttributes: { a: ['xlink:href'] } } },
  { area: 'scheme', risk: 'security', note: '...: button formaction',
    html: '<button formaction="javascript:alert(1)">x</button>', opts: { allowedTags: ['button'], allowedAttributes: { button: ['formaction'] } } },

  // ---- URL / SRCSET --------------------------------------------------------
  { area: 'url', risk: 'security', note: 'imagesrcset not sanitized (dangerous scheme passes)',
    html: '<img imagesrcset="https://a.png 1x, vbscript:x 2x">', opts: { allowedTags: ['img'], allowedAttributes: { img: ['imagesrcset'] } } },

  // ---- PARITY SANITY (these SHOULD match — guard against regressions) ------
  { area: 'scheme', risk: 'parity', note: 'OK: default src javascript stripped (matches)',
    html: '<img src="javascript:alert(1)">' },
  { area: 'url', risk: 'parity', note: 'OK: classic srcset filter (matches)',
    html: '<img srcset="javascript:alert(1) 1x, https://ok.com/a.png 2x">', opts: { allowedTags: ['img'], allowedAttributes: { img: ['srcset'] } } },
  { area: 'url', risk: 'parity', note: 'OK: srcset exponent descriptor 1e2x (matches)',
    html: '<img srcset="https://a.png 1e2x">', opts: { allowedTags: ['img'], allowedAttributes: { img: ['srcset'] } } },
  { area: 'url', risk: 'parity', note: 'OK: srcset uppercase descriptor rejected (matches)',
    html: '<img srcset="https://a.png 2X">', opts: { allowedTags: ['img'], allowedAttributes: { img: ['srcset'] } } },
  { area: 'url', risk: 'parity', note: 'OK: srcset 0w rejected (matches)',
    html: '<img srcset="https://a.png 0w">', opts: { allowedTags: ['img'], allowedAttributes: { img: ['srcset'] } } },
  { area: 'parser', risk: 'parity', note: 'OK: short comment <!--> boundary (matches)',
    html: '<!--->x-->y' },
];

const filterTags = process.argv.slice(2);
const cases = filterTags.length ? CASES.filter((c) => filterTags.includes(c.area)) : CASES;

function morePermissive(orig, ourOut) {
  // crude heuristic: more surviving content / a dangerous scheme present in ours
  const danger = /(javascript:|vbscript:|<script)/i;
  if (danger.test(ourOut) && !danger.test(orig)) return 'OURS (dangerous!)';
  if (ourOut.length > orig.length) return 'ours';
  if (orig.length > ourOut.length) return 'orig';
  return '—';
}

let diverged = 0;
let securityDiverged = 0;
const byArea = {};

console.log('\nDifferential parity: neosanitize vs. original sanitize-html\n' + '='.repeat(74));
for (const c of cases) {
  const opts = c.opts ?? PASS;
  let a, b, err = null;
  try { a = original(c.html, opts); } catch (e) { err = 'orig threw: ' + e.message; }
  try { b = ours(c.html, opts); } catch (e) { err = (err ? err + ' | ' : '') + 'ours threw: ' + e.message; }
  byArea[c.area] ??= { total: 0, diff: 0 };
  byArea[c.area].total++;
  const same = !err && a === b;
  if (same) continue;
  diverged++;
  byArea[c.area].diff++;
  if (c.risk === 'security') securityDiverged++;
  const perm = err ? '' : `  [more permissive: ${morePermissive(a, b)}]`;
  console.log(
    `\n[${c.area}/${c.risk}] ${c.note}${perm}` +
    `\n  in  : ${JSON.stringify(c.html)}` +
    (err ? `\n  ERR : ${err}` : `\n  orig: ${JSON.stringify(a)}\n  ours: ${JSON.stringify(b)}`)
  );
}

console.log('\n' + '='.repeat(74));
console.log('by area:', Object.entries(byArea).map(([k, v]) => `${k} ${v.diff}/${v.total}`).join('  ·  '));
console.log(`total divergences: ${diverged}/${cases.length}  ·  security-tier: ${securityDiverged}`);
console.log('(security-tier = ours more permissive than original on a dangerous input)\n');

process.exitCode = securityDiverged;
