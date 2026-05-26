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

// OAuth 콜백 처리: URL `#token=xxx&slug=yyy` 형태로 들어오면 sessionStorage에 저장 후 hash 제거.
// Provider 평가 전에 동기적으로 실행되어야 ManagerLayout의 isAuth 첫 평가에 반영됨.
function absorbOAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash.startsWith('#token=')) return null
  const token = hash.slice('#token='.length).split('&')[0]
  // 현재 path: /{slug}/manager 또는 /{slug}/manager/*
  const match = window.location.pathname.match(/^\/([^/]+)\/manager/)
  if (!token || !match) return null
  const slug = match[1]
  storeToken(slug, token)
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return slug
}

export function ManagerProvider({ children }: { children: React.ReactNode }) {
  // 새로고침 후에도 유지: sessionStorage에서 초기값 복원 + OAuth 콜백 토큰 흡수
  const [authSlugs, setAuthSlugs] = useState<Set<string>>(() => {
    const absorbed = absorbOAuthToken()
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('token_'))
    const slugs = new Set(keys.map(k => k.replace('token_', '')))
    if (absorbed) slugs.add(absorbed)
    return slugs
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
