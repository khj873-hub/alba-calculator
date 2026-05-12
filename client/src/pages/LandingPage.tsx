import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBusiness } from '../api'

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc-j4HYY01OlGgFwTlGZHLuzpkP474N2cNdCQdLUnT4CyGr6w/viewform'
const ADMIN_PASSWORD = 'alba2024'

export default function LandingPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showEnter, setShowEnter] = useState(false)

  // 사업장 목록 비밀번호
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [adminPw, setAdminPw] = useState('')
  const [adminError, setAdminError] = useState('')

  const navigate = useNavigate()

  const handleEnter = async (e: React.FormEvent) => {
    e.preventDefault()
    const slug = code.trim().toLowerCase()
    if (!slug) { setError('사업장 코드를 입력하세요'); return }
    setLoading(true); setError('')
    try {
      await fetchBusiness(slug)
      navigate(`/${slug}`)
    } catch {
      setError('존재하지 않는 사업장 코드입니다')
    } finally {
      setLoading(false)
    }
  }

  const handleAdminEnter = () => {
    if (adminPw === ADMIN_PASSWORD) {
      setShowAdminModal(false)
      setAdminPw('')
      setAdminError('')
      navigate('/businesses')
    } else {
      setAdminError('비밀번호가 올바르지 않습니다')
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⏱</span>
          <span className="font-extrabold text-gray-800 text-lg">알바계산기</span>
        </div>
        <button
          onClick={() => setShowEnter(v => !v)}
          className="text-sm font-semibold text-gray-500 hover:text-gray-800 transition"
        >
          사업장 입장
        </button>
      </header>

      {/* 사업장 코드 입력 */}
      {showEnter && (
        <div className="bg-gray-50 border-b border-gray-100 px-6 py-4">
          <form onSubmit={handleEnter} className="max-w-sm mx-auto flex gap-2">
            <input
              value={code}
              onChange={e => { setCode(e.target.value); setError('') }}
              placeholder="사업장 코드 입력 (예: abc123)"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <button type="submit" disabled={loading}
              className="bg-green-500 text-white font-bold px-4 py-2.5 rounded-xl hover:bg-green-600 transition disabled:opacity-50 text-sm">
              {loading ? '확인 중...' : '입장'}
            </button>
          </form>
          {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}
        </div>
      )}

      {/* 공감 섹션 */}
      <section className="px-6 pt-12 pb-10 max-w-2xl mx-auto">
        <p className="text-center text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">이런 경험 있으신가요?</p>
        <div className="flex flex-col gap-3">
          {[
            { emoji: '😤', text: '"이번 달 알바 급여 계산하다가 또 실수했어..."' },
            { emoji: '📝', text: '"카톡으로 출퇴근 보고받는데 나중에 분쟁이 생겼어요"' },
            { emoji: '🤔', text: '"주휴수당을 줘야 하는지 말아야 하는지 매번 헷갈려"' },
            { emoji: '📵', text: '"알바생이 제 시간에 출근했는지 확인할 방법이 없어"' },
          ].map(item => (
            <div key={item.emoji} className="flex items-center gap-3 bg-orange-50 rounded-2xl px-4 py-3">
              <span className="text-xl shrink-0">{item.emoji}</span>
              <span className="text-sm text-gray-600 font-medium">{item.text}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-sm font-bold text-gray-700 mt-6">
          알바계산기가 이 모든 걸 해결해드립니다.
        </p>
      </section>

      {/* 히어로 */}
      <section className="text-center px-6 pt-6 pb-12 max-w-2xl mx-auto">
        <div className="inline-block bg-green-50 text-green-700 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
          무료로 시작하기
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-4">
          알바 출퇴근 관리,<br />
          <span className="text-green-500">이제 스마트하게</span>
        </h1>
        <p className="text-gray-500 text-base mb-8 leading-relaxed">
          출퇴근 기록부터 급여 계산, 위치 기반 출근 체크까지<br />
          사장님과 알바생 모두를 위한 근태 관리 서비스
        </p>
        <a
          href={FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-green-500 text-white font-extrabold px-8 py-4 rounded-2xl text-base hover:bg-green-600 transition shadow-lg shadow-green-200"
        >
          무료로 사업장 등록하기 →
        </a>
        <p className="text-xs text-gray-400 mt-3">신용카드 불필요 · 1분 만에 시작</p>
      </section>

      {/* 미리보기 */}
      <section className="px-6 max-w-2xl mx-auto mb-16">
        <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-3xl p-8 text-center">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="text-2xl mb-2">🟢</div>
              <div className="text-xs font-bold text-gray-700">출근 처리</div>
              <div className="text-xs text-gray-400 mt-1">원터치</div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="text-2xl mb-2">📊</div>
              <div className="text-xs font-bold text-gray-700">급여 계산</div>
              <div className="text-xs text-gray-400 mt-1">자동화</div>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="text-2xl mb-2">📍</div>
              <div className="text-xs font-bold text-gray-700">위치 제한</div>
              <div className="text-xs text-gray-400 mt-1">GPS 기반</div>
            </div>
          </div>
        </div>
      </section>

      {/* 기능 소개 */}
      <section className="px-6 max-w-2xl mx-auto mb-16">
        <h2 className="text-xl font-extrabold text-gray-800 text-center mb-8">필요한 기능, 전부 있어요</h2>
        <div className="flex flex-col gap-4">
          {[
            { icon: '📱', title: '원터치 출퇴근', desc: '직원이 스마트폰으로 간편하게 출퇴근 체크. 관리자는 실시간으로 확인.' },
            { icon: '📍', title: '위치 기반 출근 제한', desc: '사업장 반경 안에서만 출근 가능. GPS로 정확하게 확인.' },
            { icon: '💰', title: '자동 급여 계산', desc: '시급 × 근무시간 자동 계산. 주휴수당도 옵션으로 적용.' },
            { icon: '📄', title: '급여 명세서 출력', desc: '월별 근태 내역과 급여를 PDF로 출력해서 직원에게 전달.' },
            { icon: '🔐', title: '사업장별 독립 관리', desc: '고유 코드로 사업장 구분. 직원 데이터 완전 분리.' },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-4 bg-gray-50 rounded-2xl p-4">
              <div className="text-2xl shrink-0">{f.icon}</div>
              <div>
                <div className="font-bold text-gray-800 text-sm">{f.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 사용 방법 */}
      <section className="bg-gray-50 px-6 py-12 mb-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-extrabold text-gray-800 text-center mb-8">3단계로 시작하세요</h2>
          <div className="flex flex-col gap-4">
            {[
              { step: '1', title: '사업장 등록 신청', desc: '아래 버튼으로 신청하면 빠르게 사업장 코드를 발급해드립니다.' },
              { step: '2', title: '직원 추가', desc: '직원 이름과 시급을 입력하면 바로 사용 가능합니다.' },
              { step: '3', title: '코드 공유', desc: '발급된 사업장 코드를 직원에게 알려주세요. 출퇴근 시작!' },
            ].map(s => (
              <div key={s.step} className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-green-500 text-white font-extrabold text-sm flex items-center justify-center shrink-0">
                  {s.step}
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-sm">{s.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 하단 CTA */}
      <section className="text-center px-6 pb-16 max-w-2xl mx-auto">
        <h2 className="text-2xl font-extrabold text-gray-800 mb-3">지금 바로 시작해보세요</h2>
        <p className="text-gray-500 text-sm mb-6">복잡한 설치 없이, 신청 즉시 사용 가능합니다</p>
        <a
          href={FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-green-500 text-white font-extrabold px-8 py-4 rounded-2xl text-base hover:bg-green-600 transition shadow-lg shadow-green-200 w-full max-w-sm text-center"
        >
          무료로 시작하기
        </a>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-gray-100 px-6 py-6 text-center">
        <p className="text-xs text-gray-400 mb-2">⏱ 알바계산기 · 출퇴근 관리 서비스</p>
        <button
          onClick={() => { setShowAdminModal(true); setAdminPw(''); setAdminError('') }}
          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition"
        >
          사업장 전체 목록
        </button>
      </footer>

      {/* 관리자 비밀번호 모달 */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-extrabold text-gray-800 mb-1">관리자 확인</h3>
            <p className="text-xs text-gray-400 mb-4">사업장 전체 목록은 관리자만 접근 가능합니다</p>
            <input
              type="password"
              value={adminPw}
              onChange={e => { setAdminPw(e.target.value); setAdminError('') }}
              onKeyDown={e => e.key === 'Enter' && handleAdminEnter()}
              placeholder="비밀번호 입력"
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 mb-2"
            />
            {adminError && <p className="text-red-500 text-xs mb-2">{adminError}</p>}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setShowAdminModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition"
              >
                취소
              </button>
              <button
                onClick={handleAdminEnter}
                className="flex-1 py-2.5 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
