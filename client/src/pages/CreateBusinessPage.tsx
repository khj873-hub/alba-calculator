import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBusiness } from '../api'

export default function CreateBusinessPage() {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('사업장명을 입력하세요'); return }
    if (pin.length < 4) { setError('PIN은 4자리 이상이어야 합니다'); return }
    if (pin !== pinConfirm) { setError('PIN이 일치하지 않습니다'); return }
    setSaving(true); setError('')
    try {
      const { slug } = await createBusiness({ name: name.trim(), manager_pin: pin })
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
      <p className="text-sm text-gray-400 mb-8">등록 후 고유 코드가 발급됩니다</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
    </div>
  )
}
