import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchEmployees, fetchBusiness, ServiceSuspendedError } from '../api'
import { useSlug } from '../hooks/useSlug'
import SuspendedNotice from '../components/SuspendedNotice'
import type { Employee } from '../types'

// 검색창 노출 임계값 — 직원이 이 수 이상일 때만 검색창을 보여 작은 사업장은 군더더기 없게.
const SEARCH_THRESHOLD = 8

const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
// 한글 문자열의 초성 추출. 한글이 아니면 글자 그대로. ("김민수" → "ㄱㅁㅅ")
function getChosung(str: string): string {
  return str.split('').map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) return ch
    return CHOSUNG[Math.floor(code / 588)]
  }).join('')
}
// 이름 부분일치 또는 초성 일치. 빈 검색어는 전체 통과.
function matchEmployee(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (name.toLowerCase().includes(q)) return true
  return getChosung(name).includes(q)
}

export default function HomePage() {
  const navigate = useNavigate()
  const slug = useSlug()
  const [mode, setMode] = useState<'kiosk' | 'private' | null>(null)
  const [suspended, setSuspended] = useState(false)

  useEffect(() => {
    fetchBusiness(slug)
      .then(biz => setMode(biz.home_mode === 'private' ? 'private' : 'kiosk'))
      .catch(e => {
        if (e instanceof ServiceSuspendedError) setSuspended(true)
        else setMode('kiosk')
      })
  }, [slug])

  if (suspended) return <SuspendedNotice slug={slug} />
  if (mode === null) return <div className="text-center text-gray-400 py-20">불러오는 중...</div>
  if (mode === 'private') return <PrivateGuide slug={slug} navigate={navigate} />
  return <KioskList slug={slug} navigate={navigate} />
}

function PrivateGuide({ slug, navigate }: { slug: string; navigate: (to: string) => void }) {
  return (
    <div className="py-16 text-center">
      <div className="text-6xl mb-6">🔗</div>
      <h2 className="text-xl font-extrabold text-gray-800 mb-2">본인 출근 링크가 필요해요</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-10">
        관리자에게 본인 전용 출근 링크를 요청하세요.
        <br />
        받으신 링크로만 출퇴근 등록이 가능합니다.
      </p>

      <button
        onClick={() => navigate(`/${slug}/manager/login`)}
        className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition"
      >
        관리자로 로그인
      </button>
    </div>
  )
}

function KioskList({ slug, navigate }: { slug: string; navigate: (to: string) => void }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    // 키오스크에는 재직(active) 직원만 노출 — 퇴사자는 출근 대상이 아님(관리자 화면과 일치)
    fetchEmployees(slug)
      .then(list => setEmployees(list.filter(e => e.status === 'active')))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="text-center text-gray-400 py-20">불러오는 중...</div>

  const showSearch = employees.length >= SEARCH_THRESHOLD
  const visible = showSearch ? employees.filter(e => matchEmployee(e.name, query)) : employees

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6 text-center">본인 이름을 선택하세요</p>

      {showSearch && (
        <div className="relative mb-5">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 검색 (초성도 가능, 예: ㄱㅁㅅ)"
            className="w-full pl-12 pr-10 py-3.5 rounded-2xl border border-gray-200 bg-white text-base focus:outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="검색어 지우기"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xl w-7 h-7 flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {employees.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">👤</div>
          <p className="text-sm">등록된 직원이 없습니다</p>
          <p className="text-xs mt-2 text-gray-300">관리자에게 문의하세요</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm">"{query}" 검색 결과가 없어요</p>
          <button onClick={() => setQuery('')} className="text-xs mt-3 text-green-600 underline">전체 보기</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((emp) => (
            <button
              key={emp.id}
              onClick={() => navigate(`/${slug}/employee/${emp.id}`)}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 hover:shadow-md hover:border-green-200 transition text-left w-full active:scale-[0.98]"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold text-xl shrink-0"
                style={{ background: emp.color }}
              >
                {emp.name[0]}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 text-base">{emp.name}</div>
                {emp.is_working ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-xs text-green-600 font-semibold">출근 중 · {emp.clock_in?.slice(11, 16)} 부터</span>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 mt-0.5">퇴근</div>
                )}
              </div>
              <span className="text-gray-300 text-lg">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
