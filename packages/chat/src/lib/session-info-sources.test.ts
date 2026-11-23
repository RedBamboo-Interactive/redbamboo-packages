import assert from "node:assert/strict"
import test from "node:test"
import { sessionInfoNodeFrom } from "./session-info-sources.ts"

const titine = {
  id: "node_1", name: "TITINE-VI", status: "online", icon: "desktop-tower", color: "blue", agentVersion: "0.2.0",
  platform: { os: "windows", arch: "x64", chassis: "desktop" },
}

test("node: the session's own node is read from /api/nodes", () => {
  const node = sessionInfoNodeFrom({ nodes: [titine] }, "node_1", "T:/Projects/x")
  assert.deepEqual(node, {
    id: "node_1", name: "TITINE-VI", icon: "desktop-tower", color: "blue", os: "windows", chassis: "desktop",
    platformLabel: "Windows · x64 desktop", online: true, agentVersion: "0.2.0", folder: "T:/Projects/x", onlyNode: true,
  })
})

test("node: without a node id the only node is the session's, several nodes name none", () => {
  assert.equal(sessionInfoNodeFrom({ nodes: [titine] }, null)?.name, "TITINE-VI")
  assert.equal(sessionInfoNodeFrom({ nodes: [titine, { ...titine, id: "node_2", name: "B" }] }, null), null)
  assert.equal(sessionInfoNodeFrom({ nodes: [titine, { ...titine, id: "node_2", name: "B" }] }, "node_2")?.onlyNode, false)
})

test("node: revoked nodes do not count, and a node missing a field leaves it out", () => {
  const node = sessionInfoNodeFrom({ nodes: [{ id: "n", name: "Lab", status: "offline" }, { ...titine, revokedAt: "2026-01-01" }] }, "n")
  assert.equal(node?.onlyNode, true)
  assert.equal(node?.online, false)
  assert.equal(node?.platformLabel, null)
  assert.equal(node?.icon, null)
})

test("node: an unknown id or a malformed body names nothing", () => {
  assert.equal(sessionInfoNodeFrom({ nodes: [titine] }, "other"), null)
  assert.equal(sessionInfoNodeFrom(null, "node_1"), null)
  assert.equal(sessionInfoNodeFrom({ nodes: "x" }, null), null)
})

test("node: RedCompute's /compute/nodes shape reads too, without an icon or colour", () => {
  const node = sessionInfoNodeFrom({ nodes: [{
    id: "node_1", name: "TITINE-VI", status: "online", isLocal: true, version: "0.2.0",
    platform: { os: "windows", architecture: "x64", chassis: "desktop" },
  }] }, "node_1")
  assert.equal(node?.agentVersion, "0.2.0")
  assert.equal(node?.platformLabel, "Windows · x64 desktop")
  assert.equal(node?.icon, null)
  assert.equal(node?.color, null)
})
