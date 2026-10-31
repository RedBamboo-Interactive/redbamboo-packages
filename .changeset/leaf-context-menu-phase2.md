---
"@redbamboo/ui": minor
"@redbamboo/chat": minor
"@redbamboo/github": patch
---

Leaf context menu, Phase 2. All new behaviour is gated by the shell's "Leaf context menu" preference; with it off, rendering and behaviour are unchanged.

`@redbamboo/ui`:
- Run contexts carry `origin`, the element actually pressed, so one target can tailor its items to the part pressed.
- A target's `getItems` may return `null` to decline, handing the menu to the next ancestor.
- `data-context-media="image|video|audio"` with `data-context-media-src` declares the media behind a thumbnail, poster or card.
- A chat row marked `data-leaf-long-press` hands its touch long-press to the shared sheet.
- Dock panel tabs and group headers get the panel menu on right-click (`dockPanelEntries`).

`@redbamboo/chat`:
- Messages get Copy text, Copy as Markdown, host items (`getMessageActions`, for example Nova's React) and Info, from every text segment of a message and from a hover ⋮.
- Fenced code blocks get a Copy button and "Copy code", which copy the authored source.
- Activity squares get Open details, Open in editor and Open job in Compute.
- Chat thumbnails, video posters, the audio widget and audio/video attachments are recognised as media.
- Artifacts tiles and rows get Open and Go to message.
- Hosts that describe their side actions, or have none, hand the touch long-press to the shared sheet. Others keep the hand-rolled action row.

`@redbamboo/github`: commit, PR and issue rows get the row's actions on right-click.
