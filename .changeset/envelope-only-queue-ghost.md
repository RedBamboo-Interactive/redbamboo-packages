---
"@redbamboo/chat": patch
---

A queued input that holds only hidden envelopes (an Agent's internal note, such as Nova's reaction note) renders no ghost instead of an empty bubble. `queuedMessageHasNothingToShow` decides it; anything a person wrote or attached, a context card and Nova events still show.
