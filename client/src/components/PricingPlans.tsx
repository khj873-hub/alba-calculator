// 요금제 카드 (랜딩·새 사업장 등록 페이지 공용)
// onFree: 무료 카드 버튼 동작 / onInquire: 유료 카드 '문의하기' 동작(관심 플랜 라벨 전달)
const PLANS = [
  { name: '무료', price: '0원', cap: '활성 직원 3명', highlight: false, inquiryType: '',
    feats: ['출퇴근 기록', '급여·주휴수당 자동 계산'], note: '구글 로그인으로 바로 시작', cta: '무료로 시작하기' },
  { name: '베이직', price: '월 9,900원', cap: '활성 직원 5명', highlight: true, inquiryType: '베이직 (직원 5명·월 9,900원)',
    feats: ['무료 기능 전체', '출퇴근 SMS·카카오 알림', 'GPS 위치 제한', '급여명세서 PDF·CSV 출력'], note: '가장 인기', cta: '베이직 문의하기' },
  { name: '프로', price: '월 29,900원', cap: '활성 직원 20명', highlight: false, inquiryType: '프로 (직원 20명·월 29,900원)',
    feats: ['베이직 기능 전체', '직원 20명까지'], note: '규모 있는 매장', cta: '프로 문의하기' },
  { name: '엔터프라이즈', price: '별도 문의', cap: '직원 무제한', highlight: false, inquiryType: '엔터프라이즈 (무제한)',
    feats: ['프로 기능 전체', '직원 수 제한 없음'], note: '다점포·대형 사업장', cta: '엔터프라이즈 문의하기' },
]

// onFree 미전달 시 무료 카드 버튼을 숨긴다(예: 이미 가입 화면인 /create).
export default function PricingPlans({ onFree, onInquire }: { onFree?: () => void; onInquire: (type: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {PLANS.map(p => (
        <div key={p.name} className={`rounded-2xl border p-5 ${p.highlight ? 'border-green-300 bg-green-50/50 shadow-sm' : 'border-gray-100 bg-white'}`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-gray-800">{p.name}</span>
              {p.highlight && <span className="text-[10px] font-bold bg-green-500 text-white px-2 py-0.5 rounded-full">{p.note}</span>}
            </div>
            <span className="font-extrabold text-gray-900">{p.price}</span>
          </div>
          <div className="text-xs text-gray-500 mb-3">{p.cap}{!p.highlight && p.note ? ` · ${p.note}` : ''}</div>
          <ul className="flex flex-col gap-1.5 mb-4">
            {p.feats.map(f => (
              <li key={f} className="text-sm text-gray-600 flex items-center gap-2">
                <span className="text-green-500 font-bold">✓</span>{f}
              </li>
            ))}
          </ul>
          {p.inquiryType ? (
            <button
              onClick={() => onInquire(p.inquiryType)}
              className={`w-full py-3 rounded-xl font-bold text-sm transition ${
                p.highlight
                  ? 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-200'
                  : 'bg-white border border-green-300 text-green-700 hover:bg-green-50'
              }`}
            >
              {p.cta} →
            </button>
          ) : onFree ? (
            <button
              onClick={onFree}
              className="w-full py-3 rounded-xl font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
            >
              {p.cta} →
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
