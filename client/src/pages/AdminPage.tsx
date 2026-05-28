import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const ADMIN_TOKEN_KEY = 'admin_token'

type Plan = 'free' | 'paid'

interface AdminBiz {
  id: number
  slug: string
  name: string
  created_at: string
  time_off_enabled: number
  is_active: number
  suspended_at: string | null
  plan: Plan
  plan_expires_at: string | null
  owner_user_id: number | null
  owner_email: string | null
  owner_name: string | null
  owner_last_login: string | null
  employee_count: number
}

// YYYY-MM-DD KST 오늘
function todayYmd() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
// 기한까지 며칠 (음수면 만료)
function daysUntil(ymd: string | null): number | null {
  if (!ymd) return null
  const t = new Date(ymd + 'T00:00:00+09:00').getTime()
  const now = new Date(todayYmd() + 'T00:00:00+09:00').getTime()
  return Math.floor((t - now) / (1000 * 60 * 60 * 24))
}

function fmtDateTime(s: string | null) {
  if (!s) return '-'
  // 서버는 datetime('now','localtime')로 'YYYY-MM-DD HH:MM:SS' KST 저장. 분 단위까지 표시
  return s.length >= 16 ? s.slice(0, 16) : s
}

function getToken() { return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '' }
function setStoredToken(t: string) { sessionStorage.setItem(ADMIN_TOKEN_KEY, t) }
function clearStoredToken() { sessionStorage.removeItem(ADMIN_TOKEN_KEY) }

async function adminApi<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'x-session-token': getToken() }
  if (init?.body != null) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${url}`, { ...init, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '오류' }))
    if (res.status === 401) {
      clearStoredToken()
      throw new Error('운영자 인증 만료 — 다시 로그인해주세요')
    }
    throw new Error(err.error || '오류')
  }
  return res.json()
}

export default function AdminPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // OAuth 콜백: #token=xxx 흡수
  useEffect(() => {
    if (window.location.hash.startsWith('#token=')) {
      const t = window.location.hash.slice('#token='.length).split('&')[0]
      if (t) {
        setStoredToken(t)
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
  }, [])

  const [authed, setAuthed] = useState(!!getToken())
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(false)
  const [bizList, setBizList] = useState<AdminBiz[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 폼 상태
  const [showForm, setShowForm] = useState(false)
  const [fName, setFName] = useState('')
  const [fPin, setFPin] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [creating, setCreating] = useState(false)

  // owner 변경
  const [editOwnerSlug, setEditOwnerSlug] = useState<string | null>(null)
  const [editOwnerEmail, setEditOwnerEmail] = useState('')

  useEffect(() => {
    fetch('/api/auth/google/status').then(r => r.json()).then(d => {
      setOauthEnabled(!!d.enabled)
      setAdminConfigured(!!d.admin_configured)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!getToken()) return
    setLoading(true); setError('')
    try {
      const data = await adminApi<AdminBiz[]>('/admin/businesses')
      setBizList(data); setAuthed(true)
    } catch (e: any) {
      setError(e.message); setAuthed(false)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (authed) load() }, [authed, load])

  const handleCreate = async () => {
    if (!fName.trim() || !fPin) { setError('사업장명·PIN 필수'); return }
    if (fEmail.trim() && !fEmail.includes('@')) { setError('이메일 형식이 올바르지 않아요 (비우거나 정확히 입력)'); return }
    setCreating(true); setError('')
    try {
      const res: any = await adminApi('/admin/businesses/provision', {
        method: 'POST',
        body: JSON.stringify({
          name: fName.trim(),
          manager_pin: fPin,
          owner_email: fEmail.trim() || null,
        }),
      })
      const ownerLine = res.owner_email ? `Owner: ${res.owner_email}` : 'Owner: 미연결 (PIN 전용)'
      alert(`✅ 사업장 생성 완료\nURL: ${window.location.origin}/${res.slug}\nPIN: ${fPin}\n${ownerLine}`)
      setFName(''); setFPin(''); setFEmail(''); setShowForm(false)
      await load()
    } catch (e: any) { setError(e.message); alert(`생성 실패: ${e.message}`) }
    finally { setCreating(false) }
  }

  const handleOwnerSave = async (slug: string) => {
    try {
      await adminApi(`/admin/businesses/${slug}/owner`, {
        method: 'PATCH',
        body: JSON.stringify({ owner_email: editOwnerEmail.trim() || null }),
      })
      setEditOwnerSlug(null); setEditOwnerEmail('')
      await load()
    } catch (e: any) { alert(`변경 실패: ${e.message}`) }
  }

  const handleOwnerClear = async (slug: string) => {
    if (!confirm('이 사업장의 owner를 해제하시겠어요? 사장님이 구글로 로그인할 수 없게 됩니다.')) return
    try {
      await adminApi(`/admin/businesses/${slug}/owner`, { method: 'PATCH', body: JSON.stringify({ owner_email: null }) })
      await load()
    } catch (e: any) { alert(`해제 실패: ${e.message}`) }
  }

  const handleChangePlan = async (b: AdminBiz, plan: Plan) => {
    if (plan === b.plan) return
    try {
      await adminApi(`/admin/businesses/${b.slug}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan }),
      })
      await load()
    } catch (e: any) { alert(`요금제 변경 실패: ${e.message}`) }
  }

  const handleChangeExpiresAt = async (b: AdminBiz, ymd: string) => {
    const v = ymd || null
    if (v === b.plan_expires_at) return
    try {
      await adminApi(`/admin/businesses/${b.slug}/plan-expires-at`, {
        method: 'PATCH',
        body: JSON.stringify({ plan_expires_at: v }),
      })
      await load()
    } catch (e: any) { alert(`기한 변경 실패: ${e.message}`) }
  }

  const handleToggleActive = async (b: AdminBiz) => {
    const next = b.is_active === 1 ? 0 : 1
    const action = next === 0 ? '정지' : '활성화'
    const msg = next === 0
      ? `'${b.name}' 사업장을 정지하시겠어요?\n사장님·직원이 모두 접근 불가합니다. 결제 정산 후 다시 활성화하세요.`
      : `'${b.name}' 사업장을 다시 활성화하시겠어요?`
    if (!confirm(msg)) return
    try {
      await adminApi(`/admin/businesses/${b.slug}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: next === 1 }),
      })
      await load()
    } catch (e: any) { alert(`${action} 실패: ${e.message}`) }
  }

  // 비인증 화면
  if (!authed) {
    const errParam = searchParams.get('oauth_error')
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 max-w-lg mx-auto">
        <div className="text-4xl mb-4">🛠</div>
        <h2 className="text-xl font-extrabold text-gray-800 mb-2">운영자 콘솔</h2>
        <p className="text-sm text-gray-500 mb-8">사업장 생성·owner 관리·승인</p>

        {!oauthEnabled && (
          <p className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 mb-4 max-w-xs text-center">
            구글 로그인이 서버에 설정되지 않았습니다. <br/>
            GOOGLE_CLIENT_ID/SECRET 환경변수 확인
          </p>
        )}
        {oauthEnabled && !adminConfigured && (
          <p className="bg-orange-50 text-orange-700 text-sm rounded-xl px-4 py-3 mb-4 max-w-xs text-center">
            ADMIN_EMAILS 환경변수가 비어 있습니다. 운영자 이메일을 먼저 등록하세요.
          </p>
        )}
        {errParam && (
          <p className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4 max-w-xs">{errParam}</p>
        )}

        <button
          onClick={() => { window.location.href = '/api/auth/google/start?admin=1' }}
          disabled={!oauthEnabled}
          className="bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-bold py-3 px-6 rounded-2xl text-sm flex items-center gap-2 transition shadow-sm disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.2 6.2 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.2 6.2 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.3 5.3C41.4 35.1 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          구글로 운영자 로그인
        </button>
        <button onClick={() => navigate('/')} className="mt-6 text-xs text-gray-400 hover:text-gray-600">← 메인으로</button>
      </div>
    )
  }

  // 인증된 어드민 화면
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-extrabold text-gray-800">🛠 운영자 콘솔</h1>
          <p className="text-xs text-gray-400 mt-0.5">사업장 {bizList.length}개</p>
        </div>
        <button onClick={() => { clearStoredToken(); setAuthed(false); navigate('/admin') }}
          className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-100 hover:border-red-200">
          로그아웃
        </button>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

        {!showForm ? (
          <button onClick={() => setShowForm(true)}
            className="mb-4 bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition">
            + 새 사업장 등록
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 flex flex-col gap-3">
            <h3 className="font-bold text-gray-800">신규 사업장</h3>
            <input value={fName} onChange={e => setFName(e.target.value)} placeholder="사업장명 (예: 메가커피 강남점)"
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <input value={fPin} onChange={e => setFPin(e.target.value)} placeholder="관리자 PIN (4자리 이상)" inputMode="numeric"
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <input value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="사장님 구글 이메일 (선택 — 비우면 PIN 전용)" type="email"
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="text-xs text-gray-400 -mt-1 px-1">
              비워두면 PIN으로만 로그인 가능한 사업장으로 생성됩니다. 나중에 우측 표의 <span className="text-blue-500">수정</span>으로 추가할 수 있어요.
            </p>
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={creating}
                className="flex-1 bg-blue-600 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50">
                {creating ? '생성 중...' : '생성 + 자동 매핑'}
              </button>
              <button onClick={() => { setShowForm(false); setError('') }}
                className="flex-1 bg-gray-100 text-gray-600 text-sm font-bold py-2.5 rounded-xl">취소</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-10">불러오는 중...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">상태</th>
                  <th className="text-left px-4 py-3">요금제</th>
                  <th className="text-left px-4 py-3">기한</th>
                  <th className="text-left px-4 py-3">slug</th>
                  <th className="text-left px-4 py-3">사업장명</th>
                  <th className="text-left px-4 py-3">직원</th>
                  <th className="text-left px-4 py-3">Owner</th>
                  <th className="text-left px-4 py-3">최근 로그인</th>
                  <th className="text-left px-4 py-3">생성일</th>
                </tr>
              </thead>
              <tbody>
                {bizList.map(b => (
                  <tr key={b.slug} className={`border-t border-gray-100 ${b.is_active === 0 ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(b)}
                        className={`text-xs font-bold px-2 py-1 rounded-lg border transition ${
                          b.is_active === 1
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                            : 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200'
                        }`}
                        title={b.is_active === 0 && b.suspended_at ? `정지: ${b.suspended_at}` : '클릭해서 상태 변경'}
                      >
                        {b.is_active === 1 ? '🟢 활성' : '🔴 정지'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={b.plan}
                        onChange={e => handleChangePlan(b, e.target.value as Plan)}
                        className={`text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                          b.plan === 'paid'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-gray-50 text-gray-600 border-gray-200'
                        }`}
                        title="요금제 변경"
                      >
                        <option value="free">🆓 무료</option>
                        <option value="paid">💎 유료</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const d = daysUntil(b.plan_expires_at)
                        const status =
                          d === null ? '' :
                          d < 0 ? '🔴 만료' :
                          d <= 7 ? `🟡 D-${d}` :
                          `🟢 D-${d}`
                        const inputCls =
                          b.plan !== 'paid' ? 'border-gray-200 bg-gray-50 text-gray-400' :
                          d === null ? 'border-gray-200 text-gray-600' :
                          d < 0 ? 'border-red-300 bg-red-50 text-red-700' :
                          d <= 7 ? 'border-yellow-300 bg-yellow-50 text-yellow-800' :
                          'border-green-300 bg-green-50 text-green-700'
                        return (
                          <div className="flex flex-col gap-0.5">
                            <input
                              type="date"
                              value={b.plan_expires_at || ''}
                              onChange={e => handleChangeExpiresAt(b, e.target.value)}
                              className={`text-xs px-2 py-1 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-300 ${inputCls}`}
                              title={b.plan === 'paid' ? '유료 결제 만료일 (도달 시 자동 정지)' : '무료 사용자엔 적용 안 됨 (참고용)'}
                            />
                            {b.plan === 'paid' && status && (
                              <span className="text-[10px] font-bold text-gray-500 px-1">{status}</span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{b.slug}</td>
                    <td className="px-4 py-3 font-semibold">{b.name}</td>
                    <td className="px-4 py-3 text-gray-500">{b.employee_count}</td>
                    <td className="px-4 py-3">
                      {editOwnerSlug === b.slug ? (
                        <div className="flex gap-2 items-center">
                          <input value={editOwnerEmail} onChange={e => setEditOwnerEmail(e.target.value)}
                            placeholder="이메일" type="email"
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs" />
                          <button onClick={() => handleOwnerSave(b.slug)}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg">저장</button>
                          <button onClick={() => { setEditOwnerSlug(null); setEditOwnerEmail('') }}
                            className="text-xs text-gray-400">취소</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {b.owner_email ? (
                            <>
                              <span className="text-xs text-gray-700">{b.owner_email}</span>
                              {b.owner_user_id && b.owner_name && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">활성</span>
                              )}
                              {b.owner_user_id && !b.owner_name && (
                                <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">미가입</span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">미연결 (PIN 전용)</span>
                          )}
                          <button onClick={() => { setEditOwnerSlug(b.slug); setEditOwnerEmail(b.owner_email || '') }}
                            className="text-xs text-blue-500 hover:text-blue-700 ml-1">수정</button>
                          {b.owner_email && (
                            <button onClick={() => handleOwnerClear(b.slug)}
                              className="text-xs text-red-400 hover:text-red-600">해제</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fmtDateTime(b.owner_last_login)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDateTime(b.created_at)}</td>
                  </tr>
                ))}
                {bizList.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-gray-400 py-10">사업장이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
