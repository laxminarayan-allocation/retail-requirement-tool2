import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import axios from 'axios'

export type Role = 'admin' | 'temp_admin' | 'planner' | 'viewer' | 'pending'

export interface User {
  sub: string
  email: string
  name: string
  role: Role
  exp: number
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  signin: (token: string) => void
  signout: () => void
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'ck_ss27_token'

function parseToken(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as User
    return payload.exp * 1000 > Date.now() ? payload : null
  } catch {
    return null
  }
}

function setAxiosToken(token: string | null) {
  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
  else delete axios.defaults.headers.common['Authorization']
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: null, loading: true })

  const applyToken = useCallback((token: string) => {
    const user = parseToken(token)
    if (!user) {
      localStorage.removeItem(TOKEN_KEY)
      setAxiosToken(null)
      setState({ user: null, token: null, loading: false })
      return
    }
    localStorage.setItem(TOKEN_KEY, token)
    setAxiosToken(token)
    setState({ user, token, loading: false })
  }, [])

  // Boot: restore from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) {
      applyToken(stored)
    } else {
      setState({ user: null, token: null, loading: false })
    }
  }, [applyToken])

  // Poll /api/auth/me every 30 s to pick up role changes approved by admin
  const refreshMe = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    try {
      const res = await axios.get<{ success: boolean; data: { user: any; new_token: string | null } }>(
        '/api/auth/me'
      )
      if (res.data.success && res.data.data.new_token) {
        applyToken(res.data.data.new_token)
      }
    } catch {
      // Ignore — 401 interceptor below will sign out if needed
    }
  }, [applyToken])

  useEffect(() => {
    const id = setInterval(refreshMe, 30_000)
    return () => clearInterval(id)
  }, [refreshMe])

  // Intercept 401s globally — clear everything and force login page
  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401) {
          localStorage.removeItem(TOKEN_KEY)
          delete axios.defaults.headers.common['Authorization']
          // Replace history entry so pressing Back doesn't restore the protected page
          window.location.replace('/login')
        }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  const signin = useCallback((token: string) => {
    applyToken(token)
  }, [applyToken])

  const signout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setAxiosToken(null)
    setState({ user: null, token: null, loading: false })
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signin, signout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export const ROLE_LEVEL: Record<Role, number> = {
  pending: 0, viewer: 1, planner: 2, temp_admin: 3, admin: 4,
}

export function hasRole(user: User | null, min: Role): boolean {
  if (!user) return false
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[min]
}
