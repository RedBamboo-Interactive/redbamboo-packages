import assert from "node:assert/strict"
import test from "node:test"
import { createSessionRenewal, isKernelRoute, type SessionRenewalDeps } from "./session-renewal.ts"
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
  let meRequest: RequestInit | undefined
  const s = setup((url, init) => {
    if (url === "/auth/refresh") return json(401, { error: "invalid_token" })
    meRequest = init
    return json(200, { id: "u1" })
  })
  assert.equal(await s.r.renewSession(), "transient")
  assert.equal(meRequest?.cache, "no-store")
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

test("401 on refresh and LocalDefault fallback ends the prior user session", async () => {
  const s = setup((url) => url === "/auth/refresh"
    ? json(401, { error: "invalid_token" })
    : json(200, { id: "local-user" }))

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

// ---- device sessions ------------------------------------------------------------------

function lostReasons(extra: Partial<SessionRenewalDeps> = {}, handler: Handler = refreshOk) {
  const reasons: string[] = []
  const s = setup(handler, { onSessionLost: (reason) => void reasons.push(reason), ...extra })
  return { ...s, reasons }
}

test("session_revoked from /auth/refresh is final at once: no /auth/me, no retry, one loss", async () => {
  const s = lostReasons({}, (url) => (url === "/auth/refresh" ? json(401, { error: "session_revoked", reason: "refresh-reused" }) : json(200, { id: "u1" })))
  s.r.start()
  const first = await s.r.renewSession()
  const second = await s.r.renewSession()

  assert.equal(first, "revoked")
  assert.equal(second, "revoked")
  assert.deepEqual(s.reasons, ["revoked"])
  assert.equal(s.calls.filter((c) => c === "GET /auth/me").length, 0)
  assert.equal(s.r.isActive(), false)
})

test("fetch interceptor: a session_revoked API answer ends the session without renewing", async () => {
  const s = lostReasons()
  s.r.start()
  await s.r.renewSession()
  let calls = 0
  const base = (async () => {
    calls++
    return json(401, { error: "session_revoked" })
  }) as unknown as typeof fetch
  const res = await s.r.wrapFetch(base)("/api/entities")

  assert.equal(res.status, 401)
  assert.equal(calls, 1)
  assert.deepEqual(s.reasons, ["revoked"])
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)  // only the start's
})

test("fetch interceptor: session_upgrade_required renews once even right after a renewal, then replays", async () => {
  const s = lostReasons()
  s.r.start()
  await s.r.renewSession()  // a fresh stamp that would normally skip the network
  let calls = 0
  const base = (async () => {
    calls++
    return calls === 1 ? json(401, { error: "session_upgrade_required" }) : json(200, { ok: true })
  }) as unknown as typeof fetch
  const res = await s.r.wrapFetch(base)("/api/entities")

  assert.equal(res.status, 200)
  assert.equal(calls, 2)
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 2)
  assert.deepEqual(s.reasons, [])
  s.r.stop()
})

test("reportRevoked (a 4401 close) ends the session once with reason revoked", () => {
  const s = lostReasons()
  s.r.start()
  s.r.reportRevoked()
  s.r.reportRevoked()
  assert.deepEqual(s.reasons, ["revoked"])
  assert.equal(s.r.isActive(), false)
})

test("an expired session still ends with reason expired", async () => {
  const s = lostReasons({}, (url) => json(401, url === "/auth/me" ? { error: "unauthorized" } : { error: "invalid_token" }))
  s.r.start()
  assert.equal(await s.r.renewSession(), "gone")
  assert.deepEqual(s.reasons, ["expired"])
})

test("fetch interceptor: a server that keeps answering session_upgrade_required gets at most one rotation", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())  // a failed assertion must not leave a renewal timer running
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))  // start() has nothing to renew
  s.r.start()
  let calls = 0
  const base = (async () => {
    calls++
    return json(401, { error: "session_upgrade_required" })
  }) as unknown as typeof fetch
  const wrapped = s.r.wrapFetch(base)

  const statuses: number[] = []
  for (let i = 0; i < 5; i++) statuses.push((await wrapped("/api/entities")).status)

  assert.deepEqual(statuses, [401, 401, 401, 401, 401])
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)
  assert.equal(calls, 6)  // the first request and its one replay, then four requests answered as they came
  assert.notEqual(s.deps.storage!.getItem("redsuite:session:renewedAt"), null)  // never cleared again
  assert.deepEqual(s.reasons, [])
})

test("fetch interceptor: upgrade on loopback with no refresh cookie accepts LocalDefault, never /login", async (t) => {
  const s = lostReasons({}, (url) =>
    url === "/auth/refresh" ? json(401, { error: "no_token" }) : json(200, { id: "local-user" }))
  t.after(() => s.r.stop())  // a failed assertion must not leave a renewal timer running
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()
  let calls = 0
  const base = (async () => {
    calls++
    return calls === 1 ? json(401, { error: "session_upgrade_required" }) : json(200, { ok: true })
  }) as unknown as typeof fetch

  const res = await s.r.wrapFetch(base)("/api/entities")

  assert.equal(res.status, 200)  // replayed as LocalDefault: the server deleted the old badge
  assert.equal(calls, 2)
  assert.deepEqual(s.reasons, [])  // so the browser singleton never navigates to /login
  assert.equal(s.r.isActive(), false)  // nothing left to renew
  assert.equal(s.deps.storage!.getItem("redsuite:session:renewedAt"), null)
})

test("only an upgrade accepts LocalDefault: an ordinary renewal that finds it still ends the session", async (t) => {
  const s = lostReasons({}, (url) =>
    url === "/auth/refresh" ? json(401, { error: "invalid_token" }) : json(200, { id: "local-user" }))
  t.after(() => s.r.stop())  // a failed assertion must not leave a renewal timer running
  s.r.start()
  assert.equal(await s.r.renewSession(), "gone")
  assert.deepEqual(s.reasons, ["expired"])
})

test("fetch interceptor: session_revoked counts only from this origin, outside /auth", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())  // a failed assertion must not leave a renewal timer running
  s.r.start()
  await s.r.renewSession()
  const base = (async () => json(401, { error: "session_revoked" })) as unknown as typeof fetch
  const wrapped = s.r.wrapFetch(base)

  assert.equal((await wrapped("https://elsewhere.example/api/x")).status, 401)
  assert.equal((await wrapped("/auth/me")).status, 401)
  assert.deepEqual(s.reasons, [])
  assert.equal(s.r.isActive(), true)

  await wrapped("/api/entities")
  assert.deepEqual(s.reasons, ["revoked"])
})

// ---- ND-F4: the upgrade path ----------------------------------------------------------

test("ND-F4: an upgrade renewal that failed transiently is not spent; the next answer upgrades", async (t) => {
  let refreshes = 0
  const s = lostReasons({}, (url) => {
    if (url !== "/auth/refresh") return json(200, { id: "u1" })
    refreshes++
    // The first upgrade meets an unreachable server (every retry); the next one succeeds.
    return refreshes <= 4 ? json(503) : json(200, { expiresIn: 3600 })
  })
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()
  let calls = 0
  const base = (async () => {
    calls++
    return calls <= 2 ? json(401, { error: "session_upgrade_required" }) : json(200, { ok: true })
  }) as unknown as typeof fetch
  const wrapped = s.r.wrapFetch(base)

  const first = await wrapped("/api/entities")
  assert.equal(first.status, 503)  // session_renewal_unavailable: retryable
  const second = await wrapped("/api/entities")
  assert.equal(second.status, 200)  // upgraded on the second answer, then replayed
  assert.ok(refreshes >= 5)
  assert.deepEqual(s.reasons, [])

  // Spent now: a third upgrade answer rotates nothing.
  const before = refreshes
  calls = 0
  const third = await s.r.wrapFetch((async () => json(401, { error: "session_upgrade_required" })) as unknown as typeof fetch)("/api/entities")
  assert.equal(third.status, 401)
  assert.equal(refreshes, before)
})

test("ND-F4: renewForUpgrade is once per session across callers and shares an upgrade in flight", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()

  const [a, b] = await Promise.all([s.r.renewForUpgrade(), s.r.renewForUpgrade()])
  assert.deepEqual([a, b], ["renewed", "renewed"])
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)
  const stamp = s.deps.storage!.getItem("redsuite:session:renewedAt")

  // The bootstrap spent it; the fetch wrapper then gets no second rotation and clears no stamp.
  assert.equal(await s.r.renewForUpgrade(), "spent")
  const res = await s.r.wrapFetch((async () => json(401, { error: "session_upgrade_required" })) as unknown as typeof fetch)("/api/entities")
  assert.equal(res.status, 401)
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)
  assert.equal(s.deps.storage!.getItem("redsuite:session:renewedAt"), stamp)
})

test("ND-F4: start() after the bootstrap's upgrade does not re-arm it; only a lost session does", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  assert.equal(await s.r.renewForUpgrade(), "renewed")  // bootstrap, before start()
  s.r.start()
  assert.equal(await s.r.renewForUpgrade(), "spent")
  s.r.stop()
  s.r.start()
  assert.equal(await s.r.renewForUpgrade(), "spent")

  s.r.reportRevoked()  // lost; signing in again without a reload starts a new session
  s.r.start()
  assert.equal(await s.r.renewForUpgrade(), "renewed")
})

test("ND-F4: session_revoked from an extension route is confirmed by a renewal, never taken on its word", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()
  for (const route of ["/api/apps/notes/items", "/api/extensions/x/data", "/api/public/x/hook", "/compute/api/jobs"]) {
    let calls = 0
    const base = (async () => {
      calls++
      return calls === 1 ? json(401, { error: "session_revoked" }) : json(200, { ok: true })
    }) as unknown as typeof fetch
    const res = await s.r.wrapFetch(base)(route)
    assert.equal(res.status, 200, route)  // the refresh succeeded: the session is alive, the request replayed
    assert.equal(calls, 2, route)
  }
  assert.deepEqual(s.reasons, [])
  assert.equal(s.r.isActive(), true)
})

test("ND-F4: an extension's session_revoked that the refresh confirms ends the session once", async (t) => {
  const s = lostReasons({}, (url) =>
    url === "/auth/refresh" ? json(401, { error: "session_revoked", reason: "signed-out" }) : json(200, { id: "u1" }))
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()
  s.advance(60_000)  // past the skip window: the confirmation asks the server
  let calls = 0
  const base = (async () => {
    calls++
    return json(401, { error: "session_revoked" })
  }) as unknown as typeof fetch
  const res = await s.r.wrapFetch(base)("/api/apps/notes/items")
  assert.equal(res.status, 401)
  assert.equal(calls, 1)  // not replayed
  assert.deepEqual(s.reasons, ["revoked"])
})

test("ND-F4: a non-replayable request's extension session_revoked is still confirmed, not trusted", async (t) => {
  const s = lostReasons()
  t.after(() => s.r.stop())
  s.deps.storage!.setItem("redsuite:session:renewedAt", String(s.deps.now()))
  s.r.start()
  s.advance(60_000)  // past the skip window: the confirmation asks the server
  const base = (async () => json(401, { error: "session_revoked" })) as unknown as typeof fetch
  const body = new ReadableStream({ start(c) { c.close() } })
  const res = await s.r.wrapFetch(base)("/api/apps/notes/upload", { method: "POST", body, duplex: "half" } as RequestInit)
  assert.equal(res.status, 401)
  assert.equal(s.calls.filter((c) => c === "POST /auth/refresh").length, 1)
  assert.deepEqual(s.reasons, [])
  assert.equal(s.r.isActive(), true)
})

test("ND-F4: isKernelRoute trusts /auth and the kernel API, not extension namespaces or other origins", () => {
  for (const ok of ["/auth/me", "/api/entities", "/api/entity-types/x/fields", "/api/extensions"])
    assert.equal(isKernelRoute(ok), true, ok)
  for (const no of ["/api/apps/notes", "/api/extensions/x/settings", "/api/public/x", "/compute/api/jobs",
    "/assets/x.js", "https://elsewhere.example/api/entities", new URL("http://localhost/api/apps/x")])
    assert.equal(isKernelRoute(no), false, String(no))
  assert.equal(isKernelRoute(new URL("http://localhost/api/entities")), true)
})
