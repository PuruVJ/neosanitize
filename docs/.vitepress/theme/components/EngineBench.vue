<script setup>
import { computed } from 'vue';
import data from '../../../../packages/neosanitize/bench/three-way.json';

const ORDER = ['original', 'legacy', 'modern'];
const COLOR = {
  original: 'var(--vp-c-text-3)',
  legacy: 'color-mix(in oklch, var(--vp-c-brand-1) 55%, var(--vp-c-text-3))',
  modern: 'var(--vp-c-brand-1)',
};
const LABEL = { original: 'sanitize-html', legacy: 'legacy', modern: 'modern' };

const fmtOps = (n) => {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
  return String(Math.round(n));
};
const fmtBytes = (b) => (b >= 1024 ? (b / 1024).toFixed(b >= 1024 * 100 ? 0 : 1) + ' KB' : b + ' B');

function rows(s) {
  const vals = ORDER.map((n) => s.ops[n] ?? 0);
  const max = Math.max(...vals, 1);
  const winner = vals.indexOf(Math.max(...vals));
  return ORDER.map((name, i) => ({
    name,
    label: LABEL[name],
    logo: name !== 'original',
    pct: Math.max(2, (vals[i] / max) * 100),
    ops: fmtOps(vals[i]),
    mult: s.ops.original ? +(vals[i] / s.ops.original).toFixed(2) : null,
    fastest: i === winner,
    color: COLOR[name],
  }));
}

const date = computed(() => (data.generatedAt || '').slice(0, 10));
</script>

<template>
  <div class="ebench">
    <blockquote>
      <strong>Geomean throughput vs <code>sanitize-html</code> (= 1.00×):</strong>
      <code>legacy</code> ≈ {{ data.summary.legacy }}× · <code>modern</code> ≈ {{ data.summary.modern }}×.
      Both engines beat the original across the corpus.
    </blockquote>

    <div v-for="s in data.scenarios" :key="s.name" class="ebench-suite">
      <div class="ebench-head">
        <span class="ebench-name">{{ s.name }}</span>
        <span class="ebench-desc">{{ fmtBytes(s.bytes) }}</span>
      </div>
      <div v-for="row in rows(s)" :key="row.name" class="ebench-row" :class="{ win: row.fastest }">
        <span class="ebench-lib">
          <img v-if="row.logo" src="/logo.svg" class="ebench-logo" alt="" />{{ row.label }}
        </span>
        <span class="ebench-track">
          <span class="ebench-fill" :style="{ width: row.pct + '%', '--bar': row.color }"></span>
        </span>
        <span class="ebench-val">
          {{ row.ops }} ops/s<span v-if="row.name !== 'original'" class="ebench-x"> · {{ row.mult }}×</span><span v-if="row.fastest" class="ebench-crown"> 🏆</span>
        </span>
      </div>
    </div>

    <p class="ebench-foot">
      <small>Generated {{ date }} · Node {{ data.node }} · {{ data.msPerTask }}ms/task · tinybench. Reproduce with <code>pnpm bench:3way</code>.</small>
    </p>
  </div>
</template>

<style scoped>
.ebench { margin: 1.25rem 0; }
.ebench-suite { margin: 0 0 1.35rem; }
.ebench-head {
  display: flex; align-items: baseline; gap: 0.6rem;
  border-bottom: 1px solid var(--vp-c-divider); padding-bottom: 0.35rem; margin-bottom: 0.55rem;
}
.ebench-name { font-family: var(--vp-font-family-mono); font-weight: 700; font-size: 0.92rem; color: var(--vp-c-brand-1); }
.ebench-desc { font-size: 0.8rem; color: var(--vp-c-text-3); }
.ebench-row { display: grid; grid-template-columns: 9rem 1fr 9.5rem; align-items: center; gap: 0.7rem; margin: 0.3rem 0; }
.ebench-lib {
  display: flex; align-items: center; font-family: var(--vp-font-family-mono);
  font-size: 0.84rem; color: var(--vp-c-text-2); white-space: nowrap;
}
.ebench-logo { width: 1.3em; height: 1.3em; margin-right: 0.4em; flex: none; }
.ebench-row.win .ebench-lib { color: var(--vp-c-brand-1); font-weight: 700; }
.ebench-track {
  position: relative; height: 16px; background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider); border-radius: 3px; overflow: hidden;
}
.ebench-fill {
  position: absolute; inset: 0 auto 0 0; background: var(--bar);
  border-right: 1px solid color-mix(in oklch, var(--bar) 60%, black); transition: width 0.35s ease;
}
.ebench-val { font-family: var(--vp-font-family-mono); font-size: 0.84rem; white-space: nowrap; color: var(--vp-c-text-1); text-align: right; }
.ebench-x { color: var(--vp-c-brand-1); font-weight: 700; }
.ebench-foot { margin-top: 1.2rem; color: var(--vp-c-text-3); }
@media (max-width: 640px) { .ebench-row { grid-template-columns: 7rem 1fr 7rem; gap: 0.4rem; } }
</style>
