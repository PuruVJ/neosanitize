// One-shot move of the VitePress pages into ogygia's folder layout (kept for the record).
// Each page becomes src/content/docs/NN-section/NN-page/+doc.svx: the H1 moves into the
// `title` frontmatter, the old address becomes `redirect_from`, internal links are rewritten.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(DOCS, 'src/content/docs');

// [section folder, label, [[page folder, old path, title]]], in the old sidebar's order.
const SECTIONS = [
	['00-guide', 'Getting started', [['00-introduction', 'guide', 'Introduction']]],
	['01-drop-in', 'Drop-in', [['00-legacy', 'legacy', 'Legacy']]],
	['02-engine', 'Main engine', [['00-sanitizing', 'sanitizing', 'Sanitizing']]],
	['03-parsing', 'Parsing', [['00-whatwg-parser', 'whatwg-parser', 'WHATWG parser']]],
	[
		'04-adapters',
		'Parser adapters',
		[
			['00-overview', 'adapters', 'Adapter system'],
			['01-parse5', 'adapters/parse5', 'parse5 adapter'],
			['02-htmlparser2', 'adapters/htmlparser2', 'htmlparser2 adapter'],
		],
	],
	[
		'05-reference',
		'Reference',
		[
			['00-performance', 'performance', 'Performance'],
			['01-security', 'security', 'Security model'],
			['02-design', 'design', 'Architecture & design'],
		],
	],
];

const strip = (s) => s.replace(/^\d+-/, '');
const NEW = new Map();
for (const [sec, , pages] of SECTIONS)
	for (const [page, old] of pages) NEW.set(old, `/${strip(sec)}/${strip(page)}`);

// `/guide#which-engine` → `/guide/introduction#which-engine`; the fragment survives only
// when it is not the page's own H1 (the layout renders the title, so that anchor is gone).
function relink(md, h1ids) {
	return md.replace(/\]\(\/([^)#\s]*)(#[^)\s]*)?\)/g, (all, path, hash = '') => {
		const to = NEW.get(path);
		if (!to) return all;
		return `](${to}${h1ids.get(path) === hash.slice(1) ? '' : hash})`;
	});
}

const src = new Map();
const h1ids = new Map();
for (const old of NEW.keys()) {
	const md = execFileSync('git', ['show', `HEAD:docs/${old}.md`], { cwd: DOCS, encoding: 'utf8' });
	src.set(old, md);
	const h1 = /^# (.+)$/m.exec(md)?.[1] ?? '';
	h1ids.set(old, h1.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''));
}

for (const [sec, label, pages] of SECTIONS) {
	mkdirSync(join(OUT, sec), { recursive: true });
	writeFileSync(join(OUT, sec, '+meta.json'), JSON.stringify({ label }) + '\n');
	for (const [page, old, title] of pages) {
		let md = src.get(old);
		let script = '';
		md = md.replace(/^<script setup>\n([\s\S]*?)<\/script>\n+/, (_, body) => {
			script = body;
			return '';
		});
		md = md.replace(/^# .+\n+/m, '');
		md = relink(md, h1ids);
		// a page whose address did not change needs no alias (it would shadow itself)
		const alias = NEW.get(old) === `/${old}` ? '' : `redirect_from: ${old}\n`;
		const fm = `---\ntitle: ${JSON.stringify(title)}\n${alias}---\n\n`;
		const out = fm + (script ? `<script>\n${script}</script>\n\n` : '') + md;
		mkdirSync(join(OUT, sec, page), { recursive: true });
		writeFileSync(join(OUT, sec, page, '+doc.svx'), out);
	}
}
console.log([...NEW].map(([a, b]) => `/${a} → ${b}`).join('\n'));
