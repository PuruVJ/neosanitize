/**
 * Single-pass HTML escapers, shared by the sanitizer serializer and the
 * policy-free `whatwg-parser` serializer.
 *
 * No regex, no `.replace()` chain (which copies a big document once per replace).
 * Clean strings (the common case) are returned as-is, zero allocation.
 *
 * - Short strings (< SCAN_MAX): an inline charCode scan. Cheapest when builtin
 *   call overhead would dominate.
 * - Longer strings: `indexOf` jumping. Track the next position of each special
 *   char with native `indexOf` (memchr speed), always handle the nearest, and
 *   re-search only for the char just consumed. The JS loop runs once per HIT, not
 *   once per character. Measured vs a per-char loop: ~2.7x on prose with a few
 *   escapes, ~1.2x on escape-dense code, equal on clean text. Vs the old
 *   `.replace()` chain: ~2.3x, ~1.5x and ~8x.
 */

/** Below this length, scan inline rather than calling builtins. */
const SCAN_MAX = 32;

// ---- text: & < > U+00A0 ----------------------------------------------------

/** Escape text content: `&`, `<`, `>`, U+00A0. */
export function escapeText(s: string): string {
  return s.length < SCAN_MAX ? scanText(s) : jumpText(s);
}

/** `out + escapeText(s)`. The escaped piece is built on its own and attached
 * once, which measured faster than appending every fragment onto `out`. */
export function appendText(out: string, s: string): string {
  return out + (s.length < SCAN_MAX ? scanText(s) : jumpText(s));
}

function scanText(s: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep: string;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 160) rep = '&nbsp;';
    else continue;
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

function jumpText(s: string): string {
  let amp = s.indexOf('&'), lt = s.indexOf('<'), gt = s.indexOf('>'), nb = s.indexOf(' ');
  if (amp === -1 && lt === -1 && gt === -1 && nb === -1) return s;
  let out = '';
  let last = 0;
  for (;;) {
    // nearest pending hit (-1 = that char has no more occurrences)
    let i = amp, which = 0;
    if (lt !== -1 && (i === -1 || lt < i)) { i = lt; which = 1; }
    if (gt !== -1 && (i === -1 || gt < i)) { i = gt; which = 2; }
    if (nb !== -1 && (i === -1 || nb < i)) { i = nb; which = 3; }
    if (i === -1) break;
    out += s.slice(last, i);
    if (which === 0) { out += '&amp;'; amp = s.indexOf('&', i + 1); }
    else if (which === 1) { out += '&lt;'; lt = s.indexOf('<', i + 1); }
    else if (which === 2) { out += '&gt;'; gt = s.indexOf('>', i + 1); }
    else { out += '&nbsp;'; nb = s.indexOf(' ', i + 1); }
    last = i + 1;
  }
  return out + s.slice(last);
}

// ---- attribute values: & " < > U+00A0 -----------------------------------------

/** Escape a double-quoted attribute value: `&`, `"`, `<`, `>`, U+00A0. `<`/`>` are
 * escaped as the current HTML spec and Chrome 138+ do, so a value can't close a
 * scripting-on raw-text parent (`</noscript>`) when the output is re-parsed. */
export function escapeAttr(s: string): string {
  return s.length < SCAN_MAX ? scanAttr(s) : jumpAttr(s);
}

/** `out + escapeAttr(s)`. */
export function appendAttr(out: string, s: string): string {
  return out + (s.length < SCAN_MAX ? scanAttr(s) : jumpAttr(s));
}

function scanAttr(s: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep: string;
    if (c === 38) rep = '&amp;';
    else if (c === 34) rep = '&quot;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 160) rep = '&nbsp;';
    else continue;
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

function jumpAttr(s: string): string {
  let amp = s.indexOf('&'), qt = s.indexOf('"'), lt = s.indexOf('<'), gt = s.indexOf('>'), nb = s.indexOf(' ');
  if (amp === -1 && qt === -1 && lt === -1 && gt === -1 && nb === -1) return s;
  let out = '';
  let last = 0;
  for (;;) {
    let i = amp, which = 0;
    if (qt !== -1 && (i === -1 || qt < i)) { i = qt; which = 1; }
    if (lt !== -1 && (i === -1 || lt < i)) { i = lt; which = 2; }
    if (gt !== -1 && (i === -1 || gt < i)) { i = gt; which = 3; }
    if (nb !== -1 && (i === -1 || nb < i)) { i = nb; which = 4; }
    if (i === -1) break;
    out += s.slice(last, i);
    if (which === 0) { out += '&amp;'; amp = s.indexOf('&', i + 1); }
    else if (which === 1) { out += '&quot;'; qt = s.indexOf('"', i + 1); }
    else if (which === 2) { out += '&lt;'; lt = s.indexOf('<', i + 1); }
    else if (which === 3) { out += '&gt;'; gt = s.indexOf('>', i + 1); }
    else { out += '&nbsp;'; nb = s.indexOf(' ', i + 1); }
    last = i + 1;
  }
  return out + s.slice(last);
}
