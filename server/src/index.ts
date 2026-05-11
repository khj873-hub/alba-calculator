import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import staticFiles from '@fastify/static'
import path from 'path'
import { randomBytes } from 'crypto'
import 'dotenv/config'
import businessesRoutes from './routes/businesses'
import employeesRoutes from './routes/employees'
import attendanceRoutes from './routes/attendance'
import { db, verifyPinHash } from './db'

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function expiresKST(hours = 24) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

const app = Fastify({ logger: false })

const isProd = process.env.NODE_ENV === 'production'
app.register(cors, {
  origin: isProd ? (process.env.ALLOWED_ORIGIN || true) : ['http://localhost:5173', 'http://localhost:5174']
})

app.register(businessesRoutes)
app.register(employeesRoutes)
app.register(attendanceRoutes)

app.get('/api/health', async () => ({ ok: true }))

// 사업장별 PIN 인증 → 세션 토큰 발급 (브루트포스 방어: slug+IP당 1분 10회)
app.post<{ Params: { slug: string }; Body: { pin: string } }>(
  '/api/:slug/auth/pin',
  {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => `pin:${req.params?.slug}:${req.ip}`,
        errorResponseBuilder: () => ({ error: 'PIN 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.' })
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

if (isProd) {
  const clientDist = path.resolve(__dirname, '../../client/dist')
  app.register(staticFiles, { root: clientDist, prefix: '/' })
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html', clientDist))
}

const PORT = Number(process.env.PORT) || 3002
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1) }
  console.log(`Alba server running on http://localhost:${PORT}`)
})
