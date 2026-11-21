import type { AuthUser } from "./auth-types"
import type { RenewalResult } from "./session-renewal"

// Mirrors session-renewal's constants; kept literal so this module needs no runtime import.
const SESSION_REVOKED_ERROR = "session_revoked"
const SESSION_UPGRADE_REQUIRED_ERROR = "session_upgrade_required"

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
  // Called unbound, never as dependencies.fetch(...): the browser's fetch throws
  // "Illegal invocation" when `this` is anything but the window (or undefined).
  const { fetch } = dependencies
  const hadUserSession = dependencies.hasRenewalStamp()
  let response = await fetch("/auth/me", {
    credentials: "include",
    cache: "no-store",
  })
  let user = response.ok ? (await response.json()) as AuthUser : null
  const code = response.status === 401 ? await errorCode(response) : null
  // Ended on the server: renewing would only be refused.
  if (code === SESSION_REVOKED_ERROR) return null
  // A badge from before device sessions is replaced by one renewal, stamp or not.
  const needsRecovery = code === SESSION_UPGRADE_REQUIRED_ERROR || (hadUserSession
    && (response.status === 401 || user?.id === LOCAL_IDENTITY_ID))

  if (needsRecovery) {
    // A recent stamp can otherwise make renewal incorrectly skip the network
    // call even though /auth/me has already proved the access badge unusable.
    dependencies.clearRenewalStamp()
    if ((await dependencies.renewSession()) !== "renewed") return null
    response = await fetch("/auth/me", {
      credentials: "include",
      cache: "no-store",
    })
    user = response.ok ? (await response.json()) as AuthUser : null
    if (user?.id === LOCAL_IDENTITY_ID) return null
  }

  return user
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    if (!(res.headers.get("Content-Type") ?? "").includes("json")) return null
    const body = (await res.json()) as { error?: unknown } | null
    return typeof body?.error === "string" ? body.error : null
  } catch {
    return null
  }
}
