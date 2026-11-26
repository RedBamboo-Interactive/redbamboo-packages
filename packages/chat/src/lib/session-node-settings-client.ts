import type { SessionNodeDestination, SessionNodeMoveReceipt, SessionNodeSettings, SessionNodeSettingsClient } from "../types"

type NodeSettingsTransport = {
  get: <T>(path: string) => Promise<T>
  putWithHeaders: <T>(path: string, body: unknown, headers: Record<string, string>) => Promise<T>
}

export function createSessionNodeSettingsClient(transport: NodeSettingsTransport): SessionNodeSettingsClient {
  const path = (id: string) => "/ai-session/sessions/" + encodeURIComponent(id)
  const placementBody = (expectedGeneration: number, choice: SessionNodeDestination) => ({
    expectedGeneration,
    destination: { nodeId: choice.nodeId, sessionRuntime: choice.sessionRuntime ?? null },
  })
  return {
    load: id => transport.get<SessionNodeSettings>(path(id) + "/placement"),
    preview: async (id, generation, choice, key) => {
      await transport.putWithHeaders(path(id) + "/placement",
        { ...placementBody(generation, choice), validateOnly: true }, { "X-Idempotency-Key": key })
    },
    move: async (id, generation, choice, key) =>
      (await transport.putWithHeaders<{ operation: SessionNodeMoveReceipt }>(path(id) + "/placement",
        placementBody(generation, choice), { "X-Idempotency-Key": key })).operation,
    receipt: (id, operation) => transport.get<SessionNodeMoveReceipt>(path(id) + "/input-queue/" + encodeURIComponent(operation)),
  }
}
