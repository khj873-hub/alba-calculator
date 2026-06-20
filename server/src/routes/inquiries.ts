import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdminAuth } from '../middleware/auth'
import { sendInquiryNotification } from '../utils/email'

const PHONE_RE = /^[0-9\-+\s()]{9,20}$/
const ALLOWED_STATUS = ['new', 'in_progress', 'done', 'spam'] as const
type InquiryStatus = typeof ALLOWED_STATUS[number]

export default async function inquiriesRoutes(app: FastifyInstance) {
  // 공개 — 사용자 폼 제출
  app.post<{
    Body: {
      source?: string | null
      inquiry_type?: string | null
      business_name: string
      phone: string
      content?: string | null
      agreed_privacy: boolean
      agreed_marketing?: boolean
    }
  }>(
    '/api/inquiries',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (req: any) => `inquiry:${req.ip}`,
          errorResponseBuilder: () => ({ error: '잠시 후 다시 시도해주세요.' }),
        },
      },
    },
    async (req, reply) => {
      const { source, inquiry_type, business_name, phone, content, agreed_privacy, agreed_marketing } = req.body || ({} as any)

      // 검증
      if (!agreed_privacy) return reply.code(400).send({ error: '개인정보 수집·이용 동의가 필요합니다.' })
      const name = (business_name || '').trim()
      const ph = (phone || '').trim()
      if (!name || name.length > 80) return reply.code(400).send({ error: '사업장명을 입력해주세요 (80자 이내)' })
      if (!ph || !PHONE_RE.test(ph)) return reply.code(400).send({ error: '휴대폰 번호 형식이 올바르지 않습니다.' })
      const text = (content || '').trim()
      if (text.length > 2000) return reply.code(400).send({ error: '문의 내용은 2000자 이내로 입력해주세요.' })
      const src = (source || '').trim().slice(0, 40)
      const itype = (inquiry_type || '').trim().slice(0, 40)

      const result = db.prepare(
        `INSERT INTO inquiries (source, inquiry_type, business_name, phone, content, agreed_marketing, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(src || null, itype || null, name, ph, text || null, agreed_marketing ? 1 : 0, req.ip || null)

      // 이메일 알림 — fire-and-forget. 실패해도 사용자에게는 OK 응답.
      const row = db.prepare(
        'SELECT created_at FROM inquiries WHERE id = ?',
      ).get(Number(result.lastInsertRowid)) as { created_at: string } | undefined
      sendInquiryNotification({
        business_name: name,
        phone: ph,
        inquiry_type: itype,
        source: src,
        content: text,
        agreed_marketing: !!agreed_marketing,
        ip: req.ip,
        created_at: row?.created_at || new Date().toISOString(),
      }).catch((e) => console.error('[inquiry-email]', e?.message || e))

      return { ok: true }
    },
  )

  // 운영자 — 목록 조회
  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/admin/inquiries',
    { preHandler: requireAdminAuth },
    async (req) => {
      const status = req.query?.status
      const limit = Math.min(Number(req.query?.limit) || 100, 500)
      const where = status && (ALLOWED_STATUS as readonly string[]).includes(status) ? 'WHERE status = ?' : ''
      const stmt = db.prepare(
        `SELECT id, source, inquiry_type, business_name, phone, content, agreed_marketing, ip, status, note, created_at, handled_at
         FROM inquiries ${where} ORDER BY created_at DESC LIMIT ?`,
      )
      const rows = where ? stmt.all(status, limit) : stmt.all(limit)
      const counts = db
        .prepare("SELECT status, COUNT(*) AS n FROM inquiries GROUP BY status")
        .all() as { status: string; n: number }[]
      return { rows, counts }
    },
  )

  // 운영자 — 상태 변경
  app.patch<{ Params: { id: string }; Body: { status?: InquiryStatus; note?: string } }>(
    '/api/admin/inquiries/:id/status',
    { preHandler: requireAdminAuth },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' })
      const found = db.prepare('SELECT id FROM inquiries WHERE id = ?').get(id)
      if (!found) return reply.code(404).send({ error: '문의 없음' })

      const status = req.body?.status
      const note = req.body?.note
      const fields: string[] = []
      const params: any[] = []
      if (status) {
        if (!(ALLOWED_STATUS as readonly string[]).includes(status)) {
          return reply.code(400).send({ error: '잘못된 상태 값' })
        }
        fields.push('status = ?')
        params.push(status)
        if (status !== 'new') {
          fields.push("handled_at = datetime('now','localtime')")
        }
      }
      if (note !== undefined) {
        fields.push('note = ?')
        params.push((note || '').slice(0, 1000))
      }
      if (fields.length === 0) return { ok: true }
      params.push(id)
      db.prepare(`UPDATE inquiries SET ${fields.join(', ')} WHERE id = ?`).run(...params)
      return { ok: true }
    },
  )

  // 운영자 — 삭제 (스팸 정리용)
  app.delete<{ Params: { id: string } }>(
    '/api/admin/inquiries/:id',
    { preHandler: requireAdminAuth },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' })
      db.prepare('DELETE FROM inquiries WHERE id = ?').run(id)
      return { ok: true }
    },
  )
}
