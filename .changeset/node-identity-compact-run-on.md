---
"@redbamboo/ui": minor
---

Node icons and colours, and a compact `RunOnChoice`.

- `NodeIcon` draws a node's icon in its colour. `NODE_ICONS` (12 curated Phosphor names) and `NODE_COLORS` (8 tokens, one hex each, at least 3:1 on light and dark surfaces) are exactly what the kernel's node entity accepts as `icon` and `color`. A node without them, or with a value outside the lists, shows its platform's logo (`platformNodeIcon`) in the muted colour, so an older kernel or RedCompute still renders. `nodeIdentity` resolves what to draw.
- `RunOnChoice` shows each node's icon in its colour (the trigger, the list, the one-node row), reading `icon`, `color` and `os` from `GET /compute/nodes` when present.
- `RunOnChoice compact`: an icon-only trigger for a toolbar line. It shows the chosen node's icon (Automatic has its own, `NODE_AUTOMATIC_ICON`), the name and status in its tooltip and aria-label (`runOnCompactLabel`), and opens the list with icon and name per node on click, Enter or Space. With one node it is the icon with a tooltip, not a button.
- `SelectContent` passes `alignItemWithTrigger` to its positioner.
