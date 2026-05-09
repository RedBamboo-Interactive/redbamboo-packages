# @redbamboo packages

Shared UI and tooling packages for the RedBamboo ecosystem — [CodeRed](https://github.com/RedBamboo-Interactive/codered), [RedCompute](https://github.com/RedBamboo-Interactive/redcompute), [RedMatter](https://github.com/RedBamboo-Interactive/redmatter), and beyond.

## Packages

| Package | Description | Status |
|---|---|---|
| [`@redbamboo/ui`](./packages/ui) | Design system — tokens, Tailwind theme, components | In development |
| [`@redbamboo/chat`](./packages/chat) | Streaming chat UI — adapter-based, framework-agnostic backend | In development |

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev         # watch mode for all packages
pnpm typecheck   # type-check all packages
pnpm test        # run all tests
```

## Publishing

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

```bash
pnpm changeset        # create a changeset for your changes
pnpm version          # bump versions based on changesets
pnpm publish          # build and publish to npm
```

## Using in your app

```bash
pnpm add @redbamboo/ui @redbamboo/chat
```

See each package's README for integration instructions.

## License

MIT — see [LICENSE](./LICENSE).
