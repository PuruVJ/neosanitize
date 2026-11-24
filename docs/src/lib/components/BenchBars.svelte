<script lang="ts">
	// One bar chart per scenario: ops/sec for each contender, the fastest gets the crown.
	// Pure markup, rendered on the server: no client JS.
	type Scenario = { name: string; description?: string; bytes: number; ops: Record<string, number> };

	let {
		scenarios,
		order,
		base,
		ours,
	}: {
		scenarios: Scenario[];
		/** contenders, brand color first fading to muted last */
		order: { key: string; color: string }[];
		/** the 1.00× contender the multipliers are relative to */
		base: string;
		/** contenders that get the neosanitize logo */
		ours: string[];
	} = $props();

	const fmtOps = (n: number) => {
		if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
		if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
		return String(Math.round(n));
	};
	const fmtBytes = (b: number) =>
		b >= 1024 ? (b / 1024).toFixed(b >= 1024 * 100 ? 0 : 1) + ' KB' : b + ' B';

	const suites = $derived(
		scenarios.map((s) => {
			const vals = order.map((o) => s.ops[o.key] ?? 0);
			const max = Math.max(...vals, 1);
			const winner = vals.indexOf(Math.max(...vals));
			return {
				name: s.name,
				desc: [s.description, fmtBytes(s.bytes)].filter(Boolean).join(' · '),
				rows: order.map((o, i) => ({
					key: o.key,
					color: o.color,
					logo: ours.includes(o.key),
					pct: Math.max(2, (vals[i] / max) * 100),
					ops: fmtOps(vals[i]),
					mult: o.key !== base && s.ops[base] ? +(vals[i] / s.ops[base]).toFixed(2) : null,
					fastest: i === winner,
				})),
			};
		}),
	);
</script>

{#each suites as s (s.name)}
	<div class="ns-bench-suite">
		<div class="ns-bench-head">
			<span class="ns-bench-name">{s.name}</span>
			<span class="ns-bench-desc">{s.desc}</span>
		</div>
		{#each s.rows as row (row.key)}
			<div class={['ns-bench-row', row.fastest && 'win']}>
				<span class="ns-bench-lib">
					{#if row.logo}<img src="/logo.svg" class="ns-bench-logo" alt="" />{/if}{row.key ===
					'original'
						? 'sanitize-html'
						: row.key}
				</span>
				<span class="ns-bench-track">
					<span class="ns-bench-fill" style:width="{row.pct}%" style:--bar={row.color}></span>
				</span>
				<span class="ns-bench-val">
					{row.ops} ops/s{#if row.mult !== null}<span class="ns-bench-x">{` · ${row.mult}×`}</span
						>{/if}{#if row.fastest}{' 🏆'}{/if}
				</span>
			</div>
		{/each}
	</div>
{/each}

<style>
	.ns-bench-suite {
		margin: 0 0 1.35rem;
	}
	.ns-bench-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		border-bottom: 1px solid var(--ns-divider, var(--og-border, #e5e5e5));
		padding-bottom: 0.35rem;
		margin-bottom: 0.55rem;
	}
	.ns-bench-name {
		font-family: var(--og-font-mono, ui-monospace, monospace);
		font-weight: 700;
		font-size: 0.92rem;
		color: var(--ns-brand, #8b5cf6);
	}
	.ns-bench-desc {
		font-size: 0.8rem;
		color: var(--ns-text-3, var(--og-text-muted, #888));
	}
	.ns-bench-row {
		display: grid;
		grid-template-columns: 9rem 1fr 9.5rem;
		align-items: center;
		gap: 0.7rem;
		margin: 0.3rem 0;
	}
	.ns-bench-lib {
		display: flex;
		align-items: center;
		font-family: var(--og-font-mono, ui-monospace, monospace);
		font-size: 0.84rem;
		color: var(--ns-text-2, var(--og-text-soft, #555));
		white-space: nowrap;
	}
	.ns-bench-logo {
		width: 1.3em;
		height: 1.3em;
		margin-right: 0.4em;
		flex: none;
	}
	.win .ns-bench-lib {
		color: var(--ns-brand, #8b5cf6);
		font-weight: 700;
	}
	.ns-bench-track {
		position: relative;
		height: 16px;
		background: var(--ns-bg-soft, var(--og-bg-soft, #f6f6f7));
		border: 1px solid var(--ns-divider, var(--og-border, #e5e5e5));
		border-radius: 3px;
		overflow: hidden;
	}
	.ns-bench-fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--bar);
		border-right: 1px solid color-mix(in oklch, var(--bar) 60%, black);
	}
	.ns-bench-val {
		font-family: var(--og-font-mono, ui-monospace, monospace);
		font-size: 0.84rem;
		white-space: nowrap;
		text-align: right;
	}
	.ns-bench-x {
		color: var(--ns-brand, #8b5cf6);
		font-weight: 700;
	}
	@media (max-width: 640px) {
		.ns-bench-row {
			grid-template-columns: 6.5rem 1fr 7rem;
			gap: 0.4rem;
		}
	}
</style>
