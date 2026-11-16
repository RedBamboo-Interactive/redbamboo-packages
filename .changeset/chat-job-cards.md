---
"@redbamboo/chat": minor
"@redbamboo/ui": patch
---

Job cards: when an agent starts an image, video, music or workflow job, a small card in the agent message that launched it shows the job's progress and links to it. `ChatPanel` takes `jobs` and `onStopJob`; without them it renders exactly as before. `useChatJobs` keeps one conversation's jobs from the host's authorized endpoint through a `ChatJobsTransport`: one bounded list on open, job frames as invalidation only, single-job re-reads coalesced, discovery bounded by the last list. The rules live in `chat-jobs` (also exported as `@redbamboo/chat/chat-jobs`): AI sessions, speech in and out, and successes under 2 s get no card, failures always do; a job anchors to the agent turn active when it was queued; a finished media job shrinks to a chip once a later agent message shows media of its kind; a percentage only when progress is real. Running jobs join the activity row after the host's own work. `@redbamboo/ui` adds the cards' shimmer, hairline and pulse keyframes to `tokens.css`, off under reduced motion.
