---
"@redbamboo/chat": patch
"@redbamboo/ui": minor
---

Add explicit quarter, half, and full EntityCard width tiers with responsive
full-width behavior on narrow layouts. Render normal Chat entity embeds at the
half-width tier and isolate their semantic card anchors from generic Markdown
link decoration and word-breaking. Add a host-owned presentation bridge so
identity-only embeds can hydrate canonical images, icons, colors, and type labels
without serializing entity properties into Markdown.
