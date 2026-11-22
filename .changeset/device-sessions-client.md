---
"@redbamboo/utility": minor
---

Device sessions, the browser's part.

- **Revoked sessions.** A session the server ended (`401 session_revoked`: signed out from another device, rejected, refresh-token reuse) is final at once.
  - Renewal stops without retrying or asking `/auth/me`, and `onSessionLost` runs once with reason `"revoked"` (`"expired"` when renewal is simply impossible).
  - Only the kernel's own routes are taken at their word (`isKernelRoute`: same origin, `/api/*` outside `/api/apps/`, `/api/extensions/` and `/api/public/`).
  - From an extension route or the Compute proxy, a `session_revoked` is confirmed by a renewal first, since `/auth/refresh` answers it too.
- **Signed-out event.** The browser singleton dispatches a cancelable `SIGNED_OUT_EVENT` (`redsuite:signed-out`, `detail: { reason }`) on `window` before it goes to /login, so a shell can show its own signed-out screen.
- **Old badges.** `401 session_upgrade_required` (a badge from before device sessions) renews once per session, even right after another renewal, and replays.
  - A repeated answer is final for that request.
  - On loopback without a refresh cookie, the renewal lands on LocalDefault: `renewSession({ acceptLocal: true })` resolves `"local"` and never calls `onSessionLost`.
  - `bootstrapAuthUser` does the same at load, with or without a renewal stamp.
  - The once is shared: the fetch wrapper and `bootstrapAuthUser` (dependency `renewForUpgrade`) both go through `renewSessionForUpgrade()`, so neither clears the stamp or rotates again after the other. It resolves `"spent"` once used.
  - A renewal that failed transiently does not spend it, and only a lost session that starts again re-arms it.
- **WebSocket.** `createWebSocket` stops reconnecting after a `4401` close (`SESSION_REVOKED_CLOSE_CODE`) and calls `onSessionRevoked`; the WebSocket provider reports it through `reportSessionRevoked()`.
  - `handle.rearm()` starts it again after a sign-in without a reload. `AuthProvider.refresh` dispatches `SIGNED_IN_EVENT` (`announceSignedIn()`) and the provider re-arms on it.
  - Reconnects that keep failing back off from `reconnectMs`, doubling up to 15 s, the server relay's own maximum (`reconnectDelay`, `MAX_RECONNECT_MS`).
- **Device on the user.** `AuthUser.device` (`{ sessionId, status }`) is what `/auth/me` now reports.
- **Unavailable is not signed out.** A 5xx or network failure from `/auth/me` (`503 device_sessions_unavailable` while the kernel loads its signed-in devices, a restart), or a renewal that only failed transiently, makes `bootstrapAuthUser` throw `AuthUnavailableError` instead of resolving null.
  - `AuthProvider` keeps its splash and asks again with `bootstrapAuthUserWithRetry` (1, 2, 4, 8, then every 15 s). It never shows the sign-in page for it, and a later `refresh()` keeps the user shown so far.
- **Refused socket upgrades.** `beforeReconnect` now receives `{ previousAttemptOpened }`. The providers use `prepareSocketReconnect`: when the last socket closed without ever opening (the device gate refused an old badge), it runs the once-per-session upgrade renewal, then reconnects; otherwise it only keeps the session fresh.
- **Requests with their own badge.** A 401 on a request that sets its own `Authorization` header (an execution token) is the caller's: the fetch wrapper never renews, replays or ends the session for it, and `createExecutionTokenClient` re-mints its badge once as before.
