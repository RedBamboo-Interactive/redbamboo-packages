---
"@redbamboo/chat": patch
---

Event modals render an image the payload carries, above the payload itself.

Detection is driven by the payload rather than the event type, so any plugin
that attaches an image gets this without a renderer of its own: an `asset_url`
(or an `asset_id`, resolved to `/api/assets/{id}`) that looks like an image,
in either casing. A non-null `frame_error` shows the plugin's message in place
of the image, and an asset that fails to load falls back to a placeholder
rather than a broken-image icon. Tapping the image opens it full size in a new
tab.
