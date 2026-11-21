import assert from "node:assert/strict"
import test from "node:test"
import { bootstrapAuthUser, type AuthBootstrapDependencies } from "./auth-bootstrap.ts"

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const local = { id: "local-user", email: "local@localhost", name: "Local User", roles: ["admin"] }
const owner = { id: "user-1", email: "owner@example.test", name: "Owner", roles: ["admin"] }

function dependencies(
  responses: Response[],
  renewal: "renewed" | "gone" | "transient" | "local",
  stamped = true,
) {
  const calls: string[] = []
  const requests: RequestInit[] = []
  let cleared = 0
  const deps: AuthBootstrapDependencies = {
    fetch: async (url, init) => {
      calls.push(url)
      requests.push(init ?? {})
      return responses.shift() ?? json(500)
    },
    hasRenewalStamp: () => stamped,
    clearRenewalStamp: () => void cleared++,
    renewSession: async () => renewal,
  }
  return { deps, calls, requests, cleared: () => cleared }
}

test("LocalDefault fallback restores the prior durable user session", async () => {
  const fixture = dependencies([json(200, local), json(200, owner)], "renewed")

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, owner)
  assert.deepEqual(fixture.calls, ["/auth/me", "/auth/me"])
  assert.deepEqual(fixture.requests.map((request) => request.cache), ["no-store", "no-store"])
  assert.equal(fixture.cleared(), 1)
})

test("LocalDefault remains available when this browser had no user session", async () => {
  const fixture = dependencies([json(200, local)], "gone", false)

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, local)
  assert.deepEqual(fixture.calls, ["/auth/me"])
  assert.equal(fixture.requests[0]?.cache, "no-store")
  assert.equal(fixture.cleared(), 0)
})

test("failed recovery never silently downgrades a prior user to LocalDefault", async () => {
  const fixture = dependencies([json(200, local)], "gone")

  const user = await bootstrapAuthUser(fixture.deps)

  assert.equal(user, null)
  assert.equal(fixture.cleared(), 1)
})

test("fetch is called unbound, as the browser's window.fetch requires", async () => {
  // window.fetch throws "Illegal invocation" when called as a method of another object.
  const fixture = dependencies([json(200, owner)], "gone", false)
  const unbound = fixture.deps.fetch
  fixture.deps.fetch = function (this: unknown, url: string, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation")
    return unbound(url, init)
  }

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, owner)
})

test("an invalid access badge also forces refresh despite a recent stamp", async () => {
  const fixture = dependencies([json(401), json(200, owner)], "renewed")

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, owner)
  assert.equal(fixture.cleared(), 1)
})

test("a badge from before device sessions is renewed once even without a renewal stamp", async () => {
  const fixture = dependencies([json(401, { error: "session_upgrade_required" }), json(200, owner)], "renewed", false)

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, owner)
  assert.deepEqual(fixture.calls, ["/auth/me", "/auth/me"])
  assert.equal(fixture.cleared(), 1)
})

test("a revoked session is not renewed at bootstrap", async () => {
  let renewed = 0
  const fixture = dependencies([json(401, { error: "session_revoked" })], "renewed")
  fixture.deps.renewSession = async () => {
    renewed++
    return "renewed"
  }

  const user = await bootstrapAuthUser(fixture.deps)

  assert.equal(user, null)
  assert.equal(renewed, 0)
  assert.deepEqual(fixture.calls, ["/auth/me"])
})

test("/auth/me's device session is passed through", async () => {
  const pending = { ...owner, device: { sessionId: "dev_01JZ0000000000000000000000", status: "pending" } }
  const fixture = dependencies([json(200, pending)], "renewed", false)

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user?.device, { sessionId: "dev_01JZ0000000000000000000000", status: "pending" })
})

test("an upgrade on loopback with no refresh cookie lands on LocalDefault instead of signing out", async () => {
  const fixture = dependencies([json(401, { error: "session_upgrade_required" }), json(200, local)], "local", false)
  const asked: unknown[] = []
  const renew = fixture.deps.renewSession
  fixture.deps.renewSession = (options) => {
    asked.push(options)
    return renew(options)
  }

  const user = await bootstrapAuthUser(fixture.deps)

  assert.deepEqual(user, local)
  assert.deepEqual(asked, [{ acceptLocal: true }])
  assert.deepEqual(fixture.calls, ["/auth/me", "/auth/me"])
})

test("a stamped session that lands on LocalDefault without an upgrade is still not downgraded", async () => {
  const fixture = dependencies([json(200, local)], "gone")
  const asked: unknown[] = []
  const renew = fixture.deps.renewSession
  fixture.deps.renewSession = (options) => {
    asked.push(options)
    return renew(options)
  }

  assert.equal(await bootstrapAuthUser(fixture.deps), null)
  assert.deepEqual(asked, [undefined])
})

test("ND-F4: an upgrade goes through the shared once-per-session renewal and clears nothing itself", async () => {
  const fixture = dependencies([json(401, { error: "session_upgrade_required" }), json(200, owner)], "renewed", false)
  let upgrades = 0
  let plain = 0
  fixture.deps.renewSession = async () => (plain++, "renewed")
  fixture.deps.renewForUpgrade = async () => (upgrades++, "renewed")

  assert.deepEqual(await bootstrapAuthUser(fixture.deps), owner)
  assert.equal(upgrades, 1)
  assert.equal(plain, 0)
  assert.equal(fixture.cleared(), 0)
})

test("ND-F4: once the upgrade is spent, the bootstrap signs out instead of rotating again", async () => {
  const fixture = dependencies([json(401, { error: "session_upgrade_required" }), json(200, owner)], "renewed", true)
  let plain = 0
  fixture.deps.renewSession = async () => (plain++, "renewed")
  fixture.deps.renewForUpgrade = async () => "spent"

  assert.equal(await bootstrapAuthUser(fixture.deps), null)
  assert.equal(plain, 0)
  assert.equal(fixture.cleared(), 0)
  assert.deepEqual(fixture.calls, ["/auth/me"])
})
