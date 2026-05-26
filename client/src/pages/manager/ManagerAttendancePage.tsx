import { useState, useEffect } from 'react'
import { fetchEmployees, fetchAttendance, deleteAttendance, updateAttendance, fetchTimeOff, createTimeOff, deleteTimeOff, fetchBusiness } from '../../api'
import { useSlug } from '../../hooks/useSlug'
import type { Employee, AttendanceRecord, TimeOffRecord, LeaveType, HalfPeriod, AttendanceSegment } from '../../types'
import { splitByMidnight } from '../../utils/segments'

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function calcMins(clockIn: string, clockOut: string | null) {
  if (!clockOut) return null
  return Math.floor((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000)
}

// 서버가 segments를 못 채워 보낸 (구버전 호환) 경우 클라이언트가 fallback 분할
function segmentsOf(r: AttendanceRecord): AttendanceSegment[] {
  if (r.segments && r.segments.length > 0) return r.segments
  if (!r.clock_out) return []
  return splitByMidnight(r.clock_in, r.clock_out)
}

const LEAVE_TYPE_LABELS: Record<LeaveType, { label: string; color: string; bg: string }> = {
  annual: { label: '연차', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  unpaid: { label: '무급', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300' },
  sick: { label: '병가', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  family: { label: '경조', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
}

function todayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

interface TimeOffModalProps {
  slug: string
  employees: Employee[]
  onClose: () => void
  onSaved: () => void
}

function TimeOffModal({ slug, employees, onClose, onSaved }: TimeOffModalProps) {
  const [empId, setEmpId] = useState<number | ''>(employees[0]?.id ?? '')
  const [date, setDate] = useState(todayKST())
  const [type, setType] = useState<LeaveType>('annual')
  const [portion, setPortion] = useState<1.0 | 0.5>(1.0)
  const [halfPeriod, setHalfPeriod] = useState<HalfPeriod>('am')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!empId) { setError('직원을 선택하세요'); return }
    setSaving(true); setError('')
    try {
      await createTimeOff(slug, {
        employee_id: Number(empId),
        date,
        type,
        portion,
        half_period: portion === 0.5 ? halfPeriod : null,
        memo: memo.trim() || undefined,
      })
      onSaved()
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-gray-800">🏖 휴가 추가</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">직원</label>
          <select value={empId} onChange={e => setEmpId(e.target.value ? Number(e.target.value) : '')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
            {employees.length === 0 && <option value="">직원이 없습니다</option>}
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">날짜</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">유형</label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map(t => {
              const meta = LEAVE_TYPE_LABELS[t]
              const active = type === t
              return (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`py-2 rounded-xl border text-xs font-bold transition ${active ? meta.bg + ' ' + meta.color : 'bg-white border-gray-200 text-gray-400'}`}>
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">단위</label>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setPortion(1.0)}
              className={`py-2 rounded-xl border text-xs font-bold transition ${portion === 1.0 ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-400'}`}>
              하루
            </button>
            <button type="button" onClick={() => { setPortion(0.5); setHalfPeriod('am') }}
              className={`py-2 rounded-xl border text-xs font-bold transition ${portion === 0.5 && halfPeriod === 'am' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-400'}`}>
              오전 반차
            </button>
            <button type="button" onClick={() => { setPortion(0.5); setHalfPeriod('pm') }}
              className={`py-2 rounded-xl border text-xs font-bold transition ${portion === 0.5 && halfPeriod === 'pm' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-400'}`}>
              오후 반차
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">메모 (선택)</label>
          <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 가족 행사"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>

        {error && <div className="bg-red-50 text-red-600 text-xs rounded-xl px-3 py-2">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm">취소</button>
          <button onClick={handleSave} disabled={saving || !empId} className="flex-1 py-3 rounded-xl bg-green-500 text-white font-bold text-sm disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AttendancePage() {
  const now = new Date()
  const slug = useSlug()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [empId, setEmpId] = useState<number | ''>('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [timeOffs, setTimeOffs] = useState<TimeOffRecord[]>([])
  const [timeOffEnabled, setTimeOffEnabled] = useState<boolean>(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editIn, setEditIn] = useState('')
  const [editOut, setEditOut] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => { fetchEmployees(slug).then(setEmployees) }, [slug])
  useEffect(() => { fetchBusiness(slug).then(b => setTimeOffEnabled((b.time_off_enabled ?? 0) === 1)).catch(() => {}) }, [slug])

  const load = async () => {
    const tasks: Promise<any>[] = [fetchAttendance(slug, year, month, empId || undefined)]
    if (timeOffEnabled) tasks.push(fetchTimeOff(slug, year, month, empId || undefined))
    const results = await Promise.all(tasks)
    setRecords(results[0])
    setTimeOffs(timeOffEnabled ? results[1] : [])
  }
  useEffect(() => { load() }, [slug, year, month, empId, timeOffEnabled])

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return
    try { await deleteAttendance(slug, id); await load() }
    catch (e: any) { setError(e.message) }
  }

  const handleDeleteTimeOff = async (id: number) => {
    if (!confirm('이 휴가 기록을 삭제할까요?')) return
    try { await deleteTimeOff(slug, id); await load() }
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

  // 모든 record를 segments로 펼침. 진행 중 근무(clock_out=null)는 segment 없이 별도 처리
  const expanded: Array<{ record: AttendanceRecord; seg: AttendanceSegment | null }> = []
  for (const r of records) {
    if (!r.clock_out) {
      expanded.push({ record: r, seg: null })
    } else {
      for (const s of segmentsOf(r)) expanded.push({ record: r, seg: s })
    }
  }
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`

  const totalMins = expanded.reduce((s, x) => {
    if (x.seg) return s + (x.seg.date.startsWith(monthPrefix) ? x.seg.mins : 0)
    return s + (calcMins(x.record.clock_in, x.record.clock_out) ?? 0)
  }, 0)

  // 날짜별 그룹 — segment 기준
  const allDates = new Set<string>()
  for (const x of expanded) {
    const d = x.seg ? x.seg.date : x.record.clock_in.slice(0, 10)
    if (d.startsWith(monthPrefix)) allDates.add(d)
  }
  for (const t of timeOffs) allDates.add(t.date)
  const sortedDates = Array.from(allDates).sort().reverse()

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">←</button>
        <span className="font-extrabold text-gray-800">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">→</button>
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={empId}
          onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : '')}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        >
          <option value="">전체 직원</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {timeOffEnabled && (
          <button
            onClick={() => setShowModal(true)}
            disabled={employees.length === 0}
            className="bg-emerald-500 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-emerald-600 transition disabled:opacity-50 shrink-0"
          >
            🏖 휴가
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-green-700">총 근무시간</span>
        <span className="text-lg font-extrabold text-green-700">{fmtDuration(totalMins)}</span>
      </div>

      {timeOffs.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-emerald-700">🏖 휴가 사용</span>
          <span className="text-lg font-extrabold text-emerald-700">
            {timeOffs.reduce((s, t) => s + t.portion, 0)}일
          </span>
        </div>
      )}

      {sortedDates.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">근태 기록이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedDates.map((date) => {
            const dayItems = expanded.filter(x => (x.seg ? x.seg.date : x.record.clock_in.slice(0, 10)) === date)
            const tos = timeOffs.filter(t => t.date === date)
            const dayMins = dayItems.reduce((s, x) => s + (x.seg ? x.seg.mins : (calcMins(x.record.clock_in, x.record.clock_out) ?? 0)), 0)
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-500">{date} ({['일','월','화','수','목','금','토'][new Date(date).getDay()]})</span>
                  {dayMins > 0 && <span className="text-xs font-semibold text-green-600">{fmtDuration(dayMins)}</span>}
                </div>
                <div className="flex flex-col gap-2">
                  {tos.map(t => {
                    const meta = LEAVE_TYPE_LABELS[t.type]
                    return (
                      <div key={`t${t.id}`} className={`rounded-xl border p-3 shadow-sm flex items-center gap-3 ${meta.bg}`}>
                        {t.color && (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ background: t.color }}>{t.employee_name?.[0]}</div>
                        )}
                        <div className="flex-1 min-w-0">
                          {t.employee_name && <div className="text-xs font-semibold text-gray-700 mb-0.5">{t.employee_name}</div>}
                          <div className={`text-xs font-semibold ${meta.color}`}>
                            🏖 {meta.label}
                            {t.portion === 0.5
                              ? <span> · {t.half_period === 'am' ? '오전 반차' : '오후 반차'}</span>
                              : <span> · 하루</span>}
                            {t.memo && <span className="ml-2 text-gray-500 font-normal">({t.memo})</span>}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteTimeOff(t.id)} className="text-gray-300 hover:text-red-400 p-1">🗑</button>
                      </div>
                    )
                  })}
                  {dayItems.map((x, idx) => {
                    const r = x.record
                    const seg = x.seg
                    const isOngoing = !r.clock_out
                    const allSegs = isOngoing ? [] : segmentsOf(r)
                    const isFirstSeg = seg ? seg === allSegs[0] : true
                    const isLastSeg = seg ? seg === allSegs[allSegs.length - 1] : true
                    const isNightSpan = allSegs.length > 1
                    return (
                      <div key={`${r.id}-${idx}`} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
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
                              {r.employee_name && <div className="text-xs font-semibold text-gray-700 mb-0.5 flex items-center gap-1">
                                {r.employee_name}
                                {isNightSpan && (
                                  <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold">
                                    {isFirstSeg ? '🌙 야간 →' : '← 익일'}
                                  </span>
                                )}
                              </div>}
                              <div className="text-xs text-gray-500">
                                {seg
                                  ? <>{seg.from} ~ {seg.to}</>
                                  : <>{r.clock_in.slice(11, 16)} ~ 근무 중</>}
                                {seg && <span className="ml-2 font-semibold text-green-600">{fmtDuration(seg.mins)}</span>}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {isFirstSeg && <button onClick={() => startEdit(r)} className="text-gray-300 hover:text-gray-500 p-1">✏️</button>}
                              {isLastSeg && <button onClick={() => handleDelete(r.id)} className="text-gray-300 hover:text-red-400 p-1">🗑</button>}
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

      {showModal && (
        <TimeOffModal
          slug={slug}
          employees={employees}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
