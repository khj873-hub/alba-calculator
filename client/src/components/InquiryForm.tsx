import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { submitInquiry } from '../api'

const SOURCES = [
  '네이버 검색',
  '구글 검색',
  '카카오톡·블로그',
  '인스타그램·페이스북',
  '지인 추천',
  '기타',
]

// 문의 유형 — 운영자가 어떤 문의(관심 플랜)인지 바로 구분할 수 있게
const INQUIRY_TYPES = [
  '단순 도입 문의',
  '베이직 (직원 5명·월 9,900원)',
  '프로 (직원 20명·월 29,900원)',
  '엔터프라이즈 (무제한)',
  '기타 문의',
]

export default function InquiryForm() {
  const navigate = useNavigate()
  const [source, setSource] = useState('')
  const [inquiryType, setInquiryType] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [content, setContent] = useState('')
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const [agreedMarketing, setAgreedMarketing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!businessName.trim()) { setError('사업장명을 입력해주세요'); return }
    if (!phone.trim()) { setError('휴대폰 번호를 입력해주세요'); return }
    if (!/^[0-9\-+\s()]{9,20}$/.test(phone.trim())) { setError('휴대폰 번호 형식이 올바르지 않습니다'); return }
    if (!agreedPrivacy) { setError('개인정보 수집·이용 동의가 필요합니다'); return }

    setSaving(true)
    try {
      await submitInquiry({
        source: source || null,
        inquiry_type: inquiryType || null,
        business_name: businessName.trim(),
        phone: phone.trim(),
        content: content.trim() || null,
        agreed_privacy: true,
        agreed_marketing: agreedMarketing,
      })
      setSuccess(true)
    } catch (e: any) {
      setError(e?.message || '문의 접수 실패. 잠시 후 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-8 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h3 className="text-lg font-extrabold text-gray-800 mb-2">문의가 접수됐어요!</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          영업일 기준 1~2일 내<br/>
          입력해주신 번호로 연락드리겠습니다.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-extrabold text-gray-800 mb-1">도입 문의하기</h3>
        <p className="text-xs text-gray-500">아직 고민 중이시라면, 지금 문의 남겨주세요</p>
      </div>

      {/* 문의 유형 */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-gray-600 mb-1.5">문의 유형</label>
        <select
          value={inquiryType}
          onChange={e => setInquiryType(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
        >
          <option value="">선택해주세요 (선택)</option>
          {INQUIRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">유료 플랜이 궁금하시면 관심 플랜을 선택해주세요.</p>
      </div>

      {/* 도입 경로 */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-gray-600 mb-1.5">도입 경로</label>
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
        >
          <option value="">선택해주세요 (선택)</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* 사업장명 */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-gray-600 mb-1.5">사업장명 <span className="text-red-500">*</span></label>
        <input
          value={businessName}
          onChange={e => setBusinessName(e.target.value)}
          placeholder="예: 강남 디저트카페"
          maxLength={80}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
      </div>

      {/* 휴대폰 */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-gray-600 mb-1.5">휴대폰 번호 <span className="text-red-500">*</span></label>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="010-1234-5678"
          inputMode="tel"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
      </div>

      {/* 문의 내용 */}
      <div className="mb-5">
        <label className="block text-xs font-bold text-gray-600 mb-1.5">문의 내용</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="궁금한 점을 자유롭게 입력해주세요"
          rows={4}
          maxLength={2000}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
        />
      </div>

      {/* 약관 동의 */}
      <div className="space-y-2 mb-5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedPrivacy}
            onChange={e => setAgreedPrivacy(e.target.checked)}
            className="mt-0.5 accent-green-500"
          />
          <span className="text-xs text-gray-700 leading-relaxed">
            <span className="text-red-500 font-bold">(필수)</span>{' '}
            <button
              type="button"
              onClick={() => navigate('/legal/privacy')}
              className="underline underline-offset-2 hover:text-gray-900"
            >개인정보 수집·이용</button>에 동의합니다
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedMarketing}
            onChange={e => setAgreedMarketing(e.target.checked)}
            className="mt-0.5 accent-green-500"
          />
          <span className="text-xs text-gray-700 leading-relaxed">
            <span className="text-gray-500">(선택)</span> 마케팅 목적의 개인정보 수집·이용에 동의합니다
          </span>
        </label>
      </div>

      {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-green-500 text-white font-extrabold py-3.5 rounded-2xl text-sm hover:bg-green-600 transition disabled:opacity-50"
      >
        {saving ? '전송 중...' : '문의 보내기'}
      </button>
    </form>
  )
}
