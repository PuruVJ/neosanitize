<script lang="ts">
	import data from '../../../../packages/neosanitize/bench/adapters.json';
	import BenchBars from './BenchBars.svelte';

	const brand = 'var(--ns-brand, #8b5cf6)';
	const muted = 'var(--ns-text-3, #888)';
	const order = [
		{ key: 'ours', color: brand },
		{ key: 'parse5', color: `color-mix(in oklch, ${brand} 55%, ${muted})` },
		{ key: 'htmlparser2', color: muted },
	];
</script>

<div class="ns-bench">
	<blockquote>
		<strong>Geomean throughput vs the bundled parser (<code>ours</code> = 1.00×):</strong>
		<code>parse5</code> ≈ {data.summary.parse5}× · <code>htmlparser2</code> ≈ {data.summary
			.htmlparser2}×. Same <code>Sanitizer</code>, same policy, only the parse step changes.
	</blockquote>
	<BenchBars scenarios={data.scenarios} {order} base="ours" ours={['ours']} />
	<p class="ns-bench-foot">
		<small
			>Generated {data.generatedAt.slice(0, 10)} · Node {data.node} · {data.msPerTask}ms/task ·
			tinybench · parse5 {data.versions.parse5}, htmlparser2 {data.versions.htmlparser2}.
			Reproduce with <code>pnpm bench:adapters</code>.</small
		>
	</p>
</div>
