<script lang="ts">
	import { Region } from 'ogygia';
	// the copy + permalink buttons on the code blocks, as on every doc page
	import { CodeChrome } from '@ogygia/content' with { wake: 'load' };

	const features = [
		{
			icon: '🌐',
			title: 'Browser-faithful parse',
			details:
				'A WHATWG/HTML5 tokenizer at 100% html5lib conformance. The tree you sanitize is the tree a browser builds, which closes parser-differential and mutation-XSS gaps by construction.',
		},
		{
			icon: '🔒',
			title: 'Deny-by-default',
			details:
				'Only the tags and attributes you allow-list survive. Behind them sits an inviolable baseline that strips scripts, <code>on*</code> handlers and <code>javascript:</code>/<code>data:</code> URLs even when your policy permits them.',
		},
		{
			icon: '⚡',
			title: '~2.3× faster',
			details:
				'Geomean 2.3× the throughput of the original sanitize-html across a 13-scenario benchmark. The policy compiles once; every call is just parse, walk, serialize.',
		},
		{
			icon: '🤏',
			title: '~3 KB in the browser',
			details:
				'The browser build parses with the platform’s own native <code>DOMParser</code>, so it ships zero parser bytes, about 3 KB brotli versus ~23 KB for the bundled-parser build.',
		},
		{
			icon: '🧩',
			title: 'Tree-shakeable, zero-dep',
			details:
				'ESM, side-effect-free, with subpath exports for the curated presets. No runtime dependencies, ever.',
		},
		{
			icon: '🔁',
			title: 'Drop-in legacy',
			details:
				'<code>./legacy</code> is a byte-identical re-implementation of sanitize-html 2.x, same API, same output, verified with millions of differential-fuzz cases. Migrate with no behaviour change.',
			href: '/guide/introduction#which-engine',
		},
	];

	const stats = [
		{ value: '2.3×', strong: 'faster', rest: 'than sanitize-html (geomean, 13 scenarios)' },
		{ value: '~3 KB', strong: 'browser build', rest: ', brotli, zero parser bytes' },
		{ value: '100%', strong: 'html5lib', rest: 'tokenizer conformance (6946/6946)' },
		{ value: '0', strong: 'mXSS holes', rest: 'across a 20,000-case adversarial fuzz' },
	];

	// The body below the hero, baked at build through the site's own markdown + Shiki pipeline.
	const body = import.meta.og.md(`
		## Build a sanitizer, then sanitize

		The API is **class-only by design**, you build a \`Sanitizer\` with an explicit policy and reuse it. There is deliberately no one-shot \`sanitize(html)\`: forcing an explicit policy means no implicit global default to misconfigure, and the policy compiles **once** so calls stay cheap.

		\`\`\`ts
		import { Sanitizer } from 'neosanitize';
		import * as presets from 'neosanitize/presets';

		// Build once (compiles the policy), reuse everywhere.
		const sanitizer = Sanitizer.builder(presets.ugc).allow('img', ['src', 'alt']).build();

		sanitizer.sanitize('<p>hi <img src=x onerror=alert(1)> <script>bad()<\/script></p>');
		// → '<p>hi <img src="x"> </p>'
		//   the onerror handler is stripped, <script> is dropped with its content.
		\`\`\`

		## The inviolable safe baseline

		Even if your allow-list permits them, the baseline **always** strips known-dangerous constructs, mirroring the browser's native \`setHTML()\`. An allow-list can never re-introduce them; only the explicit \`sanitizeUnsafe()\` opts out.

		\`\`\`ts
		const s = Sanitizer.builder().allow('a', ['href', 'onclick']).build();

		s.sanitize('<a href="javascript:alert(1)" onclick="x()">click</a>');
		// → '<a>click</a>'   ← javascript: URL and on* handler stripped despite being allow-listed
		\`\`\`

		Want to know exactly what was removed and why? Use **report mode**:

		\`\`\`ts
		const { html, removed } = s.sanitizeWithReport('<a href=javascript:alert(1) onclick=x>y</a>');
		// html    → '<a>y</a>'
		// removed → [
		//   { kind: 'url',  name: 'href',    reason: 'dangerous-url'  },
		//   { kind: 'attr', name: 'onclick', reason: 'event-handler'  },
		// ]
		\`\`\`

		## Two engines, one package

		\`\`\`ts
		// The new engine, browser-faithful WHATWG parser, deny-by-default:
		import { Sanitizer } from 'neosanitize';

		// A byte-identical drop-in for sanitize-html 2.x, same API, same output:
		import sanitize from 'neosanitize/legacy';
		sanitize('<img src=x onerror=alert(1) />', { allowedTags: ['img'], allowedAttributes: { img: ['src'] } });
		// → '<img src="x" />'   (exactly what sanitize-html produces)
		\`\`\`

		## Performance

		**Both** engines are faster than the original \`sanitize-html\`, \`legacy\` (a byte-identical streaming drop-in) and \`modern\` (the default, browser-faithful WHATWG engine). Throughput in ops/sec, higher is better (\`pnpm bench:3way\`):

		| Scenario | \`sanitize-html\` | \`legacy\` | \`modern\` |
		| --- | ---: | ---: | ---: |
		| xss-attack | 2,022 | 4,745 | 5,095 |
		| entity-heavy | 973 | 5,149 | 3,600 |
		| attribute-filtering | 1,492 | 2,906 | 3,695 |
		| style-filtering | 1,956 | 3,330 | 4,400 |
		| large-document (113 KB) | 274 | 834 | 561 |
		| **geomean (13 scenarios)** | **1.00×** | **2.75×** | **2.28×** |

		\`legacy\` is the fastest (a lean \`htmlparser2\`-style port, same output as sanitize-html); \`modern\` is ~2.3× the original *while* doing a full WHATWG parse + tree construction, the price of browser-faithfulness. See the [full performance page](/reference/performance).

		## Bundle size

		| Build | Min+gzip | Min+brotli | Notes |
		| --- | ---: | ---: | --- |
		| \`modern\`, browser | ~3.2 KB | **~2.9 KB** | native \`DOMParser\`, no bundled parser |
		| \`modern\`, Node / default | ~27 KB | ~23 KB | bundled WHATWG parser + full entity table |
		| \`legacy\` | ~21 KB | ~18 KB | single-file \`sanitize-html\` port |

		> Zero runtime dependencies. ESM. \`sideEffects: false\` with subpath exports, you ship only what you import.
	`);
</script>

<svelte:head>
	<title>neosanitize · The browser-faithful HTML sanitizer</title>
	<meta
		name="description"
		content="Zero-dependency, isomorphic HTML sanitizer: a fast, browser-faithful WHATWG engine (deny-by-default) plus a drop-in sanitize-html-compatible legacy engine. ~2.3× faster than sanitize-html, ~3 KB in the browser."
	/>
</svelte:head>

<div class="ns-home">
	<section class="ns-hero">
		<div class="ns-hero__copy">
			<h1 class="ns-hero__name">neosanitize</h1>
			<p class="ns-hero__text">The browser-faithful HTML sanitizer</p>
			<p class="ns-hero__tagline">
				Zero dependencies. A WHATWG parser that matches the browser, deny-by-default behind an
				inviolable safe baseline, ~2.3× faster than sanitize-html and ~3 KB in the browser. Plus a
				byte-identical drop-in for sanitize-html.
			</p>
			<div class="ns-hero__actions">
				<a class="ns-btn ns-btn--brand" href="/guide/introduction">Get started</a>
				<a class="ns-btn" href="/reference/performance">Performance</a>
				<a class="ns-btn" href="/reference/security">Security model</a>
			</div>
		</div>
		<div class="ns-hero__image">
			<img src="/logo.svg" alt="neosanitize" width="400" height="400" />
		</div>
	</section>

	<section class="ns-features" aria-label="Features">
		{#each features as f (f.title)}
			<svelte:element
				this={f.href ? 'a' : 'div'}
				class={['ns-feature', f.href && 'ns-feature--link']}
				href={f.href}
			>
				<span class="ns-feature__icon" aria-hidden="true">{f.icon}</span>
				<h2 class="ns-feature__title">{f.title}</h2>
				<p class="ns-feature__details">{@html f.details}</p>
			</svelte:element>
		{/each}
	</section>

	<section class="ns-stats" aria-label="At a glance">
		{#each stats as s (s.value)}
			<div class="ns-stat">
				<div class="ns-stat__value">{s.value}</div>
				<div class="ns-stat__label">
					<strong>{s.strong}</strong>{s.rest.startsWith(',') ? '' : ' '}{s.rest}
				</div>
			</div>
		{/each}
	</section>

	<div class="og-body ns-home__body">
		<Region of={body} />
	</div>
	<CodeChrome />
</div>
