---
"@redbamboo/chat": minor
"@redbamboo/ui": patch
---

A job is now a twin in the frieze row instead of an 80 px square under it: exactly two tool squares and their gap (23 x 10), magenta like a delegation, at the end of the row of the message that launched it. It fills with the job's real progress and glides to each new value, a short segment sweeps through it while there is no real progress yet, and it wobbles while it runs; queued is an outline, done solid, failed red, needs-you gold with a pulse, stopped grey. Clicking it opens the job summary in the squares' dialog, and previous/next step through jobs like any other square. Running jobs in the activity row use the same shape. Removed: `JobCard`, `JobCards`, `JOB_BODY_RENDERERS`, `jobKindColor` and their types. `@redbamboo/ui` swaps the job square's ring, aura and shimmer styles in `tokens.css` for `.job-twin`, still under reduced motion.
