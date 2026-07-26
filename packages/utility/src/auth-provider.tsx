import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import type { AuthUser, AuthContextValue } from "./auth-types"

const AuthContext = createContext<AuthContextValue | null>(null)

const REFRESH_INTERVAL = 780_000

// The server's auth middleware grants loopback requests this identity per-request,
// without issuing any cookies. There is no refresh token to rotate, so refreshing
// would 401 on every cycle.
const LOCAL_IDENTITY_ID = "local-user"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)

  const fetchUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" })
      if (res.ok) {
        const data = (await res.json()) as AuthUser
        setUser(data)
        return data
      }
      setUser(null)
      return null
    } catch {
      setUser(null)
      return null
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      await fetch("/auth/refresh", { method: "POST", credentials: "include" })
    } catch {}
    return (await fetchUser()) !== null
  }, [fetchUser])

  const logout = useCallback(async () => {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" })
    } catch {}
    setUser(null)
    if (intervalRef.current) clearInterval(intervalRef.current)
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
      if (current && current.id !== LOCAL_IDENTITY_ID) {
        intervalRef.current = setInterval(() => {
          refresh()
        }, REFRESH_INTERVAL)
      }
    })
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchUser, refresh])

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
