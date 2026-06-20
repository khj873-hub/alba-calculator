import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchEmployees, createEmployee, updateEmployee, PlanLimitError, upgradePlanSummary } from '../../api'
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
  const [hourlyRateInput, setHourlyRateInput] = useState('10320')
  const hourlyRate = parseInt(hourlyRateInput, 10) || 0
  const [color, setColor] = useState(COLORS[0])
  const [payEnabled, setPayEnabledState] = useState(true)
  const [payIncludesHoliday, setPayIncludesHoliday] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [planLimit, setPlanLimit] = useState<PlanLimitError | null>(null)

  // 주휴 환산 별도 시급 (포함 시급 ÷ 1.2, 주 40h 기준)
  const equivalentBase = payIncludesHoliday && hourlyRate > 0 ? Math.floor(hourlyRate / 1.2) : 0
  const equivalentBelowMin = payIncludesHoliday && equivalentBase > 0 && equivalentBase < 10320

  useEffect(() => {
    if (!isEdit) return
    fetchEmployees(slug).then((list) => {
      const emp = list.find((e) => e.id === Number(id))
      if (emp) {
        setName(emp.name); setHourlyRateInput(String(emp.hourly_rate)); setColor(emp.color)
        setPayEnabledState(emp.pay_enabled === 1)
        setPayIncludesHoliday(emp.pay_includes_holiday === 1)
      }
    })
  }, [id, isEdit, slug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('이름을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      if (isEdit) {
        await updateEmployee(slug, Number(id), { name, hourly_rate: hourlyRate, color, pay_enabled: payEnabled, pay_includes_holiday: payIncludesHoliday })
      } else {
        await createEmployee(slug, { name, hourly_rate: hourlyRate, color, pay_enabled: payEnabled, pay_includes_holiday: payIncludesHoliday })
      }
      navigate(`/${slug}/manager`)
    } catch (e: any) {
      if (e instanceof PlanLimitError) { setPlanLimit(e); setSaving(false); return }
      setError(e.message); setSaving(false)
    }
  }

  return (
    <div>
      {planLimit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPlanLimit(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-3xl mb-3">🚀</div>
            <h3 className="font-extrabold text-gray-800 text-lg mb-2">플랜 한도에 도달했어요</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              현재 플랜은 활성 직원 <b>{planLimit.limit}명</b>까지예요 (현재 {planLimit.active}명).
              더 등록하려면 아래 중 하나를 선택하세요.
            </p>
            <ul className="text-sm text-gray-600 list-disc pl-5 mb-3 space-y-1">
              <li>그만둔 직원을 <b>퇴사 처리</b>하면 자리가 비어 바로 등록할 수 있어요.</li>
              <li>직원이 더 필요하면 <b>플랜 업그레이드</b>를 문의하세요.</li>
            </ul>
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-5">{upgradePlanSummary()}</p>
            <div className="flex flex-col gap-2">
              <a href="https://pf.kakao.com/_xdwVxjX" target="_blank" rel="noopener noreferrer"
                className="w-full text-center py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition">
                플랜 업그레이드 문의
              </a>
              <button onClick={() => { setPlanLimit(null); navigate(`/${slug}/manager`) }}
                className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-semibold text-sm hover:bg-gray-200 transition">
                직원 목록에서 퇴사 처리하기
              </button>
            </div>
          </div>
        </div>
      )}
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
            <div className="text-xs text-gray-400">
              시급 {hourlyRate.toLocaleString()}원
              {payIncludesHoliday && <span className="ml-1 text-emerald-600 font-bold">(주휴 포함)</span>}
            </div>
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
              <span className="text-xs text-gray-400 font-normal ml-2">2026 최저시급 10,320원</span>
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
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={hourlyRateInput}
            onChange={(e) => setHourlyRateInput(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => { if (!hourlyRateInput) setHourlyRateInput('0') }}
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

          {payEnabled && (
            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-700">주휴수당을 시급에 포함</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    시급에 주휴분이 이미 녹아있는 포괄임금형. 매주 별도 주휴수당 자동 산정이 꺼집니다.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPayIncludesHoliday(v => !v)}
                  aria-pressed={payIncludesHoliday}
                  className="flex-shrink-0"
                >
                  <span className={`block w-11 h-6 rounded-full relative transition-colors ${payIncludesHoliday ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${payIncludesHoliday ? 'left-[22px]' : 'left-0.5'}`} />
                  </span>
                </button>
              </div>
              {payIncludesHoliday && hourlyRate > 0 && (
                <div className={`mt-2.5 text-xs px-2.5 py-2 rounded-lg leading-relaxed ${equivalentBelowMin ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <div>
                    주휴 환산 별도 시급 ≈ <b>{equivalentBase.toLocaleString()}원</b>
                    <span className="text-[10px] text-gray-500 ml-1">(포함 시급 ÷ 1.2 · 주 40h 기준)</span>
                  </div>
                  {equivalentBelowMin && (
                    <div className="mt-1 font-bold">⚠️ 주휴 환산 시급이 2026 최저(10,320원) 미달입니다. 포함 시급은 최소 12,384원 이상 권장.</div>
                  )}
                </div>
              )}
              {payIncludesHoliday && (
                <div className="mt-2 text-[11px] text-gray-400 leading-relaxed">
                  💡 근로계약서에 "시급 ××원 (주휴수당 포함)" 명시가 합법 운영의 전제입니다.
                </div>
              )}
            </div>
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
