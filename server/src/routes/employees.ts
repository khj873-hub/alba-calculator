import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth } from '../middleware/auth'

function getBizId(slug: string): number | null {
  const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug) as any
  return biz?.id ?? null
}

export default async function employeesRoutes(app: FastifyInstance) {
  app.get<{ Params: { slug: string } }>('/api/:slug/employees', async (req, reply) => {
    const bizId = getBizId(req.params.slug)
    if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

    const employees = db.prepare('SELECT * FROM employees WHERE business_id = ? ORDER BY id').all(bizId)
    return employees.map((e: any) => {
      const active = db.prepare(
        'SELECT id, clock_in FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
      ).get(e.id) as { id: number; clock_in: string } | undefined
      return { ...e, is_working: !!active, clock_in: active?.clock_in ?? null }
    })
  })

  app.post<{ Params: { slug: string }; Body: { name: string; hourly_rate: number; color: string } }>(
    '/api/:slug/employees', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const { name, hourly_rate, color } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '이름을 입력하세요' })
      const result = db.prepare(
        'INSERT INTO employees (business_id, name, hourly_rate, color) VALUES (?, ?, ?, ?)'
      ).run(bizId, name.trim(), hourly_rate || 9860, color || '#3B82F6')
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid)
    }
  )

  app.put<{ Params: { slug: string; id: string }; Body: { name: string; hourly_rate: number; color: string } }>(
    '/api/:slug/employees/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const { name, hourly_rate, color } = req.body
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      db.prepare('UPDATE employees SET name=?, hourly_rate=?, color=? WHERE id=?').run(name, hourly_rate, color, id)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(id)
    }
  )

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      db.prepare('DELETE FROM employees WHERE id = ?').run(id)
      return { ok: true }
    }
  )
}
