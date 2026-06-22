<script setup>
import { computed } from 'vue';
import data from '../../../../packages/neosanitize/bench/adapters.json';

const ORDER = ['ours', 'parse5', 'htmlparser2'];
const COLOR = {
  ours: 'var(--vp-c-brand-1)',
  parse5: 'color-mix(in oklch, var(--vp-c-brand-1) 55%, var(--vp-c-text-3))',
  htmlparser2: 'var(--vp-c-text-3)',
};
const LABEL = {
  ours: 'ours',
  parse5: 'parse5',
  htmlparser2: 'htmlparser2',
};

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
    pct: Math.max(2, (vals[i] / max) * 100),
    ops: fmtOps(vals[i]),
    mult: s.ops.ours ? +(vals[i] / s.ops.ours).toFixed(2) : null,
    fastest: i === winner,
    color: COLOR[name],
  }));
}

const date = computed(() => (data.generatedAt || '').slice(0, 10));
</script>

<template>
  <div class="abench">
    <blockquote>
      <strong>Geomean throughput vs the bundled parser (<code>ours</code> = 1.00×):</strong>
      <code>parse5</code> ≈ {{ data.summary.parse5 }}× · <code>htmlparser2</code> ≈ {{ data.summary.htmlparser2 }}×.
      Same <code>Sanitizer</code>, same policy, only the parse step changes.
    </blockquote>

    <div v-for="s in data.scenarios" :key="s.name" class="abench-suite">
      <div class="abench-head">
        <span class="abench-name">{{ s.name }}</span>
        <span class="abench-desc">{{ s.description }} · {{ fmtBytes(s.bytes) }}</span>
      </div>
      <div v-for="row in rows(s)" :key="row.name" class="abench-row" :class="{ win: row.fastest }">
        <span class="abench-lib">
          <img v-if="row.name === 'ours'" src="/logo.svg" class="abench-logo" alt="" />{{ row.label }}
        </span>
        <span class="abench-track">
          <span class="abench-fill" :style="{ width: row.pct + '%', '--bar': row.color }"></span>
        </span>
        <span class="abench-val">
          {{ row.ops }} ops/s<span v-if="row.name !== 'ours'" class="abench-x"> · {{ row.mult }}×</span><span v-if="row.fastest" class="abench-crown"> 🏆</span>
        </span>
      </div>
    </div>

    <p class="abench-foot">
      <small>
        Generated {{ date }} · Node {{ data.node }} · {{ data.msPerTask }}ms/task · tinybench ·
        parse5 {{ data.versions.parse5 }}, htmlparser2 {{ data.versions.htmlparser2 }}.
        Reproduce with <code>pnpm bench:adapters</code>.
      </small>
    </p>
  </div>
</template>

<style scoped>
.abench { margin: 1.25rem 0; }
.abench-suite { margin: 0 0 1.35rem; }
.abench-head {
  display: flex; align-items: baseline; gap: 0.6rem;
  border-bottom: 1px solid var(--vp-c-divider); padding-bottom: 0.35rem; margin-bottom: 0.55rem;
}
.abench-name {
  font-family: var(--vp-font-family-mono); font-weight: 700; font-size: 0.92rem; color: var(--vp-c-brand-1);
}
.abench-desc { font-size: 0.8rem; color: var(--vp-c-text-3); }
.abench-row {
  display: grid; grid-template-columns: 8rem 1fr 9.5rem; align-items: center; gap: 0.7rem; margin: 0.3rem 0;
}
.abench-lib {
  display: flex; align-items: center; font-family: var(--vp-font-family-mono);
  font-size: 0.84rem; color: var(--vp-c-text-2); white-space: nowrap;
}
.abench-logo { width: 1.3em; height: 1.3em; margin-right: 0.4em; flex: none; }
.abench-row.win .abench-lib { color: var(--vp-c-brand-1); font-weight: 700; }
.abench-track {
  position: relative; height: 16px; background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider); border-radius: 3px; overflow: hidden;
}
.abench-fill {
  position: absolute; inset: 0 auto 0 0; background: var(--bar);
  border-right: 1px solid color-mix(in oklch, var(--bar) 60%, black); transition: width 0.35s ease;
}
.abench-val {
  font-family: var(--vp-font-family-mono); font-size: 0.84rem; white-space: nowrap;
  color: var(--vp-c-text-1); text-align: right;
}
.abench-x { color: var(--vp-c-brand-1); font-weight: 700; }
.abench-foot { margin-top: 1.2rem; color: var(--vp-c-text-3); }
@media (max-width: 640px) {
  .abench-row { grid-template-columns: 6.5rem 1fr 7rem; gap: 0.4rem; }
}
</style>
