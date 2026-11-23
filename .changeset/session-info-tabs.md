---
"@redbamboo/chat": minor
---

The Info modal is a tabbed card: a hero with the agent, status, provider, quality, permissions, node and a context ring; Overview, Skills, Memory or Instructions, Workspace, Settings and Usage tabs in a fixed-height body; and a compact footer with the Discussion, Session and Job identifiers. Hosts fill it through optional `skills`, `node`, `workspace`, `memory`, `instructions`, `workingOn`, `nodeExtra`, `workspaceExtra`, `primaryLink` and `historyPartial` props, and a tab with nothing to show is hidden. New helpers: `deriveUsedSkills`, `deriveOpenedMemory` and `sessionInfoNodeFrom`.
