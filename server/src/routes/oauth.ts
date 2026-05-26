import { FastifyInstance } from 'fastify'
import { OAuth2Client } from 'google-auth-library'
import { randomBytes } from 'crypto'
import { db, verifyPinHash } from '../db'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'http://localhost:5174'
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
)

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}

// OAuth state(=CSRF token) 임시 저장.
type StateCtx = { slug?: string; admin?: boolean; createdAt: number }
const stateStore = new Map<string, StateCtx>()
function pruneStates() {
  const now = Date.now()
  for (const [k, v] of stateStore) {
    if (now - v.createdAt > 10 * 60 * 1000) stateStore.delete(k) // 10분 만료
  }
}

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
function expiresKST(hours = 24) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function oauthEnabled(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET)
}

export default async function oauthRoutes(app: FastifyInstance) {
  // OAuth 활성화 여부 (프런트가 버튼 노출 여부 판단)
  app.get('/api/auth/google/status', async () => ({
    enabled: oauthEnabled(),
    admin_configured: ADMIN_EMAILS.size > 0,
  }))

  // 1) 로그인 시작 — 구글 OAuth URL로 redirect
  // - ?slug=xxx → 매니저(사장) 흐름
  // - ?admin=1 → 운영자 흐름 (콜백에서 ADMIN_EMAILS 매칭 확인)
  app.get<{ Querystring: { slug?: string; admin?: string } }>('/api/auth/google/start', async (req, reply) => {
    if (!oauthEnabled()) {
      return reply.code(503).send({ error: '구글 로그인이 설정되지 않았습니다 (서버 환경변수 미설정)' })
    }
    const isAdmin = req.query.admin === '1'
    const slug = (req.query.slug || '').trim()
    if (!isAdmin && !slug) return reply.code(400).send({ error: 'slug 또는 admin=1 필요' })

    pruneStates()
    const state = randomBytes(16).toString('hex')
    stateStore.set(state, { slug: isAdmin ? undefined : slug, admin: isAdmin, createdAt: Date.now() })

    const redirectUri = `${PUBLIC_ORIGIN}/api/auth/google/callback`
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    })
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  })

  // 2) 콜백 — code 교환·ID token 검증·사업장 매칭·세션 발급 후 프런트로 redirect
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/google/callback', async (req, reply) => {
    const { code, state, error } = req.query
    const errRedirect = (msg: string) =>
      reply.redirect(`${PUBLIC_ORIGIN}/?oauth_error=${encodeURIComponent(msg)}`)

    if (error) return errRedirect(`구글 인증 실패: ${error}`)
    if (!code || !state) return errRedirect('필수 파라미터 누락')

    pruneStates()
    const ctx = stateStore.get(state)
    if (!ctx) return errRedirect('잘못된 또는 만료된 요청 (10분 이내 재시도)')
    stateStore.delete(state)

    if (!oauthEnabled()) return errRedirect('서버 OAuth 설정 미완')

    const redirectUri = `${PUBLIC_ORIGIN}/api/auth/google/callback`
    const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri)

    let payload: any
    try {
      // code → token 교환
      const { tokens } = await client.getToken(code)
      if (!tokens.id_token) return errRedirect('ID token 미발급')

      // ID token 검증
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: CLIENT_ID })
      payload = ticket.getPayload()
      if (!payload || !payload.sub || !payload.email) return errRedirect('토큰 payload 불충분')
      if (payload.email_verified === false) return errRedirect('이메일 인증되지 않은 구글 계정')
    } catch (e: any) {
      console.error('OAuth token 검증 실패:', e?.message)
      return errRedirect('토큰 검증 실패')
    }

    // user upsert (sub로 먼저, 없으면 운영자가 미리 만든 placeholder를 이메일로 찾아 승격)
    let userId: number
    const bySub = db.prepare(
      'SELECT id FROM users WHERE provider = ? AND provider_id = ?'
    ).get('google', payload.sub) as any
    if (bySub) {
      db.prepare('UPDATE users SET email = ?, name = ?, picture_url = ?, last_login_at = ? WHERE id = ?')
        .run(payload.email, payload.name || null, payload.picture || null, nowKST(), bySub.id)
      userId = bySub.id
    } else {
      const placeholder = db.prepare(
        "SELECT id FROM users WHERE provider = 'google' AND email = ? AND provider_id LIKE 'pending:%'"
      ).get(payload.email) as any
      if (placeholder) {
        db.prepare('UPDATE users SET provider_id = ?, name = ?, picture_url = ?, last_login_at = ? WHERE id = ?')
          .run(payload.sub, payload.name || null, payload.picture || null, nowKST(), placeholder.id)
        userId = placeholder.id
      } else {
        const result = db.prepare(
          'INSERT INTO users (provider, provider_id, email, name, picture_url, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run('google', payload.sub, payload.email, payload.name || null, payload.picture || null, nowKST())
        userId = Number(result.lastInsertRowid)
      }
    }

    // 어드민 흐름: ADMIN_EMAILS와 매칭 확인
    if (ctx.admin) {
      if (!isAdminEmail(payload.email)) {
        return reply.redirect(`${PUBLIC_ORIGIN}/admin?oauth_error=${encodeURIComponent('운영자 권한이 없는 계정입니다')}`)
      }
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowKST())
      const sessionToken = randomBytes(32).toString('hex')
      db.prepare('INSERT INTO sessions (token, slug, expires_at) VALUES (?, ?, ?)')
        .run(sessionToken, '__admin__', expiresKST(24))
      return reply.redirect(`${PUBLIC_ORIGIN}/admin#token=${sessionToken}`)
    }

    // 매니저(사장) 흐름
    if (!ctx.slug) return errRedirect('내부 상태 누락')
    const biz = db.prepare('SELECT owner_user_id FROM businesses WHERE slug = ?').get(ctx.slug) as any
    if (!biz) return errRedirect('사업장을 찾을 수 없습니다')

    if (biz.owner_user_id != null && biz.owner_user_id !== userId) {
      return errRedirect('이 사업장에 연결된 다른 구글 계정으로 로그인해주세요')
    }

    if (biz.owner_user_id == null) {
      return reply.redirect(
        `${PUBLIC_ORIGIN}/${ctx.slug}/manager/login?oauth_unlinked=1&email=${encodeURIComponent(payload.email)}`
      )
    }

    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowKST())
    const sessionToken = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions (token, slug, expires_at) VALUES (?, ?, ?)')
      .run(sessionToken, ctx.slug, expiresKST(24))
    return reply.redirect(`${PUBLIC_ORIGIN}/${ctx.slug}/manager#token=${sessionToken}`)
  })

  // 운영자: 사업장에 owner_user_id를 미리 연결 (이메일로 매핑)
  // 로컬·dev에선 PIN으로 인증 가능. P1에 운영자 전용 권한 분리 예정.
  app.post<{ Params: { slug: string }; Body: { pin: string; email: string } }>(
    '/api/businesses/:slug/link-owner', async (req, reply) => {
      const { pin, email } = req.body
      if (!email?.trim()) return reply.code(400).send({ error: '이메일이 필요합니다' })

      const biz = db.prepare('SELECT id, manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

      if (!verifyPinHash(pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })

      // 이메일로 user 찾기 또는 placeholder 생성
      let user = db.prepare('SELECT id FROM users WHERE provider = ? AND email = ?').get('google', email.trim()) as any
      if (!user) {
        // 이메일만으로 placeholder user 생성. provider_id는 첫 로그인 시 갱신.
        const placeholder = `pending:${email.trim()}`
        const result = db.prepare(
          'INSERT INTO users (provider, provider_id, email) VALUES (?, ?, ?)'
        ).run('google', placeholder, email.trim())
        user = { id: Number(result.lastInsertRowid) }
      }
      db.prepare('UPDATE businesses SET owner_user_id = ? WHERE slug = ?').run(user.id, req.params.slug)
      return { ok: true, owner_user_id: user.id, email }
    }
  )

  // 사업장 owner 해제 (PIN 인증)
  app.delete<{ Params: { slug: string }; Body: { pin: string } }>(
    '/api/businesses/:slug/owner', async (req, reply) => {
      const biz = db.prepare('SELECT manager_pin FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(req.body.pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      db.prepare('UPDATE businesses SET owner_user_id = NULL WHERE slug = ?').run(req.params.slug)
      return { ok: true }
    }
  )
}
