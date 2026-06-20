import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useManager } from '../context/ManagerContext'
import { useSlug } from '../hooks/useSlug'

export default function PINPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [oauthEnabled, setOauthEnabled] = useState(false)
  const [showPinHelp, setShowPinHelp] = useState(false)
  const [searchParams] = useSearchParams()
  const { login } = useManager()
  const navigate = useNavigate()
  const slug = useSlug()

  useEffect(() => {
    fetch('/api/auth/google/status').then(r => r.json()).then(d => setOauthEnabled(!!d.enabled)).catch(() => {})
  }, [])

  const unlinkedEmail = searchParams.get('email')
  const unlinkedHint = searchParams.get('oauth_unlinked') === '1' ? unlinkedEmail : null
  const oauthError = searchParams.get('oauth_error')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await login(slug, pin)
    if (ok) navigate(`/${slug}/manager`, { replace: true })
    else { setError('PIN이 올바르지 않습니다'); setPin('') }
  }

  const append = (v: string) => {
    if (pin.length >= 8) return
    setPin((p) => p + v)
    setError('')
  }

  const del = () => setPin((p) => p.slice(0, -1))

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 max-w-lg mx-auto">
      <button onClick={() => navigate(`/${slug}`)} className="self-start text-gray-400 text-sm mb-8">← 돌아가기</button>

      <div className="text-4xl mb-4">🔐</div>
      <h2 className="text-xl font-extrabold text-gray-800 mb-2">관리자 로그인</h2>
      <p className="text-sm text-gray-400 mb-6">관리자 전용 화면입니다</p>

      {oauthEnabled && (
        <div className="w-full max-w-xs mb-6">
          <button
            onClick={() => { window.location.href = `/api/auth/google/start?slug=${encodeURIComponent(slug)}` }}
            className="w-full bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 transition shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.2 6.2 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.2 6.2 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.3 5.3C41.4 35.1 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            구글로 로그인
          </button>
          {unlinkedHint && (
            <p className="mt-3 text-xs text-orange-600 bg-orange-50 rounded-lg p-2.5 leading-relaxed">
              <strong>{unlinkedHint}</strong> 계정이 이 사업장에 아직 연결되지 않았습니다. 운영자에게 연결 요청하거나, 아래에서 PIN으로 먼저 로그인 후 사업장 설정에서 구글 연결을 진행하세요.
            </p>
          )}
          {oauthError && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg p-2.5 leading-relaxed">
              구글 로그인 오류: {oauthError}
            </p>
          )}
          <div className="flex items-center gap-3 my-4 text-xs text-gray-400">
            <div className="flex-1 h-px bg-gray-200"></div>
            <span>또는 PIN으로 로그인</span>
            <div className="flex-1 h-px bg-gray-200"></div>
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6">
        {Array.from({ length: Math.max(pin.length + 1, 4) }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition ${i < pin.length ? 'bg-blue-600' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((v, i) => (
          <button
            key={i}
            onClick={() => v === '⌫' ? del() : v ? append(v) : null}
            disabled={!v && v !== '0'}
            className={`h-16 rounded-2xl text-xl font-bold transition ${
              v === '⌫'
                ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                : v
                ? 'bg-white border border-gray-100 shadow-sm text-gray-800 hover:bg-gray-50 active:scale-95'
                : 'invisible'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 w-full max-w-xs">
        <button
          type="submit"
          disabled={pin.length < 4}
          className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base hover:bg-blue-700 transition disabled:opacity-40"
        >
          확인
        </button>
      </form>

      {/* PIN 분실 안내 */}
      <div className="mt-5 w-full max-w-xs text-center">
        <button
          onClick={() => setShowPinHelp(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
        >
          PIN을 잊으셨나요?
        </button>
        {showPinHelp && (
          <div className="mt-3 text-xs text-gray-500 bg-gray-100 rounded-xl p-3.5 leading-relaxed text-left">
            {oauthEnabled && (
              <p className="mb-1.5">• <b>구글 계정을 연결</b>한 사업장이면 위 <b>"구글로 로그인"</b>으로 바로 들어갈 수 있어요.</p>
            )}
            <p>• PIN으로만 쓰던 사업장이면 <b>운영자에게 PIN 재발급</b>을 요청하세요.</p>
            <button
              onClick={() => navigate('/?inquiry=' + encodeURIComponent('기타 문의'))}
              className="mt-2.5 text-green-600 font-bold underline underline-offset-2"
            >
              PIN 재발급 문의하기 →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
