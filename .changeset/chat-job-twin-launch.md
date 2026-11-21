---
"@redbamboo/chat": patch
---

A job's twin sits inside its row, right after the square of the tool call that launched it (the first tool result that names the job, by a `jobId`/`job_id` field or a printed GUID), and the dialog's previous/next step in that order. A job no loaded result names keeps the time rule: the block active when it was queued, at the end of that block's row. Each job now places itself, instead of following the earliest block of its turn. New exports `jobLaunchIndex`, `jobLaunchBlock`, `idsNamedBy`; `SquareRow.jobIds` is now `jobs: { id, after }[]`.
