import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'neosanitize',
  description:
    'Zero-dependency, isomorphic HTML sanitizer: a fast, browser-faithful WHATWG engine (deny-by-default) plus a drop-in sanitize-html-compatible legacy engine. ~2.3× faster than sanitize-html, ~3 KB in the browser.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#8b5cf6' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://neosanitize.puruvj.dev/' }],
    ['meta', { property: 'og:title', content: 'neosanitize' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Zero-dependency, browser-faithful HTML sanitizer. Deny-by-default, ~2.3× faster than sanitize-html, ~3 KB in the browser, zero mXSS holes in 20k fuzz.',
      },
    ],
    ['meta', { property: 'og:image', content: 'https://neosanitize.puruvj.dev/og.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'neosanitize' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Zero-dependency, browser-faithful HTML sanitizer. Deny-by-default, ~2.3× faster than sanitize-html, ~3 KB in the browser.',
      },
    ],
    ['meta', { name: 'twitter:image', content: 'https://neosanitize.puruvj.dev/og.png' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'Sanitizing', link: '/sanitizing' },
      { text: 'Adapters', link: '/adapters' },
      { text: 'Legacy', link: '/legacy' },
      { text: 'Performance', link: '/performance' },
      { text: 'npm', link: 'https://www.npmjs.com/package/neosanitize' },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [{ text: 'Introduction', link: '/guide' }],
      },
      {
        text: 'Drop-in',
        items: [{ text: 'Legacy', link: '/legacy' }],
      },
      {
        text: 'Main engine',
        items: [{ text: 'Sanitizing', link: '/sanitizing' }],
      },
      {
        text: 'Parsing',
        items: [{ text: 'WHATWG parser', link: '/whatwg-parser' }],
      },
      {
        text: 'Parser adapters',
        items: [
          { text: 'Adapter system', link: '/adapters' },
          { text: 'parse5 adapter', link: '/adapters/parse5' },
          { text: 'htmlparser2 adapter', link: '/adapters/htmlparser2' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Performance', link: '/performance' },
          { text: 'Security model', link: '/security' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/PuruVJ/neosanitize' }],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License.',
      copyright:
        'Copyright © <a href="https://puruvj.dev" target="_blank" rel="noreferrer">Puru Vijay</a>',
    },
  },
});
