import { useState, useEffect } from 'react'
import { fetchEmployees, fetchAttendance, deleteAttendance, updateAttendance } from '../../api'
import { useSlug } from '../../hooks/useSlug'
import type { Employee, AttendanceRecord } from '../../types'

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function calcMins(clockIn: string, clockOut: string | null) {
  if (!clockOut) return null
  return Math.floor((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000)
}

export default function AttendancePage() {
  const now = new Date()
  const slug = useSlug()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [empId, setEmpId] = useState<number | ''>('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [editIn, setEditIn] = useState('')
  const [editOut, setEditOut] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchEmployees(slug).then(setEmployees) }, [slug])

  const load = () => fetchAttendance(slug, year, month, empId || undefined).then(setRecords)
  useEffect(() => { load() }, [slug, year, month, empId])

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return
    try { await deleteAttendance(slug, id); await load() }
    catch (e: any) { setError(e.message) }
  }

  const startEdit = (r: AttendanceRecord) => {
    setEditId(r.id)
    setEditIn(r.clock_in.slice(0, 16))
    setEditOut(r.clock_out ? r.clock_out.slice(0, 16) : '')
  }

  const saveEdit = async () => {
    if (!editId) return
    setSaving(true)
    try {
      await updateAttendance(slug, editId, {
        clock_in: editIn.replace('T', ' ') + ':00',
        clock_out: editOut ? editOut.replace('T', ' ') + ':00' : undefined,
      })
      setEditId(null)
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const totalMins = records.reduce((s, r) => s + (calcMins(r.clock_in, r.clock_out) ?? 0), 0)

  const grouped = records.reduce((acc, r) => {
    const date = r.clock_in.slice(0, 10)
    if (!acc[date]) acc[date] = []
    acc[date].push(r)
    return acc
  }, {} as Record<string, AttendanceRecord[]>)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">←</button>
        <span className="font-extrabold text-gray-800">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">→</button>
      </div>

      <select
        value={empId}
        onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : '')}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-400"
      >
        <option value="">전체 직원</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-green-700">총 근무시간</span>
        <span className="text-lg font-extrabold text-green-700">{fmtDuration(totalMins)}</span>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">근태 기록이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([date, recs]) => {
            const dayMins = recs.reduce((s, r) => s + (calcMins(r.clock_in, r.clock_out) ?? 0), 0)
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-500">{date} ({['일','월','화','수','목','금','토'][new Date(date).getDay()]})</span>
                  <span className="text-xs font-semibold text-green-600">{fmtDuration(dayMins)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {recs.map((r) => {
                    const mins = calcMins(r.clock_in, r.clock_out)
                    return (
                      <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                        {editId === r.id ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2 items-center text-xs text-gray-500">
                              <span>출근</span>
                              <input type="datetime-local" value={editIn} onChange={(e) => setEditIn(e.target.value)}
                                className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                            </div>
                            <div className="flex gap-2 items-center text-xs text-gray-500">
                              <span>퇴근</span>
                              <input type="datetime-local" value={editOut} onChange={(e) => setEditOut(e.target.value)}
                                className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={saveEdit} disabled={saving}
                                className="flex-1 bg-green-500 text-white text-xs font-bold py-1.5 rounded-lg">저장</button>
                              <button onClick={() => setEditId(null)}
                                className="flex-1 bg-gray-100 text-gray-600 text-xs font-bold py-1.5 rounded-lg">취소</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {r.color && (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ background: r.color }}>{r.employee_name?.[0]}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              {r.employee_name && <div className="text-xs font-semibold text-gray-700 mb-0.5">{r.employee_name}</div>}
                              <div className="text-xs text-gray-500">
                                {r.clock_in.slice(11, 16)} ~ {r.clock_out ? r.clock_out.slice(11, 16) : '근무 중'}
                                {mins !== null && <span className="ml-2 font-semibold text-green-600">{fmtDuration(mins)}</span>}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => startEdit(r)} className="text-gray-300 hover:text-gray-500 p-1">✏️</button>
                              <button onClick={() => handleDelete(r.id)} className="text-gray-300 hover:text-red-400 p-1">🗑</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
