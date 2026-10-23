---
"@redbamboo/chat": minor
---

The activity row's background text is now an icon and verb like the session's own status ("Agent working...", "Running command...", "Working..."), with no progress detail: each shape opens its details. `ActivityStatusGroup` gains an optional `icon`; `ChatStatusLine` loses its `detail` prop.
