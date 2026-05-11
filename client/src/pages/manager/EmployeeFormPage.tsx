import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchEmployees, createEmployee, updateEmployee } from '../../api'
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    fetchEmployees(slug).then((list) => {
      const emp = list.find((e) => e.id === Number(id))
      if (emp) { setName(emp.name); setHourlyRate(emp.hourly_rate); setColor(emp.color) }
    })
  }, [id, isEdit, slug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('이름을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) await updateEmployee(slug, Number(id), { name, hourly_rate: hourlyRate, color })
      else await createEmployee(slug, { name, hourly_rate: hourlyRate, color })
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
          <label className="text-sm font-semibold text-gray-600 mb-1.5 block">
            시급 (원) *
            <span className="text-xs text-gray-400 font-normal ml-2">2025 최저시급 9,860원</span>
          </label>
          <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} min={0}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
