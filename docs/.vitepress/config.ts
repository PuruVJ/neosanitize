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
      { text: 'Performance', link: '/performance' },
      { text: 'Security', link: '/security' },
      { text: 'npm', link: 'https://www.npmjs.com/package/neosanitize' },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/guide' },
          { text: 'The two engines', link: '/guide#which-engine' },
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
    socialLinks: [{ icon: 'github', link: 'https://github.com/' }],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Puru Vijay',
    },
  },
});
