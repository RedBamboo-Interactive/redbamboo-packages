import assert from "node:assert/strict"
import test from "node:test"
import { normalizeWorkflowGraph } from "./graph.ts"

test("normalizes encoded workflow graphs and preserves port handles", () => {
  const graph = normalizeWorkflowGraph(JSON.stringify({
    nodes: [{ id: "start", type: "trigger", position: { x: 10, y: 20 }, data: { label: "Start", config: { enabled: true } } }],
    edges: [{ source: "start", target: "work", sourceHandle: "on-trigger", targetHandle: "__event" }],
  }))
  assert.equal(graph.nodes[0]?.data.label, "Start")
  assert.equal(graph.edges[0]?.sourceHandle, "on-trigger")
  assert.equal(graph.edges[0]?.targetHandle, "__event")
})

test("drops malformed graph members", () => {
  const graph = normalizeWorkflowGraph({ nodes: [null, { position: {} }], edges: [{ source: "a" }] })
  assert.deepEqual(graph, { nodes: [], edges: [] })
})
