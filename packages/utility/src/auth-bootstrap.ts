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
  let response = await dependencies.fetch("/auth/me", {
    credentials: "include",
    cache: "no-store",
  })
  let user = response.ok ? (await response.json()) as AuthUser : null
  const localFallback = user?.id === LOCAL_IDENTITY_ID
  const needsRecovery = response.status === 401 || localFallback

  if (needsRecovery) {
    // LocalDefault deliberately turns a missing/invalid access badge into a successful
    // local-user response on loopback. Probe the refresh cookie even when there is no
    // renewal stamp: a fresh OAuth callback can set HttpOnly cookies, but cannot write
    // localStorage. Without this probe, the valid refresh session is never discovered.
    dependencies.clearRenewalStamp()
    const renewal = await dependencies.renewSession()
    if (renewal === "renewed") {
      response = await dependencies.fetch("/auth/me", {
        credentials: "include",
        cache: "no-store",
      })
      user = response.ok ? (await response.json()) as AuthUser : null
      if (user?.id === LOCAL_IDENTITY_ID) return null
    } else if (response.status === 401 || hadUserSession || renewal === "transient") {
      return null
    }
  }

  return user
}
