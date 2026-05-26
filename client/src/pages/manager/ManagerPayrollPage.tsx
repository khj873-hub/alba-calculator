import { useState, useEffect } from 'react'
import { fetchPayroll, fetchEmployees, updateEmployee } from '../../api'
import { useSlug } from '../../hooks/useSlug'
import { getWeekKey } from '../../utils/pay'
import type { PayrollEntry, Employee } from '../../types'

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

interface AdjustedEntry {
  totalMins: number
  basePay: number
  holidayPay: number
  leavePay: number
  paidLeaveDays: number
  unpaidDays: number
  totalPay: number
  workDays: number
}

function getAdjusted(entry: PayrollEntry, breakEnabled: boolean, holidayEnabled: boolean): AdjustedEntry {
  // segment 단위로 일별 누적 (서버가 segments 채워줌. 없으면 clock_in 날짜에 duration_minutes 통째 사용)
  const dateMinMap = new Map<string, number>()
  for (const r of entry.records) {
    if (r.segments && r.segments.length > 0) {
      for (const seg of r.segments) {
        dateMinMap.set(seg.date, (dateMinMap.get(seg.date) ?? 0) + seg.mins)
      }
    } else {
      const date = r.clock_in.slice(0, 10)
      dateMinMap.set(date, (dateMinMap.get(date) ?? 0) + (r.duration_minutes ?? 0))
    }
  }

  const workDays = dateMinMap.size
  let totalMins = 0
  const weekMap = new Map<string, number>()

  for (const [date, mins] of dateMinMap) {
    const adjusted = breakEnabled ? Math.max(0, mins - 60) : mins
    totalMins += adjusted
    const wk = getWeekKey(date + 'T00:00:00')
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + adjusted)
  }

  let holidayPay = 0
  if (holidayEnabled) {
    for (const wkMins of weekMap.values()) {
      if (wkMins >= 15 * 60) {
        holidayPay += Math.floor((wkMins / 60 / 40) * 8 * entry.hourly_rate)
      }
    }
  }

  const basePay = Math.floor((totalMins / 60) * entry.hourly_rate)
  const leavePay = entry.paid_leave_pay ?? 0
  const paidLeaveDays = entry.paid_leave_days ?? 0
  const unpaidDays = entry.unpaid_leave_days ?? 0
  return { totalMins, basePay, holidayPay, leavePay, paidLeaveDays, unpaidDays, totalPay: basePay + holidayPay + leavePay, workDays }
}

function downloadPayslipCsv(
  entry: PayrollEntry,
  adj: AdjustedEntry,
  year: number,
  month: number,
  holidayOn: boolean,
  breakEnabled: boolean,
  businessName: string,
) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const row = (...cells: (string | number)[]) => cells.map(esc).join(',')
  const issueDate = new Date().toLocaleDateString('ko-KR')
  const net = Math.floor(adj.totalPay * 0.967)
  const deduct = Math.floor(adj.totalPay * 0.033)

  const lines: string[] = []
  lines.push(row('급여 명세서'))
  if (businessName) lines.push(row('사업자명', businessName))
  lines.push(row('발급일', issueDate))
  lines.push(row('직원명', entry.employee_name))
  lines.push(row('귀속월', `${year}년 ${month}월`))
  lines.push(row('시급(원)', entry.hourly_rate))
  lines.push(row('휴게공제', breakEnabled ? '일 1시간 적용' : '미적용'))
  lines.push(row('주휴수당', holidayOn ? 'ON' : 'OFF'))
  lines.push('')
  lines.push(row('지급 내역'))
  lines.push(row('항목', '금액(원)'))
  lines.push(row('기본급', adj.basePay))
  lines.push(row('주휴수당', holidayOn ? adj.holidayPay : 0))
  lines.push(row('합계', adj.totalPay))
  lines.push(row('3.3% 공제', -deduct))
  lines.push(row('실수령액', net))
  lines.push('')
  lines.push(row('근무 상세'))
  lines.push(row('날짜', '출근', '퇴근', '근무시간(분)'))
  for (const r of entry.records) {
    if (r.segments && r.segments.length > 0) {
      for (const s of r.segments) {
        lines.push(row(s.date, s.from, s.to, s.mins))
      }
    } else {
      lines.push(row(
        r.clock_in.slice(0, 10),
        r.clock_in.slice(11, 16),
        r.clock_out?.slice(11, 16) ?? '-',
        r.duration_minutes ?? 0,
      ))
    }
  }
  lines.push('')
  lines.push(row('근무일수', adj.workDays))
  lines.push(row('총 근무시간(분)', adj.totalMins))

  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `급여명세_${entry.employee_name}_${year}년${String(month).padStart(2, '0')}월.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openPayslip(
  entry: PayrollEntry,
  adj: AdjustedEntry,
  year: number,
  month: number,
  holidayOn: boolean,
  breakEnabled: boolean,
  businessName: string
) {
  const issueDate = new Date().toLocaleDateString('ko-KR')
  const recordRows = entry.records.flatMap(r => {
    if (r.segments && r.segments.length > 0) {
      return r.segments.map(s => `<tr>
        <td>${s.date}</td>
        <td>${s.from}</td>
        <td>${s.to}</td>
        <td>${fmtDuration(s.mins)}</td>
      </tr>`)
    }
    return [`<tr>
      <td>${r.clock_in.slice(0, 10)}</td>
      <td>${r.clock_in.slice(11, 16)}</td>
      <td>${r.clock_out?.slice(11, 16) ?? '-'}</td>
      <td>${fmtDuration(r.duration_minutes ?? 0)}</td>
    </tr>`]
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>급여명세서_${entry.employee_name}_${year}년${month}월</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif; padding:48px 40px; color:#111; max-width:560px; margin:0 auto; }
    .header { text-align:center; padding-bottom:18px; margin-bottom:24px; border-bottom:2px solid #111; }
    .header .biz { font-size:13px; font-weight:700; color:#333; margin-bottom:4px; }
    .header h1 { font-size:24px; font-weight:800; letter-spacing:-0.5px; }
    .header p { font-size:12px; color:#888; margin-top:4px; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; margin-bottom:24px; }
    .info-item { font-size:13px; }
    .info-item span { color:#888; margin-right:6px; }
    .section { margin-bottom:22px; }
    .section-title { font-size:12px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid #ddd; padding-bottom:6px; margin-bottom:10px; }
    .pay-row { display:flex; justify-content:space-between; font-size:14px; padding:5px 0; border-bottom:1px solid #f0f0f0; }
    .pay-row.total { font-size:14px; color:#666; border-bottom:1px solid #eee; }
    .deduct-line { display:flex; justify-content:space-between; font-size:14px; color:#555; padding:5px 0; border-bottom:1px solid #f0f0f0; }
    .deduct-line span:last-child { min-width:120px; text-align:right; }
    .pay-row span:last-child { min-width:120px; text-align:right; }
    .net-pay { display:flex; justify-content:space-between; align-items:baseline; border-top:2px solid #111; margin-top:6px; padding-top:12px; }
    .net-pay .label { font-size:14px; font-weight:600; }
    .net-pay .amount { font-size:22px; font-weight:800; letter-spacing:-0.5px; min-width:120px; text-align:right; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:#f7f7f7; text-align:center; padding:7px 4px; border:1px solid #e0e0e0; font-weight:600; font-size:11px; }
    td { text-align:center; padding:6px 4px; border:1px solid #eee; color:#333; }
    tr:nth-child(even) td { background:#fafafa; }
    .footer { margin-top:36px; text-align:center; font-size:11px; color:#bbb; border-top:1px solid #eee; padding-top:16px; }
    @media print { body { padding:24px 20px; } }
  </style>
</head>
<body>
  <div class="header">
    ${businessName ? `<p class="biz">${businessName}</p>` : ''}
    <h1>급여 명세서</h1>
    <p>발급일 ${issueDate}</p>
  </div>

  <div class="info-grid">
    <div class="info-item"><span>직원명</span>${entry.employee_name}</div>
    <div class="info-item"><span>귀속월</span>${year}년 ${month}월</div>
    <div class="info-item"><span>시급</span>${entry.hourly_rate.toLocaleString()}원</div>
    <div class="info-item"><span>근무일수</span>${adj.workDays}일</div>
    <div class="info-item"><span>총 근무시간</span>${fmtDuration(adj.totalMins)}</div>
    ${breakEnabled ? '<div class="info-item"><span>휴게공제</span>일 1시간</div>' : ''}
  </div>

  <div class="section">
    <div class="section-title">지급 내역</div>
    <div class="pay-row"><span>기본급</span><span>${adj.basePay.toLocaleString()}원</span></div>
    <div class="pay-row"><span>주휴수당</span><span>${(holidayOn ? adj.holidayPay : 0).toLocaleString()}원</span></div>
    <div class="pay-row total"><span>합계</span><span>${adj.totalPay.toLocaleString()}원</span></div>
    <div class="deduct-line"><span>3.3% 공제액</span><span>- ${Math.floor(adj.totalPay * 0.033).toLocaleString()}원</span></div>
    <div class="net-pay"><span class="label">실수령액</span><span class="amount">${Math.floor(adj.totalPay * 0.967).toLocaleString()}원</span></div>
  </div>

  <div class="section">
    <div class="section-title">근무 상세 내역</div>
    <table>
      <thead><tr><th>날짜</th><th>출근</th><th>퇴근</th><th>근무시간</th></tr></thead>
      <tbody>${recordRows}</tbody>
    </table>
  </div>

  <div class="footer">퍼펙트 근태관리에서 자동 생성된 명세서입니다.</div>
  <script>window.onload = function(){ window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=700,height=900')
  if (win) { win.document.write(html); win.document.close() }
}

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition ${
        enabled ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400'
      }`}
    >
      <span className={`w-8 h-4 rounded-full relative transition-colors ${enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${enabled ? 'left-4' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

export default function PayrollPage() {
  const now = new Date()
  const slug = useSlug()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<PayrollEntry[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [editRateId, setEditRateId] = useState<number | null>(null)
  const [editRate, setEditRate] = useState(0)
  const [saving, setSaving] = useState(false)
  const [breakTimeEnabled, setBreakTimeEnabled] = useState(
    () => localStorage.getItem(`payroll_break_time_${slug}`) === 'true'
  )
  const [businessName, setBusinessName] = useState(
    () => localStorage.getItem(`business_name_${slug}`) ?? ''
  )
  const [editingBizName, setEditingBizName] = useState(false)
  const [bizNameInput, setBizNameInput] = useState('')
  // 직원별 주휴수당 ON/OFF: { [employee_id]: boolean }
  const [holidayMap, setHolidayMap] = useState<Record<number, boolean>>({})

  const load = () => fetchPayroll(slug, year, month).then(setData)
  useEffect(() => { load() }, [slug, year, month])
  useEffect(() => { fetchEmployees(slug).then(setEmployees) }, [slug])

  // 데이터 로드 시 localStorage에서 직원별 설정 복원 (기본값: true)
  useEffect(() => {
    setHolidayMap(prev => {
      const next = { ...prev }
      for (const e of data) {
        if (!(e.employee_id in next)) {
          next[e.employee_id] = localStorage.getItem(`payroll_holiday_${slug}_${e.employee_id}`) === 'true'
        }
      }
      return next
    })
  }, [data])

  const toggleBreakTime = () =>
    setBreakTimeEnabled(v => { localStorage.setItem(`payroll_break_time_${slug}`, String(!v)); return !v })

  const saveBizName = () => {
    localStorage.setItem(`business_name_${slug}`, bizNameInput.trim())
    setBusinessName(bizNameInput.trim())
    setEditingBizName(false)
  }

  const toggleEmployeeHoliday = (empId: number) => {
    setHolidayMap(prev => {
      const newVal = !(prev[empId] ?? true)
      localStorage.setItem(`payroll_holiday_${slug}_${empId}`, String(newVal))
      return { ...prev, [empId]: newVal }
    })
  }

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }

  const startEditRate = (entry: PayrollEntry) => { setEditRateId(entry.employee_id); setEditRate(entry.hourly_rate) }
  const saveRate = async () => {
    if (!editRateId) return
    setSaving(true)
    try {
      const emp = employees.find(e => e.id === editRateId)
      if (emp) await updateEmployee(slug, editRateId, { name: emp.name, hourly_rate: editRate, color: emp.color })
      setEditRateId(null)
      await load()
      fetchEmployees(slug).then(setEmployees)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const adjustedData = data.map(e => {
    const payOn = (employees.find(emp => emp.id === e.employee_id)?.pay_enabled ?? 1) === 1
    const baseAdj = getAdjusted(e, breakTimeEnabled, holidayMap[e.employee_id] ?? true)
    const adj = payOn ? baseAdj : { ...baseAdj, basePay: 0, holidayPay: 0, leavePay: 0, totalPay: 0 }
    return { entry: e, adj, payOn }
  })
  const totalPay = adjustedData.reduce((s, { adj }) => s + adj.totalPay, 0)
  const totalHolidayPay = adjustedData.reduce((s, { adj }) => s + adj.holidayPay, 0)
  const totalMins = adjustedData.reduce((s, { adj }) => s + adj.totalMins, 0)

  return (
    <div>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">←</button>
        <span className="font-extrabold text-gray-800">{year}년 {month}월 급여</span>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 text-lg">→</button>
      </div>

      {/* 전체 설정 */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 mb-4 flex flex-col gap-3">
        {/* 사업자명 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16 shrink-0">사업자명</span>
          {editingBizName ? (
            <>
              <input
                autoFocus
                value={bizNameInput}
                onChange={e => setBizNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveBizName(); if (e.key === 'Escape') setEditingBizName(false) }}
                placeholder="상호명 입력"
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs"
              />
              <button onClick={saveBizName} className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg">저장</button>
              <button onClick={() => setEditingBizName(false)} className="text-xs text-gray-400 px-1">취소</button>
            </>
          ) : (
            <>
              <span className="flex-1 text-xs font-semibold text-gray-700">
                {businessName || <span className="text-gray-300">미입력</span>}
              </span>
              <button
                onClick={() => { setBizNameInput(businessName); setEditingBizName(true) }}
                className="text-xs text-blue-400 hover:text-blue-600"
              >
                {businessName ? '수정' : '입력'}
              </button>
            </>
          )}
        </div>
        <div className="border-t border-gray-50" />
        <Toggle enabled={breakTimeEnabled} onToggle={toggleBreakTime} label="휴게시간 1시간 공제 (전체)" />
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-green-500 text-white rounded-2xl p-4">
          <div className="text-xs opacity-80 mb-1">총 지급 예상액</div>
          <div className="text-2xl font-extrabold">{totalPay.toLocaleString()}원</div>
          {totalHolidayPay > 0 && (
            <div className="text-xs opacity-80 mt-1">주휴수당 {totalHolidayPay.toLocaleString()}원 포함</div>
          )}
          <div className="text-xs opacity-70 mt-0.5">
            3.3% 제외 ({Math.floor(totalPay * 0.967).toLocaleString()}원)
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="text-xs text-gray-400 mb-1">총 근무시간</div>
          <div className="text-2xl font-extrabold text-gray-800">{fmtDuration(totalMins)}</div>
          {breakTimeEnabled && (
            <div className="text-xs text-gray-400 mt-1">휴게 공제 적용됨</div>
          )}
        </div>
      </div>

      {/* 직원별 급여 */}
      {data.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">이번 달 근무 기록이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-3">
          {adjustedData.map(({ entry, adj, payOn }) => {
            const holidayOn = holidayMap[entry.employee_id] ?? true
            return (
              <div key={entry.employee_id} className={`rounded-2xl border shadow-sm p-4 ${payOn ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-lg shrink-0"
                    style={{ background: entry.color, opacity: payOn ? 1 : 0.5 }}
                  >
                    {entry.employee_name[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-bold text-gray-800 truncate">{entry.employee_name}</div>
                        {!payOn && (
                          <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-semibold shrink-0">
                            급여 미적용
                          </span>
                        )}
                      </div>
                      {payOn && (
                        <button
                          onClick={() => toggleEmployeeHoliday(entry.employee_id)}
                          className={`text-xs px-2 py-1 rounded-lg border font-semibold transition shrink-0 ${
                            holidayOn
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}
                        >
                          주휴수당 {holidayOn ? 'ON' : 'OFF'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {editRateId === entry.employee_id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editRate}
                            onChange={(e) => setEditRate(Number(e.target.value))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-0.5 text-xs"
                          />
                          <span className="text-xs text-gray-400">원/시간</span>
                          <button onClick={saveRate} disabled={saving}
                            className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-lg ml-1">저장</button>
                          <button onClick={() => setEditRateId(null)}
                            className="text-xs text-gray-400 px-1">취소</button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-gray-400">시급 {entry.hourly_rate.toLocaleString()}원</span>
                          <button onClick={() => startEditRate(entry)}
                            className="text-xs text-blue-400 hover:text-blue-600 ml-1">수정</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 rounded-xl py-2">
                    <div className="text-xs text-gray-400 mb-0.5">근무일수</div>
                    <div className="font-bold text-gray-700 text-sm">{adj.workDays}일</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl py-2">
                    <div className="text-xs text-gray-400 mb-0.5">총 시간</div>
                    <div className="font-bold text-gray-700 text-sm">{fmtDuration(adj.totalMins)}</div>
                    {breakTimeEnabled && (
                      <div className="text-xs text-gray-400">(공제 후)</div>
                    )}
                  </div>
                  {payOn ? (
                    <div className="bg-green-50 rounded-xl py-2 px-1">
                      <div className="text-xs text-green-600 mb-0.5">예상 급여</div>
                      <div className="font-extrabold text-green-700 text-sm">{adj.totalPay.toLocaleString()}원</div>
                      <div className={`text-xs ${holidayOn && adj.holidayPay > 0 ? 'text-green-500' : 'text-gray-400'}`}>
                        주휴수당 {holidayOn ? adj.holidayPay.toLocaleString() : 0}원
                      </div>
                      {adj.leavePay > 0 && (
                        <div className="text-xs text-emerald-600">
                          🏖 연차 {adj.paidLeaveDays}일 ({adj.leavePay.toLocaleString()}원)
                        </div>
                      )}
                      <div className="text-xs text-green-600">3.3% 제외 ({Math.floor(adj.totalPay * 0.967).toLocaleString()}원)</div>
                    </div>
                  ) : (
                    <div className="bg-gray-100 rounded-xl py-2 px-1 flex flex-col items-center justify-center">
                      <div className="text-xs text-gray-400 mb-0.5">예상 급여</div>
                      <div className="font-extrabold text-gray-400 text-sm">–</div>
                      <div className="text-xs text-gray-400">계산 미적용</div>
                    </div>
                  )}
                </div>

                {/* 일별 상세 펼치기 */}
                <details className="mt-3">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">상세 내역 보기</summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {entry.records.flatMap((r, ri) => {
                      if (r.segments && r.segments.length > 0) {
                        return r.segments.map((s, si) => (
                          <div key={`${r.id}-${si}`} className="flex justify-between text-xs text-gray-500 py-1 border-b border-gray-50">
                            <span>{s.date} {s.from}~{s.to}{r.segments && r.segments.length > 1 && <span className="ml-1 text-indigo-500">🌙</span>}</span>
                            <span className="font-semibold text-green-600">{fmtDuration(s.mins)}</span>
                          </div>
                        ))
                      }
                      return [(
                        <div key={`${r.id}-r${ri}`} className="flex justify-between text-xs text-gray-500 py-1 border-b border-gray-50">
                          <span>{r.clock_in.slice(0, 10)} {r.clock_in.slice(11, 16)}~{r.clock_out?.slice(11, 16)}</span>
                          <span className="font-semibold text-green-600">
                            {r.duration_minutes !== undefined ? fmtDuration(r.duration_minutes) : '-'}
                          </span>
                        </div>
                      )]
                    })}
                  </div>
                </details>

                {payOn && (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      onClick={() => openPayslip(entry, adj, year, month, holidayOn, breakTimeEnabled, businessName)}
                      className="w-full py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition"
                    >
                      📄 급여 명세서 PDF 출력
                    </button>
                    <button
                      onClick={() => downloadPayslipCsv(entry, adj, year, month, holidayOn, breakTimeEnabled, businessName)}
                      className="w-full py-2 rounded-xl border border-green-200 text-xs font-semibold text-green-600 hover:bg-green-50 transition"
                    >
                      📊 엑셀(CSV) 다운로드
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
