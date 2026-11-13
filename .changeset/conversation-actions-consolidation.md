---
"@redbamboo/chat": minor
---

Conversation actions, sharing, maintenance, history paging and search move into the shared package so Nova and Code use one implementation each: `conversationActionEntries` with `CONVERSATION_SHORTCUTS` and host slots, `useConversationShortcuts`, `ConversationActionsMenu`, `EditableTitle`, `useTitleUpdate`, a source-agnostic `useShare` (`discussionShareSource`, `sessionShareSource`), `useMaintenanceStatus` with an injected loader, `LatestTaskCoordinator`, `SessionTranscriptPaging` over RedCompute `transcript-page`, the transcript-page contract helpers, `GoToMessageController` with `useGoToMessage` and `?message=` deep links, and `ConversationSearchDialog` with `sessionSearchSource`. `ShareDialog` now says plainly that tool output and file contents are not included.
