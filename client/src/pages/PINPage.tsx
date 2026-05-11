import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useManager } from '../context/ManagerContext'
import { useSlug } from '../hooks/useSlug'

export default function PINPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const { login } = useManager()
  const navigate = useNavigate()
  const slug = useSlug()

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
      <h2 className="text-xl font-extrabold text-gray-800 mb-2">관리자 PIN 입력</h2>
      <p className="text-sm text-gray-400 mb-8">관리자 전용 화면입니다</p>

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
    </div>
  )
}
