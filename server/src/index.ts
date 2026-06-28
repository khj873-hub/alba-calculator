import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import staticFiles from '@fastify/static'
import path from 'path'
import 'dotenv/config'
import businessesRoutes from './routes/businesses'
import employeesRoutes from './routes/employees'
import attendanceRoutes from './routes/attendance'
import timeOffRoutes from './routes/timeOff'
import oauthRoutes from './routes/oauth'
import adminRoutes from './routes/admin'
import inquiriesRoutes from './routes/inquiries'
import departmentsRoutes from './routes/departments'
import authRoutes from './routes/auth'
import { db } from './db'
import { startBackup } from './backup'

function todayKSTYmd() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// trustProxy: Railway 등 리버스 프록시 뒤에서 req.ip를 X-Forwarded-For의 실제 클라이언트 IP로 해석.
// 미설정 시 req.ip가 프록시 연결마다 달라져 IP 기반 rate-limit(PIN 브루트포스 방어)이 무력화된다.
const app = Fastify({ logger: false, trustProxy: true })

const isProd = process.env.NODE_ENV === 'production'

// CORS — prod에서는 명시 도메인만 허용. ALLOWED_ORIGIN 우선, 없으면 PUBLIC_ORIGIN(사이트 도메인) 사용.
// 둘 다 없을 때만 와일드카드(true)로 폴백하되 경고를 남겨 운영자가 인지하게 한다.
const allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.PUBLIC_ORIGIN
if (isProd && !allowedOrigin) {
  console.warn('[cors] ⚠️  ALLOWED_ORIGIN/PUBLIC_ORIGIN 미설정 — 모든 origin 허용(보안 권장 X). 환경변수 설정 필요.')
}
app.register(cors, {
  origin: isProd ? (allowedOrigin || true) : ['http://localhost:5173', 'http://localhost:5174']
})

// Rate-limit 플러그인 등록. global:false → 전역엔 미적용, 라우트별 config.rateLimit만 활성화
// (PIN 브루트포스 방어, 문의 스팸 방어). 등록이 빠지면 라우트의 config.rateLimit이 조용히 무시된다.
app.register(rateLimit, { global: false })

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
app.register(departmentsRoutes)
app.register(authRoutes)

app.get('/api/health', async () => ({ ok: true }))

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
