import assert from "node:assert/strict"
import test from "node:test"
import { sessionSearchPath, sessionSearchSource, toSessionSearchResults } from "./session-search-source.ts"

test("the search path carries the query, the limit and archived sessions", () => {
  assert.equal(sessionSearchPath("fix the build"), "/ai-session/sessions/search?q=fix%20the%20build&limit=20&includeArchived=true")
})

test("items become results that open the session at its message", async () => {
  const calls: string[] = []
  const source = sessionSearchSource({
    get: async <T>(path: string) => {
      calls.push(path)
      return { items: [
        { session: { id: "a", title: "Paging", projectName: "chat" }, snippet: "earlier history", messageUid: "u1", archived: false },
        { session: { id: "b", title: null, projectName: "codered" }, snippet: "", messageUid: null, archived: true },
      ] } as T
    },
  })
  assert.deepEqual(await source.search("hi"), [
    { id: "a", title: "Paging", meta: undefined, snippet: "earlier history", messageUid: "u1" },
    { id: "b", title: "codered", meta: "archived", snippet: undefined, messageUid: null },
  ])
  assert.equal(calls.length, 1)
  assert.deepEqual(toSessionSearchResults(undefined), [])
})
