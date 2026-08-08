# @redbamboo/chat

## 0.4.3

### Patch Changes

- 97fd08a: Replace the context percentage trigger with a semantic session Info action while retaining context usage inside the Session Info dialog.

## 0.4.2

### Patch Changes

- Updated dependencies [47669c6]
  - @redbamboo/ui@0.6.1
  - @redbamboo/utility@0.4.2

## 0.4.1

### Patch Changes

- ddc8fba: Add explicit quarter, half, and full EntityCard width tiers with responsive
  full-width behavior on narrow layouts. Render normal Chat entity embeds at the
  half-width tier and isolate their semantic card anchors from generic Markdown
  link decoration and word-breaking. Add a host-owned presentation bridge so
  identity-only embeds can hydrate canonical images, icons, colors, and type labels
  without serializing entity properties into Markdown.
- Updated dependencies [ddc8fba]
  - @redbamboo/ui@0.6.0
  - @redbamboo/utility@0.4.1

## 0.4.0

### Minor Changes

- 3dc2155: Render standalone RedLeaf Page entity embeds and canonical Database entity
  links as inspectable EntityCards when the host provides Entity Inspector
  interaction. Inline links and non-card Page embed modes retain their existing
  Markdown behavior.

  Add shared formatting and parsing support for the established `redleaf://`
  embed targets and canonical entity routes.

### Patch Changes

- 3dc2155: Add a host-bridged inspect action to the canonical EntityCard while preserving
  native link behavior for modified clicks and hosts without an inspector.

  Use the inspect action for the Session Info agent reference.

- Updated dependencies [3dc2155]
- Updated dependencies [3dc2155]
  - @redbamboo/ui@0.5.0
  - @redbamboo/utility@0.4.0

## 0.3.2

### Patch Changes

- 484259b: Add canonical AI-native entity identity/card primitives, direct entity-link helpers, and migrate
  shared Session Info agent presentation onto the design-system component.
- Updated dependencies [484259b]
  - @redbamboo/ui@0.4.0
  - @redbamboo/utility@0.3.0

## 0.3.1

### Patch Changes

- f480891: Event modals render an image the payload carries, above the payload itself.

  Detection is driven by the payload rather than the event type, so any plugin
  that attaches an image gets this without a renderer of its own: an `asset_url`
  (or an `asset_id`, resolved to `/api/assets/{id}`) that looks like an image,
  in either casing. A non-null `frame_error` shows the plugin's message in place
  of the image, and an asset that fails to load falls back to a placeholder
  rather than a broken-image icon. Tapping the image opens it full size in a new
  tab.

## 0.3.0

### Minor Changes

- 773d40a: Rich per-type rendering for frieze event and tool-call modals.

  - New `EventView` + `parseEventPart` (exported): event modals render structured
    cards per event type (Spotify/Sonos mini-player with album art, Steam game
    header, location map, weather summary, Hue light state, discussion links,
    outfit images, device rows) instead of a raw JSON dump. Legacy events without
    metadata fall back to a clean text card.
  - `ToolOutputView` is now tool-aware: syntax-highlighted Read output (inline
    images for image files), Grep matches grouped by file with pattern
    highlighting and line links, Glob file lists, terminal-styled shell output
    with ANSI stripping, markdown rendering for Agent/WebFetch results, and
    linkified WebSearch results. Output truncation is expandable (Show more)
    instead of a hard 5,000-char cut.
  - New optional props: `resolveEventLink` on `ChatPanel`/`ChatMessage`, and
    `toolName`/`toolInput`/`resolveFileLink`/`resolveImageSrc`/`onNavigate` on
    `ToolOutputView`. All backward compatible.

## 0.2.3

### Patch Changes

- Updated dependencies [c3283e7]
  - @redbamboo/utility@0.2.0

## 0.2.2

### Patch Changes

- Updated dependencies [293fe40]
  - @redbamboo/ui@0.3.0
  - @redbamboo/utility@0.1.1

## 0.2.1

### Patch Changes

- Updated dependencies [070b099]
  - @redbamboo/ui@0.2.0

## 0.2.0

### Minor Changes

- 358b9b5: Add StreamingStatusLine component and onResume prop to Composer

## 0.1.1

### Patch Changes

- 6eb9765: Republish with working pipeline (no OIDC provenance)
- Updated dependencies [6eb9765]
  - @redbamboo/ui@0.1.1

## 0.1.0

### Minor Changes

- 9004900: Initial public release

### Patch Changes

- 4f264c2: Fix publish pipeline (disable broken OIDC provenance)
- Updated dependencies [4f264c2]
- Updated dependencies [9004900]
  - @redbamboo/ui@0.1.0
