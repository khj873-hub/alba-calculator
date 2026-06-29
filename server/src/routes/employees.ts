import { FastifyInstance } from 'fastify'
import { db, generateAccessToken } from '../db'
import { requireManagerAuth } from '../middleware/auth'
import { activeLimit, getPlan, planAllows } from '../plans'

// CSV 일괄 등록 시 직원 프로필 색 자동 배정용 팔레트(순환)
const COLOR_PALETTE = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1']

function getBizId(slug: string): number | null {
  const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug) as any
  return biz?.id ?? null
}

function getBiz(slug: string): { id: number; plan: string } | null {
  const biz = db.prepare('SELECT id, plan FROM businesses WHERE slug = ?').get(slug) as any
  return biz ? { id: biz.id, plan: biz.plan ?? 'free' } : null
}

function countActive(bizId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM employees WHERE business_id = ? AND status = 'active'").get(bizId) as any).n
}

// 활성 인원 한도 초과 여부. 초과면 표준화된 403 응답 객체 반환, 여유 있으면 null.
function planLimitBlock(plan: string, bizId: number) {
  const limit = activeLimit(plan)
  if (limit === null) return null // 무제한
  if (countActive(bizId) >= limit) {
    return {
      error: `현재 플랜(${getPlan(plan).label}) 활성 인원 ${limit}명을 초과했습니다. 기존 직원을 퇴사 처리하거나 플랜을 업그레이드하세요.`,
      code: 'PLAN_LIMIT',
      plan,
      limit,
      active: countActive(bizId),
    }
  }
  return null
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

  app.post<{ Params: { slug: string }; Body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean; pay_includes_holiday?: boolean } }>(
    '/api/:slug/employees', { preHandler: requireManagerAuth }, async (req, reply) => {
      const biz = getBiz(req.params.slug)
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const bizId = biz.id
      const { name, hourly_rate, color, pay_enabled, pay_includes_holiday } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '이름을 입력하세요' })
      // 플랜 활성 인원 한도 체크 (신규 직원은 active 로 추가되므로 등록 전 검사)
      const block = planLimitBlock(biz.plan, bizId)
      if (block) return reply.code(403).send(block)
      const token = generateAccessToken()
      const result = db.prepare(
        'INSERT INTO employees (business_id, name, hourly_rate, color, access_token, pay_enabled, pay_includes_holiday) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(bizId, name.trim(), hourly_rate || 10320, color || '#3B82F6', token, pay_enabled === false ? 0 : 1, pay_includes_holiday === true ? 1 : 0)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid)
    }
  )

  // CSV 일괄 등록 — 엔터프라이즈 전용. 클라가 파싱한 행 배열을 받아 서버가 전 필드 재검증 후 트랜잭션 일괄 INSERT.
  app.post<{ Params: { slug: string }; Body: { employees: { name: string; hourly_rate?: number | string; department?: string; pay_includes_holiday?: boolean; pay_enabled?: boolean }[] } }>(
    '/api/:slug/employees/bulk', { preHandler: requireManagerAuth }, async (req, reply) => {
      const biz = getBiz(req.params.slug)
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!planAllows(biz.plan, 'bulkImport')) {
        return reply.code(403).send({ error: '직원 CSV 일괄 등록은 엔터프라이즈 플랜에서 사용할 수 있습니다.', code: 'PLAN_FEATURE', feature: 'bulkImport', plan: biz.plan })
      }
      const rows = req.body?.employees
      if (!Array.isArray(rows) || rows.length === 0) return reply.code(400).send({ error: '등록할 직원이 없습니다' })
      if (rows.length > 300) return reply.code(400).send({ error: '한 번에 최대 300명까지 등록할 수 있습니다' })

      // 전 행 서버 재검증 (클라 파싱 결과를 신뢰하지 않음)
      const errors: { row: number; reason: string }[] = []
      const clean = rows.map((r, i) => {
        const name = (r?.name ?? '').toString().trim()
        if (!name) errors.push({ row: i + 1, reason: '이름 누락' })
        let rate = 10320
        const raw = r?.hourly_rate
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
          const n = Number(raw)
          if (!Number.isFinite(n) || n < 0) errors.push({ row: i + 1, reason: '시급이 올바르지 않음' })
          else rate = Math.floor(n)
        }
        return {
          name, rate,
          department: (r?.department ?? '').toString().trim(),
          pay_enabled: r?.pay_enabled === false ? 0 : 1,
          pay_includes_holiday: r?.pay_includes_holiday === true ? 1 : 0,
        }
      })
      if (errors.length) return reply.code(400).send({ error: 'CSV에 오류가 있습니다', code: 'CSV_INVALID', errors })

      // 활성 인원 한도 합산 검사 (현재 활성 + 등록할 행 수)
      const limit = activeLimit(biz.plan)
      const active = countActive(biz.id)
      if (limit !== null && active + clean.length > limit) {
        return reply.code(403).send({ error: `활성 인원 한도를 초과합니다. 현재 ${active}명 / 한도 ${limit}명`, code: 'PLAN_LIMIT', plan: biz.plan, limit, active, allowed: Math.max(0, limit - active) })
      }

      // 부서명 → id 매칭(같은 사업장). 없는 부서명은 미배속 + 경고.
      const depts = db.prepare('SELECT id, name FROM departments WHERE business_id = ?').all(biz.id) as any[]
      const deptMap = new Map<string, number>(depts.map((d) => [d.name, d.id]))
      const unmatched = new Set<string>()

      const ins = db.prepare('INSERT INTO employees (business_id, name, hourly_rate, color, access_token, pay_enabled, pay_includes_holiday, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const tx = db.transaction(() => {
        clean.forEach((c, i) => {
          let deptId: number | null = null
          if (c.department) {
            if (deptMap.has(c.department)) deptId = deptMap.get(c.department)!
            else unmatched.add(c.department)
          }
          const color = COLOR_PALETTE[(active + i) % COLOR_PALETTE.length]
          ins.run(biz.id, c.name, c.rate, color, generateAccessToken(), c.pay_enabled, c.pay_includes_holiday, deptId)
        })
      })
      tx()
      return { ok: true, created: clean.length, unmatchedDepartments: [...unmatched] }
    }
  )

  app.put<{ Params: { slug: string; id: string }; Body: { name: string; hourly_rate: number; color: string; pay_enabled?: boolean; pay_includes_holiday?: boolean } }>(
    '/api/:slug/employees/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const { name, hourly_rate, color, pay_enabled, pay_includes_holiday } = req.body
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const sets: string[] = ['name=?', 'hourly_rate=?', 'color=?']
      const params: any[] = [name, hourly_rate, color]
      if (typeof pay_enabled === 'boolean') { sets.push('pay_enabled=?'); params.push(pay_enabled ? 1 : 0) }
      if (typeof pay_includes_holiday === 'boolean') { sets.push('pay_includes_holiday=?'); params.push(pay_includes_holiday ? 1 : 0) }
      params.push(id)
      db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id=?`).run(...params)
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

  // 직원 부서 배정(개별) — 엔터프라이즈 전용. department_id=null 이면 미배속 해제.
  // 게이트 + 직원·부서 양쪽 business_id 스코프 검증(타 사업장 부서로 배정 차단).
  app.patch<{ Params: { slug: string; id: string }; Body: { department_id: number | null } }>(
    '/api/:slug/employees/:id/department', { preHandler: requireManagerAuth }, async (req, reply) => {
      const biz = getBiz(req.params.slug)
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!planAllows(biz.plan, 'departments')) {
        return reply.code(403).send({
          error: '부서 기능은 엔터프라이즈 플랜에서 사용할 수 있습니다.',
          code: 'PLAN_FEATURE', feature: 'departments', plan: biz.plan,
        })
      }
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, biz.id)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const deptId = req.body?.department_id ?? null
      if (deptId !== null) {
        const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND business_id = ?').get(deptId, biz.id)
        if (!dept) return reply.code(400).send({ error: '유효하지 않은 부서입니다' })
      }
      db.prepare('UPDATE employees SET department_id = ? WHERE id = ?').run(deptId, id)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(id)
    }
  )

  // 퇴사 처리 (soft) — 레코드 보존, 활성 카운트에서 제외. 근무 중이면 거부.
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id/resign', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const working = db.prepare(
        'SELECT id FROM attendance WHERE employee_id = ? AND clock_out IS NULL LIMIT 1'
      ).get(id)
      if (working) return reply.code(409).send({ error: '근무 중인 직원입니다. 퇴근 처리 후 퇴사할 수 있어요.' })
      db.prepare("UPDATE employees SET status = 'resigned', resigned_at = datetime('now','localtime') WHERE id = ?").run(id)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(id)
    }
  )

  // 복원 (재직) — 퇴사자를 다시 활성으로. 활성 카운트에 다시 포함되므로 한도 체크.
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id/restore', { preHandler: requireManagerAuth }, async (req, reply) => {
      const biz = getBiz(req.params.slug)
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, biz.id)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const block = planLimitBlock(biz.plan, biz.id)
      if (block) return reply.code(403).send(block)
      db.prepare("UPDATE employees SET status = 'active', resigned_at = NULL WHERE id = ?").run(id)
      return db.prepare('SELECT * FROM employees WHERE id = ?').get(id)
    }
  )

  // 완전 삭제 — 근태 기록이 있으면 거부(법적 보관). 기록 없는 오등록만 삭제 가능.
  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/:slug/employees/:id', { preHandler: requireManagerAuth }, async (req, reply) => {
      const bizId = getBizId(req.params.slug)
      if (!bizId) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      const id = Number(req.params.id)
      const exists = db.prepare('SELECT id FROM employees WHERE id = ? AND business_id = ?').get(id, bizId)
      if (!exists) return reply.code(404).send({ error: '직원을 찾을 수 없습니다' })
      const hasRecord = db.prepare('SELECT id FROM attendance WHERE employee_id = ? LIMIT 1').get(id)
      if (hasRecord) {
        return reply.code(409).send({ error: '근태 기록이 있는 직원은 삭제할 수 없습니다. 퇴사 처리로 보존하세요.' })
      }
      db.prepare('DELETE FROM employees WHERE id = ?').run(id)
      return { ok: true }
    }
  )
}
