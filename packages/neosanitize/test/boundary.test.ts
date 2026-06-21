/**
 * Import-boundary guard — makes the "zero shared runtime code" rule a CHECKED
 * invariant, not a good intention. `./legacy` (the byte-identical sanitize-html
 * port) and `.` (the new engine) must never import each other; legacy's whole
 * value is being a faithful, independent port, and main must stay free of
 * legacy's parity quirks. See docs/design.md §3.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

/** Does an import specifier reach into the sibling tree (`legacy` or `main`)? */
function crossesInto(spec: string, sibling: 'legacy' | 'main'): boolean {
  return (
    new RegExp(`(^|/)${sibling}(/|$)`).test(spec) || // relative path or subpath
    spec === `neosanitize/${sibling}` ||
    spec.endsWith(`/${sibling}`)
  );
}

describe('legacy ⇄ main import boundary', () => {
  it('nothing under src/main imports from src/legacy', () => {
    const offenders = walkTs('src/main')
      .map((f) => [f, importsOf(f).filter((s) => crossesInto(s, 'legacy'))] as const)
      .filter(([, hits]) => hits.length > 0);
    expect(offenders).toEqual([]);
  });

  it('nothing under src/legacy imports from src/main', () => {
    const offenders = walkTs('src/legacy')
      .map((f) => [f, importsOf(f).filter((s) => crossesInto(s, 'main'))] as const)
      .filter(([, hits]) => hits.length > 0);
    expect(offenders).toEqual([]);
  });
});
