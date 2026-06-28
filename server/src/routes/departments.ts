import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireManagerAuth } from '../middleware/auth'
import { planAllows } from '../plans'

// 부서 쓰기 게이트 — 사업장 조회 + 엔터프라이즈(departments) 기능 확인.
// 성공 시 { bizId }, 실패 시 { err, body } 반환. (businesses.ts gps/notifications 게이트와 동일 컨벤션)
function deptGate(slug: string): { bizId: number } | { err: number; body?: any } {
  const biz = db.prepare('SELECT id, plan FROM businesses WHERE slug = ?').get(slug) as any
  if (!biz) return { err: 404, body: { error: '사업장을 찾을 수 없습니다' } }
  if (!planAllows(biz.plan ?? 'free', 'departments')) {
    return {
      err: 403,
      body: {
        error: '부서 기능은 엔터프라이즈 플랜에서 사용할 수 있습니다.',
        code: 'PLAN_FEATURE',
        feature: 'departments',
        plan: biz.plan ?? 'free',
      },
    }
  }
  return { bizId: biz.id }
}

function getBizId(slug: string): number | null {
  const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug) as any
  return biz?.id ?? null
}

export default async function departmentsRoutes(app: FastifyInstance) {
  // 부서 목록 — 인증 불필요(키오스크 2단계 네비에서 사용, employees GET과 동일 정책).
  // 게이트 없음: 비엔터는 부서 행이 없어 빈 배열. 각 부서의 활성 직원 수 포함.
  app.get<{ Params: { slug: string } }>('/api/:slug/departments', async (req, reply) => {
    const bizId = getBizId(req.params.slug)
    if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
    const rows = db.prepare(`
      SELECT d.id, d.name, d.sort_order,
             (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS employee_count
      FROM departments d
      WHERE d.business_id = ?
      ORDER BY d.sort_order, d.id
    `).all(bizId)
    return rows
  })

  // 부서 생성 — 매니저 인증 + 엔터 게이트.
  app.post<{ Params: { slug: string }; Body: { name: string } }>(
    '/api/:slug/departments', { preHandler: requireManagerAuth }, async (req, reply) => {
      const gate = deptGate(req.params.slug)
      if ('err' in gate) return reply.code(gate.err).send(gate.body)
      const name = (req.body?.name || '').trim()
      if (!name) return reply.code(400).send({ error: '부서명을 입력하세요' })
      const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM departments WHERE business_id = ?').get(gate.bizId) as any
      const result = db.prepare(
        'INSERT INTO departments (business_id, name, sort_order) VALUES (?, ?, ?)'
      ).run(gate.bizId, name, next.n)
      return db.prepare('SELECT id, name, sort_order FROM departments WHERE id = ?').get(result.lastInsertRowid)
    }
  )

  // 부서 수정(이름/순서) — 인증 + 게이트 + 스코프.
  app.put<{ Params: { slug: string; id: string }; Body: { name?: string; sort_order?: number } }>(
    '/api/:slug/departments/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const gate = deptGate(req.params.slug)
      if ('err' in gate) return reply.code(gate.err).send(gate.body)
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM departments WHERE id = ? AND business_id = ?').get(id, gate.bizId)
      if (!exists) return reply.code(404).send({ error: '부서를 찾을 수 없습니다' })
      const sets: string[] = []
      const params: any[] = []
      if (typeof req.body?.name === 'string') {
        const name = req.body.name.trim()
        if (!name) return reply.code(400).send({ error: '부서명을 입력하세요' })
        sets.push('name = ?'); params.push(name)
      }
      if (typeof req.body?.sort_order === 'number') { sets.push('sort_order = ?'); params.push(req.body.sort_order) }
      if (sets.length === 0) return reply.code(400).send({ error: '변경할 내용이 없습니다' })
      params.push(id)
      db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      return db.prepare('SELECT id, name, sort_order FROM departments WHERE id = ?').get(id)
    }
  )

  // 부서 삭제 — 인증 + 게이트 + 스코프. 트랜잭션으로 소속 직원 미배속(NULL) 강등 후 부서 삭제(데이터 보존).
  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/:slug/departments/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const gate = deptGate(req.params.slug)
      if ('err' in gate) return reply.code(gate.err).send(gate.body)
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM departments WHERE id = ? AND business_id = ?').get(id, gate.bizId)
      if (!exists) return reply.code(404).send({ error: '부서를 찾을 수 없습니다' })
      const tx = db.transaction(() => {
        const r = db.prepare('UPDATE employees SET department_id = NULL WHERE department_id = ? AND business_id = ?').run(id, gate.bizId)
        db.prepare('DELETE FROM departments WHERE id = ?').run(id)
        return r.changes
      })
      const unassigned = tx()
      return { ok: true, unassigned }
    }
  )
}
