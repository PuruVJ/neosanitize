import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// One plain-Markdown file with every page, in reading order, for language models.
export const prerender = true;

const DIR = join(process.cwd(), 'src/content/docs');

// Every page in sidebar order: the NN- prefixes sort the folder tree.
const pages = () =>
	readdirSync(DIR, { recursive: true, encoding: 'utf-8' })
		.filter((f) => f.endsWith('+doc.svx'))
		.sort();

// Strip the Svelte / container syntax so only Markdown is left.
function to_plain(md: string): string {
	const title = /^---\n[\s\S]*?^title:\s*(.+)$[\s\S]*?\n---\n/m.exec(md)?.[1];
	return (
		(title ? `# ${title}\n\n` : '') +
		md
			.replace(/^---\n[\s\S]*?\n---\n/, '') // frontmatter
			.replace(/<script[\s\S]*?<\/script>/g, '')
			.replace(/<style[\s\S]*?<\/style>/g, '')
			.replace(
				/<(EngineBench|AdapterBench|DomPurifyBench)\s*\/>/g,
				'_(interactive benchmark chart at https://neosanitize.puruvj.dev/reference/performance)_',
			)
			.replace(/^:::\s*\w+.*$/gm, '') // ::: tip / warning / code-group open
			.replace(/^:::\s*$/gm, '') // ::: close
			.replace(/\{#[\w-]+\}/g, '') // heading anchors {#id}
			.replace(/ \[[^\]\n]+\]$/gm, '') // code-group tab labels on fences
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

export function GET() {
	const parts = [
		'# neosanitize',
		'',
		'> Zero-dependency, isomorphic HTML sanitizer: a fast, browser-faithful WHATWG engine (deny-by-default) plus a byte-identical drop-in for sanitize-html. ~2.3× faster than sanitize-html, ~3 KB in the browser.',
		'',
		'Docs: https://neosanitize.puruvj.dev · npm: https://www.npmjs.com/package/neosanitize',
	];
	for (const file of pages()) {
		parts.push('\n\n---\n\n' + to_plain(readFileSync(join(DIR, file), 'utf-8')));
	}
	return new Response(parts.join('\n') + '\n', {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
