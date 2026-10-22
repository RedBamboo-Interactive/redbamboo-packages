---
"@redbamboo/chat": minor
---

Consolidate the chat's status and background lines into one activity row: a spinner, one clickable shape per running agent, background task and host item, and one status text chosen by priority (the session, then agents, then other background tasks, then host work). Task shapes open their launching square's details dialog, or the same dialog from live state when the launching square is not loaded; host items open their details in the standard dialog shell. `hostActivity` replaces `backgroundStatusExtras`, and `BackgroundStatusLine` is removed. `renderStatusLine` now renders only while the session streams or reconnects.
