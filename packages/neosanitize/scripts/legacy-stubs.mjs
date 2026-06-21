// Generates the root-level `legacy.*` entry stubs. They are gitignored (build
// artifacts) but SHIPPED via package.json `files: ["dist", "legacy.*"]`, so that
// `neosanitize/legacy` resolves even under toolchains that bypass the `exports`
// map — older bundlers, and TypeScript with `moduleResolution: node` (classic),
// which look for `<pkg>/legacy.js` / `<pkg>/legacy.d.ts` at the package root.
//
// Run by the build script, after tsdown, from the package directory.
import { writeFileSync, copyFileSync } from 'node:fs';

// Tiny re-export stubs — the real builds live in dist/ (the legacy port is a
// single self-contained file, so a re-export is enough; no chunk graph to follow).
writeFileSync('legacy.js', "export { default } from './dist/legacy/index.mjs';\n");
writeFileSync('legacy.cjs', "module.exports = require('./dist/legacy/index.cjs');\n");

// Types: copy the dist declarations verbatim (they have no relative imports, so
// they're self-contained and resolve standalone under every moduleResolution).
copyFileSync('dist/legacy/index.d.mts', 'legacy.d.ts');
copyFileSync('dist/legacy/index.d.cts', 'legacy.d.cts');

console.log('✓ generated root stubs: legacy.js, legacy.cjs, legacy.d.ts, legacy.d.cts');
