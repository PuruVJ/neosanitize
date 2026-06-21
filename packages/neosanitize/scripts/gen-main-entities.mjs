/**
 * Generates `src/main/parser/entities.ts` from the shared WHATWG spec JSON.
 *
 * Main shares NO runtime code with ./legacy, but both may couple to the same
 * SPEC DATA at build time — that's coupling to WHATWG, not to each other. This
 * emits main's own independent copy of the named character reference table for
 * the tokenizer's named-character-reference state.
 *
 *   node scripts/gen-main-entities.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(here, 'entities-whatwg.json'), 'utf8'));

const pairs = [];
let maxLen = 0;
for (const rawKey of Object.keys(src)) {
  const name = rawKey.slice(1); // drop leading '&'
  pairs.push([name, src[rawKey].characters]);
  if (name.length > maxLen) maxLen = name.length;
}
pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));

const json = "'" + JSON.stringify(pairs).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const out = `// <generated> from scripts/entities-whatwg.json — DO NOT EDIT BY HAND.
// WHATWG named character references for the tokenizer's named-character-reference
// state. Main's own independent copy (shares no runtime code with ./legacy);
// both generate from the same spec JSON. ${pairs.length} entries.
// Keys keep the trailing ';' for semicolon forms; legacy no-';' forms included.
export const NAMED_REFS: Map<string, string> = new Map(JSON.parse(
  ${json}
));
/** Longest named-reference key length (for bounding the match scan). */
export const MAX_NAMED_REF_LEN = ${maxLen};
`;

mkdirSync(join(here, '..', 'src', 'main', 'parser'), { recursive: true });
writeFileSync(join(here, '..', 'src', 'main', 'parser', 'entities.ts'), out);
console.log(`generated src/main/parser/entities.ts: ${pairs.length} refs, maxLen ${maxLen}`);
