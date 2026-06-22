---
"neosanitize": patch
---

`./legacy`: improve `sanitize-html` parity while staying zero-dependency.

The legacy engine now reimplements `parse-srcset` (its descriptor-validation state machine) and several `htmlparser2` parser edge cases (`<!-`, `<!>`, `<a ==b>`, short `<!--…-->` comments) inline — with **no `postcss` or `entities` runtime dependencies**. Inline `style` filtering for `allowedStyles` keeps using a hand-written flat-declaration parser instead of `postcss`, so it stays zero-dep and, unlike the original, also works in the browser (sanitize-html's postcss path is Node-only).
