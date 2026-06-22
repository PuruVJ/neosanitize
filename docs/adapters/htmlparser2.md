# htmlparser2 adapter

[`htmlparser2`](https://github.com/fb55/htmlparser2) is a very fast, forgiving HTML parser. It's the one `sanitize-html` itself uses. Reach for it if you want htmlparser2's lenient semantics, or to match a pipeline already built around it.

## Install

`htmlparser2` is an optional peer dependency. Install it yourself, it is only loaded when you import the adapter.

```bash
npm install htmlparser2
```

## Use

```ts
import { Sanitizer } from 'neosanitize';
import { htmlparser2Adapter } from 'neosanitize/htmlparser2';

const s = Sanitizer.builder(ugc).parser(htmlparser2Adapter).build();
```

## Caveat

htmlparser2 is not a full WHATWG tree builder. It does not do foster-parenting, the adoption agency, or foreign-content (SVG/MathML) namespacing. Every element is treated as HTML. That is fine for sanitization, and it matches sanitize-html, but it is not browser-faithful.

For browser fidelity use the [default parser](/adapters). For strict conformance use [parse5](/adapters/parse5). The deny-by-default policy and inviolable baseline hold either way, so output is always safe regardless of which parser builds the tree.
