import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth, getValidSession } from '../middleware/auth'

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function checkLocation(slug: string, lat?: number, lng?: number, sessionToken?: string): string | null {
  const biz = db.prepare('SELECT lat, lng, radius_meters FROM businesses WHERE slug = ?').get(slug) as any
  if (!biz?.lat || !biz?.lng) return null // 위치 미설정 → 제한 없음
  if (sessionToken && getValidSession(slug, sessionToken)) return null // 유효 세션(관리자) → 우회
  if (lat == null || lng == null) return '위치 정보가 필요합니다. 위치 권한을 허용해주세요.'
  const dist = Math.round(haversine(biz.lat, biz.lng, lat, lng))
  if (dist > biz.radius_meters) return `사업장 반경 ${biz.radius_meters}m 밖에 있습니다 (현재 약 ${dist}m)`
  return null
}

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().slice(0, 10)
}

function calcWeeklyHolidayPay(records: { clock_in: string; duration_minutes: number }[], hourlyRate: number): number {
  const weekMap = new Map<string, number>()
  for (const r of records) {
    const wk = getWeekKey(r.clock_in)
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + r.duration_minutes)
  }
  let total = 0
  for (const weekMins of weekMap.values()) {
    if (weekMins >= 15 * 60) {
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

export default async function attendanceRoutes(app: FastifyInstance) {
  // 출근
  app.post<{ Params: { slug: string }; Body: { employee_id: number; lat?: number; lng?: number } }>(
    '/api/:slug/attendance/clock-in', async (req, reply) => {
      const { employee_id, lat, lng } = req.body
      const sessionToken = req.headers['x-session-token'] as string | undefined
      const locErr = checkLocation(req.params.slug, lat, lng, sessionToken)
      if (locErr) return reply.code(403).send({ error: locErr })

      if (!verifyEmployee(req.params.slug, employee_id))
        return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })

      const already = db.prepare(
        'SELECT id FROM attendance WHERE employee_id = ? AND clock_out IS NULL'
      ).get(employee_id)
      if (already) return reply.code(400).send({ error: '이미 출근 중입니다' })

      const now = nowKST()
      const result = db.prepare('INSERT INTO attendance (employee_id, clock_in) VALUES (?, ?)').run(employee_id, now)
      return db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid)
    }
  )

  // 퇴근
  app.post<{ Params: { slug: string }; Body: { employee_id: number; lat?: number; lng?: number } }>(
    '/api/:slug/attendance/clock-out', async (req, reply) => {
      const { employee_id, lat, lng } = req.body
      const sessionToken = req.headers['x-session-token'] as string | undefined
      const locErr = checkLocation(req.params.slug, lat, lng, sessionToken)
      if (locErr) return reply.code(403).send({ error: locErr })

      if (!verifyEmployee(req.params.slug, employee_id))
        return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })

      const record = db.prepare(
        'SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
      ).get(employee_id) as any
      if (!record) return reply.code(400).send({ error: '출근 기록이 없습니다' })

      const now = nowKST()
      db.prepare('UPDATE attendance SET clock_out = ? WHERE id = ?').run(now, record.id)
      return db.prepare('SELECT * FROM attendance WHERE id = ?').get(record.id)
    }
  )

  // 근태 조회 (월별)
  app.get<{ Params: { slug: string }; Querystring: { employee_id?: string; year: string; month: string } }>(
    '/api/:slug/attendance', async (req, reply) => {
      const { slug } = req.params
      const { employee_id, year, month } = req.query
      const prefix = `${year}-${String(month).padStart(2, '0')}`

      if (employee_id) {
        if (!verifyEmployee(slug, Number(employee_id)))
          return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
        return db.prepare(`
          SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color
          FROM attendance a JOIN employees e ON e.id = a.employee_id
          WHERE a.employee_id = ? AND a.clock_in LIKE ?
          ORDER BY a.clock_in DESC
        `).all(Number(employee_id), `${prefix}%`)
      }

      return db.prepare(`
        SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE b.slug = ? AND a.clock_in LIKE ?
        ORDER BY a.clock_in DESC
      `).all(slug, `${prefix}%`)
    }
  )

  // 급여 계산 (월별)
  app.get<{ Params: { slug: string }; Querystring: { year: string; month: string } }>(
    '/api/:slug/payroll', async (req, reply) => {
      const { slug } = req.params
      const { year, month } = req.query
      const prefix = `${year}-${String(month).padStart(2, '0')}`

      const records = db.prepare(`
        SELECT a.*, e.name AS employee_name, e.hourly_rate, e.color
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE b.slug = ? AND a.clock_in LIKE ? AND a.clock_out IS NOT NULL
        ORDER BY e.id, a.clock_in
      `).all(slug, `${prefix}%`) as any[]

      const map = new Map<number, any>()
      for (const r of records) {
        if (!map.has(r.employee_id)) {
          map.set(r.employee_id, {
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            hourly_rate: r.hourly_rate,
            color: r.color,
            total_minutes: 0,
            records: [],
          })
        }
        const entry = map.get(r.employee_id)
        const mins = Math.max(0, Math.floor((new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime()) / 60000))
        entry.total_minutes += mins
        entry.records.push({ ...r, duration_minutes: mins })
      }

      return Array.from(map.values()).map((e) => {
        const base_pay = Math.floor((e.total_minutes / 60) * e.hourly_rate)
        const weekly_holiday_pay = calcWeeklyHolidayPay(e.records, e.hourly_rate)
        return { ...e, base_pay, weekly_holiday_pay, total_pay: base_pay + weekly_holiday_pay }
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
