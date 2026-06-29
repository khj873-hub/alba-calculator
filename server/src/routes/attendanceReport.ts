import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth } from '../middleware/auth'
import { planAllows } from '../plans'

// 근태 리포트 게이트 — 사업장 조회 + attendanceReport(베이직+) 확인. grace도 함께 반환.
function reportGate(slug: string): { bizId: number; grace: number } | { err: number; body: any } {
  const biz = db.prepare('SELECT id, plan, grace_minutes FROM businesses WHERE slug = ?').get(slug) as any
  if (!biz) return { err: 404, body: { error: '사업장을 찾을 수 없습니다' } }
  if (!planAllows(biz.plan ?? 'free', 'attendanceReport')) {
    return {
      err: 403,
      body: { error: '근무 스케줄·근태 리포트는 베이직 이상 플랜에서 사용할 수 있습니다.', code: 'PLAN_FEATURE', feature: 'attendanceReport', plan: biz.plan ?? 'free' },
    }
  }
  return { bizId: biz.id, grace: biz.grace_minutes ?? 0 }
}

function hhmmToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function todayKSTYmd(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default async function attendanceReportRoutes(app: FastifyInstance) {
  // 직원 근무 스케줄 조회 (요일별)
  app.get<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id/schedule', { preHandler: requireManagerAuth }, async (req, reply) => {
      const g = reportGate(req.params.slug)
      if ('err' in g) return reply.code(g.err).send(g.body)
      const id = Number(req.params.id)
      const emp = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, g.bizId)
      if (!emp) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      return db.prepare('SELECT weekday, start_time, end_time, is_off FROM employee_schedules WHERE employee_id = ? ORDER BY weekday').all(id)
    }
  )

  // 직원 근무 스케줄 일괄 저장 (요일별 upsert)
  app.put<{ Params: { slug: string; id: string }; Body: { schedule: { weekday: number; start_time?: string | null; end_time?: string | null; is_off?: boolean }[] } }>(
    '/api/:slug/employees/:id/schedule', { preHandler: requireManagerAuth }, async (req, reply) => {
      const g = reportGate(req.params.slug)
      if ('err' in g) return reply.code(g.err).send(g.body)
      const id = Number(req.params.id)
      const emp = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, g.bizId)
      if (!emp) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const schedule = req.body?.schedule
      if (!Array.isArray(schedule)) return reply.code(400).send({ error: 'schedule 배열이 필요합니다' })
      const re = /^\d{2}:\d{2}$/
      for (const s of schedule) {
        if (typeof s.weekday !== 'number' || s.weekday < 0 || s.weekday > 6) return reply.code(400).send({ error: 'weekday는 0~6이어야 합니다' })
        if (!s.is_off) {
          if (!re.test(s.start_time || '') || !re.test(s.end_time || '')) return reply.code(400).send({ error: '근무 요일은 HH:MM 출퇴근 시각이 필요합니다' })
          if (hhmmToMin(s.start_time as string) >= hhmmToMin(s.end_time as string)) return reply.code(400).send({ error: '퇴근 시각이 출근 시각보다 늦어야 합니다' })
        }
      }
      const up = db.prepare(`
        INSERT INTO employee_schedules (employee_id, weekday, start_time, end_time, is_off)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, weekday) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, is_off = excluded.is_off
      `)
      const tx = db.transaction(() => {
        for (const s of schedule) up.run(id, s.weekday, s.is_off ? null : s.start_time, s.is_off ? null : s.end_time, s.is_off ? 1 : 0)
      })
      tx()
      return db.prepare('SELECT weekday, start_time, end_time, is_off FROM employee_schedules WHERE employee_id = ? ORDER BY weekday').all(id)
    }
  )

  // 월간 근태 리포트 — 지각/조퇴/결근/퇴근누락 (조회 시 파생 계산, 상태 비저장)
  app.get<{ Params: { slug: string }; Querystring: { year?: string; month?: string } }>(
    '/api/:slug/attendance-report', { preHandler: requireManagerAuth }, async (req, reply) => {
      const g = reportGate(req.params.slug)
      if ('err' in g) return reply.code(g.err).send(g.body)
      const year = Number(req.query.year), month = Number(req.query.month)
      if (!year || !month || month < 1 || month > 12) return reply.code(400).send({ error: 'year, month가 필요합니다' })
      const ym = `${year}-${String(month).padStart(2, '0')}`
      const today = todayKSTYmd()
      const grace = g.grace

      const employees = db.prepare("SELECT id, name FROM employees WHERE business_id = ? AND status = 'active' ORDER BY id").all(g.bizId) as any[]

      const scheds = db.prepare(`
        SELECT s.employee_id, s.weekday, s.start_time, s.end_time, s.is_off
        FROM employee_schedules s JOIN employees e ON e.id = s.employee_id WHERE e.business_id = ?
      `).all(g.bizId) as any[]
      const schedMap: Record<number, Record<number, any>> = {}
      for (const s of scheds) { (schedMap[s.employee_id] ??= {})[s.weekday] = s }

      const atts = db.prepare(`
        SELECT a.employee_id, a.clock_in, a.clock_out
        FROM attendance a JOIN employees e ON e.id = a.employee_id
        WHERE e.business_id = ? AND a.clock_in LIKE ?
      `).all(g.bizId, ym + '%') as any[]
      const attMap: Record<number, Record<string, any[]>> = {}
      for (const a of atts) { const d = a.clock_in.slice(0, 10); ((attMap[a.employee_id] ??= {})[d] ??= []).push(a) }

      const offs = db.prepare(`
        SELECT t.employee_id, t.date FROM time_off t JOIN employees e ON e.id = t.employee_id
        WHERE e.business_id = ? AND t.date LIKE ?
      `).all(g.bizId, ym + '%') as any[]
      const offMap: Record<number, Set<string>> = {}
      for (const o of offs) { (offMap[o.employee_id] ??= new Set()).add(o.date) }

      const daysInMonth = new Date(year, month, 0).getDate()
      const result = employees.map((emp) => {
        const r: any = { employee_id: emp.id, name: emp.name, late: 0, earlyLeave: 0, absent: 0, missingClockOut: 0,
          dates: { late: [] as string[], earlyLeave: [] as string[], absent: [] as string[], missingClockOut: [] as string[] } }
        for (let day = 1; day <= daysInMonth; day++) {
          const d = `${ym}-${String(day).padStart(2, '0')}`
          if (d >= today) continue // 오늘/미래는 판정 제외(진행 중)
          const wd = new Date(d + 'T00:00:00').getDay() // 0=일~6=토
          const sched = schedMap[emp.id]?.[wd]
          const recs = attMap[emp.id]?.[d] || []

          // 퇴근누락: 스케줄 무관, 출근했는데 퇴근 NULL인 채 날짜 경과
          if (recs.some((a) => !a.clock_out)) { r.missingClockOut++; r.dates.missingClockOut.push(d) }

          if (!sched || sched.is_off) continue // 예정 없음/휴무 → 지각·조퇴·결근 판정 안 함
          if (recs.length === 0) {
            if (offMap[emp.id]?.has(d)) continue // 휴가 → 결근 아님
            r.absent++; r.dates.absent.push(d)
          } else {
            const earliestIn = Math.min(...recs.map((a) => hhmmToMin(a.clock_in.slice(11, 16))))
            if (earliestIn > hhmmToMin(sched.start_time) + grace) { r.late++; r.dates.late.push(d) }
            const outRecs = recs.filter((a) => a.clock_out)
            if (outRecs.length) {
              const latestOut = Math.max(...outRecs.map((a) => hhmmToMin(a.clock_out.slice(11, 16))))
              if (latestOut < hhmmToMin(sched.end_time) - grace) { r.earlyLeave++; r.dates.earlyLeave.push(d) }
            }
          }
        }
        return r
      })
      return { year, month, grace_minutes: grace, employees: result }
    }
  )
}
