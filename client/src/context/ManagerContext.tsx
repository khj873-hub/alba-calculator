import { createContext, useContext, useState } from 'react'
import { verifyPin, storeToken, clearToken, getStoredToken } from '../api'

interface ManagerCtx {
  isAuth: (slug: string) => boolean
  login: (slug: string, pin: string) => Promise<boolean>
  logout: (slug: string) => void
}

const Ctx = createContext<ManagerCtx>({
  isAuth: () => false,
  login: async () => false,
  logout: () => {},
})

export function ManagerProvider({ children }: { children: React.ReactNode }) {
  // 새로고침 후에도 유지: sessionStorage에서 초기값 복원
  const [authSlugs, setAuthSlugs] = useState<Set<string>>(() => {
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('token_'))
    return new Set(keys.map(k => k.replace('token_', '')))
  })

  const isAuth = (slug: string) => authSlugs.has(slug) && !!getStoredToken(slug)

  const login = async (slug: string, pin: string) => {
    try {
      const { token } = await verifyPin(slug, pin)
      storeToken(slug, token)
      setAuthSlugs(prev => new Set([...prev, slug]))
      return true
    } catch {
      return false
    }
  }

  const logout = (slug: string) => {
    clearToken(slug)
    setAuthSlugs(prev => { const next = new Set(prev); next.delete(slug); return next })
  }

  return <Ctx.Provider value={{ isAuth, login, logout }}>{children}</Ctx.Provider>
}

export const useManager = () => useContext(Ctx)
