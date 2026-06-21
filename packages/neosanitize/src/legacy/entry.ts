// Published build entry for `./legacy` (tsdown points here). It re-exports ONLY
// the default from ./index, so the CommonJS output is a bare `module.exports =
// sanitize` — i.e. `require('neosanitize/legacy')` IS the function, exactly like
// `require('sanitize-html')`. (`./index` also carries a test-only `__internal`
// export; re-exporting just the default keeps it out of the shipped bundle.)
export { default } from './index';
