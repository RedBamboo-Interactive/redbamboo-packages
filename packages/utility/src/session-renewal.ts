/**
 * Silent browser-session renewal.
 *
 * The access badge (HttpOnly cookie) is short lived; a rotating refresh cookie renews it via
 * `POST /auth/refresh`. This module makes renewal invisible and cheap:
 *
 * - single-flight inside a tab, and across tabs through the Web Locks API (with a
 *   localStorage lease as fallback) plus a shared "last renewed at" stamp;
 * - a 401 from /auth/refresh is final only after /auth/me confirms the session is gone;
 * - network errors and 5xx are transient and never end the session;
 * - a global fetch interceptor renews and replays a request that came back 401, once;
 * - proactive renewal about once an hour per browser, also on focus/visibility/online.
 *
 * Loopback identity (`local-user`) has no refresh token: it never starts renewal.
 *
 * Deliberately dependency-free (no relative imports) so it runs under `node --test`.
 */

export type RenewalResult = "renewed" | "gone" | "transient"

export interface SessionRenewalDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  locks: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } | null
  /** Called at most once when the session truly cannot be renewed. */
  onSessionLost: () => void
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
  renewSession(): Promise<RenewalResult>
  /** Begin tracking a real (non-local) session: proactive timer + lifecycle listeners. */
  start(): void
  stop(): void
  isActive(): boolean
  /** Whether the badge may have expired; used before WebSocket reconnects. */
  ensureFresh(): Promise<void> | undefined
  /** Forget the renewal stamp (logout). */
  clearStamp(): void
  /** Same-origin fetch that renews and replays once on 401. */
  wrapFetch(base: typeof fetch): typeof fetch
}

export function createSessionRenewal(deps: SessionRenewalDeps): SessionRenewal {
  let inflight: Promise<RenewalResult> | null = null
  let active = false
  let lost = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let renewAfterMs = PROACTIVE_AFTER_MS
  let teardown: (() => void) | null = null

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
              // that the prior durable user session still exists.
              if (user?.id === "local-user") return "gone"
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

  const loseSession = () => {
    stopInternal()
    try {
      deps.storage?.removeItem(STAMP_KEY)
    } catch {}
    memoryStamp = null
    if (lost) return
    lost = true
    deps.onSessionLost()
  }

  const renewSession = (): Promise<RenewalResult> => {
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
        if (result === "gone") {
          // Bootstrap also probes once for a refresh cookie when LocalDefault masks an
          // unauthenticated loopback request. That anonymous probe must not redirect a
          // genuine local user to /login; only an actively tracked user session can be lost.
          if (active) loseSession()
          else {
            try {
              deps.storage?.removeItem(STAMP_KEY)
            } catch {}
            memoryStamp = null
          }
        }
        else if (active) schedule(result === "transient" ? TRANSIENT_RETRY_MS : undefined)
        return result
      } finally {
        inflight = null
      }
    })()
    return inflight
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

  function stopInternal() {
    active = false
    if (timer) clearTimeout(timer)
    timer = null
    teardown?.()
    teardown = null
  }

  return {
    renewSession,
    start() {
      if (active) return
      active = true
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
    clearStamp() {
      memoryStamp = null
      try {
        deps.storage?.removeItem(STAMP_KEY)
      } catch {}
    },
    wrapFetch(base) {
      const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const eligible = active && isRenewable(input)
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
        if (res.status !== 401 || !replay || !active) return res
        const result = await renewSession()
        if (result === "renewed") return replay()
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
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body === undefined || body === null) return true
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return false
  return true
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
    onSessionLost: () => {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login"
      }
    },
  })
  return singleton
}

export const renewSession = () => browserRenewal().renewSession()
export const startSessionRenewal = () => {
  installSessionFetchInterceptor()
  browserRenewal().start()
}
export const stopSessionRenewal = () => browserRenewal().stop()
export const ensureFreshSession = () => browserRenewal().ensureFresh()
export const clearSessionRenewalStamp = () => browserRenewal().clearStamp()
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
