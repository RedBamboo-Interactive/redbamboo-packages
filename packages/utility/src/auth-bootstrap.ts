import type { AuthUser } from "./auth-types"
import type { RenewalResult, RenewOptions } from "./session-renewal"

// Mirrors session-renewal's constants; kept literal so this module needs no runtime import.
const SESSION_REVOKED_ERROR = "session_revoked"
const SESSION_UPGRADE_REQUIRED_ERROR = "session_upgrade_required"

const LOCAL_IDENTITY_ID = "local-user"

/**
 * The server could not say who this browser is: /auth/me (or the renewal it needed) answered 5xx, failed on the
 * network, or the renewal was transient (a restart, `device_sessions_unavailable` while signed-in devices load).
 * Not a sign-out: the shell keeps its splash and asks again ({@link bootstrapAuthUserWithRetry}).
 */
export class AuthUnavailableError extends Error {
  readonly status: number | null
  readonly code: string | null
  constructor(status: number | null, code: string | null) {
    super(`auth unavailable (${status ?? "network"}${code ? `, ${code}` : ""})`)
    this.name = "AuthUnavailableError"
    this.status = status
    this.code = code
  }
}

export interface AuthBootstrapDependencies {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  hasRenewalStamp: () => boolean
  clearRenewalStamp: () => void
  renewSession: (options?: RenewOptions) => Promise<RenewalResult>
  /**
   * The once-per-session upgrade renewal shared with the fetch wrapper (`renewSessionForUpgrade`). Without it,
   * an upgrade clears the stamp and renews on every call.
   */
  renewForUpgrade?: () => Promise<RenewalResult | "spent">
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
  // Called unbound: window.fetch throws "Illegal invocation" when called as a method of another object.
  const rawFetch = dependencies.fetch
  const fetch = async (input: string, init?: RequestInit) => {
    let res: Response
    try {
      res = await rawFetch(input, init)
    } catch {
      throw new AuthUnavailableError(null, null)
    }
    if (res.status >= 500) throw new AuthUnavailableError(res.status, await errorCode(res))
    return res
  }
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
  const upgrade = code === SESSION_UPGRADE_REQUIRED_ERROR
  const needsRecovery = upgrade || (hadUserSession
    && (response.status === 401 || user?.id === LOCAL_IDENTITY_ID))

  if (needsRecovery) {
    let result: RenewalResult | "spent"
    if (upgrade && dependencies.renewForUpgrade) {
      // Once per session, shared with the fetch wrapper: a server that keeps answering
      // session_upgrade_required gets one rotation, however often the identity is read.
      result = await dependencies.renewForUpgrade()
    } else {
      // A recent stamp can otherwise make renewal incorrectly skip the network
      // call even though /auth/me has already proved the access badge unusable.
      dependencies.clearRenewalStamp()
      // The server deleted the old badge; on loopback without a refresh cookie the
      // browser is LocalDefault now, as before sessions (design 5.3), not signed out.
      result = await dependencies.renewSession(upgrade ? { acceptLocal: true } : undefined)
    }
    // Unreachable for now, not signed out: the caller keeps waiting and asks again.
    if (result === "transient") throw new AuthUnavailableError(null, "session_renewal_unavailable")
    if (result !== "renewed" && result !== "local") return null
    response = await fetch("/auth/me", {
      credentials: "include",
      cache: "no-store",
    })
    user = response.ok ? (await response.json()) as AuthUser : null
    if (user?.id === LOCAL_IDENTITY_ID && result !== "local") return null
  }

  return user
}

/**
 * {@link bootstrapAuthUser}, asked again while the server is unavailable: 1, 2, 4, 8 then every 15 s, until it
 * answers or {@link isCancelled}. Resolves with the user (or null: signed out) only once the server has said so.
 */
export async function bootstrapAuthUserWithRetry(
  load: () => Promise<AuthUser | null>,
  options: { sleep?: (ms: number) => Promise<void>; isCancelled?: () => boolean } = {},
): Promise<AuthUser | null | undefined> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    if (options.isCancelled?.()) return undefined
    try {
      return await load()
    } catch (error) {
      if (!(error instanceof AuthUnavailableError)) throw error
    }
    await sleep(Math.min(15_000, 1_000 * 2 ** attempt))
  }
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    if (!(res.headers.get("Content-Type") ?? "").includes("json")) return null
    const body = (await res.clone().json()) as { error?: unknown } | null
    return typeof body?.error === "string" ? body.error : null
  } catch {
    return null
  }
}
