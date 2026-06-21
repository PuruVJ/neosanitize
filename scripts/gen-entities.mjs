/**
 * Injects the canonical WHATWG named character reference table directly into
 * src/index.ts, between the `<generated-entities>` / `</generated-entities>`
 * markers. Source of truth: scripts/entities-whatwg.json — a verbatim copy of
 * https://html.spec.whatwg.org/entities.json.
 *
 * Everything ships in one zero-dependency, isomorphic file. Re-run after
 * updating the JSON:
 *
 *   node scripts/gen-entities.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, '..', 'src', 'legacy', 'index.ts');
const src = JSON.parse(readFileSync(join(here, 'entities-whatwg.json'), 'utf8'));

// WHATWG keys look like "&copy;" / "&copy" (legacy, no semicolon). We strip the
// leading "&" and keep the trailing ";" so the decoder can do longest-match and
// distinguish semicolon-terminated forms from legacy ones by the key itself.
const map = {};
let maxLen = 0;
for (const rawKey of Object.keys(src)) {
  const key = rawKey.slice(1);
  map[key] = src[rawKey].characters;
  const letters = key.endsWith(';') ? key.length - 1 : key.length;
  if (letters > maxLen) maxLen = letters;
}

const keys = Object.keys(map).sort();
const legacy = keys.filter((k) => !k.endsWith(';')).length;

const PER_LINE = 6;
// Emit the table as a sorted array of [name, char] pairs, fed straight into a
// Map. JSON.parse('[[...]]') builds the pairs far faster than an object-literal
// AST (cheap cold start), and a Map gives single-op `.get()` lookups that are
// also inherently safe (no inherited 'toString'/'constructor' entries).
const pairs = keys.map((k) => [k, map[k]]);
const jsonLiteral =
  "'" + JSON.stringify(pairs).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

const block = `// <generated-entities> — do not edit by hand
// Full WHATWG HTML5 named character reference table: ${keys.length} entries
// (${legacy} legacy no-semicolon forms). Source: scripts/entities-whatwg.json.
// A Map built from a JSON.parse()'d pair array — fast cold start + fast lookups.
/** Longest entity name in letters (excluding any trailing ";"). */
const MAX_ENTITY_NAME_LENGTH = ${maxLen};
const NAMED_ENTITIES: Map<string, string> = new Map(JSON.parse(
  ${jsonLiteral}
));
// </generated-entities>`;

const code = readFileSync(indexPath, 'utf8');
const re = /\/\/ <generated-entities>[\s\S]*?\/\/ <\/generated-entities>/;
if (!re.test(code)) {
  throw new Error('generated-entities markers not found in src/index.ts');
}
writeFileSync(indexPath, code.replace(re, block));
console.log(
  `injected ${keys.length} entities (${legacy} legacy) into src/index.ts, max name length ${maxLen}`
);
