import type { AuthUser } from "./auth-types"
import type { RenewalResult } from "./session-renewal"

const LOCAL_IDENTITY_ID = "local-user"

export interface AuthBootstrapDependencies {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  hasRenewalStamp: () => boolean
  clearRenewalStamp: () => void
  renewSession: () => Promise<RenewalResult>
}

/**
 * Resolves the browser identity without silently replacing a prior user session
 * with loopback LocalDefault. A signing-key rotation can invalidate the access
 * badge while leaving the opaque refresh cookie valid; LocalDefault makes that
 * state look like a successful /auth/me response unless recovery is attempted.
 */
export async function bootstrapAuthUser(
  dependencies: AuthBootstrapDependencies,
): Promise<AuthUser | null> {
  const hadUserSession = dependencies.hasRenewalStamp()
  let response = await dependencies.fetch("/auth/me", { credentials: "include" })
  let user = response.ok ? (await response.json()) as AuthUser : null
  const needsRecovery = hadUserSession
    && (response.status === 401 || user?.id === LOCAL_IDENTITY_ID)

  if (needsRecovery) {
    // A recent stamp can otherwise make renewal incorrectly skip the network
    // call even though /auth/me has already proved the access badge unusable.
    dependencies.clearRenewalStamp()
    if ((await dependencies.renewSession()) !== "renewed") return null
    response = await dependencies.fetch("/auth/me", { credentials: "include" })
    user = response.ok ? (await response.json()) as AuthUser : null
    if (user?.id === LOCAL_IDENTITY_ID) return null
  }

  return user
}
