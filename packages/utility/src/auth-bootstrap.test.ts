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
  renewal: "renewed" | "gone" | "transient",
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
