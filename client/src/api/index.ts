import type { Business, Employee, AttendanceRecord, PayrollEntry } from '../types'

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

// 직원 접근 토큰 매핑 (localStorage, 데모용 — 서버 미적용 단계)
// 추후 서버 access_token 컬럼이 추가되면 fetchEmployees 응답을 그대로 사용한다
type EmpTokenMap = Record<number, string>
const EMP_TOKENS_KEY = (slug: string) => `emp_tokens_${slug}`

function readEmpTokens(slug: string): EmpTokenMap {
  try { return JSON.parse(localStorage.getItem(EMP_TOKENS_KEY(slug)) ?? '{}') }
  catch { return {} }
}
function writeEmpTokens(slug: string, map: EmpTokenMap) {
  localStorage.setItem(EMP_TOKENS_KEY(slug), JSON.stringify(map))
}
function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function getOrCreateEmployeeToken(slug: string, empId: number): string {
  const map = readEmpTokens(slug)
  if (!map[empId]) { map[empId] = randomToken(); writeEmpTokens(slug, map) }
  return map[empId]
}
export function regenerateEmployeeToken(slug: string, empId: number): string {
  const map = readEmpTokens(slug)
  map[empId] = randomToken()
  writeEmpTokens(slug, map)
  return map[empId]
}
export function resolveEmployeeIdByToken(slug: string, token: string): number | null {
  const map = readEmpTokens(slug)
  for (const [id, t] of Object.entries(map)) if (t === token) return Number(id)
  return null
}
export function removeEmployeeToken(slug: string, empId: number) {
  const map = readEmpTokens(slug)
  delete map[empId]
  writeEmpTokens(slug, map)
}
export function buildEmployeeLink(slug: string, token: string): string {
  return `${window.location.origin}/${slug}/e/${token}`
}

// 직원별 급여 계산 적용 ON/OFF (localStorage, 기본 ON)
const PAY_ENABLED_KEY = (slug: string, empId: number) => `pay_enabled_${slug}_${empId}`
export function isPayEnabled(slug: string, empId: number): boolean {
  return localStorage.getItem(PAY_ENABLED_KEY(slug, empId)) !== 'false'
}
export function setPayEnabled(slug: string, empId: number, enabled: boolean) {
  localStorage.setItem(PAY_ENABLED_KEY(slug, empId), String(enabled))
}
export function removePayEnabled(slug: string, empId: number) {
  localStorage.removeItem(PAY_ENABLED_KEY(slug, empId))
}

// 사업장 홈 화면 모드 (localStorage, 기본 kiosk = 직원 카드 리스트)
// 'kiosk' — 공용 단말 1대에서 직원 카드 노출, 누구나 본인 카드 클릭 가능 (기존 동작)
// 'private' — 토큰 링크로만 본인 페이지 접근
export type HomeMode = 'kiosk' | 'private'
const HOME_MODE_KEY = (slug: string) => `home_mode_${slug}`
export function getHomeMode(slug: string): HomeMode {
  return (localStorage.getItem(HOME_MODE_KEY(slug)) as HomeMode) === 'private' ? 'private' : 'kiosk'
}
export function setHomeMode(slug: string, mode: HomeMode) {
  localStorage.setItem(HOME_MODE_KEY(slug), mode)
}

async function req<T>(url: string, options?: RequestInit, sessionToken?: string): Promise<T> {
  const method = options?.method?.toUpperCase() ?? 'GET'
  const needsContentType = method !== 'GET'
  const headers: Record<string, string> = {}
  if (needsContentType) headers['Content-Type'] = 'application/json'
  if (sessionToken) headers['x-session-token'] = sessionToken

  const res = await fetch(BASE + url, {
    headers,
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '오류가 발생했습니다' }))
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

// 직원 (읽기: 인증 불필요 / 쓰기: 관리자 인증 필요)
export const fetchEmployees = (slug: string) =>
  req<Employee[]>(`/${slug}/employees`)
export const createEmployee = (slug: string, body: { name: string; hourly_rate: number; color: string }) =>
  req<Employee>(`/${slug}/employees`, { method: 'POST', body: JSON.stringify(body) }, getStoredToken(slug))
export const updateEmployee = (slug: string, id: number, body: { name: string; hourly_rate: number; color: string }) =>
  req<Employee>(`/${slug}/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) }, getStoredToken(slug))
export const deleteEmployee = (slug: string, id: number) =>
  req<{ ok: boolean }>(`/${slug}/employees/${id}`, { method: 'DELETE' }, getStoredToken(slug))

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
