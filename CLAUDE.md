# CLAUDE.md — @redbamboo packages

## What this is

Shared packages for the RedBamboo ecosystem. Published to npm under the `@redbamboo` scope.

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@redbamboo/ui` | `packages/ui/` | Design system — tokens (oklch dark/light), Tailwind v4 theme, shadcn-based components |
| `@redbamboo/chat` | `packages/chat/` | Streaming chat UI with adapter-based backend |

## Consumers

- **CodeRed** — source of truth for the design language (open source)
- **RedCompute** — AI compute service dashboard (open source)
- **RedMatter** — game engine CMS (closed source)

## Tech stack

- **Monorepo**: pnpm workspaces
- **Build**: Vite library mode + vite-plugin-dts
- **Versioning**: Changesets
- **Publish**: npm (public, `@redbamboo` scope)
- **CI**: GitHub Actions
- **Framework**: React 19 + TypeScript 5.9
- **Styling**: Tailwind CSS v4 (CSS-first config) + Radix UI + CVA
- **Icons**: Lucide React (peer dependency)

## Code standards

- Components follow shadcn/ui v4 patterns (function components, `data-slot` attributes, `cn()` class merging)
- All components have `data-slot` for CSS targeting and testing
- CVA for variant management
- No `"use client"` directives (not a Next.js project)
- Peer dependencies for React, Tailwind, Radix, Lucide — keeps bundles lean

## Commands

```bash
pnpm install          # install all dependencies
pnpm build            # build all packages
pnpm dev              # watch mode
pnpm typecheck        # type-check all packages
pnpm changeset        # create a changeset
pnpm version          # bump versions
pnpm publish          # build + publish to npm
```

## Adding a new component to @redbamboo/ui

1. Create `packages/ui/src/components/my-component.tsx`
2. Import `cn` from `"../utils"`, NOT from `"@/lib/utils"`
3. Export from `packages/ui/src/index.ts`
4. Add `data-slot="my-component"` to the root element

## Adding a new package

1. Create `packages/my-package/` with `package.json`, `tsconfig.json`, `vite.config.ts`
2. Name it `@redbamboo/my-package`
3. Add to `pnpm-workspace.yaml` (already covered by `packages/*` glob)

## Open source considerations

- All packages in this repo are MIT licensed
- Consumers (CodeRed, RedCompute) may be open source
- RedMatter is closed source but can freely consume MIT packages
- Never commit secrets, API keys, or proprietary business logic to this repo
