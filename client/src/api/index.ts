import type { Business, Employee, AttendanceRecord, PayrollEntry, HomeMode, TimeOffRecord, LeaveType, HalfPeriod, LeavePayCalcMode } from '../types'

const BASE = '/api'

// 세션 토큰 관리 (PIN 원문 대신 토큰 저장)
export function getStoredToken(slug: string): string {
  return sessionStorage.getItem(`token_${slug}`) ?? ''
}
export function storeToken(slug: string, token: string) {
  sessionStorage.setItem(`token_${slug}`, token)
}
export function clearToken(slug: string) {
  sessionStorage.removeItem(`token_${slug}`)
}

// 직원 개인 출근 링크 (token은 employee.access_token에서 가져옴)
export function buildEmployeeLink(slug: string, token: string): string {
  return `${window.location.origin}/${slug}/e/${token}`
}

export class ServiceSuspendedError extends Error {
  constructor(message: string) { super(message); this.name = 'ServiceSuspendedError' }
}

async function req<T>(url: string, options?: RequestInit, sessionToken?: string): Promise<T> {
  // body가 있을 때만 Content-Type 지정 (Fastify는 body 없는데 Content-Type:json이면
  // FST_ERR_CTP_EMPTY_JSON_BODY 400 반환 — DELETE without body가 여기 해당)
  const headers: Record<string, string> = {}
  if (options?.body != null) headers['Content-Type'] = 'application/json'
  if (sessionToken) headers['x-session-token'] = sessionToken

  const res = await fetch(BASE + url, {
    headers,
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '오류가 발생했습니다' }))
    if (res.status === 403 && err.error === 'service_suspended') {
      throw new ServiceSuspendedError(err.message || '서비스 이용이 일시 제한되었습니다.')
    }
    if (res.status === 401) {
      throw new Error('관리자 인증이 만료됐습니다. 페이지를 새로고침한 뒤 PIN을 다시 입력해주세요.')
    }
    throw new Error(err.error || '오류가 발생했습니다')
  }
  return res.json()
}

// 사업장
export const fetchBusinesses = () =>
  req<Business[]>('/businesses')
export const createBusiness = (body: { name: string; manager_pin: string }) =>
  req<{ slug: string; name: string }>('/businesses', { method: 'POST', body: JSON.stringify(body) })
export const fetchBusiness = (slug: string) =>
  req<Business>(`/businesses/${slug}`)
export const updateBusiness = (slug: string, body: { name: string; pin: string }) =>
  req<Business>(`/businesses/${slug}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteBusiness = (slug: string, pin: string) =>
  req<{ ok: boolean }>(`/businesses/${slug}`, { method: 'DELETE', body: JSON.stringify({ pin }) })
export const changePin = (slug: string, body: { current_pin: string; new_pin: string }) =>
  req<{ ok: boolean }>(`/businesses/${slug}/pin`, { method: 'PATCH', body: JSON.stringify(body) })

// 사업장 홈 화면 모드 (관리자 세션 인증)
export const updateHomeMode = (slug: string, home_mode: HomeMode) =>
  req<{ ok: boolean; home_mode: HomeMode }>(`/businesses/${slug}/home-mode`, {
    method: 'PATCH', body: JSON.stringify({ home_mode })
  }, getStoredToken(slug))

// 사업장 휴가 정책 (관리자 세션 인증)
export const updateLeavePolicy = (slug: string, body: { leave_pay_calc_mode?: LeavePayCalcMode; weekly_holiday_includes_leave?: boolean; time_off_enabled?: boolean }) =>
  req<{ ok: boolean; leave_pay_calc_mode: LeavePayCalcMode; weekly_holiday_includes_leave: number; time_off_enabled: number }>(
    `/businesses/${slug}/leave-policy`,
    { method: 'PATCH', body: JSON.stringify(body) },
    getStoredToken(slug)
  )

// 휴가 (조회: 인증 불필요 / 등록·삭제: 관리자 세션)
export const fetchTimeOff = (slug: string, year: number, month: number, employee_id?: number) => {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  if (employee_id) params.set('employee_id', String(employee_id))
  return req<TimeOffRecord[]>(`/${slug}/time-off?${params}`)
}
export const createTimeOff = (slug: string, body: { employee_id: number; date: string; type: LeaveType; portion: number; half_period?: HalfPeriod | null; memo?: string }) =>
  req<TimeOffRecord>(`/${slug}/time-off`, { method: 'POST', body: JSON.stringify(body) }, getStoredToken(slug))
export const deleteTimeOff = (slug: string, id: number) =>
  req<{ ok: boolean }>(`/${slug}/time-off/${id}`, { method: 'DELETE' }, getStoredToken(slug))

// 직원 (읽기: 인증 불필요 / 쓰기: 관리자 인증 필요)
export const fetchEmployees = (slug: string) =>
  req<Employee[]>(`/${slug}/employees`)
export const fetchEmployeeByToken = (slug: string, token: string) =>
  req<Employee>(`/${slug}/employees/by-token/${token}`)
export const createEmployee = (slug: string, body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean }) =>
  req<Employee>(`/${slug}/employees`, { method: 'POST', body: JSON.stringify(body) }, getStoredToken(slug))
export const updateEmployee = (slug: string, id: number, body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean }) =>
  req<Employee>(`/${slug}/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) }, getStoredToken(slug))
export const deleteEmployee = (slug: string, id: number) =>
  req<{ ok: boolean }>(`/${slug}/employees/${id}`, { method: 'DELETE' }, getStoredToken(slug))
export const regenerateEmployeeToken = (slug: string, id: number) =>
  req<{ ok: boolean; access_token: string }>(`/${slug}/employees/${id}/regenerate-token`, {
    method: 'POST', body: JSON.stringify({})
  }, getStoredToken(slug))

// 출퇴근 (관리자 세션 토큰 있으면 위치 우회)
export const clockIn = (slug: string, employee_id: number, coords?: { lat: number; lng: number }, sessionToken?: string) =>
  req<AttendanceRecord>(`/${slug}/attendance/clock-in`, { method: 'POST', body: JSON.stringify({ employee_id, ...coords }) }, sessionToken)
export const clockOut = (slug: string, employee_id: number, coords?: { lat: number; lng: number }, sessionToken?: string) =>
  req<AttendanceRecord>(`/${slug}/attendance/clock-out`, { method: 'POST', body: JSON.stringify({ employee_id, ...coords }) }, sessionToken)

// 위치 설정
export const setBusinessLocation = (slug: string, body: { pin: string; lat: number | null; lng: number | null; radius_meters: number }) =>
  req<{ ok: boolean }>(`/businesses/${slug}/location`, { method: 'PATCH', body: JSON.stringify(body) })

// 근태 (읽기: 인증 불필요 / 수정·삭제: 관리자 인증 필요)
export const fetchAttendance = (slug: string, year: number, month: number, employee_id?: number) => {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  if (employee_id) params.set('employee_id', String(employee_id))
  return req<AttendanceRecord[]>(`/${slug}/attendance?${params}`)
}
export const updateAttendance = (slug: string, id: number, body: { clock_in: string; clock_out?: string; memo?: string }) =>
  req<AttendanceRecord>(`/${slug}/attendance/${id}`, { method: 'PUT', body: JSON.stringify(body) }, getStoredToken(slug))
export const deleteAttendance = (slug: string, id: number) =>
  req<{ ok: boolean }>(`/${slug}/attendance/${id}`, { method: 'DELETE' }, getStoredToken(slug))

// 급여
export const fetchPayroll = (slug: string, year: number, month: number) => {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  return req<PayrollEntry[]>(`/${slug}/payroll?${params}`)
}

// 인증 — PIN 검증 후 세션 토큰 반환
export const verifyPin = (slug: string, pin: string) =>
  req<{ ok: boolean; token: string }>(`/${slug}/auth/pin`, { method: 'POST', body: JSON.stringify({ pin }) })
