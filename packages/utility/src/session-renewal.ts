/**
 * Silent browser-session renewal.
 *
 * The access badge (HttpOnly cookie) is short lived; a rotating refresh cookie renews it via
 * `POST /auth/refresh`. This module makes renewal invisible and cheap:
 *
 * - single-flight inside a tab, and across tabs through the Web Locks API (with a
 *   localStorage lease as fallback) plus a shared "last renewed at" stamp;
 * - a 401 from /auth/refresh is final only after /auth/me confirms the session is gone;
 * - a session the server ended (`session_revoked`: signed out from another device, rejected,
 *   refresh-token reuse) is final at once: no retry, one `onSessionLost("revoked")`;
 * - `session_upgrade_required` (a badge from before device sessions) renews once per session and
 *   replays; on loopback with no refresh cookie that renewal ends in LocalDefault, which is accepted;
 * - network errors and 5xx are transient and never end the session;
 * - a global fetch interceptor renews and replays a request that came back 401, once;
 * - proactive renewal about once an hour per browser, also on focus/visibility/online.
 *
 * Loopback identity (`local-user`) has no refresh token: it never starts renewal.
 *
 * Deliberately dependency-free (no relative imports) so it runs under `node --test`.
 */

/**
 * `local`: there was nothing to renew and the browser is now the loopback LocalDefault identity, which the
 * caller asked to accept ({@link RenewOptions.acceptLocal}). Renewal stops; the session is not "lost".
 */
export type RenewalResult = "renewed" | "gone" | "revoked" | "transient" | "local"

export interface RenewOptions {
  /**
   * The server deleted a badge from before device sessions (`session_upgrade_required`). On loopback a
   * browser without a refresh cookie then falls back to LocalDefault, as before sessions (design 5.3):
   * accept that instead of treating it as a lost session.
   */
  acceptLocal?: boolean
}

/** Why the session ended: it could not be renewed, or the server ended it. */
export type SessionLostReason = "expired" | "revoked"

/** The server's 401 for a device session that has ended. Final: renewing cannot bring it back. */
export const SESSION_REVOKED_ERROR = "session_revoked"
/** The server's 401 for a badge issued before device sessions: one renewal replaces it. */
export const SESSION_UPGRADE_REQUIRED_ERROR = "session_upgrade_required"

/**
 * Dispatched on `window` (cancelable, `detail: { reason }`) when the browser session ends. A shell that
 * shows its own signed-out screen calls `preventDefault()`; otherwise the page goes to /login.
 */
export const SIGNED_OUT_EVENT = "redsuite:signed-out"

/**
 * Dispatched on `window` after someone signed in again without a reload (for example from a shell's own
 * signed-out screen). A WebSocket stopped by a 4401 close re-arms on it.
 */
export const SIGNED_IN_EVENT = "redsuite:signed-in"

export interface SessionRenewalDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  locks: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } | null
  /** Called at most once when the session truly cannot be renewed, or the server ended it. */
  onSessionLost: (reason: SessionLostReason) => void
}

const STAMP_KEY = "redsuite:session:renewedAt"
const LEASE_KEY = "redsuite:session:renewLease"
const LOCK_NAME = "redsuite-session-renew"
const SKIP_WINDOW_MS = 30_000
const PROACTIVE_AFTER_MS = 40 * 60_000
const WS_STALE_MS = 50 * 60_000
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000]
const TRANSIENT_RETRY_MS = 60_000

export interface SessionRenewal {
  renewSession(options?: RenewOptions): Promise<RenewalResult>
  /**
   * The renewal a `session_upgrade_required` answer calls for, once per session for every caller (the fetch
   * wrapper and `bootstrapAuthUser`): it clears the stamp and renews, accepting LocalDefault. Callers that
   * arrive while it runs share it; after it, `"spent"`. A renewal that only failed transiently spends nothing.
   */
  renewForUpgrade(): Promise<RenewalResult | "spent">
  /** Begin tracking a real (non-local) session: proactive timer + lifecycle listeners. */
  start(): void
  stop(): void
  isActive(): boolean
  /** Whether the badge may have expired; used before WebSocket reconnects. */
  ensureFresh(): Promise<void> | undefined
  /**
   * For {@link CreateWebSocketOptions.beforeReconnect}: when the previous attempt never opened (the server refused
   * the upgrade, as the device gate does a badge from before device sessions), the once-per-session upgrade
   * renewal ({@link renewForUpgrade}); otherwise {@link ensureFresh}. Spent once, so a socket that keeps failing
   * rotates nothing more.
   */
  prepareSocketReconnect(context?: { previousAttemptOpened: boolean }): Promise<void> | undefined
  /** Forget the renewal stamp (logout). */
  clearStamp(): void
  /** Same-origin fetch that renews and replays once on 401. */
  wrapFetch(base: typeof fetch): typeof fetch
  /** The server ended this session (a 4401 WebSocket close, a `session_revoked` answer elsewhere). */
  reportRevoked(): void
}

export function createSessionRenewal(deps: SessionRenewalDeps): SessionRenewal {
  let inflight: Promise<RenewalResult> | null = null
  let active = false
  let lost = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let renewAfterMs = PROACTIVE_AFTER_MS
  let teardown: (() => void) | null = null
  // Set while some caller of the in-flight renewal accepts ending in LocalDefault.
  let acceptLocal = false
  // session_upgrade_required renews once per session: a server that kept answering it would otherwise
  // rotate the refresh token on every request. Only a session that was lost and started again re-arms it.
  let upgradeSpent = false
  let upgradeInflight: Promise<RenewalResult> | null = null

  const readStamp = (): number | null => {
    try {
      const v = Number(deps.storage?.getItem(STAMP_KEY))
      return Number.isFinite(v) && v > 0 ? v : null
    } catch {
      return null
    }
  }
  let memoryStamp: number | null = null
  const lastRenewed = () => Math.max(readStamp() ?? 0, memoryStamp ?? 0) || null
  const writeStamp = () => {
    memoryStamp = deps.now()
    try {
      deps.storage?.setItem(STAMP_KEY, String(memoryStamp))
    } catch {}
  }

  const attempt = async (): Promise<RenewalResult> => {
    for (let i = 0; ; i++) {
      let transient = false
      try {
        const res = await deps.fetch("/auth/refresh", { method: "POST", credentials: "include" })
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { expiresIn?: number } | null
          if (body && typeof body.expiresIn === "number" && body.expiresIn > 0) {
            renewAfterMs = Math.min(PROACTIVE_AFTER_MS, Math.floor(body.expiresIn * 1000 * 0.66))
          }
          writeStamp()
          return "renewed"
        }
        if (res.status === 401) {
          if ((await errorCode(res)) === SESSION_REVOKED_ERROR) return "revoked"
          // Another tab may have rotated the cookie; only /auth/me knows whether we are still in.
          try {
            const me = await deps.fetch("/auth/me", {
              credentials: "include",
              cache: "no-store",
            })
            if (me.status === 401) return "gone"
            if (me.ok) {
              const user = (await me.json().catch(() => null)) as { id?: string } | null
              // LocalDefault is a successful anonymous loopback fallback, not proof
              // that the prior durable user session still exists, unless the caller
              // knows the badge was just deleted and accepts it.
              if (user?.id === "local-user") return acceptLocal ? "local" : "gone"
            }
          } catch {}
          // Session still valid (or unknown) but refresh did not work: try again later, don't stamp.
          return "transient"
        }
        transient = true
      } catch {
        transient = true
      }
      if (transient && i >= RETRY_BACKOFF_MS.length) return "transient"
      await deps.sleep(RETRY_BACKOFF_MS[i])
    }
  }

  /** Cross-tab critical section: serialize, then skip if someone just renewed. */
  const withCrossTabLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (deps.locks) return (await deps.locks.request(LOCK_NAME, fn)) as T
    // Fallback: localStorage lease, polled. Best effort; the stamp check does the real dedupe.
    const store = deps.storage
    if (!store) return fn()
    const me = Math.random().toString(36).slice(2)
    const deadline = deps.now() + 15_000
    for (;;) {
      let held = false
      try {
        const raw = store.getItem(LEASE_KEY)
        const lease = raw ? (JSON.parse(raw) as { owner: string; until: number }) : null
        held = !!lease && lease.until > deps.now() && lease.owner !== me
        if (!held) store.setItem(LEASE_KEY, JSON.stringify({ owner: me, until: deps.now() + 15_000 }))
      } catch {}
      if (!held || deps.now() >= deadline) break
      await deps.sleep(100)
    }
    try {
      return await fn()
    } finally {
      try {
        const lease = JSON.parse(store.getItem(LEASE_KEY) ?? "null") as { owner: string } | null
        if (lease?.owner === me) store.removeItem(LEASE_KEY)
      } catch {}
    }
  }

  const loseSession = (reason: SessionLostReason) => {
    stopInternal()
    try {
      deps.storage?.removeItem(STAMP_KEY)
    } catch {}
    memoryStamp = null
    if (lost) return
    lost = true
    deps.onSessionLost(reason)
  }

  const renewSession = (options?: RenewOptions): Promise<RenewalResult> => {
    if (options?.acceptLocal) acceptLocal = true
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const result = await withCrossTabLock(async () => {
          const stamp = lastRenewed()
          // A tab that waited on the lock (or a caller right after a renewal) reuses the
          // renewal another tab just performed.
          if (stamp !== null && deps.now() - stamp < SKIP_WINDOW_MS) {
            return "renewed" as RenewalResult
          }
          return attempt()
        })
        if (result === "gone") loseSession("expired")
        else if (result === "revoked") loseSession("revoked")
        else if (result === "local") {
          // Nothing left to renew: stop quietly, without onSessionLost.
          stopInternal()
          clearStampOnly()
        } else if (active) schedule(result === "transient" ? TRANSIENT_RETRY_MS : undefined)
        return result
      } finally {
        inflight = null
        acceptLocal = false
      }
    })()
    return inflight
  }

  const renewForUpgrade = (): Promise<RenewalResult | "spent"> => {
    if (upgradeInflight) return upgradeInflight
    if (upgradeSpent) return Promise.resolve("spent")
    upgradeSpent = true
    // A badge from before device sessions: a fresh renewal, even right after another one.
    clearStampOnly()
    upgradeInflight = renewSession({ acceptLocal: true })
      .then((result) => {
        // The server could not be reached: nothing was upgraded, so the next answer may try again.
        if (result === "transient") upgradeSpent = false
        return result
      })
      .finally(() => {
        upgradeInflight = null
      })
    return upgradeInflight
  }

  function schedule(delayOverride?: number) {
    if (timer) clearTimeout(timer)
    timer = null
    if (!active) return
    const stamp = lastRenewed()
    const delay =
      delayOverride ?? Math.max(5_000, stamp === null ? 0 : stamp + renewAfterMs - deps.now())
    timer = setTimeout(onTimer, delay)
  }

  function onTimer() {
    timer = null
    if (!active) return
    const stamp = lastRenewed()
    // Another tab may have renewed meanwhile; just re-aim the timer in that case.
    if (stamp !== null && deps.now() - stamp < renewAfterMs) schedule()
    else void renewSession()
  }

  const renewIfStale = () => {
    if (!active) return
    const stamp = lastRenewed()
    if (stamp === null || deps.now() - stamp > renewAfterMs) void renewSession()
    else schedule()
  }

  function clearStampOnly() {
    memoryStamp = null
    try {
      deps.storage?.removeItem(STAMP_KEY)
    } catch {}
  }

  function stopInternal() {
    active = false
    if (timer) clearTimeout(timer)
    timer = null
    teardown?.()
    teardown = null
  }

  const renewal: SessionRenewal = {
    renewSession,
    renewForUpgrade,
    start() {
      if (active) return
      active = true
      // A new session after a lost one (signed in again without a reload) may upgrade once more.
      if (lost) upgradeSpent = false
      lost = false
      const onVisible = () => {
        if (typeof document === "undefined" || document.visibilityState === "visible") renewIfStale()
      }
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible)
      if (typeof window !== "undefined") {
        window.addEventListener("focus", renewIfStale)
        window.addEventListener("online", renewIfStale)
      }
      teardown = () => {
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible)
        if (typeof window !== "undefined") {
          window.removeEventListener("focus", renewIfStale)
          window.removeEventListener("online", renewIfStale)
        }
      }
      renewIfStale()
    },
    stop: stopInternal,
    isActive: () => active,
    ensureFresh() {
      if (!active) return undefined
      const stamp = lastRenewed()
      if (stamp !== null && deps.now() - stamp < WS_STALE_MS) return undefined
      return renewSession().then(() => undefined)
    },
    prepareSocketReconnect(context) {
      if (!active) return undefined
      if (context && !context.previousAttemptOpened)
        return renewForUpgrade().then(() => undefined, () => undefined)
      return renewal.ensureFresh()
    },
    clearStamp: clearStampOnly,
    reportRevoked() {
      loseSession("revoked")
    },
    wrapFetch(base) {
      const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        // A request that carries its own badge (an execution token) speaks for that badge, not this session: its
        // 401 is the caller's to handle (execution-token re-mints), never a reason to renew or end the session.
        const eligible = active && isRenewable(input) && !carriesAuthorization(input, init)
        let replay: (() => Promise<Response>) | null = null
        if (eligible) {
          if (typeof Request !== "undefined" && input instanceof Request) {
            if (!input.bodyUsed) {
              const copy = input.clone()
              replay = () => base(copy, init)
            }
          } else if (isReplayableBody(init?.body)) {
            replay = () => base(input, init)
          }
        }
        const res = await base(input, init)
        // Only this origin's own API speaks for this session: another origin's 401 says nothing about it.
        if (res.status !== 401 || !eligible || !active) return res
        const code = await errorCode(res.clone())
        if (code === SESSION_REVOKED_ERROR && isKernelRoute(input)) {
          // Ended on the server: renewing would only be refused. Final, once.
          loseSession("revoked")
          return res
        }
        // From a route an extension answers (or the Compute proxy), session_revoked could be anyone's
        // words: it is confirmed by a renewal instead, since /auth/refresh answers session_revoked itself.
        const confirmRevoked = code === SESSION_REVOKED_ERROR
        if (!replay && !confirmRevoked) return res
        let result: RenewalResult | "spent"
        if (code === SESSION_UPGRADE_REQUIRED_ERROR) {
          // Once per session. Repeated, it is final for that request: no second rotation, no stamp cleared.
          result = await renewForUpgrade()
          if (result === "spent") return res
        } else {
          result = await renewSession()
        }
        if (!replay) return res
        // "local": the server deleted the old badge and this loopback browser is LocalDefault now.
        if (result === "renewed" || result === "local") return replay()
        if (result === "transient") {
          // Not a logout: surface a retryable error rather than a 401.
          return new Response(JSON.stringify({ error: "session_renewal_unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        }
        return res
      }
      return wrapped as typeof fetch
    },
  }
  return renewal
}

/** The `error` member of a JSON error body, or null. Never throws. */
export async function errorCode(res: Response): Promise<string | null> {
  try {
    if (!(res.headers.get("Content-Type") ?? "").includes("json")) return null
    const body = (await res.json()) as { error?: unknown } | null
    return typeof body?.error === "string" ? body.error : null
  } catch {
    return null
  }
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body === undefined || body === null) return true
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return false
  return true
}

/**
 * A route the kernel itself answers, so its `session_revoked` is the server's word: `/auth/*`, and `/api/*`
 * outside the extension namespaces. Extension routes live under `/api/apps/<id>`, `/api/extensions/<id>`
 * (the SDK allows no other namespace) and `/api/public/<id>`; the kernel's own `/api/extensions/{id}/...`
 * routes share that prefix, so it is not trusted as a whole. Same origin only.
 */
export function isKernelRoute(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const base = typeof location !== "undefined" ? location.href : "http://localhost/"
    const url = new URL(raw, base)
    if (url.origin !== new URL(base).origin) return false
    const path = url.pathname
    if (path.startsWith("/auth/")) return true
    if (!path.startsWith("/api/")) return false
    return !["/api/apps/", "/api/extensions/", "/api/public/"].some((prefix) => path.startsWith(prefix))
  } catch {
    return false
  }
}

/** Whether the request sets its own Authorization header. */
function carriesAuthorization(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    if (init?.headers && new Headers(init.headers).has("Authorization")) return true
    return typeof Request !== "undefined" && input instanceof Request && input.headers.has("Authorization")
  } catch {
    return false
  }
}

function isRenewable(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const base = typeof location !== "undefined" ? location.href : "http://localhost/"
    const url = new URL(raw, base)
    if (url.origin !== new URL(base).origin) return false
    return !(url.pathname === "/auth" || url.pathname.startsWith("/auth/"))
  } catch {
    return false
  }
}

// ---- Browser singleton -------------------------------------------------------------------

let singleton: SessionRenewal | null = null

function browserRenewal(): SessionRenewal {
  if (singleton) return singleton
  singleton = createSessionRenewal({
    fetch: (input, init) => (originalFetch ?? globalThis.fetch).call(globalThis, input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    storage: (() => {
      try {
        return typeof localStorage !== "undefined" ? localStorage : null
      } catch {
        return null
      }
    })(),
    locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null,
    onSessionLost: (reason) => {
      if (typeof window === "undefined") return
      const event = new CustomEvent(SIGNED_OUT_EVENT, { cancelable: true, detail: { reason } })
      if (!window.dispatchEvent(event)) return
      if (window.location.pathname !== "/login") window.location.href = "/login"
    },
  })
  return singleton
}

export const renewSession = (options?: RenewOptions) => browserRenewal().renewSession(options)
/** The once-per-session upgrade renewal ({@link SessionRenewal.renewForUpgrade}). */
export const renewSessionForUpgrade = () => browserRenewal().renewForUpgrade()
export const startSessionRenewal = () => {
  installSessionFetchInterceptor()
  browserRenewal().start()
}
export const stopSessionRenewal = () => browserRenewal().stop()
export const ensureFreshSession = () => browserRenewal().ensureFresh()
/** {@link SessionRenewal.prepareSocketReconnect} of the browser singleton, for `beforeReconnect`. */
export const prepareSocketReconnect = (context?: { previousAttemptOpened: boolean }) =>
  browserRenewal().prepareSocketReconnect(context)
export const clearSessionRenewalStamp = () => browserRenewal().clearStamp()
/** The server ended this browser's session (for example a 4401 WebSocket close). */
export const reportSessionRevoked = () => browserRenewal().reportRevoked()
/** Someone signed in again without a reload: tell what stopped on sign-out (a 4401 WebSocket) to start again. */
export const announceSignedIn = () => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(SIGNED_IN_EVENT))
}
export const hasSessionRenewalStamp = () => {
  try {
    return !!localStorage.getItem(STAMP_KEY)
  } catch {
    return false
  }
}

let originalFetch: typeof fetch | null = null

/** Install the global 401 -> renew -> replay-once interceptor. Idempotent. */
export function installSessionFetchInterceptor(): void {
  if (originalFetch || typeof window === "undefined") return
  originalFetch = window.fetch.bind(window)
  window.fetch = browserRenewal().wrapFetch(originalFetch)
}

export function uninstallSessionFetchInterceptor(): void {
  if (!originalFetch || typeof window === "undefined") return
  window.fetch = originalFetch
  originalFetch = null
}
