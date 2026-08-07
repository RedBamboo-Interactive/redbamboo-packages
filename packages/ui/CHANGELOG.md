# @redbamboo/ui

## 0.6.1

### Patch Changes

- 47669c6: Keep outlined entity-card hover and inspector states on a neutral border instead of applying the primary accent color.

## 0.6.0

### Minor Changes

- ddc8fba: Add explicit quarter, half, and full EntityCard width tiers with responsive
  full-width behavior on narrow layouts. Render normal Chat entity embeds at the
  half-width tier and isolate their semantic card anchors from generic Markdown
  link decoration and word-breaking. Add a host-owned presentation bridge so
  identity-only embeds can hydrate canonical images, icons, colors, and type labels
  without serializing entity properties into Markdown.

## 0.5.0

### Minor Changes

- 3dc2155: Add a host-bridged inspect action to the canonical EntityCard while preserving
  native link behavior for modified clicks and hosts without an inspector.

  Use the inspect action for the Session Info agent reference.

## 0.4.0

### Minor Changes

- 484259b: Add canonical AI-native entity identity/card primitives, direct entity-link helpers, and migrate
  shared Session Info agent presentation onto the design-system component.

## 0.3.0

### Minor Changes

- 293fe40: Add `ItemList`, `ItemListRow`, `MasterDetailLayout`, `FilterBar`, and `FilterPillGroup` components for reusable master-detail list UIs with responsive layout (flush on desktop, padded+rounded on mobile)

## 0.2.0

### Minor Changes

- 070b099: Add FeedbackDialog component and Toast notification system

  - FeedbackDialog: category-based feedback form (bug/feature/suggestion) with auto-collected system info, designed for AI-native issue creation via RedCompute
  - Toast: provider-based notification system with loading/success/error/default variants, updatable toasts for async progress tracking
  - FeedbackButton: trigger component with menu-item and standalone button variants
  - collectSystemInfo: exported utility for programmatic system context gathering

## 0.1.1

### Patch Changes

- 6eb9765: Republish with working pipeline (no OIDC provenance)

## 0.1.0

### Minor Changes

- 9004900: Initial public release

### Patch Changes

- 4f264c2: Fix publish pipeline (disable broken OIDC provenance)
