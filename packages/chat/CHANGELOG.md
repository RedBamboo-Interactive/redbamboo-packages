# @redbamboo/chat

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
