export type HomeMode = 'kiosk' | 'private'
export type LeavePayCalcMode = '8hours' | 'avg_workhours'
export type LeaveType = 'annual' | 'unpaid' | 'sick' | 'family'
export type HalfPeriod = 'am' | 'pm' | 'full'

export interface Business {
  id: number
  slug: string
  name: string
  created_at: string
  lat?: number | null
  lng?: number | null
  radius_meters?: number | null
  home_mode?: HomeMode
  leave_pay_calc_mode?: LeavePayCalcMode
  weekly_holiday_includes_leave?: number
  time_off_enabled?: number
}

export interface TimeOffRecord {
  id: number
  employee_id: number
  employee_name?: string
  color?: string
  hourly_rate?: number
  date: string
  type: LeaveType
  portion: number
  half_period: HalfPeriod
  memo: string | null
  created_at: string
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

export interface AttendanceSegment {
  date: string  // YYYY-MM-DD
  from: string  // HH:MM
  to: string    // HH:MM (자정은 '24:00')
  mins: number
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
  segments?: AttendanceSegment[]
}

export interface PayrollEntry {
  employee_id: number
  employee_name: string
  hourly_rate: number
  color: string
  total_minutes: number
  base_pay: number
  weekly_holiday_pay: number
  paid_leave_pay: number
  paid_leave_days: number
  unpaid_leave_days: number
  sick_days: number
  family_days: number
  total_pay: number
  records: AttendanceRecord[]
  time_off: TimeOffRecord[]
}
