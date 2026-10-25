import { createContext, useContext, useState, useEffect, useCallback } from "react"
import {
  clearSessionRenewalStamp,
  hasSessionRenewalStamp,
  renewSession,
  startSessionRenewal,
  stopSessionRenewal,
} from "./session-renewal"
import type { AuthUser, AuthContextValue } from "./auth-types"
import { bootstrapAuthUser } from "./auth-bootstrap"

const AuthContext = createContext<AuthContextValue | null>(null)

// The server's auth middleware grants loopback requests this identity per-request,
// without issuing any cookies. There is no refresh token to rotate, so refreshing
// would 401 on every cycle.
const LOCAL_IDENTITY_ID = "local-user"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const current = await bootstrapAuthUser({
        fetch,
        hasRenewalStamp: hasSessionRenewalStamp,
        clearRenewalStamp: clearSessionRenewalStamp,
        renewSession,
      })
      setUser(current)
      return current
    } catch {
      setUser(null)
      return null
    }
  }, [])

  const refresh = useCallback(async () => {
    // Transient failures keep the session; only a confirmed-gone session ends it.
    await renewSession()
    return (await fetchUser()) !== null
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
    fetchUser().then((current) => {
      if (cancelled) return
      setIsLoading(false)
      // Renewal is shared per browser (locks + stamp), so every tab can start it cheaply.
      if (current && current.id !== LOCAL_IDENTITY_ID) startSessionRenewal()
    })
    return () => {
      cancelled = true
      stopSessionRenewal()
    }
  }, [fetchUser])

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
