import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBusiness } from '../api'

export default function LandingPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 max-w-lg mx-auto">
      <div className="text-5xl mb-4">⏱</div>
      <h1 className="text-2xl font-extrabold text-gray-800 mb-1">급여 계산기</h1>
      <p className="text-sm text-gray-400 mb-10">출퇴근 기록부터 급여 명세서까지</p>

      <form onSubmit={handleEnter} className="w-full mb-6">
        <label className="text-xs font-semibold text-gray-500 mb-2 block">사업장 코드로 입장</label>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => { setCode(e.target.value); setError('') }}
            placeholder="예: abc123"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          <button type="submit" disabled={loading}
            className="bg-green-500 text-white font-bold px-5 py-3 rounded-xl hover:bg-green-600 transition disabled:opacity-50">
            {loading ? '확인 중...' : '입장'}
          </button>
        </div>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </form>

      <div className="flex items-center gap-3 w-full mb-6">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-xs text-gray-400">또는</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      <button
        onClick={() => navigate('/create')}
        className="w-full border-2 border-blue-600 text-blue-600 font-bold py-4 rounded-2xl text-base hover:bg-blue-50 transition"
      >
        + 새 사업장 등록하기
      </button>

      <button
        onClick={() => navigate('/businesses')}
        className="mt-4 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition"
      >
        사업장 전체 목록 보기
      </button>
    </div>
  )
}
