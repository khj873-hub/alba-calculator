import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBusiness, fetchAttendanceReport, planHasAttendanceReport, updateLeavePolicy } from '../../api'
import type { AttendanceReport } from '../../api'
import { useSlug } from '../../hooks/useSlug'

const TYPE_META = [
  { key: 'late' as const, label: '지각', color: 'text-amber-600' },
  { key: 'earlyLeave' as const, label: '조퇴', color: 'text-orange-600' },
  { key: 'absent' as const, label: '결근', color: 'text-red-600' },
  { key: 'missingClockOut' as const, label: '퇴근 누락', color: 'text-gray-600' },
]

export default function ManagerReportPage() {
  const navigate = useNavigate()
  const slug = useSlug()
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth() + 1)
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [gated, setGated] = useState(false)
  const [open, setOpen] = useState<string | null>(null) // `${empId}:${type}` 드릴다운
  const [graceInput, setGraceInput] = useState('0')
  const [graceSaving, setGraceSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const biz = await fetchBusiness(slug)
      if (!planHasAttendanceReport(biz.plan)) { setGated(true); return }
      setGated(false)
      const r = await fetchAttendanceReport(slug, year, month)
      setReport(r)
      setGraceInput(String(r.grace_minutes))
    } catch { /* 게이트/오류 */ } finally { setLoading(false) }
  }, [slug, year, month])

  const saveGrace = async () => {
    const v = Math.max(0, Math.min(120, Number(graceInput) || 0))
    setGraceSaving(true)
    try { await updateLeavePolicy(slug, { grace_minutes: v }); await load() }
    catch { /* noop */ } finally { setGraceSaving(false) }
  }

  useEffect(() => { load() }, [load])

  const prevMonth = () => { if (month === 1) { setYear(year - 1); setMonth(12) } else setMonth(month - 1) }
  const nextMonth = () => { if (month === 12) { setYear(year + 1); setMonth(1) } else setMonth(month + 1) }

  if (gated) {
    return (
      <div className="text-center bg-white rounded-2xl border border-gray-100 py-10 px-4 mt-4">
        <div className="text-3xl mb-2">🔒</div>
        <p className="text-sm font-semibold text-gray-700 mb-1">근태 리포트는 베이직 이상 플랜 기능이에요</p>
        <p className="text-xs text-gray-400 mb-4">지각·조퇴·결근·퇴근누락을 자동 집계합니다.</p>
        <button onClick={() => navigate('/?inquiry=' + encodeURIComponent('베이직 (직원 5명·월 9,900원)'))}
          className="text-sm font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg px-4 py-2 transition">
          플랜 업그레이드 문의
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-extrabold text-gray-800">근태 리포트</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">‹</button>
          <span className="text-sm font-bold text-gray-700 w-24 text-center">{year}.{String(month).padStart(2, '0')}</span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">›</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-20">불러오는 중...</div>
      ) : !report || report.employees.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-sm">집계할 직원이 없습니다</p>
          <p className="text-xs mt-2 text-gray-300">직원의 근무 스케줄을 등록하면 지각·조퇴가 집계됩니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
            <span>허용오차</span>
            <input type="number" min={0} max={120} value={graceInput} onChange={(e) => setGraceInput(e.target.value)}
              className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-gray-700" />
            <span>분</span>
            <button onClick={saveGrace} disabled={graceSaving || String(report.grace_minutes) === graceInput}
              className="text-blue-600 font-semibold disabled:text-gray-300">적용</button>
            <span>· 근무 스케줄 기준 자동 집계</span>
          </div>
          {report.employees.map((e) => (
            <div key={e.employee_id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="font-bold text-gray-800 mb-3">{e.name}</div>
              <div className="grid grid-cols-4 gap-2">
                {TYPE_META.map((t) => {
                  const count = e[t.key]
                  const key = `${e.employee_id}:${t.key}`
                  return (
                    <button
                      key={t.key}
                      onClick={() => setOpen(open === key ? null : (count > 0 ? key : null))}
                      className={`rounded-xl py-2 text-center transition ${count > 0 ? 'bg-gray-50 hover:bg-gray-100' : 'bg-gray-50/50'}`}
                    >
                      <div className="text-[11px] text-gray-400">{t.label}</div>
                      <div className={`text-lg font-extrabold ${count > 0 ? t.color : 'text-gray-300'}`}>{count}</div>
                    </button>
                  )
                })}
              </div>
              {TYPE_META.map((t) => {
                const key = `${e.employee_id}:${t.key}`
                if (open !== key) return null
                const days = e.dates[t.key]
                return (
                  <div key={t.key} className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-xs font-semibold text-gray-500 mb-1">{t.label} 일자</div>
                    <div className="flex flex-wrap gap-1.5">
                      {days.map((d) => (
                        <span key={d} className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-1">{d.slice(5)}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
