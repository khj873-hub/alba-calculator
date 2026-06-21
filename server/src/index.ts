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
import timeOffRoutes from './routes/timeOff'
import oauthRoutes from './routes/oauth'
import adminRoutes from './routes/admin'
import inquiriesRoutes from './routes/inquiries'
import { db, verifyPinHash } from './db'
import { startBackup } from './backup'

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function expiresKST(hours = 24) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function todayKSTYmd() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const app = Fastify({ logger: false })

const isProd = process.env.NODE_ENV === 'production'
app.register(cors, {
  origin: isProd ? (process.env.ALLOWED_ORIGIN || true) : ['http://localhost:5173', 'http://localhost:5174']
})

// 사업장 정지(is_active=0) 시 사장·직원 API 차단. 어드민·OAuth·health는 화이트리스트.
app.addHook('onRequest', async (req, reply) => {
  const url = req.url.split('?')[0]
  if (!url.startsWith('/api/')) return
  if (url === '/api/health') return
  if (url.startsWith('/api/admin/')) return
  if (url.startsWith('/api/auth/')) return
  // 사업장 신규 생성·전체 목록은 정지와 무관
  if (url === '/api/businesses') return

  // 슬러그 추출: /api/businesses/:slug/... 또는 /api/:slug/...
  let slug: string | null = null
  const m1 = url.match(/^\/api\/businesses\/([a-zA-Z0-9_-]+)/)
  if (m1) slug = m1[1]
  else {
    const m2 = url.match(/^\/api\/([a-zA-Z0-9_-]+)\//)
    if (m2 && !['businesses', 'admin', 'auth', 'health'].includes(m2[1])) slug = m2[1]
  }
  if (!slug) return

  const biz = db.prepare('SELECT is_active, plan, plan_expires_at FROM businesses WHERE slug = ?').get(slug) as any
  if (biz) {
    // 유료 결제 만료 → 무료 자동 다운그레이드 (정지가 아니라 무료로 전환: 3명 한도 + 알림 OFF).
    // 모든 유료 플랜(basic/pro/enterprise/레거시 paid) 대상. free는 만료 개념 없음.
    if (biz.plan !== 'free' && biz.plan_expires_at && biz.plan_expires_at < todayKSTYmd()) {
      db.prepare("UPDATE businesses SET plan = 'free', plan_expires_at = NULL WHERE slug = ?").run(slug)
      biz.plan = 'free'
      biz.plan_expires_at = null
    }
    if (biz.is_active === 0) {
      return reply.code(403).send({
        error: 'service_suspended',
        message: '서비스 이용이 일시 제한되었습니다. 운영자에게 문의해주세요. (khj873@jinusoft.com)',
      })
    }
  }
})

app.register(businessesRoutes)
app.register(employeesRoutes)
app.register(attendanceRoutes)
app.register(timeOffRoutes)
app.register(oauthRoutes)
app.register(adminRoutes)
app.register(inquiriesRoutes)

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

// 시작 시 이미 만료된 유료 사업장을 무료로 일괄 다운그레이드.
// 미들웨어가 요청 시 lazy로도 처리하지만, 요청이 없어도 즉시 일관성을 맞춰
// 어드민 통계·이미 만료된 건(예: 배포 시점에 만료 상태)을 바로 정리한다.
function downgradeExpiredPlans() {
  const today = todayKSTYmd()
  const res = db
    .prepare(
      "UPDATE businesses SET plan = 'free', plan_expires_at = NULL WHERE plan != 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at < ?"
    )
    .run(today)
  if (res.changes > 0) {
    console.log(`[plan] 만료 사업장 ${res.changes}건 무료로 다운그레이드`)
  }
}

const PORT = Number(process.env.PORT) || 3002
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1) }
  console.log(`Alba server running on http://localhost:${PORT}`)
  downgradeExpiredPlans()
  startBackup()
})
