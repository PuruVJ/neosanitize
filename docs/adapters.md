# Parser adapters

The main engine separates **parsing** from **policy**. Untrusted HTML is parsed into a plain `{type,name,attrs,children}` tree, and the deny-by-default policy plus serializer run over that tree. The parser is the only pluggable seam, a **parse adapter**, so you can keep the exact same security engine and swap how the HTML is parsed.

```ts
type ParseAdapter = (html: string) => ParentNode;
```

Every entry ships an environment-appropriate default, and you can override it per-`Sanitizer` with `.parser(adapter)`.

## The defaults

| Entry | Default parser | Why |
| --- | --- | --- |
| `neosanitize` (Node) | bundled WHATWG parser (`whatwgAdapter`) | browser-faithful, zero-dependency, fastest |
| `neosanitize` (browser build) | native `DOMParser` (`domParserAdapter`) | zero parser bytes, byte-for-byte what the user's browser does |

Both are exported, so you can also pass them explicitly:

```ts
import { Sanitizer } from 'neosanitize';
import { whatwgAdapter } from 'neosanitize/whatwg-parser';
import { domParserAdapter } from 'neosanitize/browser';

// Force the bundled WHATWG parser, even inside a browser bundle:
const s = Sanitizer.builder(ugc).parser(whatwgAdapter).build();
```

Import `whatwgAdapter` from `neosanitize/whatwg-parser`, not from `neosanitize`. In a browser bundle the `.` export resolves to the DOMParser build, which only carries `domParserAdapter`. (For convenience `neosanitize` also re-exports `whatwgAdapter` in Node, but the `neosanitize/whatwg-parser` import works everywhere.)

Pass `null` to restore the environment default: `.parser(null)`.

## Optional adapters

Two reference parsers are available as separate subpath exports. They are optional peer dependencies: install the one you use, nothing is pulled in otherwise, and the rest of the package stays zero-dependency.

- **[parse5](/adapters/parse5)**, the reference WHATWG parser. Pick it for 100% spec-conformant tree construction.
- **[htmlparser2](/adapters/htmlparser2)**, very fast and forgiving, the parser `sanitize-html` uses.

## Choosing

| Adapter | Spec conformance | Speed | Deps | Use when |
| --- | --- | --- | --- | --- |
| `ours` (default) | tokenizer 100%, tree ~95.6% | fastest | none | almost always |
| [`parse5`](/adapters/parse5) | 100% (reference) | ~0.5× | `parse5` | conformance on degenerate markup matters |
| [`htmlparser2`](/adapters/htmlparser2) | lenient, not WHATWG | ~0.9× | `htmlparser2` | you want htmlparser2 semantics or speed |

The inviolable safe baseline and deny-by-default policy hold regardless of parser. Swapping the adapter never changes what is allowed, only how the input bytes become a tree. See the [benchmarks](/performance#parser-adapters) for the throughput trade-off.

## Writing your own

An adapter is just a function from HTML to the node tree. Build the tree with any parser, mapping it to the `{type,name,attrs,children}` shape (`attrs` is an ordered `[name, value][]`, `namespace` is `'html' | 'svg' | 'mathml'`). See the [WHATWG parser module](/whatwg-parser) for the exact node types, and the `parse5` / `htmlparser2` adapters in the source for worked examples.

```ts
import { Sanitizer, type ParseAdapter } from 'neosanitize';

const my_adapter: ParseAdapter = (html) => {
  // parse however you like, return a { type: 'document', children: [...] } tree
};

const s = Sanitizer.builder(ugc).parser(my_adapter).build();
```
