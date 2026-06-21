<p align="center">
  <img src="packages/neosanitize/assets/logo.svg" width="84" height="84" alt="neosanitize" />
</p>

<h1 align="center">neosanitize</h1>

<p align="center">Zero-dependency, browser-faithful HTML sanitizer — a fast WHATWG engine (deny-by-default) plus a byte-identical drop-in for <code>sanitize-html</code>.</p>

This is the monorepo. The published library lives in **[`packages/neosanitize`](packages/neosanitize)** — see its [README](packages/neosanitize/README.md) for the full pitch, API, security model, and benchmarks.

## Layout

| Path | What |
| --- | --- |
| [`packages/neosanitize`](packages/neosanitize) | The library, published to npm as [`neosanitize`](https://www.npmjs.com/package/neosanitize) |
| [`docs`](docs) | The VitePress documentation site |

## Develop

```bash
pnpm install
pnpm build       # build the library
pnpm test        # build + run the suite
pnpm typecheck
pnpm docs:dev    # run the docs site locally
```

## Releasing

Versioning and publishing run through [Changesets](https://github.com/changesets/changesets) with **OIDC trusted publishing** — no npm token, provenance on by default.

```bash
pnpm changeset   # describe a change and pick the bump
```

On merge to `main` the release workflow opens a "Version Packages" PR; merging that publishes to npm.

## License

[MIT](./LICENSE) © Puru Vijay
