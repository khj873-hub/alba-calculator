import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchEmployees, clockIn, clockOut, fetchAttendance, fetchBusiness, resolveEmployeeIdByToken, isPayEnabled, getHomeMode } from '../api'
import { useSlug } from '../hooks/useSlug'
import { getCurrentPosition } from '../utils/geo'
import { calcWeeklyHolidayPay } from '../utils/pay'
import type { Employee, AttendanceRecord, Business } from '../types'

function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function calcMins(clockIn: string, clockOut: string | null) {
  if (!clockOut) return null
  return Math.max(0, Math.floor((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000))
}

function formatElapsed(clockInStr: string) {
  const diff = Math.floor((Date.now() - new Date(clockInStr).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

export default function PersonalPage() {
  const { token, id } = useParams<{ token?: string; id?: string }>()
  const navigate = useNavigate()
  const slug = useSlug()
  const now = new Date()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [acting, setActing] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)

  const mode = getHomeMode(slug)
  // 토큰 우선 — 없을 땐 키오스크 모드에서만 id 직접 접근 허용 (private 모드에선 id 접근 차단)
  const empId = token
    ? resolveEmployeeIdByToken(slug, token)
    : (id && mode === 'kiosk' ? Number(id) : null)
  const isKiosk = mode === 'kiosk' && !token

  const load = useCallback(async () => {
    if (!empId) { setInvalid(true); setLoading(false); return }
    const today = new Date()
    const [emps, recs, biz] = await Promise.all([
      fetchEmployees(slug),
      fetchAttendance(slug, today.getFullYear(), today.getMonth() + 1, empId),
      fetchBusiness(slug),
    ])
    const emp = emps.find((e) => e.id === empId)
    if (!emp) { setInvalid(true); setLoading(false); return }
    setEmployee(emp)
    setRecords(recs)
    setBusiness(biz)
    setLoading(false)
  }, [empId, slug])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const handleClock = async () => {
    if (!employee || !empId || acting) return
    setActing(true); setError('')
    try {
      let coords: { lat: number; lng: number } | undefined
      if (business?.lat && business?.lng) {
        setGpsLoading(true)
        coords = await getCurrentPosition()
        setGpsLoading(false)
      }
      if (employee.is_working) await clockOut(slug, empId, coords)
      else await clockIn(slug, empId, coords)
      await load()
    } catch (e: any) { setError(e.message); setGpsLoading(false) }
    finally { setActing(false) }
  }

  const totalMins = records.reduce((s, r) => s + (calcMins(r.clock_in, r.clock_out) ?? 0), 0)

  if (loading) return <div className="text-center text-gray-400 py-20">불러오는 중...</div>
  if (invalid) {
    const headline = mode === 'private' ? '유효하지 않은 링크예요' : '직원을 찾을 수 없어요'
    const body = mode === 'private'
      ? '이 출근 링크는 만료됐거나 잘못된 주소입니다.\n관리자에게 새 링크를 요청하세요.'
      : '존재하지 않는 직원입니다. 다시 선택해 주세요.'
    return (
      <div className="py-16 text-center">
        <div className="text-5xl mb-4">🚫</div>
        <h2 className="text-lg font-extrabold text-gray-800 mb-2">{headline}</h2>
        <p className="text-sm text-gray-500 mb-6 whitespace-pre-line">{body}</p>
        <button
          onClick={() => navigate(`/${slug}`)}
          className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition"
        >
          홈으로
        </button>
      </div>
    )
  }
  if (!employee) return null

  const payOn = isPayEnabled(slug, employee.id)
  const basePay = payOn ? Math.floor((totalMins / 60) * employee.hourly_rate) : 0
  const completedRecords = records
    .filter(r => r.clock_out)
    .map(r => ({ clock_in: r.clock_in, duration_minutes: calcMins(r.clock_in, r.clock_out) ?? 0 }))
  const weeklyHolidayPay = payOn ? calcWeeklyHolidayPay(completedRecords, employee.hourly_rate) : 0
  const totalPay = basePay + weeklyHolidayPay

  return (
    <div>
      {isKiosk && (
        <button onClick={() => navigate(`/${slug}`)} className="text-gray-400 text-sm mb-6 block">← 직원 선택으로</button>
      )}

      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white font-extrabold text-2xl shrink-0"
          style={{ background: employee.color }}
        >
          {employee.name[0]}
        </div>
        <div>
          <div className="text-xl font-extrabold text-gray-800">{employee.name}</div>
          <div className="text-sm text-gray-400">
            {payOn
              ? `시급 ${employee.hourly_rate.toLocaleString()}원`
              : '급여 계산 미적용'}
          </div>
        </div>
      </div>

      {employee.is_working && employee.clock_in && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse shrink-0"></span>
          <div>
            <div className="text-sm font-bold text-green-700">출근 중</div>
            <div className="text-xs text-green-600">
              {employee.clock_in.slice(11, 16)} 출근 · {formatElapsed(employee.clock_in)} 근무 중
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')}
            className="shrink-0 text-xs font-bold underline underline-offset-2">
            재시도
          </button>
        </div>
      )}

      <button
        onClick={handleClock}
        disabled={acting}
        className={`w-full py-5 rounded-2xl text-xl font-extrabold transition mb-6 ${
          employee.is_working
            ? 'bg-red-500 text-white hover:bg-red-600 active:scale-[0.98]'
            : 'bg-green-500 text-white hover:bg-green-600 active:scale-[0.98]'
        } disabled:opacity-50`}
      >
        {gpsLoading ? '📍 위치 확인 중...' : acting ? '처리 중...' : employee.is_working ? '🔴 퇴근하기' : '🟢 출근하기'}
      </button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="text-xs font-bold text-gray-400 mb-3">{now.getMonth() + 1}월 근무 현황</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-extrabold text-gray-800">
              {new Set(records.map(r => r.clock_in.slice(0, 10))).size}일
            </div>
            <div className="text-xs text-gray-400">근무일</div>
          </div>
          <div>
            <div className="text-lg font-extrabold text-gray-800">{fmtDuration(totalMins)}</div>
            <div className="text-xs text-gray-400">총 시간</div>
          </div>
          <div>
            {payOn ? (
              <>
                <div className="text-lg font-extrabold text-green-600">{totalPay.toLocaleString()}원</div>
                <div className="text-xs text-gray-400">예상 급여</div>
                {weeklyHolidayPay > 0 && (
                  <div className="text-xs text-green-500">주휴 {weeklyHolidayPay.toLocaleString()}원 포함</div>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  3.3% 제외 ({Math.floor(totalPay * 0.967).toLocaleString()}원)
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-extrabold text-gray-300">–</div>
                <div className="text-xs text-gray-400">급여 미적용</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs font-bold text-gray-400 mb-2">최근 출퇴근 기록</div>
      {records.length === 0 ? (
        <div className="text-center py-8 text-gray-300 text-sm">기록이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-2">
          {records.slice(0, 10).map((r) => {
            const mins = calcMins(r.clock_in, r.clock_out)
            return (
              <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex justify-between items-center">
                <div>
                  <div className="text-xs font-semibold text-gray-600">{r.clock_in.slice(0, 10)}</div>
                  <div className="text-xs text-gray-400">
                    {r.clock_in.slice(11, 16)} ~ {r.clock_out ? r.clock_out.slice(11, 16) : '근무 중'}
                  </div>
                </div>
                {mins !== null && <span className="text-sm font-bold text-green-600">{fmtDuration(mins)}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
