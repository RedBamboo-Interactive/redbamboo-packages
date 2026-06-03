import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import type { AuthUser, AuthContextValue } from "./auth-types"

const AuthContext = createContext<AuthContextValue | null>(null)

const REFRESH_INTERVAL = 780_000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setUser(data)
        return true
      }
      setUser(null)
      return false
    } catch {
      setUser(null)
      return false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/auth/refresh", { method: "POST", credentials: "include" })
      if (res.ok) {
        return await fetchUser()
      }
      setUser(null)
      return false
    } catch {
      setUser(null)
      return false
    }
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
    fetchUser().then((ok) => {
      if (cancelled) return
      setIsLoading(false)
      if (ok) {
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
