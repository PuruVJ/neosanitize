# Why not DOMPurify?

Honestly, if you're only sanitizing in the browser, use DOMPurify. It runs against the
real DOM, cure53 maintains it, and it's survived a decade of people trying to break it.
neosanitize hasn't earned that kind of scrutiny yet, and I'm not going to pretend it has.

Where DOMPurify gets awkward is the server. It has no parser of its own — it needs a DOM
— so the moment you sanitize in Node you're dragging in jsdom: ~25 MB, 39 packages, won't
run on edge runtimes like Cloudflare Workers, and leaks in long-running processes
(isomorphic-dompurify had to add a `clearWindow()` call just to keep the heap from
climbing). jsdom also quietly becomes part of your attack surface — DOMPurify's own docs
warn it can let XSS through "even if DOMPurify does everything 100% correctly," and
CVE-2026-0540 earlier this year was exactly that: a bypass caused by jsdom's raw-text
parsing, not by DOMPurify itself.

neosanitize sidesteps all of it. Zero dependencies, and it ships its own WHATWG parser
(verified against html5lib and the browser's `DOMParser`), so it behaves the same in Node,
the browser, and on the edge. No jsdom, ~5 KB in the browser, and deny-by-default so an
allow-list can't accidentally let `<script>` or `onerror=` back in.

And if you're coming from sanitize-html, there's nothing to rewrite. `neosanitize/legacy`
is a genuine drop-in — change the import and you're done. Same options, same output, not a
single line of extra code:

```diff
- const sanitizeHtml = require('sanitize-html');
+ const sanitizeHtml = require('neosanitize/legacy');
```

So: browser-only and want the most battle-tested option? DOMPurify. Need one sanitizer
that runs everywhere without putting jsdom on your server? That's what neosanitize is for.
