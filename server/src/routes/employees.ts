import { FastifyInstance } from 'fastify'
import { db, generateAccessToken } from '../db'
import { requireManagerAuth } from '../middleware/auth'

function getBizId(slug: string): number | null {
  const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug) as any
  return biz?.id ?? null
}

function attachStatus(e: any) {
  const active = db.prepare(
    'SELECT id, clock_in FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).get(e.id) as { id: number; clock_in: string } | undefined
  return { ...e, is_working: !!active, clock_in: active?.clock_in ?? null }
}

export default async function employeesRoutes(app: FastifyInstance) {
  app.get<{ Params: { slug: string } }>('/api/:slug/employees', async (req, reply) => {
    const bizId = getBizId(req.params.slug)
    if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

    const employees = db.prepare('SELECT * FROM employees WHERE business_id = ? ORDER BY id').all(bizId) as any[]
    return employees.map(attachStatus)
  })

  // 토큰으로 직원 조회 (개인 링크 진입 시 사용, 인증 불필요)
  app.get<{ Params: { slug: string; token: string } }>(
    '/api/:slug/employees/by-token/:token', async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const emp = db.prepare(
        'SELECT * FROM employees WHERE business_id = ? AND access_token = ?'
      ).get(bizId, req.params.token) as any
      if (!emp) return reply.code(404).send({ error: '유효하지 않은 링크입니다' })
      return attachStatus(emp)
    }
  )

  app.post<{ Params: { slug: string }; Body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean } }>(
    '/api/:slug/employees', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const { name, hourly_rate, color, pay_enabled } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '이름을 입력하세요' })
      const token = generateAccessToken()
      const result = db.prepare(
        'INSERT INTO employees (business_id, name, hourly_rate, color, access_token, pay_enabled) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(bizId, name.trim(), hourly_rate || 10320, color || '#3B82F6', token, pay_enabled === false ? 0 : 1)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid)
    }
  )

  app.put<{ Params: { slug: string; id: string }; Body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean } }>(
    '/api/:slug/employees/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const { name, hourly_rate, color, pay_enabled } = req.body
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      if (typeof pay_enabled === 'boolean') {
        db.prepare('UPDATE employees SET name=?, hourly_rate=?, color=?, pay_enabled=? WHERE id=?')
          .run(name, hourly_rate, color, pay_enabled ? 1 : 0, id)
      } else {
        db.prepare('UPDATE employees SET name=?, hourly_rate=?, color=? WHERE id=?')
          .run(name, hourly_rate, color, id)
      }
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(id)
    }
  )

  // 직원 토큰 재발급 (관리자 전용)
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id/regenerate-token', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const token = generateAccessToken()
      db.prepare('UPDATE employees SET access_token = ? WHERE id = ?').run(token, id)
      return { ok: true, access_token: token }
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
