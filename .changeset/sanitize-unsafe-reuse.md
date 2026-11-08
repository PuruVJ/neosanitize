---
'neosanitize': patch
---

neosanitize: `sanitizeUnsafe()` builds its policy once per sanitizer instead of on every call, so calling it many times on short inputs is several times faster.
