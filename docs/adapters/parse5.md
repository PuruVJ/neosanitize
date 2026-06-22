# parse5 adapter

[`parse5`](https://github.com/inikulin/parse5) is the reference WHATWG HTML parser, the one jsdom uses. Reach for it when you want 100% spec-conformant tree construction.

Our bundled parser passes 100% of the html5lib tokenizer suite but ~95.6% of the tree-construction suite, so on a handful of pathological constructs (deeply misnested formatting, adoption-agency corners) it can differ from a browser. parse5 is more mature and battle-tested on exactly those cases.

## Install

`parse5` is an optional peer dependency. Install it yourself, it is only loaded when you import the adapter.

```bash
npm install parse5
```

## Use

```ts
import { Sanitizer } from 'neosanitize';
import { parse5Adapter } from 'neosanitize/parse5';

const s = Sanitizer.builder(ugc).parser(parse5Adapter).build();
s.sanitize(html); // same output contract, parsed by parse5
```

The deny-by-default policy and the inviolable safe baseline are unchanged. Only the parse step is different.

## Trade-off

parse5 runs at roughly half the throughput of the bundled parser (see the [benchmarks](/performance#parser-adapters)). For the vast majority of inputs the two produce identical trees, so use parse5 when conformance on adversarial or degenerate markup matters more than raw speed.

For everyday content the [default parser](/adapters) is the better pick: it is faster, zero-dependency, and already browser-faithful on anything a real document contains.
