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

// 플랜 활성 인원 한도 초과 (등록·복원 차단). 업그레이드 유도 UI 트리거용.
export class PlanLimitError extends Error {
  plan: string; limit: number; active: number
  constructor(message: string, plan: string, limit: number, active: number) {
    super(message); this.name = 'PlanLimitError'
    this.plan = plan; this.limit = limit; this.active = active
  }
}

// 클라이언트 플랜 표시 정보 (서버 plans.ts 와 동일하게 유지)
export interface PlanDisplay { label: string; maxActive: number | null; monthlyPrice: number | null; notifications: boolean; gps: boolean; payslip: boolean }
export const PLANS_DISPLAY: Record<string, PlanDisplay> = {
  free:       { label: '무료',         maxActive: 3,    monthlyPrice: 0,     notifications: false, gps: false, payslip: false },
  basic:      { label: '베이직',       maxActive: 5,    monthlyPrice: 9900,  notifications: true,  gps: true,  payslip: true },
  pro:        { label: '프로',         maxActive: 20,   monthlyPrice: 29900, notifications: true,  gps: true,  payslip: true },
  enterprise: { label: '엔터프라이즈', maxActive: null, monthlyPrice: null,  notifications: true,  gps: true,  payslip: true },
  paid:       { label: '유료',         maxActive: null, monthlyPrice: null,  notifications: true,  gps: true,  payslip: true },
}
// 유료 단계 목록 (업그레이드 안내용 — 무료/레거시 제외)
export const UPGRADE_PLANS = ['basic', 'pro', 'enterprise']
function planInfo(plan?: string): PlanDisplay {
  return (plan && PLANS_DISPLAY[plan]) || PLANS_DISPLAY.free
}
export function planActiveLimit(plan?: string): number | null {
  return planInfo(plan).maxActive
}
// 출퇴근 알림(SMS/카카오)은 유료 전용
export function planHasNotifications(plan?: string): boolean {
  return planInfo(plan).notifications
}
export function planHasGps(plan?: string): boolean {
  return planInfo(plan).gps
}
export function planHasPayslip(plan?: string): boolean {
  return planInfo(plan).payslip
}
// 업그레이드 플랜 요약 (모달/안내용): "베이직 10명 9,900원 · 프로 30명 29,900원 · 엔터프라이즈 무제한 별도문의"
export function upgradePlanSummary(): string {
  return UPGRADE_PLANS.map(k => {
    const p = PLANS_DISPLAY[k]
    const cap = p.maxActive === null ? '무제한' : `${p.maxActive}명`
    const price = p.monthlyPrice === null ? '별도문의' : `${p.monthlyPrice.toLocaleString()}원`
    return `${p.label} ${cap} ${price}`
  }).join(' · ')
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
    if (res.status === 403 && err.code === 'PLAN_LIMIT') {
      throw new PlanLimitError(err.error || '플랜 한도를 초과했습니다.', err.plan, err.limit, err.active)
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
export const updateLeavePolicy = (slug: string, body: { leave_pay_calc_mode?: LeavePayCalcMode; weekly_holiday_includes_leave?: boolean; time_off_enabled?: boolean; weekly_holiday_threshold_hours?: number; week_start_day?: 0 | 1 }) =>
  req<{ ok: boolean; leave_pay_calc_mode: LeavePayCalcMode; weekly_holiday_includes_leave: number; time_off_enabled: number; weekly_holiday_threshold_hours: number; week_start_day: number }>(
    `/businesses/${slug}/leave-policy`,
    { method: 'PATCH', body: JSON.stringify(body) },
    getStoredToken(slug)
  )

// 출근 SMS 알림 설정 (관리자 세션 인증)
export const updateSmsNotify = (slug: string, body: { notify_phone?: string | null; sms_notify_enabled?: boolean }) =>
  req<{ ok: boolean; notify_phone: string | null; sms_notify_enabled: number }>(
    `/businesses/${slug}/sms-notify`,
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
export const createEmployee = (slug: string, body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean; pay_includes_holiday?: boolean }) =>
  req<Employee>(`/${slug}/employees`, { method: 'POST', body: JSON.stringify(body) }, getStoredToken(slug))
export const updateEmployee = (slug: string, id: number, body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean; pay_includes_holiday?: boolean }) =>
  req<Employee>(`/${slug}/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) }, getStoredToken(slug))
export const deleteEmployee = (slug: string, id: number) =>
  req<{ ok: boolean }>(`/${slug}/employees/${id}`, { method: 'DELETE' }, getStoredToken(slug))
export const resignEmployee = (slug: string, id: number) =>
  req<Employee>(`/${slug}/employees/${id}/resign`, { method: 'POST', body: JSON.stringify({}) }, getStoredToken(slug))
export const restoreEmployee = (slug: string, id: number) =>
  req<Employee>(`/${slug}/employees/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }, getStoredToken(slug))
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

// 도입 문의 — 공개 (rate limit 적용됨)
export const submitInquiry = (body: {
  source?: string | null
  business_name: string
  phone: string
  content?: string | null
  agreed_privacy: boolean
  agreed_marketing?: boolean
}) => req<{ ok: boolean }>(`/inquiries`, { method: 'POST', body: JSON.stringify(body) })
