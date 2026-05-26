import { FastifyInstance } from 'fastify'
import { db, hashPin } from '../db'
import { requireAdminAuth } from '../middleware/auth'

function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let attempt = 0; attempt < 10; attempt++) {
    let slug = ''
    for (let i = 0; i < 6; i++) slug += chars[Math.floor(Math.random() * chars.length)]
    if (!db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug)) return slug
  }
  throw new Error('슬러그 생성 실패')
}

export default async function adminRoutes(app: FastifyInstance) {
  // 1) 모든 사업장 + owner 정보 목록
  app.get('/api/admin/businesses', { preHandler: requireAdminAuth }, async () => {
    return db.prepare(`
      SELECT b.id, b.slug, b.name, b.created_at, b.time_off_enabled,
             b.is_active, b.suspended_at,
             u.id AS owner_user_id, u.email AS owner_email, u.name AS owner_name,
             u.last_login_at AS owner_last_login,
             (SELECT COUNT(*) FROM employees WHERE business_id = b.id) AS employee_count
      FROM businesses b
      LEFT JOIN users u ON u.id = b.owner_user_id
      ORDER BY b.created_at DESC
    `).all()
  })

  // 사업장 활성/정지 토글
  app.patch<{ Params: { slug: string }; Body: { is_active: boolean } }>(
    '/api/admin/businesses/:slug/status', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })
      const active = req.body.is_active ? 1 : 0
      const suspendedAt = active === 0
        ? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : null
      db.prepare('UPDATE businesses SET is_active = ?, suspended_at = ? WHERE slug = ?')
        .run(active, suspendedAt, req.params.slug)
      return { ok: true, is_active: active, suspended_at: suspendedAt }
    }
  )

  // 2) 신규 사업장 프로비저닝 — 사업장 생성 + owner 매핑 한 번에
  app.post<{ Body: { name: string; manager_pin: string; owner_email: string } }>(
    '/api/admin/businesses/provision', { preHandler: requireAdminAuth }, async (req, reply) => {
      const { name, manager_pin, owner_email } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '사업장명 필수' })
      if (!manager_pin || manager_pin.length < 4) return reply.code(400).send({ error: 'PIN 4자리 이상' })
      if (!owner_email?.trim() || !owner_email.includes('@')) return reply.code(400).send({ error: '올바른 이메일 필수' })

      const slug = generateSlug()
      const hashedPin = hashPin(manager_pin)

      // owner placeholder user (이미 있으면 재사용)
      const email = owner_email.trim().toLowerCase()
      let user = db.prepare("SELECT id FROM users WHERE provider = 'google' AND email = ?").get(email) as any
      if (!user) {
        const placeholder = `pending:${email}`
        const result = db.prepare(
          'INSERT INTO users (provider, provider_id, email) VALUES (?, ?, ?)'
        ).run('google', placeholder, email)
        user = { id: Number(result.lastInsertRowid) }
      }

      db.prepare('INSERT INTO businesses (slug, name, manager_pin, owner_user_id, time_off_enabled) VALUES (?, ?, ?, ?, 0)')
        .run(slug, name.trim(), hashedPin, user.id)

      return { ok: true, slug, name: name.trim(), owner_email: email, owner_user_id: user.id }
    }
  )

  // 3) owner 이메일 변경/해제
  app.patch<{ Params: { slug: string }; Body: { owner_email: string | null } }>(
    '/api/admin/businesses/:slug/owner', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })

      if (req.body.owner_email === null) {
        db.prepare('UPDATE businesses SET owner_user_id = NULL WHERE slug = ?').run(req.params.slug)
        return { ok: true, owner_user_id: null }
      }

      const email = req.body.owner_email.trim().toLowerCase()
      if (!email.includes('@')) return reply.code(400).send({ error: '올바른 이메일 필수' })

      let user = db.prepare("SELECT id FROM users WHERE provider = 'google' AND email = ?").get(email) as any
      if (!user) {
        const placeholder = `pending:${email}`
        const result = db.prepare(
          'INSERT INTO users (provider, provider_id, email) VALUES (?, ?, ?)'
        ).run('google', placeholder, email)
        user = { id: Number(result.lastInsertRowid) }
      }
      db.prepare('UPDATE businesses SET owner_user_id = ? WHERE slug = ?').run(user.id, req.params.slug)
      return { ok: true, owner_user_id: user.id, email }
    }
  )

  // 4) 어드민 본인 확인 (UI 진입 검증용)
  app.get('/api/admin/me', { preHandler: requireAdminAuth }, async () => {
    return { ok: true, role: 'admin' }
  })
}
