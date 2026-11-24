<script lang="ts">
	import data from '../../../../packages/neosanitize/bench/three-way.json';
	import BenchBars from './BenchBars.svelte';

	const brand = 'var(--ns-brand, #8b5cf6)';
	const muted = 'var(--ns-text-3, #888)';
	const order = [
		{ key: 'original', color: muted },
		{ key: 'legacy', color: `color-mix(in oklch, ${brand} 55%, ${muted})` },
		{ key: 'modern', color: brand },
	];
</script>

<div class="ns-bench">
	<blockquote>
		<strong>Geomean throughput vs <code>sanitize-html</code> (= 1.00×):</strong>
		<code>legacy</code> ≈ {data.summary.legacy}× · <code>modern</code> ≈ {data.summary.modern}×.
		Both engines beat the original across the corpus.
	</blockquote>
	<BenchBars scenarios={data.scenarios} {order} base="original" ours={['legacy', 'modern']} />
	<p class="ns-bench-foot">
		<small
			>Generated {data.generatedAt.slice(0, 10)} · Node {data.node} · {data.msPerTask}ms/task ·
			tinybench. Reproduce with <code>pnpm bench:3way</code>.</small
		>
	</p>
</div>
