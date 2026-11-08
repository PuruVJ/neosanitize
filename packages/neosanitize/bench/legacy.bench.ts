/**
 * Heisenbench cases for the `neosanitize/legacy` engine (the sanitize-html port), counted
 * from `src/legacy/`. The same scenarios and options as `index.mjs`. Run with
 * `pnpm bench:count`.
 */
import { bench } from 'heisenbench/bench';
import legacy from '../src/legacy/index.ts';
// @ts-expect-error: the fixtures are plain JavaScript with no types.
import { scenarios } from './fixtures.mjs';

// The `transformTags` of `index.mjs`, which the fixtures cannot hold (it has functions).
function options_for(scenario: any) {
  if (!scenario.needsTransform) return scenario.options;
  return {
    allowedTags: ['strong', 'em', 'span', 'a', 'ol', 'ul', 'li'],
    transformTags: {
      b: 'strong',
      i: 'em',
      font: legacy.simpleTransform('span', { class: 'legacy-font' }),
      a: (tagName: string, attribs: Record<string, string>) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  };
}

for (const scenario of scenarios) {
  bench(`legacy · ${scenario.name}`, ({ html, options }) => legacy(html, options), {
    setup: () => ({ html: scenario.html as string, options: options_for(scenario) }),
  });
}
