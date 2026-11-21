/** The device session of a signed-in browser, as /auth/me reports it. */
export interface AuthDevice {
  sessionId: string
  /** `pending`: signed in, waiting for approval from a device already in use. */
  status: "approved" | "pending" | "ended"
}

export interface AuthUser {
  id: string
  email: string
  name: string | null
  roles: string[]
  avatarUrl?: string
  /** Null or absent for loopback access and for badges from before device sessions. */
  device?: AuthDevice | null
}

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<boolean>
  hasRole: (role: string) => boolean
}
