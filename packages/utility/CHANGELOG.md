# @redbamboo/utility

## 0.4.0

### Minor Changes

- 3dc2155: Render standalone RedLeaf Page entity embeds and canonical Database entity
  links as inspectable EntityCards when the host provides Entity Inspector
  interaction. Inline links and non-card Page embed modes retain their existing
  Markdown behavior.

  Add shared formatting and parsing support for the established `redleaf://`
  embed targets and canonical entity routes.

### Patch Changes

- Updated dependencies [3dc2155]
  - @redbamboo/ui@0.5.0

## 0.3.0

### Minor Changes

- 484259b: Add canonical AI-native entity identity/card primitives, direct entity-link helpers, and migrate
  shared Session Info agent presentation onto the design-system component.

### Patch Changes

- Updated dependencies [484259b]
  - @redbamboo/ui@0.4.0

## 0.2.0

### Minor Changes

- c3283e7: Add shared WebSocket event system: `createWebSocket` factory with auto-reconnect, `WsEventProvider`/`useWsSubscribe`/`useWsSubscribeByType` React primitives, and refactored `useLogStream` to use the shared transport

## 0.1.1

### Patch Changes

- Updated dependencies [293fe40]
  - @redbamboo/ui@0.3.0
