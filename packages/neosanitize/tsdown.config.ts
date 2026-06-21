import { defineConfig } from 'tsdown';

export default defineConfig({
	// Two independent entry points (zero shared runtime code):
	//   src/main/index.ts   -> dist/main/index.mjs   (`.`        — new engine)
	//   src/legacy/index.ts -> dist/legacy/index.mjs (`./legacy` — sanitize-html port)
	entry: [
		'src/main/index.ts',
		// Browser build: same Sanitizer API, parses via native DOMParser (the
		// `browser` export condition resolves here) → ships zero parser bytes.
		'src/main/browser.ts',
		'src/legacy/index.ts',
		// All curated presets live under the single `neosanitize/presets` barrel.
		'src/main/presets/index.ts'
	],
	format: ['esm'],
	dts: true,
	clean: true,
	outDir: 'dist',
	sourcemap: true,
	target: 'es2025',
});
