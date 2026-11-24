import { sveltekit } from '@sveltejs/kit/vite';
import { content } from '@ogygia/content/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// the bench charts and the version badge import JSON from packages/neosanitize
	server: { fs: { allow: ['..'] } },
	plugins: [ogygia(), content({ markdown: {} }), sveltekit()],
});
