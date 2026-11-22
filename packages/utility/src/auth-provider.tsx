import { createContext, useContext, useState, useEffect, useCallback } from "react"
import {
  announceSignedIn,
  clearSessionRenewalStamp,
  hasSessionRenewalStamp,
  renewSession,
  renewSessionForUpgrade,
  startSessionRenewal,
  stopSessionRenewal,
} from "./session-renewal"
import type { AuthUser, AuthContextValue } from "./auth-types"
import { AuthUnavailableError, bootstrapAuthUser, bootstrapAuthUserWithRetry } from "./auth-bootstrap"

const AuthContext = createContext<AuthContextValue | null>(null)

// The server's auth middleware grants loopback requests this identity per-request,
// without issuing any cookies. There is no refresh token to rotate, so refreshing
// would 401 on every cycle.
const LOCAL_IDENTITY_ID = "local-user"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Throws AuthUnavailableError while the server cannot say who this is (5xx, network, transient renewal).
  const loadUser = useCallback(() => bootstrapAuthUser({
    fetch: (input, init) => fetch(input, init),
    hasRenewalStamp: hasSessionRenewalStamp,
    clearRenewalStamp: clearSessionRenewalStamp,
    renewSession,
    renewForUpgrade: renewSessionForUpgrade,
  }), [])

  const fetchUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const current = await loadUser()
      setUser(current)
      return current
    } catch (error) {
      // Unavailable is not signed out: the user shown so far stays.
      if (error instanceof AuthUnavailableError) return null
      setUser(null)
      return null
    }
  }, [loadUser])

  const refresh = useCallback(async () => {
    // Transient failures keep the session; only a confirmed-gone session ends it.
    await renewSession()
    const current = await fetchUser()
    if (current && current.id !== LOCAL_IDENTITY_ID) {
      // Also after a sign-in without a reload: renewal restarts (idempotent when it runs) and
      // whatever stopped at sign-out, like a socket closed with 4401, starts again.
      startSessionRenewal()
      announceSignedIn()
    }
    return current !== null
  }, [fetchUser])

  const logout = useCallback(async () => {
    stopSessionRenewal()
    clearSessionRenewalStamp()
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" })
    } catch {}
    setUser(null)
    window.location.href = "/login"
  }, [])

  const hasRole = useCallback(
    (role: string) => user?.roles?.includes(role) ?? false,
    [user],
  )

  useEffect(() => {
    let cancelled = false
    // The splash stays (isLoading) while the server is unavailable: a 503 from /auth/me while signed-in
    // devices load, or a restart, must never show the sign-in page.
    bootstrapAuthUserWithRetry(loadUser, { isCancelled: () => cancelled }).then((current) => {
      if (cancelled || current === undefined) return
      setUser(current)
      setIsLoading(false)
      // Renewal is shared per browser (locks + stamp), so every tab can start it cheaply.
      if (current && current.id !== LOCAL_IDENTITY_ID) startSessionRenewal()
    }, () => {
      // Anything else (a malformed answer): signed out, as before.
      if (cancelled) return
      setUser(null)
      setIsLoading(false)
    })
    return () => {
      cancelled = true
      stopSessionRenewal()
    }
  }, [loadUser])

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    logout,
    refresh,
    hasRole,
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
