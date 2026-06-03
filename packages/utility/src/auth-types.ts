export interface AuthUser {
  id: string
  email: string
  name: string | null
  roles: string[]
  avatarUrl?: string
}

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<boolean>
  hasRole: (role: string) => boolean
}
