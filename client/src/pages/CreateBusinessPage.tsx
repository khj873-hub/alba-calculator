import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBusiness } from '../api'
import PricingPlans from '../components/PricingPlans'

const KAKAO_URL = 'https://pf.kakao.com/_xdwVxjX'

export default function CreateBusinessPage() {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 구글 신원확인 후 콜백으로 전달되는 1회용 토큰 + 검증된 이메일
  const [signupToken, setSignupToken] = useState('')
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const navigate = useNavigate()

  // 구글 콜백 복귀 시 #signup=...&email=... 해시 파싱
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash) return
    const params = new URLSearchParams(hash)
    const token = params.get('signup')
    if (token) {
      setSignupToken(token)
      setVerifiedEmail(params.get('email') || '')
      // 토큰을 URL/히스토리에 남기지 않도록 해시 제거
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const startGoogle = () => {
    window.location.href = '/api/auth/google/start?signup=1'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('사업장명을 입력하세요'); return }
    if (pin.length < 4) { setError('PIN은 4자리 이상이어야 합니다'); return }
    if (pin !== pinConfirm) { setError('PIN이 일치하지 않습니다'); return }
    setSaving(true); setError('')
    try {
      const { slug } = await createBusiness({ name: name.trim(), manager_pin: pin, signup_token: signupToken })
      navigate(`/${slug}/manager`, { replace: true })
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col px-6 max-w-lg mx-auto py-12">
      <button onClick={() => navigate('/')} className="text-gray-400 text-sm mb-8 self-start">← 돌아가기</button>

      <h1 className="text-2xl font-extrabold text-gray-800 mb-1">새 사업장 등록</h1>
      <p className="text-sm text-gray-400 mb-8">
        {signupToken ? '구글 본인 확인 완료 — 사업장 정보를 입력하세요' : '구글 계정으로 본인 확인 후 등록합니다'}
      </p>

      {!signupToken ? (
        // 1단계: 구글 본인 확인
        <div className="flex flex-col gap-4">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-gray-600 leading-relaxed">
            사업장은 <b>구글 계정</b>으로 본인 확인 후 만들 수 있어요.
            <ul className="list-disc pl-5 mt-2 text-xs text-gray-500 space-y-1">
              <li>PIN 분실 시 구글 로그인으로 바로 복구돼요</li>
              <li>관리자 PIN은 본인 확인 후 함께 설정합니다(매장·키오스크용)</li>
            </ul>
          </div>
          <button
            onClick={startGoogle}
            className="w-full bg-white border border-gray-300 text-gray-700 font-bold py-4 rounded-2xl text-base hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <span className="text-lg">🟦</span> 구글로 사업장 만들기
          </button>
        </div>
      ) : (
        // 2단계: 사업장명 + PIN
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {verifiedEmail && (
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-2.5 text-xs text-green-700 font-semibold">
              ✓ {verifiedEmail} 본인 확인됨 (이 계정이 사업장 소유자가 됩니다)
            </div>
          )}
          <div>
            <label className="text-sm font-semibold text-gray-600 mb-1.5 block">사업장명 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 홍길동 편의점"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-600 mb-1.5 block">관리자 PIN *</label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="4자리 이상 숫자"
              maxLength={8}
              inputMode="numeric"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-gray-400 mt-1">매장 단말·일상 로그인용. 분실 시 구글 로그인으로 복구돼요.</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-600 mb-1.5 block">PIN 확인 *</label>
            <input
              type="password"
              value={pinConfirm}
              onChange={e => setPinConfirm(e.target.value)}
              placeholder="PIN 재입력"
              maxLength={8}
              inputMode="numeric"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base hover:bg-blue-700 transition disabled:opacity-50 mt-2"
          >
            {saving ? '등록 중...' : '사업장 등록하기'}
          </button>
        </form>
      )}

      {/* 요금제 안내 */}
      <div className="mt-10 pt-8 border-t border-gray-100">
        <h2 className="text-lg font-extrabold text-gray-800 text-center mb-1">요금제 안내</h2>
        <p className="text-sm text-gray-400 text-center mb-6">무료로 시작하고, 필요할 때 업그레이드하세요</p>
        <PricingPlans
          onFree={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          onInquire={() => window.open(KAKAO_URL, '_blank', 'noopener,noreferrer')}
        />
        <p className="text-xs text-gray-400 mt-5 text-center">
          유료 플랜은 문의 주시면 운영자가 빠르게 설정해드려요. 무료로 먼저 시작 후 언제든 업그레이드 가능합니다.
        </p>
      </div>
    </div>
  )
}
