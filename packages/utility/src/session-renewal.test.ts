import assert from "node:assert/strict"
import test from "node:test"
import { createSessionRenewal, type SessionRenewalDeps } from "./session-renewal.ts"
import { createWebSocket } from "./create-websocket.ts"

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

/** Mutex that behaves like navigator.locks within one process, shared by "tabs". */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request(_n: string, cb: () => Promise<unknown>) {
      const run = tail.then(cb, cb)
      tail = run.catch(() => {})
      return run
    },
  }
}

function setup(handler: Handler, extra: Partial<SessionRenewalDeps> = {}) {
  const calls: string[] = []
  const lost: number[] = []
  let clock = 1_000_000
  const deps: SessionRenewalDeps = {
    fetch: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      return handler(url, init)
    },
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    storage: memoryStorage(),
    locks: fakeLocks(),
    onSessionLost: () => void lost.push(1),
    ...extra,
  }
  return { deps, calls, lost, advance: (ms: number) => void (clock += ms), r: createSessionRenewal(deps) }
}

const refreshOk: Handler = (url) => (url === "/auth/refresh" ? json(200, { expiresIn: 3600 }) : json(200, { id: "u1" }))

test("single-flight: concurrent callers share one refresh", async () => {
  const s = setup(refreshOk)
  const results = await Promise.all([s.r.renewSession(), s.r.renewSession(), s.r.renewSession()])
  assert.deepEqual(results, ["renewed", "renewed", "renewed"])
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)
})

test("cross-tab: second tab waiting on the lock skips via shared stamp", async () => {
  const storage = memoryStorage()
  const locks = fakeLocks()
  const a = setup(refreshOk, { storage, locks })
  const b = setup(refreshOk, { storage, locks, now: a.deps.now })
  const [ra, rb] = await Promise.all([a.r.renewSession(), b.r.renewSession()])
  assert.equal(ra, "renewed")
  assert.equal(rb, "renewed")
  const total = a.calls.length + b.calls.length
  assert.equal(total, 1, "only one network refresh across both tabs")
})

test("fetch interceptor: 401 -> renew -> retry once succeeds", async () => {
  let api = 0
  const s = setup(refreshOk)
  s.r.start()
  const base = (async () => (++api === 1 ? json(401) : json(200, { ok: true }))) as unknown as typeof fetch
  const f = s.r.wrapFetch(base)
  const res = await f("/api/things", { method: "POST", body: "x" })
  assert.equal(res.status, 200)
  assert.equal(api, 2)
  s.r.stop()
})

test("fetch interceptor: persistent 401 retries exactly once, no loop", async () => {
  let api = 0
  const s = setup(refreshOk)
  s.r.start()
  const base = (async () => (api++, json(401))) as unknown as typeof fetch
  const res = await s.r.wrapFetch(base)("/api/things")
  assert.equal(res.status, 401)
  assert.equal(api, 2)
  s.r.stop()
})

test("fetch interceptor: not applied to /auth/*, other origins, stream bodies, or when inactive", async () => {
  let api = 0
  const s = setup(refreshOk)
  const base = (async () => (api++, json(401))) as unknown as typeof fetch
  const f = s.r.wrapFetch(base)
  await f("/api/x") // inactive (local-user / logged out)
  assert.equal(api, 1)
  s.r.start()
  await f("/auth/me")
  assert.equal(api, 2)
  await f("https://example.com/api/x")
  assert.equal(api, 3)
  await f("/api/x", { method: "POST", body: new ReadableStream(), duplex: "half" } as RequestInit)
  assert.equal(api, 4)
  s.r.stop()
})

test("transient 503 on refresh never logs out and surfaces a retryable 503", async () => {
  const s = setup((url) => (url === "/auth/refresh" ? json(503) : json(200)))
  s.r.start()
  const base = (async () => json(401)) as unknown as typeof fetch
  const res = await s.r.wrapFetch(base)("/api/x")
  assert.equal(res.status, 503)
  assert.equal(s.lost.length, 0)
  assert.equal(await s.r.renewSession(), "transient")
  assert.equal(s.lost.length, 0)
  s.r.stop()
})

test("network error on refresh is transient", async () => {
  const s = setup(() => {
    throw new TypeError("network")
  })
  assert.equal(await s.r.renewSession(), "transient")
  assert.equal(s.lost.length, 0)
})

test("401 on refresh but /auth/me ok does not log out", async () => {
  const s = setup((url) => (url === "/auth/refresh" ? json(401, { error: "invalid_token" }) : json(200, { id: "u1" })))
  assert.equal(await s.r.renewSession(), "transient")
  assert.equal(s.lost.length, 0)
})

test("401 on refresh and /auth/me 401 ends the session exactly once", async () => {
  const s = setup(() => json(401))
  s.r.start()
  const results = await Promise.all([s.r.renewSession(), s.r.renewSession()])
  assert.deepEqual(results, ["gone", "gone"])
  assert.equal(await s.r.renewSession(), "gone")
  assert.equal(s.lost.length, 1)
})

test("local-user: renewal is never started, so nothing refreshes", async () => {
  const s = setup(refreshOk)
  // AuthProvider does not call start() for local-user.
  assert.equal(s.r.isActive(), false)
  assert.equal(s.r.ensureFresh(), undefined)
  let api = 0
  const res = await s.r.wrapFetch((async () => (api++, json(401))) as unknown as typeof fetch)("/api/x")
  assert.equal(res.status, 401)
  assert.equal(api, 1)
  assert.equal(s.calls.length, 0)
})

test("ensureFresh renews when stamp is unknown/stale, not when fresh", async () => {
  const s = setup(refreshOk)
  s.r.start() // unknown stamp -> renews once
  await s.r.renewSession()
  const before = s.calls.length
  assert.equal(s.r.ensureFresh(), undefined)
  s.advance(51 * 60_000)
  await s.r.ensureFresh()
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length >= 2, true)
  assert.ok(s.calls.length > before)
  s.r.stop()
})

class FakeWs {
  static instances: FakeWs[] = []
  onopen: unknown
  onclose: (() => void) | null = null
  onerror: unknown
  onmessage: unknown
  url: string
  constructor(url: string) {
    this.url = url
    FakeWs.instances.push(this)
  }
  close() {}
}

test("WebSocket reconnect awaits renewal when the badge is stale", async () => {
  const g = globalThis as Record<string, unknown>
  const prev = g.WebSocket
  g.WebSocket = FakeWs
  FakeWs.instances = []
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let renewals = 0
  const handle = createWebSocket({
    url: "ws://x/ws",
    reconnectMs: 1,
    beforeReconnect: () => (renewals++, gate),
    onEvent: () => {},
  })
  try {
    assert.equal(FakeWs.instances.length, 1)
    FakeWs.instances[0].onclose?.()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(renewals, 1)
    assert.equal(FakeWs.instances.length, 1, "must not reconnect before renewal finishes")
    release()
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(FakeWs.instances.length, 2)
  } finally {
    handle.close()
    g.WebSocket = prev
  }
})
