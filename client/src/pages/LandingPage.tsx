import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBusiness, ServiceSuspendedError } from '../api'
import InquiryForm from '../components/InquiryForm'
import KakaoFloatButton from '../components/KakaoFloatButton'
import AdSlot from '../components/AdSlot'
import PricingPlans from '../components/PricingPlans'

const KAKAO_URL = 'https://pf.kakao.com/_xdwVxjX'

export default function LandingPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showEnter, setShowEnter] = useState(false)
  const [inquiryPlan, setInquiryPlan] = useState('') // 요금제 카드에서 선택한 관심 플랜 → 문의 폼 자동 선택

  const navigate = useNavigate()

  // 유료 플랜 '문의하기' — 관심 플랜 지정 + 문의 폼으로 스크롤
  const goInquiry = (type: string) => {
    setInquiryPlan(type)
    setTimeout(() => document.getElementById('inquiry')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // 다른 페이지(/create 등)에서 ?inquiry=<플랜>으로 들어오면 문의 폼으로 이동 + 자동 선택
  useEffect(() => {
    const inq = new URLSearchParams(window.location.search).get('inquiry')
    if (inq) {
      setInquiryPlan(inq)
      window.history.replaceState(null, '', '/')
      setTimeout(() => document.getElementById('inquiry')?.scrollIntoView({ behavior: 'smooth' }), 200)
    }
  }, [])

  const handleEnter = async (e: React.FormEvent) => {
    e.preventDefault()
    const slug = code.trim().toLowerCase()
    if (!slug) { setError('사업장 코드를 입력하세요'); return }
    setLoading(true); setError('')
    try {
      await fetchBusiness(slug)
      navigate(`/${slug}`)
    } catch (e: any) {
      if (e instanceof ServiceSuspendedError) navigate(`/${slug}`)  // 정지 안내 페이지 노출
      else setError('존재하지 않는 사업장 코드입니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⏱</span>
          <span className="font-extrabold text-gray-800 text-lg">퍼펙트 근태관리</span>
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
            { emoji: '😤', text: '"이번 달 직원 급여 계산하다가 또 실수했어..."' },
            { emoji: '📝', text: '"카톡으로 출퇴근 보고받는데 나중에 분쟁이 생겼어요"' },
            { emoji: '🤔', text: '"단기 직원 주휴수당을 줘야 하는지 매번 헷갈려"' },
            { emoji: '📵', text: '"직원이 제 시간에 출근했는지 확인할 방법이 없어"' },
            { emoji: '🏖', text: '"직원이 연차 썼는데 급여에 반영 안 돼서 분쟁 났어요"' },
          ].map(item => (
            <div key={item.emoji} className="flex items-center gap-3 bg-orange-50 rounded-2xl px-4 py-3">
              <span className="text-xl shrink-0">{item.emoji}</span>
              <span className="text-sm text-gray-600 font-medium">{item.text}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-sm font-bold text-gray-700 mt-6">
          퍼펙트 근태관리가 이 모든 걸 해결해드립니다.
        </p>
      </section>

      {/* 히어로 */}
      <section className="text-center px-6 pt-6 pb-12 max-w-2xl mx-auto">
        <div className="inline-block bg-green-50 text-green-700 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
          무료로 시작하기
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-4">
          직원 출퇴근 관리,<br />
          <span className="text-green-500">이제 스마트하게</span>
        </h1>
        <p className="text-gray-500 text-base mb-8 leading-relaxed">
          출퇴근 기록부터 급여 계산, 위치 기반 출근 체크까지<br />
          <strong className="text-gray-700">단기·장기 직원</strong> 모두를 위한 근태 관리 서비스
        </p>
        <button
          onClick={() => navigate('/create')}
          className="inline-block bg-green-500 text-white font-extrabold px-8 py-4 rounded-2xl text-base hover:bg-green-600 transition shadow-lg shadow-green-200"
        >
          무료로 사업장 만들기 →
        </button>
        <p className="text-xs text-gray-400 mt-3">구글 로그인 · 신용카드 불필요 · 1분 만에 시작</p>
      </section>

      {/* 미리보기 */}
      <section className="px-6 max-w-2xl mx-auto mb-16">
        <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-3xl p-6 sm:p-8 text-center">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {[
              { icon: '🟢', label: '출근 처리', desc: '원터치' },
              { icon: '📊', label: '급여·명세서', desc: '자동 계산·PDF' },
              { icon: '📍', label: '위치 제한', desc: 'GPS 기반' },
              { icon: '🏖', label: '휴가·주휴수당', desc: '4종+자동 계산' },
              { icon: '📲', label: '출퇴근 알림', desc: '카카오·문자' },
              { icon: '🔐', label: '구글 로그인', desc: '안전 접근' },
            ].map(item => (
              <div key={item.label} className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
                <div className="text-2xl mb-1.5">{item.icon}</div>
                <div className="text-xs font-bold text-gray-700">{item.label}</div>
                <div className="text-xs text-gray-400 mt-1">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 기능 소개 */}
      <section className="px-6 max-w-2xl mx-auto mb-16">
        <h2 className="text-xl font-extrabold text-gray-800 text-center mb-8">필요한 기능, 전부 있어요</h2>
        <div className="flex flex-col gap-4">
          {[
            { icon: '👥', title: '단기·장기 직원 구분 관리', desc: '직원 유형별로 시급/주휴수당 자동 적용. 한 사업장에서 모두 관리.' },
            { icon: '📱', title: '원터치 출퇴근', desc: '직원이 스마트폰으로 간편하게 출퇴근 체크. 관리자는 실시간으로 확인.' },
            { icon: '📲', title: '출퇴근 알림 (SMS·카카오)', desc: '직원이 출퇴근을 찍으면 사장님 휴대폰으로 즉시 알림. 매장에 없어도 실시간 확인.' },
            { icon: '📍', title: '위치 기반 출근 제한', desc: '사업장 반경 안에서만 출근 가능. GPS로 정확하게 확인.' },
            { icon: '💰', title: '자동 급여 계산', desc: '시급 × 근무시간 자동 계산. 주휴수당도 옵션으로 적용.' },
            { icon: '🏖', title: '휴가 관리 (4종)', desc: '연차·반차·병가·경조사 등록. 급여에 자동 반영하거나 기록만 남길지 선택.' },
            { icon: '🌙', title: '야간 근무 자정 분할', desc: '22시→다음날 06시 같은 야간 근무를 자동으로 일자별 분리. 명세서에도 정확히 표시.' },
            { icon: '📄', title: '급여 명세서 출력', desc: '월별 근태 내역과 급여를 PDF/CSV로 출력해서 직원에게 전달.' },
            { icon: '🔐', title: '구글 로그인', desc: '사장님 본인 구글 계정으로 안전하게 접근. PIN 분실 걱정 없음. (PIN도 병행 가능)' },
            { icon: '🏪', title: '사업장별 독립 관리', desc: '고유 코드로 사업장 구분. 직원·근태·급여 데이터 완전 분리.' },
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

      {/* 광고 (랜딩 전용 · 게시자ID + 슬롯 모두 설정됐을 때만 노출) */}
      {(import.meta as any).env?.VITE_ADSENSE_CLIENT && (import.meta as any).env?.VITE_ADSENSE_SLOT_LANDING && (
        <section className="px-6 max-w-2xl mx-auto mb-16">
          <p className="text-center text-[10px] text-gray-300 uppercase tracking-widest mb-2">광고</p>
          <AdSlot slot={(import.meta as any).env?.VITE_ADSENSE_SLOT_LANDING} />
        </section>
      )}

      {/* 사용 방법 */}
      <section className="bg-gray-50 px-6 py-12 mb-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-extrabold text-gray-800 text-center mb-8">3단계로 시작하세요</h2>
          <div className="flex flex-col gap-4">
            {[
              { step: '1', title: '구글로 사업장 만들기', desc: '구글 로그인 후 사업장명·관리자 PIN만 입력하면 바로 시작. 신용카드 불필요.' },
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

      {/* 요금제 안내 */}
      <section className="px-6 max-w-2xl mx-auto mb-16" id="pricing">
        <p className="text-center text-xs font-bold text-green-600 uppercase tracking-widest mb-3">PRICING</p>
        <h2 className="text-xl font-extrabold text-gray-800 text-center mb-2">합리적인 요금제</h2>
        <p className="text-center text-sm text-gray-500 mb-8">무료로 시작하고, 필요할 때 업그레이드하세요</p>
        <PricingPlans onFree={() => navigate('/create')} onInquire={goInquiry} />
        <p className="text-xs text-gray-400 mt-5 text-center">
          유료 플랜은 문의 주시면 운영자가 빠르게 설정해드려요. 무료로 먼저 시작 후 언제든 업그레이드 가능합니다.
        </p>
      </section>

      {/* 사장님 이용 후기 */}
      <section className="px-6 pb-12 max-w-2xl mx-auto">
        <p className="text-center text-xs font-bold text-green-600 uppercase tracking-widest mb-3">사장님 이용 후기</p>
        <h2 className="text-xl font-extrabold text-gray-800 text-center mb-2">업종별로 다르게, 모두에게 똑같이 편하게</h2>
        <p className="text-center text-sm text-gray-500 mb-8">카페·식당·편의점·미용실·학원 — 실제 운영 중인 사장님들의 한 줄 후기</p>
        <div className="flex flex-col gap-4">
          {[
            { industry: '카페',   emoji: '☕', quote: '"직원 4명 시급·근무 시간 매달 엑셀로 1~2시간씩 정리하던 게 5분이면 끝나요. 야간 자정 분할도 자동이라 신뢰가 갑니다."', who: '강남 디저트카페 · 사장 이OO',  tagColor: 'bg-amber-50 text-amber-700' },
            { industry: '식당',   emoji: '🍽', quote: '"주말 알바 출퇴근을 카톡으로 받다 분쟁 한 번 나고 도입했어요. GPS 제한으로 매장 안에서만 찍히니 깔끔합니다."',          who: '동네 한식당 · 사장 박OO',     tagColor: 'bg-rose-50 text-rose-700' },
            { industry: '편의점', emoji: '🏪', quote: '"야간 알바 시급·주휴수당 계산이 까다로웠는데 자동으로 다 잡아주니까 신경 안 써도 돼요. 휴가도 한눈에 보여서 일정 짜기 편합니다."', who: '24시 편의점 점주 · 김OO',     tagColor: 'bg-blue-50 text-blue-700' },
            { industry: '미용실', emoji: '💇', quote: '"스타일리스트 3명 출퇴근 + 매월 정산까지 한 곳에서. 명세서 PDF로 바로 뽑아 보내니 직원 신뢰도가 다릅니다."',           who: '청담 헤어살롱 · 원장 정OO',   tagColor: 'bg-pink-50 text-pink-700' },
            { industry: '학원',   emoji: '📚', quote: '"시간 강사 5명 시급 계산 + 휴가 처리를 한 곳에서. 강사 헷갈리던 일도 사라졌고, 명세서가 깔끔해서 강사들도 만족합니다."',   who: '영어 학원 · 원장 최OO',       tagColor: 'bg-indigo-50 text-indigo-700' },
          ].map(r => (
            <div key={r.industry} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{r.emoji}</span>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${r.tagColor}`}>{r.industry}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed mb-3">{r.quote}</p>
              <p className="text-xs text-gray-400">— {r.who}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-gray-300 mt-4">* 일부 후기는 비공개 요청에 따라 사업장명·실명을 익명 처리했습니다.</p>
      </section>

      {/* 실제 서비스 화면 */}
      <section className="px-6 pb-16 max-w-3xl mx-auto">
        <p className="text-center text-xs font-bold text-green-600 uppercase tracking-widest mb-3">실제 서비스 화면</p>
        <h2 className="text-xl font-extrabold text-gray-800 text-center mb-2">사장님과 직원이 보는 화면</h2>
        <p className="text-center text-sm text-gray-500 mb-8">스마트폰 한 대만 있으면 출퇴근부터 급여 정산까지 끝납니다</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          {[
            { label: '키오스크 출퇴근', desc: '본인 카드 골라 원터치', image: '/landing/testimonial-cafe.png' },
            { label: 'GPS 위치 제한',   desc: '매장 반경 안에서만 가능', image: '/landing/testimonial-restaurant.png' },
            { label: '직원 마이페이지', desc: '내 근무·예상 급여 확인', image: '/landing/testimonial-convenience.png' },
            { label: '급여 명세서',     desc: '월별 자동 계산 + PDF',  image: '/landing/testimonial-salon.png' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center text-center">
              <div className="w-full rounded-[1.5rem] border-[5px] border-gray-800 bg-gray-800 overflow-hidden shadow-lg mb-3">
                <img
                  src={s.image}
                  alt={s.label}
                  loading="lazy"
                  className="w-full aspect-[9/19.5] object-cover bg-white"
                />
              </div>
              <div className="font-bold text-gray-800 text-sm">{s.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 도입 문의 폼 */}
      <section className="px-6 pb-16 max-w-2xl mx-auto" id="inquiry">
        <div className="text-center mb-6">
          <p className="text-xs font-bold text-green-600 uppercase tracking-widest mb-2">CONTACT</p>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-2">도입, 어렵지 않아요</h2>
          <p className="text-gray-500 text-sm">아직 고민 중이시라면, 지금 문의 남겨주세요. 영업일 1~2일 내 연락드립니다.</p>
        </div>
        <InquiryForm initialType={inquiryPlan} />

        {/* 카카오톡 오픈채팅 안내 */}
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-5 flex items-center gap-4">
          <span className="text-3xl shrink-0">💬</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-800 mb-0.5">카카오톡으로 즉시 문의</p>
            <p className="text-xs text-gray-500">오픈채팅으로 바로 대화 가능합니다</p>
          </div>
          <a
            href={KAKAO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-yellow-300 hover:bg-yellow-400 text-gray-900 font-bold px-4 py-2.5 rounded-xl text-sm transition shrink-0"
          >
            카톡 채팅 →
          </a>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-gray-100 px-6 py-8 max-w-3xl mx-auto">
        <p className="text-xs text-gray-400 text-center mb-3">⏱ 퍼펙트 근태관리 · 출퇴근 관리 서비스</p>
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mb-3">
          <button onClick={() => navigate('/legal/terms')} className="hover:text-gray-700 underline underline-offset-2 transition">이용약관</button>
          <span className="text-gray-200">|</span>
          <button onClick={() => navigate('/legal/privacy')} className="hover:text-gray-700 underline underline-offset-2 transition font-bold">개인정보처리방침</button>
          <span className="text-gray-200">|</span>
          <button onClick={() => navigate('/admin')} className="hover:text-gray-700 underline underline-offset-2 transition">운영자 콘솔</button>
        </div>
        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          주식회사 지누소프트 · 대표 김한중 · 사업자등록번호 716-87-01425<br/>
          경기도 성남시 분당구 운중로 124 804호 · khj873@jinusoft.com · 0505-170-3258
        </p>
      </footer>

      {/* 우하단 카카오톡 플로팅 (환경변수 있을 때만) */}
      <KakaoFloatButton />
    </div>
  )
}
