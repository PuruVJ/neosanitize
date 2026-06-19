import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	outDir: 'dist',
	sourcemap: true,
	target: 'es2025',
});
