import { FastifyInstance } from 'fastify'
import { db, hashPin, verifyPinHash } from '../db'

function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let attempt = 0; attempt < 10; attempt++) {
    let slug = ''
    for (let i = 0; i < 6; i++) slug += chars[Math.floor(Math.random() * chars.length)]
    if (!db.prepare('SELECT id FROM businesses WHERE slug = ?').get(slug)) return slug
  }
  throw new Error('슬러그 생성 실패: 잠시 후 다시 시도해주세요')
}

export default async function businessesRoutes(app: FastifyInstance) {
  // 사업장 생성
  app.post<{ Body: { name: string; manager_pin: string } }>(
    '/api/businesses', async (req, reply) => {
      const { name, manager_pin } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '사업장명을 입력하세요' })
      if (!manager_pin || manager_pin.length < 4) return reply.code(400).send({ error: 'PIN은 4자리 이상이어야 합니다' })
      const slug = generateSlug()
      const hashedPin = hashPin(manager_pin)
      db.prepare('INSERT INTO businesses (slug, name, manager_pin) VALUES (?, ?, ?)').run(slug, name.trim(), hashedPin)
      return { slug, name: name.trim() }
    }
  )

  // 전체 사업장 목록 (PIN 미포함)
  app.get('/api/businesses', async () => {
    return db.prepare('SELECT id, slug, name, created_at, lat, lng, radius_meters FROM businesses ORDER BY created_at DESC').all()
  })

  // 사업장 존재 확인 (PIN 미포함)
  app.get<{ Params: { slug: string } }>(
    '/api/businesses/:slug', async (req, reply) => {
      const biz = db.prepare('SELECT id, slug, name, created_at, lat, lng, radius_meters FROM businesses WHERE slug = ?').get(req.params.slug)
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      return biz
    }
  )

  // 사업장 이름 수정 (PIN 인증 필요)
  app.put<{ Params: { slug: string }; Body: { name: string; pin: string } }>(
    '/api/businesses/:slug', async (req, reply) => {
      const { name, pin } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '사업장명을 입력하세요' })
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      db.prepare('UPDATE businesses SET name = ? WHERE slug = ?').run(name.trim(), req.params.slug)
      return db.prepare('SELECT id, slug, name, created_at FROM businesses WHERE slug = ?').get(req.params.slug)
    }
  )

  // 사업장 위치 설정 (PIN 인증 필요)
  app.patch<{ Params: { slug: string }; Body: { pin: string; lat: number | null; lng: number | null; radius_meters: number } }>(
    '/api/businesses/:slug/location', async (req, reply) => {
      const { pin, lat, lng, radius_meters } = req.body
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      db.prepare('UPDATE businesses SET lat=?, lng=?, radius_meters=? WHERE slug=?')
        .run(lat ?? null, lng ?? null, radius_meters ?? 300, req.params.slug)
      return { ok: true }
    }
  )

  // PIN 변경 (현재 PIN 인증 필요)
  app.patch<{ Params: { slug: string }; Body: { current_pin: string; new_pin: string } }>(
    '/api/businesses/:slug/pin', async (req, reply) => {
      const { current_pin, new_pin } = req.body
      if (!new_pin || new_pin.length < 4) return reply.code(400).send({ error: '새 PIN은 4자리 이상이어야 합니다' })
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(current_pin, biz.manager_pin)) return reply.code(401).send({ error: '현재 PIN이 올바르지 않습니다' })
      db.prepare('UPDATE businesses SET manager_pin = ? WHERE slug = ?').run(hashPin(new_pin), req.params.slug)
      return { ok: true }
    }
  )

  // 사업장 삭제 (PIN 인증 필요, 직원·근태 데이터 모두 삭제)
  app.delete<{ Params: { slug: string }; Body: { pin: string } }>(
    '/api/businesses/:slug', async (req, reply) => {
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(req.body.pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      db.prepare('DELETE FROM businesses WHERE slug = ?').run(req.params.slug)
      return { ok: true }
    }
  )
}
