import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth } from '../middleware/auth'

const TYPES = ['annual', 'unpaid', 'sick', 'family'] as const
type LeaveType = typeof TYPES[number]

function verifyEmployeeInBusiness(slug: string, employeeId: number): boolean {
  const row = db.prepare(`
    SELECT e.id FROM employees e
    JOIN businesses b ON b.id = e.business_id
    WHERE e.id = ? AND b.slug = ?
  `).get(employeeId, slug)
  return !!row
}

export default async function timeOffRoutes(app: FastifyInstance) {
  // 월별 휴가 조회
  app.get<{ Params: { slug: string }; Querystring: { year: string; month: string; employee_id?: string } }>(
    '/api/:slug/time-off', async (req, reply) => {
      const { slug } = req.params
      const { year, month, employee_id } = req.query
      const prefix = `${year}-${String(month).padStart(2, '0')}`

      if (employee_id) {
        if (!verifyEmployeeInBusiness(slug, Number(employee_id)))
          return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
        return db.prepare(`
          SELECT t.*, e.name AS employee_name, e.color, e.hourly_rate
          FROM time_off t JOIN employees e ON e.id = t.employee_id
          WHERE t.employee_id = ? AND t.date LIKE ?
          ORDER BY t.date DESC, t.id DESC
        `).all(Number(employee_id), `${prefix}%`)
      }

      return db.prepare(`
        SELECT t.*, e.name AS employee_name, e.color, e.hourly_rate
        FROM time_off t
        JOIN employees e ON e.id = t.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE b.slug = ? AND t.date LIKE ?
        ORDER BY t.date DESC, t.id DESC
      `).all(slug, `${prefix}%`)
    }
  )

  // 휴가 등록 (관리자)
  app.post<{
    Params: { slug: string };
    Body: { employee_id: number; date: string; type: LeaveType; portion?: number; half_period?: 'am' | 'pm' | null; memo?: string }
  }>(
    '/api/:slug/time-off', { preHandler: requireManagerAuth }, async (req, reply) => {
      const { employee_id, date, type, portion, half_period, memo } = req.body
      if (!employee_id || !date || !type) return reply.code(400).send({ error: '필수 항목이 누락됐습니다' })
      if (!TYPES.includes(type)) return reply.code(400).send({ error: 'type이 올바르지 않습니다' })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: '날짜 형식은 YYYY-MM-DD 입니다' })

      const finalPortion = portion === 0.5 ? 0.5 : 1.0
      const finalHalf = finalPortion === 0.5 ? (half_period === 'pm' ? 'pm' : 'am') : null

      if (!verifyEmployeeInBusiness(req.params.slug, employee_id))
        return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })

      try {
        const result = db.prepare(
          'INSERT INTO time_off (employee_id, date, type, portion, half_period, memo) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(employee_id, date, type, finalPortion, finalHalf, memo?.trim() || null)
        return db.prepare('SELECT * FROM time_off WHERE id = ?').get(result.lastInsertRowid)
      } catch (e: any) {
        if (String(e.message).includes('UNIQUE')) {
          return reply.code(409).send({ error: '같은 날짜에 이미 같은 시간대 휴가가 등록돼 있습니다' })
        }
        throw e
      }
    }
  )

  // 휴가 삭제 (관리자)
  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/:slug/time-off/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const id = Number(req.params.id)
      const row = db.prepare(`
        SELECT t.id FROM time_off t
        JOIN employees e ON e.id = t.employee_id
        JOIN businesses b ON b.id = e.business_id
        WHERE t.id = ? AND b.slug = ?
      `).get(id, req.params.slug)
      if (!row) return reply.code(404).send({ error: '기록을 찾을 수 없습니다' })
      db.prepare('DELETE FROM time_off WHERE id = ?').run(id)
      return { ok: true }
    }
  )
}
