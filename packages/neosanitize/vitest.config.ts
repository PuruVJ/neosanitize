import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.{js,mjs,ts}'],
    // Coverage instrumentation slows the generative fuzz suites; give them room.
    testTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // Ratchet — coverage can only go up. The NEW engine (src/main: core, browser,
      // parser/*) is at 100% statements/functions/lines, and core/browser/tokenizer
      // are 100% branches too. The residual ~1% is (a) the frozen `./legacy` port's
      // option-edges (transformTags/textFilter/… — covered instead by its
      // differential fuzz vs sanitize-html) and (b) defensive / fragment-context
      // error-recovery branches unreachable in document-only parsing (annotated
      // with `v8 ignore` where provably dead). Bump these as coverage rises.
      thresholds: { statements: 99, branches: 96, functions: 100, lines: 99 }
    }
  }
});
