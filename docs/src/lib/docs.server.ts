import { content, links, outline, site } from '@ogygia/content';

// Every `NN-name/+doc.svx` under src/content/docs is a page, and the folders are the sidebar:
// the `NN-` prefix orders siblings (and is dropped from the URL), and each section's `+meta.json`
// names its group. So `04-adapters/01-parse5/+doc.svx` is the second page of "Parser adapters",
// at `/adapters/parse5`. Old VitePress addresses live on as `redirect_from` in each page's frontmatter.
const pages = content({
	loader: import.meta.og.loader.folder('../content/docs'),
});

export const docs = site({
	outline: outline([pages, { label: 'llms.txt', href: '/llms.txt' }]),
	checks: [links()],
	data: {
		title: 'neosanitize',
		description:
			'Zero-dependency, isomorphic HTML sanitizer: a fast, browser-faithful WHATWG engine (deny-by-default) plus a drop-in sanitize-html-compatible legacy engine. ~2.3× faster than sanitize-html, ~3 KB in the browser.',
		origin: 'https://neosanitize.puruvj.dev',
	},
});
