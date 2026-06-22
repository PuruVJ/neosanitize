<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import pkg from '../../../packages/neosanitize/package.json';
import ThemeToggle from './components/ThemeToggle.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #nav-bar-title-after>
      <a
        class="nt-version"
        :href="`https://www.npmjs.com/package/neosanitize/v/${pkg.version}`"
        target="_blank"
        rel="noreferrer"
        >v{{ pkg.version }}</a
      >
    </template>
    <template #nav-bar-content-after>
      <ThemeToggle class="nt-theme-nav" />
    </template>
  </Layout>
</template>

<style scoped>
.nt-version {
  margin-left: 0.5rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  text-decoration: none;
  transition: color 0.12s ease;
}
.nt-version:hover {
  color: var(--vp-c-brand-1);
}
</style>
