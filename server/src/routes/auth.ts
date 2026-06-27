import { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { db, verifyPinHash } from '../db'

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function expiresKST(hours = 24) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

// 사업장별 PIN 인증 라우트. 라우트 플러그인으로 분리한 이유:
// @fastify/rate-limit은 onRoute 훅으로 라우트별 config.rateLimit을 읽는데,
// index.ts에 직접 app.post로 등록하면 rate-limit 플러그인 로드 전에 라우트가 등록돼
// 브루트포스 방어가 적용되지 않는다. register로 묶어야 확실히 적용된다.
export default async function authRoutes(app: FastifyInstance) {
  // PIN 인증 → 세션 토큰 발급 (브루트포스 방어: IP당 1분 10회)
  app.post<{ Params: { slug: string }; Body: { pin: string } }>(
    '/api/:slug/auth/pin',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          // IP 기준으로 분당 10회. slug별이 아닌 IP 총량 제한이라 여러 사업장을 순회하는 브루트포스도 차단.
          keyGenerator: (req: any) => `pin:${req.ip}`,
          // statusCode를 명시해야 429로 응답(미지정 시 Fastify가 500 처리).
          errorResponseBuilder: () => ({ statusCode: 429, error: 'PIN 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.' })
        }
      }
    },
    async (req, reply) => {
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(req.body.pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      // 만료 세션 정리 후 새 토큰 발급
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowKST())
      const token = randomBytes(32).toString('hex')
      db.prepare('INSERT INTO sessions (token, slug, expires_at) VALUES (?, ?, ?)').run(token, req.params.slug, expiresKST(24))
      return { ok: true, token }
    }
  )
}
