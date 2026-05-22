export type HomeMode = 'kiosk' | 'private'

export interface Business {
  id: number
  slug: string
  name: string
  created_at: string
  lat?: number | null
  lng?: number | null
  radius_meters?: number | null
  home_mode?: HomeMode
}

export interface Employee {
  id: number
  name: string
  hourly_rate: number
  color: string
  access_token: string
  pay_enabled: number
  created_at: string
  is_working: boolean
  clock_in: string | null
}

export interface AttendanceRecord {
  id: number
  employee_id: number
  employee_name?: string
  hourly_rate?: number
  color?: string
  clock_in: string
  clock_out: string | null
  memo?: string | null
  duration_minutes?: number
}

export interface PayrollEntry {
  employee_id: number
  employee_name: string
  hourly_rate: number
  color: string
  total_minutes: number
  base_pay: number
  weekly_holiday_pay: number
  total_pay: number
  records: AttendanceRecord[]
}
