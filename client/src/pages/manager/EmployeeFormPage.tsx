import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchEmployees, createEmployee, updateEmployee, isPayEnabled, setPayEnabled } from '../../api'
import { useSlug } from '../../hooks/useSlug'

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
]

export default function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const slug = useSlug()

  const [name, setName] = useState('')
  const [hourlyRate, setHourlyRate] = useState(9860)
  const [color, setColor] = useState(COLORS[0])
  const [payEnabled, setPayEnabledState] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    fetchEmployees(slug).then((list) => {
      const emp = list.find((e) => e.id === Number(id))
      if (emp) {
        setName(emp.name); setHourlyRate(emp.hourly_rate); setColor(emp.color)
        setPayEnabledState(isPayEnabled(slug, emp.id))
      }
    })
  }, [id, isEdit, slug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('이름을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) {
        await updateEmployee(slug, Number(id), { name, hourly_rate: hourlyRate, color })
        setPayEnabled(slug, Number(id), payEnabled)
      } else {
        const created = await createEmployee(slug, { name, hourly_rate: hourlyRate, color })
        setPayEnabled(slug, created.id, payEnabled)
      }
      navigate(`/${slug}/manager`)
    } catch (e: any) { setError(e.message); setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/${slug}/manager`)} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h2 className="text-lg font-extrabold text-gray-800">{isEdit ? '직원 수정' : '직원 추가'}</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label className="text-sm font-semibold text-gray-600 mb-2 block">프로필 색상</label>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)}
                className="w-10 h-10 rounded-full transition border-4"
                style={{ background: c, borderColor: color === c ? '#111' : 'transparent' }} />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold text-xl"
            style={{ background: color }}>{name ? name[0] : '?'}</div>
          <div>
            <div className="font-bold text-gray-800">{name || '이름 미입력'}</div>
            <div className="text-xs text-gray-400">시급 {hourlyRate.toLocaleString()}원</div>
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold text-gray-600 mb-1.5 block">이름 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold text-gray-600">
              시급 (원) {payEnabled && '*'}
              <span className="text-xs text-gray-400 font-normal ml-2">2025 최저시급 9,860원</span>
            </label>
            <button
              type="button"
              onClick={() => setPayEnabledState(v => !v)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition ${
                payEnabled ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400'
              }`}
              aria-pressed={payEnabled}
            >
              <span className={`w-7 h-3.5 rounded-full relative transition-colors ${payEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${payEnabled ? 'left-4' : 'left-0.5'}`} />
              </span>
              급여계산 {payEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <input
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Number(e.target.value))}
            min={0}
            disabled={!payEnabled}
            className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              payEnabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          />
          {!payEnabled && (
            <p className="text-xs text-gray-400 mt-1.5">
              💡 이 직원은 근태만 기록되고 급여는 계산되지 않습니다 (무급·봉사·견습 등)
            </p>
          )}
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button type="submit" disabled={saving}
          className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-base hover:bg-blue-700 transition disabled:opacity-50 mt-2">
          {saving ? '저장 중...' : isEdit ? '수정 완료' : '직원 추가'}
        </button>
      </form>
    </div>
  )
}
