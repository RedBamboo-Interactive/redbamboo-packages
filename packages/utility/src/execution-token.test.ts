import assert from "node:assert/strict"
import test from "node:test"
import { createExecutionTokenClient } from "./execution-token.ts"

interface FetchCall {
  url: string
  init?: RequestInit
}

function installBrowser(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch")
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:18804" } },
  })
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchImpl })
  return () => {
    restore("window", previousWindow)
    restore("fetch", previousFetch)
  }
}

function restore(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  else delete (globalThis as Record<string, unknown>)[name]
}

function token(appId: string, value = `${appId}-token`) {
  return Response.json({
    accessToken: value,
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    identity: {
      schemaVersion: 1,
      executionId: "00000000-0000-0000-0000-000000000001",
      app: { id: appId, name: appId },
      actor: { kind: "app", id: appId, name: appId },
      beneficiary: { kind: "user", id: "user-1" },
      context: [{ kind: "browser", route: `/apps/${appId}` }],
    },
  })
}

test("coalesces concurrent minting and attaches the signed token", async () => {
  const calls: FetchCall[] = []
  const restoreBrowser = installBrowser(async (url, init) => {
    calls.push({ url: url.toString(), init })
    if (url === "/api/auth/execution-token") return token("nova")
    return Response.json({ ok: true })
  })
  try {
    const client = createExecutionTokenClient("nova")
    await Promise.all([
      client.fetch("/api/apps/nova/discussions"),
      client.fetch("/api/apps/nova/agents"),
    ])

    assert.equal(calls.filter(call => call.url === "/api/auth/execution-token").length, 1)
    const requests = calls.filter(call => call.url !== "/api/auth/execution-token")
    assert.equal(requests.length, 2)
    for (const request of requests)
      assert.equal(new Headers(request.init?.headers).get("Authorization"), "Bearer nova-token")
  } finally {
    restoreBrowser()
  }
})

test("keeps tokens isolated between apps in the same browser process", async () => {
  const seen = new Map<string, string | null>()
  const restoreBrowser = installBrowser(async (url, init) => {
    if (url === "/api/auth/execution-token") {
      const body = JSON.parse(init?.body as string) as { appId: string }
      return token(body.appId)
    }
    seen.set(url.toString(), new Headers(init?.headers).get("Authorization"))
    return Response.json({ ok: true })
  })
  try {
    const nova = createExecutionTokenClient("nova")
    const codered = createExecutionTokenClient("codered")
    await nova.fetch("/api/apps/nova/discussions")
    await codered.fetch("/api/apps/codered/sessions")

    assert.equal(seen.get("/api/apps/nova/discussions"), "Bearer nova-token")
    assert.equal(seen.get("/api/apps/codered/sessions"), "Bearer codered-token")
  } finally {
    restoreBrowser()
  }
})

test("never sends or even mints an execution token for another origin", async () => {
  let calls = 0
  const restoreBrowser = installBrowser(async () => {
    calls++
    return Response.json({ ok: true })
  })
  try {
    const client = createExecutionTokenClient("nova")
    await assert.rejects(
      client.fetch("https://example.com/collect"),
      /another origin/,
    )
    assert.equal(calls, 0)
  } finally {
    restoreBrowser()
  }
})

test("refreshes once after a rejected token", async () => {
  let mintCount = 0
  const attached: string[] = []
  const restoreBrowser = installBrowser(async (url, init) => {
    if (url === "/api/auth/execution-token") {
      mintCount++
      return token("nova", `token-${mintCount}`)
    }
    attached.push(new Headers(init?.headers).get("Authorization") ?? "")
    return new Response(null, { status: attached.length === 1 ? 401 : 204 })
  })
  try {
    const response = await createExecutionTokenClient("nova").fetch("/api/test")
    assert.equal(response.status, 204)
    assert.equal(mintCount, 2)
    assert.deepEqual(attached, ["Bearer token-1", "Bearer token-2"])
  } finally {
    restoreBrowser()
  }
})
