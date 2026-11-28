---
"@redbamboo/chat": patch
---

The activity row no longer draws the same state twice. While the session is not working and host work has the row's words, a first host item that asks for `shape: "square"` in the spinner's colour leads the row instead of the spinner. It keeps its activity-marker button and painted layer, so the hover still works. Circles, items without a shape, and a working session keep the spinner as before. `ChatStatusLine` takes an optional `spinner` prop (default true).
