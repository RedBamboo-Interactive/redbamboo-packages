import assert from "node:assert/strict"
import test from "node:test"
import { discussionShareSource, sessionShareSource, shareErrorMessage, type ShareHttp } from "./share-sources.ts"

function recordingHttp(responses: Record<string, unknown> = {}) {
  const calls: string[] = []
  const http: ShareHttp = {
    get: async <T>(path: string) => { calls.push(`GET ${path}`); return responses[`GET ${path}`] as T },
    post: async <T>(path: string, body?: unknown) => { calls.push(`POST ${path} ${JSON.stringify(body)}`); return responses[`POST ${path}`] as T },
    delete: async <T>(path: string) => { calls.push(`DELETE ${path}`); return undefined as T },
  }
  return { http, calls }
}

test("a discussion shares through /api/shares by its entity id", async () => {
  const { http, calls } = recordingHttp({
    "POST /api/shares": { shareId: "s1", url: "https://share/s1" },
    "GET /api/shares/info/e%2F1": { active: true, shareId: "s1", url: "https://share/s1" },
  })
  const source = discussionShareSource(http, "e/1")
  assert.deepEqual(await source.create(), { shareId: "s1", url: "https://share/s1" })
  assert.equal((await source.info()).active, true)
  await source.revoke("s1")
  assert.deepEqual(calls, [
    `POST /api/shares {"discussionEntityId":"e/1"}`,
    "GET /api/shares/info/e%2F1",
    "DELETE /api/shares/s1",
  ])
})

test("a session shares through /api/shares/session by its session id", async () => {
  const { http, calls } = recordingHttp({
    "POST /api/shares/session": { shareId: "s2", url: "https://share/s2" },
    "GET /api/shares/session-info/abc": { active: false },
  })
  const source = sessionShareSource(http, "abc")
  assert.equal((await source.create()).url, "https://share/s2")
  assert.deepEqual(await source.info(), { active: false })
  await source.revoke("s2")
  assert.deepEqual(calls, [
    `POST /api/shares/session {"sessionId":"abc"}`,
    "GET /api/shares/session-info/abc",
    "DELETE /api/shares/s2",
  ])
})

test("refusals read plainly; other failures keep the server's words", () => {
  const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code })
  assert.equal(shareErrorMessage(apiError(409, "confidential", "Session is confidential"), "x"), "A confidential conversation can't be shared.")
  assert.equal(shareErrorMessage(apiError(503, "share_unavailable", "not configured"), "x"), "Sharing isn't set up on this installation.")
  assert.equal(shareErrorMessage(apiError(403, "forbidden", "You can't manage this session"), "x"), "You can't manage this session")
  assert.equal(shareErrorMessage("boom", "Failed to create share link"), "Failed to create share link")
})
