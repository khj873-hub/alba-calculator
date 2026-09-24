// ───────────────────────────────────────────────────────────────────────────
// 퍼펙트 AI 매니저(에이전트) 전용 **읽기 전용** 라우트.
//
// 이 SaaS는 멀티테넌트이므로, 환경변수 AGENT_STORE_SLUG 로 지정한 **단일 매장만**
// 노출한다(다른 사업장 데이터 격리). 인증은 헤더 x-agent-token === AGENT_READ_TOKEN.
// 테이블은 읽기만 하며(쓰기 없음), 전화번호·PIN 등 PII 는 반환하지 않는다.
//
// 설치:
//   server/src/index.ts 에서:
//     import { registerAgentRoutes } from './routes/agent'
//     registerAgentRoutes(app, db)
//   Railway Variables:
//     AGENT_READ_TOKEN=<길고 강한 랜덤값>
//     AGENT_STORE_SLUG=<AI 매니저가 읽을 매장 slug (예: xacyqf)>
// ───────────────────────────────────────────────────────────────────────────
import type { FastifyInstance, FastifyReply } from 'fastify'
import type Database from 'better-sqlite3'

export function registerAgentRoutes(app: FastifyInstance, db: Database.Database): void {
  // /api/agent/* 전체에 토큰 인증. 토큰 미설정이면 전면 차단.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/agent/')) return
    const token = process.env.AGENT_READ_TOKEN
    if (!token || req.headers['x-agent-token'] !== token) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  const allowedSlug = (): string => process.env.AGENT_STORE_SLUG || ''

  // 요청 store 가 허용 매장과 일치하는지 확인. 불일치/미설정이면 응답을 보내고 null 반환.
  function resolveStore(store: string | undefined, reply: FastifyReply): string | null {
    const allowed = allowedSlug()
    if (!allowed) {
      reply.code(503).send({ error: 'agent store not configured' })
      return null
    }
    const s = store ?? allowed
    if (s !== allowed) {
      reply.code(403).send({ error: 'store not allowed' })
      return null
    }
    return s
  }

  // 매장 목록: 허용된 1곳만 반환
  app.get('/api/agent/stores', async (_req, reply) => {
    const allowed = allowedSlug()
    if (!allowed) return reply.code(503).send({ error: 'agent store not configured' })
    return db.prepare('SELECT slug AS id, name FROM businesses WHERE slug = ?').all(allowed)
  })

  // 직원: 시급 포함, PII 제외. status='active' → active 1.
  app.get<{ Querystring: { store?: string } }>('/api/agent/employees', async (req, reply) => {
    const store = resolveStore(req.query.store, reply)
    if (!store) return
    return db
      .prepare(
        `SELECT e.id, e.name, e.hourly_rate AS hourly_wage,
                CASE WHEN e.status = 'active' THEN 1 ELSE 0 END AS active
         FROM employees e JOIN businesses b ON b.id = e.business_id
         WHERE b.slug = ?`,
      )
      .all(store)
  })

  // 출퇴근(세션행): clock_in/clock_out 은 "YYYY-MM-DD HH:MM:SS" KST 문자열.
  // from(포함)·to(배타) 는 날짜 문자열(YYYY-MM-DD). TEXT 비교로 기간 필터.
  app.get<{ Querystring: { store?: string; from?: string; to?: string } }>(
    '/api/agent/attendance',
    async (req, reply) => {
      const store = resolveStore(req.query.store, reply)
      if (!store) return
      const { from, to } = req.query
      if (!from || !to) return reply.code(400).send({ error: 'from/to 필요' })
      return db
        .prepare(
          `SELECT a.id, a.employee_id, a.clock_in, a.clock_out
           FROM attendance a
           JOIN employees e ON e.id = a.employee_id
           JOIN businesses b ON b.id = e.business_id
           WHERE b.slug = ? AND a.clock_in >= ? AND a.clock_in < ?
           ORDER BY a.clock_in`,
        )
        .all(store, from, to)
    },
  )
}
