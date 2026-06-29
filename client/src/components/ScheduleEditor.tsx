import { useState, useEffect } from 'react'
import { fetchSchedule, saveSchedule } from '../api'
import type { ScheduleDay } from '../api'

const WD = ['일', '월', '화', '수', '목', '금', '토'] // weekday 0~6

interface Day { weekday: number; start_time: string; end_time: string; is_off: boolean }

// 요일 7행 근무 스케줄 편집기 (tech-critic 조건: 7행 그리드 + "전 요일 동일" 헬퍼만)
export default function ScheduleEditor({ slug, employeeId, employeeName, onClose }: {
  slug: string; employeeId: number; employeeName: string; onClose: (saved: boolean) => void
}) {
  const [days, setDays] = useState<Day[]>(
    // 기본은 '근무'(미체크) — 대부분 근무일이라 쉬는 요일만 휴무 체크하면 됨
    Array.from({ length: 7 }, (_, i) => ({ weekday: i, start_time: '09:00', end_time: '18:00', is_off: false }))
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchSchedule(slug, employeeId)
      .then((rows: ScheduleDay[]) => {
        setDays((prev) => prev.map((d) => {
          const f = rows.find((r) => r.weekday === d.weekday)
          return f ? { weekday: d.weekday, start_time: f.start_time || '09:00', end_time: f.end_time || '18:00', is_off: !!f.is_off } : d
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug, employeeId])

  const setDay = (wd: number, patch: Partial<Day>) => setDays((ds) => ds.map((d) => d.weekday === wd ? { ...d, ...patch } : d))
  const applyAll = () => {
    const first = days.find((d) => !d.is_off)
    if (!first) return
    setDays((ds) => ds.map((d) => ({ ...d, start_time: first.start_time, end_time: first.end_time, is_off: false })))
  }
  const save = async () => {
    setSaving(true); setErr('')
    try {
      await saveSchedule(slug, employeeId, days)
      onClose(true)
    } catch (e) { setErr(e instanceof Error ? e.message : '저장에 실패했습니다') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="mt-3 pt-3 border-t border-gray-100 py-4 text-center text-gray-400 text-sm">불러오는 중...</div>

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-600">🗓 {employeeName} 근무 스케줄</span>
        <button onClick={applyAll} className="text-xs text-blue-600 hover:underline">전 요일 동일 적용</button>
      </div>
      <div className="flex flex-col gap-1.5">
        {days.map((d) => (
          <div key={d.weekday} className="flex items-center gap-2">
            <span className="w-5 text-xs font-bold text-gray-500">{WD[d.weekday]}</span>
            <label className="flex items-center gap-1 text-xs text-gray-400 select-none">
              <input type="checkbox" checked={d.is_off} onChange={(e) => setDay(d.weekday, { is_off: e.target.checked })} />휴무
            </label>
            {!d.is_off && (
              <>
                <input type="time" value={d.start_time} onChange={(e) => setDay(d.weekday, { start_time: e.target.value })}
                  className="text-xs border border-gray-200 rounded px-1.5 py-1" />
                <span className="text-xs text-gray-300">~</span>
                <input type="time" value={d.end_time} onChange={(e) => setDay(d.weekday, { end_time: e.target.value })}
                  className="text-xs border border-gray-200 rounded px-1.5 py-1" />
              </>
            )}
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={() => onClose(false)} className="flex-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg py-2 transition">닫기</button>
        <button onClick={save} disabled={saving} className="flex-1 text-xs font-bold text-white bg-green-500 hover:bg-green-600 rounded-lg py-2 disabled:opacity-50 transition">{saving ? '저장 중...' : '저장'}</button>
      </div>
    </div>
  )
}
