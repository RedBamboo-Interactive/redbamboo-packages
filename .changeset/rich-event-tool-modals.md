---
"@redbamboo/chat": minor
---

Rich per-type rendering for frieze event and tool-call modals.

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
