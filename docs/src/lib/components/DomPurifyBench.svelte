<script lang="ts">
	import data from '../../../../packages/neosanitize/bench/dompurify.json';
	import BenchBars from './BenchBars.svelte';

	const brand = 'var(--ns-brand, #8b5cf6)';
	const muted = 'var(--ns-text-3, #888)';
	const order = [
		{ key: 'neosanitize', color: brand },
		{ key: 'dompurify', color: muted },
	];
	const labels = { dompurify: 'DOMPurify' };
	const runs = [
		{ key: 'node', title: 'Node: neosanitize vs DOMPurify + jsdom', run: data.node },
		{ key: 'browser', title: 'Browser: neosanitize browser build vs DOMPurify', run: data.browser },
	];
</script>

{#each runs as { key, title, run } (key)}
	<div class="ns-bench">
		<blockquote>
			<strong>{title}.</strong> Geomean, <code>DOMPurify</code> = 1.00×:
			<code>neosanitize</code> ≈ {run.summary.neosanitize}×.
		</blockquote>
		<BenchBars scenarios={run.scenarios} {order} base="dompurify" ours={['neosanitize']} {labels} />
		<p class="ns-bench-foot">
			<small
				>Generated {run.generatedAt.slice(0, 10)} · {run.runtime} · DOMPurify {run.versions
					.dompurify}{#if key === 'node'}{` · jsdom ${data.node.versions.jsdom}`}{/if} · {run.msPerTask}ms/task
				· tinybench. Reproduce with <code>pnpm bench:dompurify</code>.</small
			>
		</p>
	</div>
{/each}
