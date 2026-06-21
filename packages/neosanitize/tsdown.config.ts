import { defineConfig } from 'tsdown';

const shared = {
	dts: true,
	clean: false, // a single `rm -rf dist` in the build script cleans once for both configs
	outDir: 'dist',
	sourcemap: true,
	target: 'es2025',
} as const;

// Named entries pin the output path (`{ 'a/b': 'src/a/b.ts' }` -> `dist/a/b.*`),
// so splitting into two configs doesn't flatten the directory structure.
export default defineConfig([
	// `.` (new engine) + browser build + the presets barrel — ESM only.
	{
		...shared,
		entry: {
			'main/index': 'src/main/index.ts',
			'main/browser': 'src/main/browser.ts',
			'main/presets/index': 'src/main/presets/index.ts',
		},
		format: ['esm'],
	},
	// `./legacy` — DUAL ESM + CJS, because the original sanitize-html it drops in
	// for is CommonJS (`const sanitize = require('sanitize-html')`).
	{
		...shared,
		entry: { 'legacy/index': 'src/legacy/entry.ts' },
		format: ['esm', 'cjs'],
	},
]);
