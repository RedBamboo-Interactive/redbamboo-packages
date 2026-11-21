---
"@redbamboo/utility": minor
---

Device sessions, the browser's part.

- **Revoked sessions.** A session the server ended (`401 session_revoked`: signed out from another device, rejected, refresh-token reuse) is final at once.
  - Renewal stops without retrying or asking `/auth/me`, and `onSessionLost` runs once with reason `"revoked"` (`"expired"` when renewal is simply impossible).
  - Only same-origin requests outside `/auth` count.
- **Signed-out event.** The browser singleton dispatches a cancelable `SIGNED_OUT_EVENT` (`redsuite:signed-out`, `detail: { reason }`) on `window` before it goes to /login, so a shell can show its own signed-out screen.
- **Old badges.** `401 session_upgrade_required` (a badge from before device sessions) renews once per session, even right after another renewal, and replays.
  - A repeated answer is final for that request.
  - On loopback without a refresh cookie, the renewal lands on LocalDefault: `renewSession({ acceptLocal: true })` resolves `"local"` and never calls `onSessionLost`.
  - `bootstrapAuthUser` does the same at load, with or without a renewal stamp.
- **WebSocket.** `createWebSocket` stops reconnecting after a `4401` close (`SESSION_REVOKED_CLOSE_CODE`) and calls `onSessionRevoked`; the WebSocket provider reports it through `reportSessionRevoked()`.
  - `handle.rearm()` starts it again after a sign-in without a reload. `AuthProvider.refresh` dispatches `SIGNED_IN_EVENT` (`announceSignedIn()`) and the provider re-arms on it.
  - Reconnects that keep failing back off from `reconnectMs`, doubling up to 15 s, the server relay's own maximum (`reconnectDelay`, `MAX_RECONNECT_MS`).
- **Device on the user.** `AuthUser.device` (`{ sessionId, status }`) is what `/auth/me` now reports.
