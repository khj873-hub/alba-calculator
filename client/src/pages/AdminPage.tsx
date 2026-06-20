import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const ADMIN_TOKEN_KEY = 'admin_token'

type Plan = 'free' | 'basic' | 'pro' | 'enterprise' | 'paid'
type InquiryStatus = 'new' | 'in_progress' | 'done' | 'spam'
type AdminTab = 'businesses' | 'inquiries' | 'stats'

interface AdminStats {
  generated_at: string
  businesses: { total: number; paid: number; new7: number; new30: number; byPlan: { plan: string; n: number }[]; active7: number; active30: number }
  employees: { active: number; total: number }
  attendance: { today: number; last7: number; daily: { d: string; n: number }[] }
  logins: { users7: number; users30: number }
  notifications: { sent7: number; sent30: number }
  inquiries: { total: number; new: number; byType: { t: string; n: number }[] }
}

interface AdminBizDetail {
  business: { name: string; slug: string; plan: string; created_at: string; is_active: number; owner_email: string | null }
  employees: { active: number; total: number; pay_enabled: number; working_now: number }
  attendance: { today: number; last7: number; last30: number; last_at: string | null; daily30: { d: string; n: number }[] }
  notifications: { sent30: number; byTemplate: { t: string; n: number }[] }
  timeoff: { last30: number; total: number }
}

interface AdminInquiry {
  id: number
  source: string | null
  inquiry_type: string | null
  business_name: string
  phone: string
  content: string | null
  agreed_marketing: number
  ip: string | null
  status: InquiryStatus
  note: string | null
  created_at: string
  handled_at: string | null
}

const STATUS_LABELS: Record<InquiryStatus, { label: string; cls: string }> = {
  new:         { label: '🆕 신규',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress: { label: '⏳ 처리 중', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  done:        { label: '✅ 완료',    cls: 'bg-green-50 text-green-700 border-green-200' },
  spam:        { label: '🚫 스팸',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

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
  active_employee_count: number
  last_attendance: string | null
  att7: number
  notify_phone: string | null
  sms_notify_enabled: number
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

  // 출근 SMS 수신번호 인라인 편집
  const [editSmsSlug, setEditSmsSlug] = useState<string | null>(null)
  const [editSmsPhone, setEditSmsPhone] = useState('')

  // 탭 + 문의 내역
  const [tab, setTab] = useState<AdminTab>('businesses')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [detailSlug, setDetailSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminBizDetail | null>(null)

  const openDetail = async (slug: string) => {
    setDetailSlug(slug); setDetail(null)
    try { setDetail(await adminApi<AdminBizDetail>(`/admin/businesses/${slug}/detail-stats`)) }
    catch (e: any) { setError(e.message); setDetailSlug(null) }
  }
  const [inquiries, setInquiries] = useState<AdminInquiry[]>([])
  const [inqCounts, setInqCounts] = useState<{ status: string; n: number }[]>([])
  const [inqFilter, setInqFilter] = useState<InquiryStatus | 'all'>('new')
  const [inqLoading, setInqLoading] = useState(false)

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

  const loadInquiries = useCallback(async () => {
    if (!getToken()) return
    setInqLoading(true)
    try {
      const params = inqFilter === 'all' ? '' : `?status=${inqFilter}`
      const data = await adminApi<{ rows: AdminInquiry[]; counts: { status: string; n: number }[] }>(
        `/admin/inquiries${params}`,
      )
      setInquiries(data.rows)
      setInqCounts(data.counts)
    } catch (e: any) { setError(e.message) }
    finally { setInqLoading(false) }
  }, [inqFilter])

  useEffect(() => { if (authed && tab === 'inquiries') loadInquiries() }, [authed, tab, loadInquiries])

  const loadStats = useCallback(async () => {
    if (!getToken()) return
    setStatsLoading(true)
    try { setStats(await adminApi<AdminStats>('/admin/stats')) }
    catch (e: any) { setError(e.message) }
    finally { setStatsLoading(false) }
  }, [])
  useEffect(() => { if (authed && tab === 'stats') loadStats() }, [authed, tab, loadStats])

  const handleInquiryStatus = async (id: number, status: InquiryStatus) => {
    try {
      await adminApi(`/admin/inquiries/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await loadInquiries()
    } catch (e: any) { alert(`상태 변경 실패: ${e.message}`) }
  }

  const handleInquiryDelete = async (id: number) => {
    if (!confirm('이 문의를 영구 삭제하시겠어요? (스팸·중복 정리용)')) return
    try {
      await adminApi(`/admin/inquiries/${id}`, { method: 'DELETE' })
      await loadInquiries()
    } catch (e: any) { alert(`삭제 실패: ${e.message}`) }
  }

  const newCount = inqCounts.find(c => c.status === 'new')?.n || 0

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

  const handleSmsSave = async (slug: string) => {
    const digits = editSmsPhone.replace(/[^0-9]/g, '')
    if (digits && (digits.length < 10 || digits.length > 11)) {
      alert('올바른 휴대폰 번호를 입력하세요 (10~11자리)')
      return
    }
    try {
      await adminApi(`/admin/businesses/${slug}/sms-notify`, {
        method: 'PATCH',
        body: JSON.stringify({ notify_phone: digits || null }),
      })
      setEditSmsSlug(null); setEditSmsPhone('')
      await load()
    } catch (e: any) { alert(`번호 저장 실패: ${e.message}`) }
  }

  const handleToggleSms = async (b: AdminBiz) => {
    const next = b.sms_notify_enabled === 1 ? false : true
    if (next && !b.notify_phone) {
      alert('알림을 켜려면 받는 번호를 먼저 등록하세요')
      return
    }
    try {
      await adminApi(`/admin/businesses/${b.slug}/sms-notify`, {
        method: 'PATCH',
        body: JSON.stringify({ sms_notify_enabled: next }),
      })
      await load()
    } catch (e: any) { alert(`알림 설정 실패: ${e.message}`) }
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
      const res: any = await adminApi(`/admin/businesses/${b.slug}/plan-expires-at`, {
        method: 'PATCH',
        body: JSON.stringify({ plan_expires_at: v }),
      })
      if (res?.auto_activated) {
        alert(`✅ 기한 연장 + 자동 활성화 완료 (${v})`)
      }
      await load()
    } catch (e: any) { alert(`기한 변경 실패: ${e.message}`) }
  }

  const handleResetPin = async (b: AdminBiz) => {
    const input = prompt(`${b.name}의 관리자 PIN을 재발급합니다.\n새 PIN을 입력하세요 (비우면 자동 생성, 4~8자리 숫자):`)
    if (input === null) return // 취소
    const newPin = input.trim()
    if (newPin && !/^[0-9]{4,8}$/.test(newPin)) { alert('PIN은 4~8자리 숫자여야 합니다'); return }
    try {
      const res: any = await adminApi(`/admin/businesses/${b.slug}/reset-pin`, {
        method: 'PATCH',
        body: JSON.stringify({ new_pin: newPin || undefined }),
      })
      alert(`✅ PIN 재발급 완료\n\n사업장: ${b.name}\n새 PIN: ${res.new_pin}\n\n이 PIN을 사장님께 안전하게 전달하세요. (기존 PIN은 더 이상 사용 불가)`)
    } catch (e: any) { alert(`PIN 재발급 실패: ${e.message}`) }
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

      <main className="max-w-7xl mx-auto p-6">
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

        {/* 업체별 상세 통계 모달 */}
        {detailSlug && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setDetailSlug(null)}>
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl my-8" onClick={e => e.stopPropagation()}>
              {!detail ? (
                <p className="text-center text-gray-400 py-10">불러오는 중...</p>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-extrabold text-gray-800">{detail.business.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {detail.business.plan} · 가입 {detail.business.created_at?.slice(0, 10)}
                        {detail.business.is_active === 0 && <span className="text-red-500 ml-1">· 정지</span>}
                      </p>
                      {detail.business.owner_email && <p className="text-xs text-gray-400">{detail.business.owner_email}</p>}
                    </div>
                    <button onClick={() => setDetailSlug(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                  </div>

                  {/* KPI */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '활성/전체 직원', value: `${detail.employees.active}/${detail.employees.total}` },
                      { label: '출근 중', value: detail.employees.working_now },
                      { label: '급여 대상', value: detail.employees.pay_enabled },
                      { label: '오늘 출퇴근', value: detail.attendance.today },
                      { label: '7일 출퇴근', value: detail.attendance.last7 },
                      { label: '30일 출퇴근', value: detail.attendance.last30 },
                      { label: '30일 알림', value: detail.notifications.sent30 },
                      { label: '30일 휴가등록', value: detail.timeoff.last30 },
                      { label: '마지막 활동', value: detail.attendance.last_at ? detail.attendance.last_at.slice(5, 10) : '없음' },
                    ].map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <div className="text-[10px] text-gray-400 mb-0.5">{k.label}</div>
                        <div className="text-base font-extrabold text-gray-800">{typeof k.value === 'number' ? k.value.toLocaleString() : k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* 30일 출퇴근 추이 */}
                  <div>
                    <h4 className="text-xs font-extrabold text-gray-700 mb-2">최근 30일 출퇴근 추이</h4>
                    {detail.attendance.daily30.length === 0 ? (
                      <p className="text-xs text-gray-400">기록 없음</p>
                    ) : (
                      <div className="flex items-end gap-0.5 h-20">
                        {(() => {
                          const max = Math.max(...detail.attendance.daily30.map(d => d.n), 1)
                          return detail.attendance.daily30.map(d => (
                            <div key={d.d} className="flex-1 bg-blue-400 rounded-t" style={{ height: `${d.n / max * 100}%` }} title={`${d.d}: ${d.n}건`} />
                          ))
                        })()}
                      </div>
                    )}
                  </div>

                  {/* 알림 유형 */}
                  {detail.notifications.byTemplate.length > 0 && (
                    <div>
                      <h4 className="text-xs font-extrabold text-gray-700 mb-2">알림 발송 (30일)</h4>
                      <div className="flex flex-wrap gap-2">
                        {detail.notifications.byTemplate.map(t => (
                          <span key={t.t} className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">{t.t} · {t.n}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 탭 */}
        <div className="flex gap-1 mb-5 border-b border-gray-200">
          <button
            onClick={() => setTab('businesses')}
            className={`px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px ${
              tab === 'businesses' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            🏪 사업장 ({bizList.length})
          </button>
          <button
            onClick={() => setTab('stats')}
            className={`px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px ${
              tab === 'stats' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            📊 통계
          </button>
          <button
            onClick={() => setTab('inquiries')}
            className={`px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px relative ${
              tab === 'inquiries' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            💬 도입 문의
            {newCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1">
                {newCount}
              </span>
            )}
          </button>
        </div>

        {tab === 'stats' && (
          <div>
            {statsLoading && !stats ? (
              <p className="text-center text-gray-400 py-10">불러오는 중...</p>
            ) : !stats ? (
              <p className="text-center text-gray-400 py-10">데이터를 불러올 수 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">기준 시각 {stats.generated_at?.slice(0, 16)}</p>
                  <button onClick={loadStats} className="text-xs font-semibold text-blue-600 hover:text-blue-800">↻ 새로고침</button>
                </div>

                {/* KPI 카드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: '전체 사업장', value: stats.businesses.total, sub: `7일 신규 ${stats.businesses.new7}` },
                    { label: '유료 사업장', value: stats.businesses.paid, sub: `전환율 ${stats.businesses.total ? Math.round(stats.businesses.paid / stats.businesses.total * 100) : 0}%` },
                    { label: '활성 사업장(7일)', value: stats.businesses.active7, sub: `30일 ${stats.businesses.active30}` },
                    { label: '활성 직원', value: stats.employees.active, sub: `전체 ${stats.employees.total}` },
                    { label: '오늘 출퇴근', value: stats.attendance.today, sub: `7일 ${stats.attendance.last7}건` },
                    { label: '로그인 사용자(7일)', value: stats.logins.users7, sub: `30일 ${stats.logins.users30}` },
                    { label: '알림 발송(7일)', value: stats.notifications.sent7, sub: `30일 ${stats.notifications.sent30}` },
                    { label: '신규 문의', value: stats.inquiries.new, sub: `전체 ${stats.inquiries.total}` },
                  ].map(k => (
                    <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
                      <div className="text-xs text-gray-400 mb-1">{k.label}</div>
                      <div className="text-2xl font-extrabold text-gray-800">{k.value.toLocaleString()}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{k.sub}</div>
                    </div>
                  ))}
                </div>

                {/* 플랜 분포 */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5">
                  <h3 className="text-sm font-extrabold text-gray-800 mb-3">플랜 분포</h3>
                  <div className="flex flex-wrap gap-2">
                    {stats.businesses.byPlan.map(p => (
                      <span key={p.plan} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 border border-gray-100">
                        {p.plan} · {p.n}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 일별 출퇴근 (최근 7일) */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5">
                  <h3 className="text-sm font-extrabold text-gray-800 mb-3">일별 출퇴근 (최근 7일)</h3>
                  {stats.attendance.daily.length === 0 ? (
                    <p className="text-xs text-gray-400">기록 없음</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {(() => {
                        const max = Math.max(...stats.attendance.daily.map(d => d.n), 1)
                        return stats.attendance.daily.map(d => (
                          <div key={d.d} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-20 shrink-0">{d.d.slice(5)}</span>
                            <div className="flex-1 bg-gray-50 rounded h-5 overflow-hidden">
                              <div className="h-full bg-blue-400 rounded" style={{ width: `${d.n / max * 100}%` }} />
                            </div>
                            <span className="text-xs font-bold text-gray-600 w-10 text-right">{d.n}</span>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                </div>

                {/* 문의 유형 분포 */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5">
                  <h3 className="text-sm font-extrabold text-gray-800 mb-3">문의 유형 분포</h3>
                  {stats.inquiries.byType.length === 0 ? (
                    <p className="text-xs text-gray-400">문의 없음</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {stats.inquiries.byType.map(t => (
                        <div key={t.t} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">{t.t}</span>
                          <span className="font-bold text-gray-800">{t.n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'inquiries' && (
          <div>
            {/* 필터 */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(['all','new','in_progress','done','spam'] as const).map(s => {
                const cnt = s === 'all' ? inqCounts.reduce((a,b) => a + b.n, 0) : (inqCounts.find(c => c.status === s)?.n || 0)
                const active = inqFilter === s
                const label = s === 'all' ? '전체' : STATUS_LABELS[s].label
                return (
                  <button key={s} onClick={() => setInqFilter(s)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}>
                    {label} <span className="opacity-70 ml-1">{cnt}</span>
                  </button>
                )
              })}
            </div>

            {inqLoading ? (
              <div className="text-center text-gray-400 py-10">불러오는 중...</div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 whitespace-nowrap">상태</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">접수</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">사업장명</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">문의 유형</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">휴대폰</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">경로</th>
                      <th className="text-left px-4 py-3">문의 내용</th>
                      <th className="text-left px-4 py-3 whitespace-nowrap">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inquiries.map(q => (
                      <tr key={q.id} className="border-t border-gray-100 align-top">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <select
                            value={q.status}
                            onChange={e => handleInquiryStatus(q.id, e.target.value as InquiryStatus)}
                            className={`text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${STATUS_LABELS[q.status].cls}`}
                          >
                            {(Object.keys(STATUS_LABELS) as InquiryStatus[]).map(s => (
                              <option key={s} value={s}>{STATUS_LABELS[s].label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(q.created_at)}</td>
                        <td className="px-4 py-3 font-semibold whitespace-nowrap">{q.business_name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {q.inquiry_type ? (
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${q.inquiry_type.includes('단순') || q.inquiry_type.includes('기타') ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>
                              {q.inquiry_type}
                            </span>
                          ) : <span className="text-xs text-gray-400">-</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <a href={`tel:${q.phone}`} className="text-blue-600 hover:underline">{q.phone}</a>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{q.source || '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 whitespace-pre-wrap min-w-[280px] max-w-[420px]">{q.content || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button onClick={() => handleInquiryDelete(q.id)}
                            className="text-xs text-red-400 hover:text-red-600">삭제</button>
                        </td>
                      </tr>
                    ))}
                    {inquiries.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-gray-400 py-10">해당 상태의 문의가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'businesses' && (<>
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
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">상태</th>
                  <th className="text-left px-4 py-3">요금제</th>
                  <th className="text-left px-4 py-3">기한</th>
                  <th className="text-left px-4 py-3">slug</th>
                  <th className="text-left px-4 py-3">사업장명</th>
                  <th className="text-left px-4 py-3">직원</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">활동</th>
                  <th className="text-left px-4 py-3">출근 SMS</th>
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
                          b.plan !== 'free'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-gray-50 text-gray-600 border-gray-200'
                        }`}
                        title="요금제 변경"
                      >
                        <option value="free">🆓 무료 (3명)</option>
                        <option value="basic">💳 베이직 (5명·9,900원)</option>
                        <option value="pro">💎 프로 (20명·29,900원)</option>
                        <option value="enterprise">🏢 엔터프라이즈 (무제한)</option>
                        {b.plan === 'paid' && <option value="paid">💎 유료(레거시)</option>}
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
                        const isPaid = b.plan !== 'free'
                        const inputCls =
                          !isPaid ? 'border-gray-200 bg-gray-50 text-gray-400' :
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
                              title={isPaid ? '유료 결제 만료일 (도달 시 자동 정지)' : '무료 사용자엔 적용 안 됨 (참고용)'}
                            />
                            {isPaid && status && (
                              <span className="text-[10px] font-bold text-gray-500 px-1">{status}</span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div>{b.slug}</div>
                      <button onClick={() => handleResetPin(b)}
                        title="관리자 PIN 재발급 (분실 복구)"
                        className="mt-1 text-[11px] font-sans font-semibold text-gray-400 hover:text-blue-600 transition">🔑 PIN 재발급</button>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      <button onClick={() => openDetail(b.slug)}
                        className="text-blue-700 hover:underline" title="상세 통계 보기">
                        {b.name} 📊
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {b.active_employee_count}<span className="text-gray-300">/{b.employee_count}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {b.last_attendance ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-gray-600">최근 {b.last_attendance.slice(5, 10)}</span>
                          <span className="text-[10px] text-gray-400">7일 {b.att7}건</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">사용 없음</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editSmsSlug === b.slug ? (
                        <div className="flex gap-1.5 items-center">
                          <input value={editSmsPhone} onChange={e => setEditSmsPhone(e.target.value)}
                            placeholder="01012345678" type="tel" inputMode="numeric"
                            className="w-32 border border-gray-300 rounded-lg px-2 py-1 text-xs" />
                          <button onClick={() => handleSmsSave(b.slug)}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg">저장</button>
                          <button onClick={() => { setEditSmsSlug(null); setEditSmsPhone('') }}
                            className="text-xs text-gray-400">취소</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {b.notify_phone ? (
                            <>
                              <button
                                onClick={() => handleToggleSms(b)}
                                className={`text-xs font-bold px-2 py-1 rounded-lg border transition ${
                                  b.sms_notify_enabled === 1
                                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                                }`}
                                title="클릭해서 출근 SMS 알림 ON/OFF"
                              >
                                {b.sms_notify_enabled === 1 ? '🔔 ON' : '🔕 OFF'}
                              </button>
                              <span className="text-xs text-gray-600 font-mono">{b.notify_phone}</span>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">미등록</span>
                          )}
                          <button onClick={() => { setEditSmsSlug(b.slug); setEditSmsPhone(b.notify_phone || '') }}
                            className="text-xs text-blue-500 hover:text-blue-700 ml-1">수정</button>
                        </div>
                      )}
                    </td>
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
                  <tr><td colSpan={11} className="text-center text-gray-400 py-10">사업장이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        </>)}
      </main>
    </div>
  )
}
