import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { api } from '../services/api'
import type { AdminUser, AuthResult } from '../types'

interface AuthContextValue {
  token: string | null
  user: AdminUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (payload: { username: string; displayName: string; password: string }) => Promise<AuthResult>
  refreshUser: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('quiz-admin-token'))
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }

    api
      .me(token)
      .then((admin) => setUser(admin))
      .catch(() => {
        localStorage.removeItem('quiz-admin-token')
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, [token])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      login: async (username, password) => {
        const result = await api.login(username, password)
        localStorage.setItem('quiz-admin-token', result.token)
        setToken(result.token)
        setUser(result.user)
      },
      register: async (payload) => {
        const result = await api.register(payload)
        if (result.token) {
          localStorage.setItem('quiz-admin-token', result.token)
          setToken(result.token)
          setUser(result.user)
        }
        return result
      },
      refreshUser: async () => {
        if (!token) return
        const nextUser = await api.me(token)
        setUser(nextUser)
      },
      logout: () => {
        localStorage.removeItem('quiz-admin-token')
        setToken(null)
        setUser(null)
      },
    }),
    [loading, token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
