/**
 * Preload for `pnpm bench:count`. The source imports its siblings without an extension
 * (`./core`, `./parser/tree-builder`), which tsdown resolves but Node does not. Heisenbench
 * counts the `.ts` source as it is, so a relative import with no extension is resolved to
 * `<path>.ts`, or `<path>/index.ts` for a folder. Loaded with
 * `NODE_OPTIONS=--import=./bench/resolve.ts`.
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const is_file = (url: URL) => existsSync(fileURLToPath(url)) && statSync(fileURLToPath(url)).isFile();

registerHooks({
  resolve(specifier, context, next_resolve) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]s$/.test(specifier)) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        const url = new URL(candidate, context.parentURL);
        if (is_file(url)) return next_resolve(url.href, context);
      }
    }
    return next_resolve(specifier, context);
  },
});
