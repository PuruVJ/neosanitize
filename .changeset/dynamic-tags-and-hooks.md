---
"neosanitize": minor
---

Unify the main-engine configuration around a single builder API, and add dynamic tags, an attribute hook, and sanitizer derivation.

The builder is now the only way to construct a `Sanitizer`. There is no declarative config object and no public `new Sanitizer(...)`; everything goes through `Sanitizer.builder()...build()`.

- **`allow` is polymorphic:** `allow('a', ['href'])` (exact), `allow(['p', 'b', 'i'])` (bulk), `allow(/^(qds|se)-/, '*')` (pattern + any attribute). Pattern tags cover custom-element conventions whose set isn't known up front; matches are memoized. This folds in the previous `allowMatching`.
- **`allow('*', [...])`** sets attributes allowed on any tag; an attribute list of `'*'` allows any attribute on that tag.
- **`transformAttribute(({ tag, name, value }) => string | null | undefined)`** runs arbitrary per-attribute logic on allow-listed attributes; the result is re-checked by the baseline (a hook can rewrite or drop, never reintroduce `on*` / dangerous URLs). Hooks compose.
- **`sanitizer.toExtended((b) => ...)`** returns a new `Sanitizer` derived from an existing one without re-declaring the base policy. Immutable (like `Array.prototype.toSorted`): the base is never mutated, so a shared sanitizer can be derived from per call site.
- **`allowUnsafe(on?)`** on the builder; `parser(adapter)` is unchanged.

**Breaking:** presets are now `(builder) => void` functions instead of branded policy objects (`UNSAFE_PRESET_SYMBOL` is removed). `Sanitizer.builder(preset)` and `import * as presets from 'neosanitize/presets'` still work. The declarative `Sanitizer.builder({ tags, attrs })` form and `new Sanitizer(policy)` are removed in favour of `.allow()` / presets.
