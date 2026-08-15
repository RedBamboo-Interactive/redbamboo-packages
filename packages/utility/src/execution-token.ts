export interface ExecutionAppIdentity {
  id: string
  name: string
  entityId?: string
  icon?: string
  color?: string
}

export interface ExecutionActorIdentity {
  kind: string
  id: string
  name: string
  entityId?: string
  avatar?: string
}

export interface ExecutionBeneficiaryIdentity {
  kind: "user" | "system"
  id?: string
  name?: string
  avatar?: string
  reason?: string
}

export interface ExecutionContextReference {
  kind: string
  id?: string
  entityId?: string
  name?: string
  route?: string
}

export interface ExecutionTrace {
  requestId?: string
  correlationId?: string
  parentJobId?: string
}

export interface ExecutionIdentity {
  schemaVersion: number
  executionId: string
  app: ExecutionAppIdentity
  actor: ExecutionActorIdentity
  beneficiary: ExecutionBeneficiaryIdentity
  context: ExecutionContextReference[]
  parentExecutionId?: string
  trace?: ExecutionTrace
}

export interface ExecutionTokenResponse {
  accessToken: string
  tokenType: "Bearer"
  expiresAt: string
  identity: ExecutionIdentity
}

export interface ExecutionContextResponse {
  authenticated: boolean
  subjectId?: string
  tokenUse: "user" | "execution"
  expiresAt?: string
  identity: ExecutionIdentity | null
}

/**
 * A token client is deliberately bound to one app instead of configuring global fetch state.
 * Multiple Leaf apps can coexist in one browser process without overwriting one another's actor.
 */
export interface ExecutionTokenClient {
  readonly appId: string
  fetch(path: string | URL, init?: RequestInit): Promise<Response>
  inspect(): Promise<ExecutionContextResponse>
  invalidate(): void
}

interface CachedToken extends ExecutionTokenResponse {
  expiresAtMs: number
}

const REFRESH_MARGIN_MS = 30_000

export function createExecutionTokenClient(appId: string): ExecutionTokenClient {
  if (!appId.trim()) throw new Error("Execution token client requires an app id")

  let cached: CachedToken | null = null
  let minting: Promise<CachedToken> | null = null

  const invalidate = () => {
    cached = null
    minting = null
  }

  const mint = async (): Promise<CachedToken> => {
    if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > Date.now()) return cached
    if (minting) return minting

    minting = (async () => {
      const response = await globalThis.fetch("/api/auth/execution-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as
          | { error?: string; message?: string }
          | null
        throw new Error(body?.message ?? body?.error ??
          `Could not mint execution token (${response.status})`)
      }

      const value = await response.json() as ExecutionTokenResponse
      const expiresAtMs = Date.parse(value.expiresAt)
      if (!value.accessToken || !Number.isFinite(expiresAtMs))
        throw new Error("Execution token response is malformed")
      cached = { ...value, expiresAtMs }
      return cached
    })()

    try {
      return await minting
    } finally {
      minting = null
    }
  }

  const authenticatedFetch = async (
    path: string | URL,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> => {
    assertSameOrigin(path)
    const token = await mint()
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token.accessToken}`)
    const response = await globalThis.fetch(path, {
      ...init,
      credentials: init.credentials ?? "include",
      headers,
    })
    if (response.status === 401 && retry) {
      invalidate()
      return authenticatedFetch(path, init, false)
    }
    return response
  }

  return {
    appId,
    fetch: authenticatedFetch,
    async inspect() {
      const response = await authenticatedFetch("/api/auth/execution-context")
      if (!response.ok)
        throw new Error(`Could not inspect execution context (${response.status})`)
      return await response.json() as ExecutionContextResponse
    },
    invalidate,
  }
}

function assertSameOrigin(path: string | URL) {
  if (typeof window === "undefined") {
    if (typeof path === "string" && path.startsWith("/")) return
    throw new Error("Execution tokens can only be attached to relative RedLeaf URLs")
  }

  const url = new URL(path.toString(), window.location.origin)
  if (url.origin !== window.location.origin)
    throw new Error("Refusing to send a RedLeaf execution token to another origin")
}
