import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth, getValidSession } from '../middleware/auth'
import { splitByMidnight } from '../utils/segments'
import { notifyCheckIn, notifyCheckOut } from '../utils/notify'
import { planAllows, activeLimit } from '../plans'

// 출근 알림(SMS) 발송 — 출근 처리와 완전히 분리.
// 어떤 이유로 실패하든 예외를 밖으로 던지지 않아 출근 기록에 영향이 없다.
// 사업장이 알림을 켜고(sms_notify_enabled=1) 수신번호(notify_phone)가 있을 때만 발송.
async function sendCheckInNotification(employeeId: number, clockInTime: string) {
  try {
    const row = db.prepare(`
      SELECT e.name AS employee_name, b.name AS business_name, b.plan AS plan,
             b.notify_phone AS notify_phone, b.sms_notify_enabled AS sms_notify_enabled
      FROM employees e JOIN businesses b ON b.id = e.business_id
      WHERE e.id = ?
    `).get(employeeId) as any
    if (!row) return
    if (row.sms_notify_enabled !== 1 || !row.notify_phone) return // opt-in 사업장만
    if (!planAllows(row.plan, 'notifications')) return // 유료 전용 — 무료 플랜은 발송 안 함(비용 방지)
    await notifyCheckIn({
      employeeName: row.employee_name,
      clockInTime,
      ownerPhone: row.notify_phone,
      businessName: row.business_name,
    })
  } catch (e: any) {
    console.error('[attendance] 출근 알림 발송 중 예외(무시):', e?.message || e)
  }
}

// 퇴근 알림(SMS) 발송 — 출근 알림과 동일하게 퇴근 처리와 완전히 분리.
async function sendCheckOutNotification(employeeId: number, clockOutTime: string) {
  try {
    const row = db.prepare(`
      SELECT e.name AS employee_name, b.name AS business_name, b.plan AS plan,
             b.notify_phone AS notify_phone, b.sms_notify_enabled AS sms_notify_enabled
      FROM employees e JOIN businesses b ON b.id = e.business_id
      WHERE e.id = ?
    `).get(employeeId) as any
    if (!row) return
    if (row.sms_notify_enabled !== 1 || !row.notify_phone) return // opt-in 사업장만
    if (!planAllows(row.plan, 'notifications')) return // 유료 전용 — 무료 플랜은 발송 안 함(비용 방지)
    await notifyCheckOut({
      employeeName: row.employee_name,
      clockOutTime,
      ownerPhone: row.notify_phone,
      businessName: row.business_name,
    })
  } catch (e: any) {
    console.error('[attendance] 퇴근 알림 발송 중 예외(무시):', e?.message || e)
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function checkLocation(slug: string, lat?: number, lng?: number, sessionToken?: string): string | null {
  const biz = db.prepare('SELECT lat, lng, radius_meters, plan FROM businesses WHERE slug = ?').get(slug) as any
  if (!biz?.lat || !biz?.lng) return null // 위치 미설정 → 제한 없음
  if (!planAllows(biz.plan, 'gps')) return null // 유료 전용 — 무료(만료 다운그레이드 포함)는 기존 lat/lng 있어도 GPS 미적용. 재업그레이드 시 자동 복구
  if (sessionToken && getValidSession(slug, sessionToken)) return null // 유효 세션(관리자) → 우회
  if (lat == null || lng == null) return '위치 정보가 필요합니다. 위치 권한을 허용해주세요.'
  const dist = Math.round(haversine(biz.lat, biz.lng, lat, lng))
  if (dist > biz.radius_meters) return `사업장 반경 ${biz.radius_meters}m 밖에 있습니다 (현재 약 ${dist}m)`
  return null
}

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

// startDay: 1=월요일 시작, 0=일요일 시작
function getWeekKey(dateStr: string, startDay: 0 | 1 = 1): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  // 월요일 시작: (day===0 ? 6 : day-1) 일 빼기 / 일요일 시작: day 일 빼기
  const offset = startDay === 1 ? (day === 0 ? 6 : day - 1) : day
  const weekStart = new Date(d)
  weekStart.setDate(d.getDate() - offset)
  return weekStart.toISOString().slice(0, 10)
}

function calcWeeklyHolidayPay(weekMap: Map<string, number>, hourlyRate: number, thresholdHours = 15): number {
  let total = 0
  const thresholdMins = thresholdHours * 60
  for (const weekMins of weekMap.values()) {
    if (weekMins >= thresholdMins) {
      total += Math.floor((weekMins / 60 / 40) * 8 * hourlyRate)
    }
  }
  return total
}

function verifyEmployee(slug: string, employeeId: number): boolean {
  const result = db.prepare(`
    SELECT e.id FROM employees e
    JOIN businesses b ON b.id = e.business_id
    WHERE e.id = ? AND b.slug = ?
  `).get(employeeId, slug)
  return !!result
}

function resolveEmployeeId(slug: string, employeeId?: number, token?: string): number | null {
  if (token) {
    const row = db.prepare(`
      SELECT e.id FROM employees e
      JOIN businesses b ON b.id = e.business_id
      WHERE b.slug = ? AND e.access_token = ?
    `).get(slug, token) as any
    return row?.id ?? null
  }
  if (employeeId != null && verifyEmployee(slug, employeeId)) return employeeId
  return null
}

// 출퇴근 인원 게이트: 활성 인원이 플랜 한도를 넘으면 "최근 등록한 limit명"만 출퇴근 허용.
// 최근 기준 = 등록 순(id) 내림차순. 이 직원보다 나중에 등록된 활성 직원 수가 limit 미만이면 허용.
// 무제한 플랜(limit=null)이거나 한도 이내면 항상 허용.
function attendanceGate(slug: string, empId: number): { ok: true } | { ok: false; limit: number } {
  const biz = db.prepare('SELECT id, plan FROM businesses WHERE slug = ?').get(slug) as any
  if (!biz) return { ok: true }
  const limit = activeLimit(biz.plan)
  if (limit === null) return { ok: true } // 무제한
  const emp = db.prepare(
    "SELECT id FROM employees WHERE id = ? AND business_id = ? AND status = 'active'"
  ).get(empId, biz.id) as any
  if (!emp) return { ok: true } // 비활성/타사업장은 여기서 판정하지 않음
  const newer = db.prepare(
    "SELECT COUNT(*) AS n FROM employees WHERE business_id = ? AND status = 'active' AND id > ?"
  ).get(biz.id, empId) as any
  return newer.n < limit ? { ok: true } : { ok: false, limit }
}

function attendanceLimitMessage(limit: number): string {
  return `현재 플랜에서는 최근 등록한 ${limit}명만 출퇴근을 기록할 수 있습니다. 모든 직원이 사용하려면 플랜을 업그레이드해 주세요.`
}

export default async function attendanceRoutes(app: FastifyInstance) {
  // 출근 (employee_id 또는 token 둘 중 하나)
  app.post<{ Params: { slug: string }; Body: { employee_id?: number; token?: string; lat?: number; lng?: number } }>(
    '/api/:slug/attendance/clock-in', async (req, reply) => {
      const { employee_id, token, lat, lng } = req.body
      const sessionToken = req.headers['x-session-token'] as string | undefined
      const locErr = checkLocation(req.params.slug, lat, lng, sessionToken)
      if (locErr) return reply.code(403).send({ error: locErr })

      const empId = resolveEmployeeId(req.params.slug, employee_id, token)
      if (!empId) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })

      const gate = attendanceGate(req.params.slug, empId)
      if (!gate.ok) {
        // error=친절 메시지(클라 표시용), code=머신 코드 — 기존 PLAN_LIMIT 컨벤션 동일
        return reply.code(403).send({
          error: attendanceLimitMessage(gate.limit),
          code: 'PLAN_LIMIT_ATTENDANCE',
          limit: gate.limit,
        })
      }

      const already = db.prepare(
        'SELECT id FROM attendance WHERE employee_id = ? AND clock_out IS NULL'
      ).get(empId)
      if (already) return reply.code(400).send({ error: '이미 출근 중입니다' })

      const now = nowKST()
      const result = db.prepare('INSERT INTO attendance (employee_id, clock_in) VALUES (?, ?)').run(empId, now)
      const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid)

      // 사업주 출근 알림 — fire-and-forget. 발송 결과를 기다리지 않아 출근 응답이 지연되지 않고,
      // 실패해도 sendCheckInNotification 내부에서 삼켜 출근 처리에 영향이 없다.
      void sendCheckInNotification(empId, now)

      return record
    }
  )

  // 퇴근 (employee_id 또는 token 둘 중 하나)
  app.post<{ Params: { slug: string }; Body: { employee_id?: number; token?: string; lat?: number; lng?: number } }>(
    '/api/:slug/attendance/clock-out', async (req, reply) => {
      const { employee_id, token, lat, lng } = req.body
      const sessionToken = req.headers['x-session-token'] as string | undefined
      const locErr = checkLocation(req.params.slug, lat, lng, sessionToken)
      if (locErr) return reply.code(403).send({ error: locErr })

      const empId = resolveEmployeeId(req.params.slug, employee_id, token)
      if (!empId) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })

      const record = db.prepare(
        'SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
      ).get(empId) as any
      if (!record) return reply.code(400).send({ error: '출근 기록이 없습니다' })

      const now = nowKST()
      db.prepare('UPDATE attendance SET clock_out = ? WHERE id = ?').run(now, record.id)

      // 사업주 퇴근 알림 — 출근과 동일한 fire-and-forget. 발송 결과를 기다리지 않고,
      // 실패해도 sendCheckOutNotification 내부에서 삼켜 퇴근 처리에 영향이 없다.
      void sendCheckOutNotification(empId, now)

      return db.prepare('SELECT * FROM attendance WHERE id = ?').get(record.id)
    }
  )

  // 근태 조회 (월별)
  app.get<{ Params: { slug: string }; Querystring: { employee_id?: string; year: string; month: string } }>(
    '/api/:slug/attendance', async (req, reply) => {
      const { slug } = req.params
      const { employee_id, year, month } = req.query
      const prefix = `${year}-${String(month).padStart(2, '0')}`

      const addSegments = (rows: any[]) => rows.map(r => ({
        ...r,
        segments: r.clock_out ? splitByMidnight(r.clock_in, r.clock_out) : [],
      }))

      // 월 경계(예: 5/31 22:00 ~ 6/1 06:00) 근무도 양쪽 월에서 조회되도록 clock_in/clock_out 모두 매칭
      if (employee_id) {
        if (!verifyEmployee(slug, Number(employee_id)))
          return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
        const rows = db.prepare(`
          SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color
          FROM attendance a JOIN employees e ON e.id = a.employee_id
          WHERE a.employee_id = ? AND (a.clock_in LIKE ? OR a.clock_out LIKE ?)
          ORDER BY a.clock_in DESC
        `).all(Number(employee_id), `${prefix}%`, `${prefix}%`) as any[]
        return addSegments(rows)
      }

      const rows = db.prepare(`
        SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE b.slug = ? AND (a.clock_in LIKE ? OR a.clock_out LIKE ?)
        ORDER BY a.clock_in DESC
      `).all(slug, `${prefix}%`, `${prefix}%`) as any[]
      return addSegments(rows)
    }
  )

  // 급여 계산 (월별)
  app.get<{ Params: { slug: string }; Querystring: { year: string; month: string } }>(
    '/api/:slug/payroll', async (req, reply) => {
      const { slug } = req.params
      const { year, month } = req.query
      const prefix = `${year}-${String(month).padStart(2, '0')}`

      const biz = db.prepare(
        'SELECT leave_pay_calc_mode, weekly_holiday_includes_leave, time_off_enabled, weekly_holiday_threshold_hours, week_start_day FROM businesses WHERE slug = ?'
      ).get(slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

      const timeOffEnabled: boolean = biz.time_off_enabled === 1
      const leaveMode: '8hours' | 'avg_workhours' = biz.leave_pay_calc_mode === 'avg_workhours' ? 'avg_workhours' : '8hours'
      const includeLeaveInWeekly: boolean = timeOffEnabled && biz.weekly_holiday_includes_leave === 1
      const thresholdHours: number = Number(biz.weekly_holiday_threshold_hours ?? 15)
      const weekStartDay: 0 | 1 = biz.week_start_day === 0 ? 0 : 1

      // payroll도 월 경계 근무 양쪽 월에서 잡히도록
      const records = db.prepare(`
        SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color, e.pay_includes_holiday
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE b.slug = ? AND (a.clock_in LIKE ? OR a.clock_out LIKE ?) AND a.clock_out IS NOT NULL
        ORDER BY e.id, a.clock_in
      `).all(slug, `${prefix}%`, `${prefix}%`) as any[]

      const timeOffRows = timeOffEnabled
        ? db.prepare(`
            SELECT t.* FROM time_off t
            JOIN employees e ON e.id = t.employee_id
            JOIN businesses b ON b.id = e.business_id
            WHERE b.slug = ? AND t.date LIKE ?
          `).all(slug, `${prefix}%`) as any[]
        : []

      const map = new Map<number, any>()
      for (const r of records) {
        if (!map.has(r.employee_id)) {
          map.set(r.employee_id, {
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            hourly_rate: r.hourly_rate,
            color: r.color,
            pay_includes_holiday: r.pay_includes_holiday === 1 ? 1 : 0,
            total_minutes: 0,
            records: [],
            time_off: [] as any[],
            paid_leave_days: 0,
            unpaid_leave_days: 0,
            sick_days: 0,
            family_days: 0,
          })
        }
        const entry = map.get(r.employee_id)
        const allSegments = splitByMidnight(r.clock_in, r.clock_out)
        // 해당 월에 속한 segment만 카운트 (월 경계 근무 중복 방지)
        const segments = allSegments.filter(s => s.date.startsWith(prefix))
        const mins = segments.reduce((s, seg) => s + seg.mins, 0)
        entry.total_minutes += mins
        entry.records.push({ ...r, duration_minutes: mins, segments })
      }

      // time_off 합산 (출근기록이 없는 직원도 포함될 수 있으므로 직원 메타가 필요)
      for (const t of timeOffRows) {
        let entry = map.get(t.employee_id)
        if (!entry) {
          const emp = db.prepare('SELECT name, hourly_rate, color FROM employees WHERE id = ?').get(t.employee_id) as any
          if (!emp) continue
          entry = {
            employee_id: t.employee_id,
            employee_name: emp.name,
            hourly_rate: emp.hourly_rate,
            color: emp.color,
            total_minutes: 0,
            records: [],
            time_off: [],
            paid_leave_days: 0,
            unpaid_leave_days: 0,
            sick_days: 0,
            family_days: 0,
          }
          map.set(t.employee_id, entry)
        }
        entry.time_off.push(t)
        if (t.type === 'annual') entry.paid_leave_days += t.portion
        else if (t.type === 'unpaid') entry.unpaid_leave_days += t.portion
        else if (t.type === 'sick') entry.sick_days += t.portion
        else if (t.type === 'family') entry.family_days += t.portion
      }

      return Array.from(map.values()).map((e) => {
        const base_pay = Math.floor((e.total_minutes / 60) * e.hourly_rate)

        // 유급 연차 환산
        let paid_leave_pay = 0
        if (e.paid_leave_days > 0) {
          if (leaveMode === '8hours') {
            paid_leave_pay = Math.floor(e.paid_leave_days * 8 * e.hourly_rate)
          } else {
            // 평일 평균: 해당 직원의 그달 출근일(unique date) 기준 평균 분.
            // 출근일이 없거나 누적 분이 0이면 8시간 기본값으로 fallback.
            const dateSet = new Set<string>(e.records.map((r: any) => r.clock_in.slice(0, 10)))
            const workDays = dateSet.size
            const avgMins = workDays > 0 && e.total_minutes > 0 ? e.total_minutes / workDays : 8 * 60
            paid_leave_pay = Math.floor((avgMins / 60) * e.hourly_rate * e.paid_leave_days)
          }
        }

        // 주차별 분 집계 — segment 단위로 분할해 주차 키 산출 (자정 넘는 근무 정확 반영)
        const weekMap = new Map<string, number>()
        for (const r of e.records) {
          for (const seg of (r.segments as { date: string; mins: number }[])) {
            const wk = getWeekKey(seg.date + 'T00:00:00', weekStartDay)
            weekMap.set(wk, (weekMap.get(wk) ?? 0) + seg.mins)
          }
        }
        if (includeLeaveInWeekly) {
          for (const t of e.time_off) {
            if (t.type !== 'annual') continue
            const wk = getWeekKey(t.date + 'T00:00:00', weekStartDay)
            weekMap.set(wk, (weekMap.get(wk) ?? 0) + Math.floor(t.portion * 8 * 60))
          }
        }
        // pay_includes_holiday=1 직원은 시급에 주휴분이 이미 포함되어 있으므로
        // 자동 산정 0원 처리(이중 지급 방지). 명세서는 헤더에 "(주휴수당 포함)"로 표기.
        const weekly_holiday_pay = e.pay_includes_holiday === 1
          ? 0
          : calcWeeklyHolidayPay(weekMap, e.hourly_rate, thresholdHours)

        return {
          ...e,
          base_pay,
          weekly_holiday_pay,
          paid_leave_pay,
          total_pay: base_pay + weekly_holiday_pay + paid_leave_pay,
        }
      })
    }
  )

  // 근태 수정 (관리자 전용)
  app.put<{ Params: { slug: string; id: string }; Body: { clock_in: string; clock_out?: string; memo?: string } }>(
    '/api/:slug/attendance/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const id = Number(req.params.id)
      const record = db.prepare(`
        SELECT a.id FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE a.id = ? AND b.slug = ?
      `).get(id, req.params.slug)
      if (!record) return reply.code(404).send({ error: '기록을 찾을 수 없습니다' })
      const { clock_in, clock_out, memo } = req.body
      if (clock_out && clock_out <= clock_in)
        return reply.code(400).send({ error: '퇴근 시간은 출근 시간보다 이후여야 합니다' })
      db.prepare('UPDATE attendance SET clock_in=?, clock_out=?, memo=? WHERE id=?')
        .run(clock_in, clock_out ?? null, memo ?? null, id)
      return db.prepare('SELECT * FROM attendance WHERE id = ?').get(id)
    }
  )

  // 근태 삭제 (관리자 전용)
  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/:slug/attendance/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const id = Number(req.params.id)
      const record = db.prepare(`
        SELECT a.id FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE a.id = ? AND b.slug = ?
      `).get(id, req.params.slug)
      if (!record) return reply.code(404).send({ error: '기록을 찾을 수 없습니다' })
      db.prepare('DELETE FROM attendance WHERE id = ?').run(id)
      return { ok: true }
    }
  )
}
