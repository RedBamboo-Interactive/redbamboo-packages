---
"@redbamboo/ui": minor
"@redbamboo/chat": patch
---

Leaf context menu, Phase 3. All new behaviour is gated by the shell's "Leaf context menu" preference; with it off, rendering and behaviour are unchanged.

`@redbamboo/ui`:
- A `file` kind: an element inside the pressed object that declares `data-context-file` (absolute local path, optional `data-context-file-line`) gets a Copy path item and the `file` contributions of other plugins (Code's "Open in Code"). A registered target that is itself a file passes `{ kind: "file", subject: { path, line?, directory? } }`. `FileSubject` is exported.

`@redbamboo/chat`:
- Local file links in Markdown declare their file, so they get Copy path and "Open in Code" after the message's own items.
