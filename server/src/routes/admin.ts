import { FastifyInstance } from 'fastify'
import { db, hashPin } from '../db'
import { requireAdminAuth } from '../middleware/auth'
import { planAllows, ASSIGNABLE_PLANS } from '../plans'

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
             b.is_active, b.suspended_at, b.plan, b.plan_expires_at,
             b.notify_phone, b.sms_notify_enabled,
             u.id AS owner_user_id, u.email AS owner_email, u.name AS owner_name,
             u.last_login_at AS owner_last_login,
             (SELECT COUNT(*) FROM employees WHERE business_id = b.id) AS employee_count
      FROM businesses b
      LEFT JOIN users u ON u.id = b.owner_user_id
      ORDER BY b.created_at DESC
    `).all()
  })

  // 요금제(plan) 변경
  app.patch<{ Params: { slug: string }; Body: { plan: string } }>(
    '/api/admin/businesses/:slug/plan', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })
      const plan = req.body.plan
      if (!ASSIGNABLE_PLANS.includes(plan)) return reply.code(400).send({ error: '잘못된 요금제' })
      db.prepare('UPDATE businesses SET plan = ? WHERE slug = ?').run(plan, req.params.slug)
      return { ok: true, plan }
    }
  )

  // 유료 결제 만료일(plan_expires_at) 변경 — null이면 무기한
  // 미래 날짜로 설정 시 정지된 사업장이면 자동 활성화 (결제 받음 → 즉시 재개)
  app.patch<{ Params: { slug: string }; Body: { plan_expires_at: string | null } }>(
    '/api/admin/businesses/:slug/plan-expires-at', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id, is_active FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })
      const v = req.body.plan_expires_at
      if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v ?? '')) {
        return reply.code(400).send({ error: '날짜 형식은 YYYY-MM-DD 또는 null' })
      }

      // 자동 활성화 조건: 새 기한이 오늘 이후(>=) + 현재 정지 상태
      const todayYmd = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const shouldAutoActivate = v !== null && v >= todayYmd && biz.is_active === 0

      if (shouldAutoActivate) {
        db.prepare('UPDATE businesses SET plan_expires_at = ?, is_active = 1, suspended_at = NULL WHERE slug = ?')
          .run(v, req.params.slug)
        return { ok: true, plan_expires_at: v, auto_activated: true }
      }

      db.prepare('UPDATE businesses SET plan_expires_at = ? WHERE slug = ?').run(v, req.params.slug)
      return { ok: true, plan_expires_at: v, auto_activated: false }
    }
  )

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

  // 관리자 PIN 재발급 — PIN 분실 복구용. 현재 PIN 몰라도 운영자 권한으로 재설정.
  // new_pin 미입력 시 6자리 자동 생성. 응답에 평문 PIN 반환(운영자가 사장님께 전달).
  app.patch<{ Params: { slug: string }; Body: { new_pin?: string } }>(
    '/api/admin/businesses/:slug/reset-pin', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })
      let pin = (req.body?.new_pin || '').trim()
      if (pin) {
        if (!/^[0-9]{4,8}$/.test(pin)) return reply.code(400).send({ error: 'PIN은 4~8자리 숫자여야 합니다' })
      } else {
        pin = String(Math.floor(100000 + Math.random() * 900000)) // 6자리 자동 생성
      }
      db.prepare('UPDATE businesses SET manager_pin = ? WHERE slug = ?').run(hashPin(pin), req.params.slug)
      return { ok: true, new_pin: pin }
    }
  )

  // 출근 SMS 알림 설정 (운영자가 사업장 대신 수신번호 일괄 등록)
  // 사장님 셀프(/api/businesses/:slug/sms-notify, requireManagerAuth)와 동일 검증.
  app.patch<{ Params: { slug: string }; Body: { notify_phone?: string | null; sms_notify_enabled?: boolean } }>(
    '/api/admin/businesses/:slug/sms-notify', { preHandler: requireAdminAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id, notify_phone, plan FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장 없음' })

      const { notify_phone, sms_notify_enabled } = req.body
      const updates: string[] = []
      const params: any[] = []

      // 최종 적용될 수신번호 (이번 요청에 없으면 기존값 유지)
      let finalPhone: string | null = biz.notify_phone ?? null
      if (notify_phone !== undefined) {
        const digits = (notify_phone ?? '').replace(/[^0-9]/g, '')
        if (digits && (digits.length < 10 || digits.length > 11)) {
          return reply.code(400).send({ error: '올바른 휴대폰 번호를 입력하세요 (10~11자리)' })
        }
        finalPhone = digits || null
        updates.push('notify_phone = ?'); params.push(finalPhone)
      }
      if (sms_notify_enabled !== undefined) {
        // 알림은 유료 전용 — 무료 플랜이면 먼저 요금제를 paid 로 바꿔야 켤 수 있음
        if (sms_notify_enabled && !planAllows(biz.plan, 'notifications')) {
          return reply.code(403).send({
            error: '무료 플랜 사업장입니다. 요금제를 유료로 변경한 뒤 알림을 켜주세요.',
            code: 'PLAN_FEATURE', feature: 'notifications', plan: biz.plan ?? 'free',
          })
        }
        if (sms_notify_enabled && !finalPhone) {
          return reply.code(400).send({ error: '알림을 켜려면 받는 번호를 먼저 입력하세요' })
        }
        updates.push('sms_notify_enabled = ?'); params.push(sms_notify_enabled ? 1 : 0)
      }
      if (updates.length === 0) return reply.code(400).send({ error: '변경할 항목이 없습니다' })

      params.push(req.params.slug)
      db.prepare(`UPDATE businesses SET ${updates.join(', ')} WHERE slug = ?`).run(...params)
      const updated = db.prepare('SELECT notify_phone, sms_notify_enabled FROM businesses WHERE slug = ?').get(req.params.slug)
      return { ok: true, ...updated as object }
    }
  )

  // 2) 신규 사업장 프로비저닝 — 사업장 생성 + (선택) owner 매핑 한 번에
  //    owner_email 미입력 시: PIN 전용 사업장으로 생성 (구글 로그인 비활성)
  app.post<{ Body: { name: string; manager_pin: string; owner_email?: string | null } }>(
    '/api/admin/businesses/provision', { preHandler: requireAdminAuth }, async (req, reply) => {
      const { name, manager_pin, owner_email } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '사업장명 필수' })
      if (!manager_pin || manager_pin.length < 4) return reply.code(400).send({ error: 'PIN 4자리 이상' })

      const trimmedEmail = owner_email?.trim() || ''
      if (trimmedEmail && !trimmedEmail.includes('@')) {
        return reply.code(400).send({ error: '이메일 형식이 올바르지 않아요 (비우거나 정확한 이메일을 입력)' })
      }

      const slug = generateSlug()
      const hashedPin = hashPin(manager_pin)

      let ownerUserId: number | null = null
      let resolvedEmail: string | null = null

      if (trimmedEmail) {
        // owner placeholder user (이미 있으면 재사용)
        const email = trimmedEmail.toLowerCase()
        let user = db.prepare("SELECT id FROM users WHERE provider = 'google' AND email = ?").get(email) as any
        if (!user) {
          const placeholder = `pending:${email}`
          const result = db.prepare(
            'INSERT INTO users (provider, provider_id, email) VALUES (?, ?, ?)'
          ).run('google', placeholder, email)
          user = { id: Number(result.lastInsertRowid) }
        }
        ownerUserId = user.id
        resolvedEmail = email
      }

      db.prepare('INSERT INTO businesses (slug, name, manager_pin, owner_user_id, time_off_enabled) VALUES (?, ?, ?, ?, 0)')
        .run(slug, name.trim(), hashedPin, ownerUserId)

      return { ok: true, slug, name: name.trim(), owner_email: resolvedEmail, owner_user_id: ownerUserId }
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

  // 운영자 통계 대시보드 (기존 DB 집계) — P1
  app.get('/api/admin/stats', { preHandler: requireAdminAuth }, async () => {
    const kst = (offsetMs = 0) =>
      new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetMs).toISOString().replace('T', ' ').slice(0, 19)
    const todayStart = kst().slice(0, 10) + ' 00:00:00'
    const cutoff7 = kst(-7 * 86400000)
    const cutoff30 = kst(-30 * 86400000)
    const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any)?.n ?? 0

    // 사업장
    const bizTotal = one('SELECT COUNT(*) n FROM businesses')
    const bizByPlan = db.prepare('SELECT plan, COUNT(*) n FROM businesses GROUP BY plan').all() as any[]
    const bizNew7 = one('SELECT COUNT(*) n FROM businesses WHERE created_at >= ?', cutoff7)
    const bizNew30 = one('SELECT COUNT(*) n FROM businesses WHERE created_at >= ?', cutoff30)
    const paidTotal = one("SELECT COUNT(*) n FROM businesses WHERE plan != 'free'")

    // 활성 사업장(최근 출퇴근 발생 기준)
    const activeBiz7 = one(
      'SELECT COUNT(DISTINCT e.business_id) n FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.clock_in >= ?', cutoff7)
    const activeBiz30 = one(
      'SELECT COUNT(DISTINCT e.business_id) n FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.clock_in >= ?', cutoff30)

    // 직원
    const empActive = one("SELECT COUNT(*) n FROM employees WHERE status = 'active'")
    const empTotal = one('SELECT COUNT(*) n FROM employees')

    // 출퇴근
    const attToday = one('SELECT COUNT(*) n FROM attendance WHERE clock_in >= ?', todayStart)
    const att7 = one('SELECT COUNT(*) n FROM attendance WHERE clock_in >= ?', cutoff7)
    const attDaily = db.prepare(
      "SELECT substr(clock_in,1,10) d, COUNT(*) n FROM attendance WHERE clock_in >= ? GROUP BY d ORDER BY d").all(cutoff7) as any[]

    // 로그인(활성 사용자)
    const loginUsers7 = one('SELECT COUNT(*) n FROM users WHERE last_login_at >= ?', cutoff7)
    const loginUsers30 = one('SELECT COUNT(*) n FROM users WHERE last_login_at >= ?', cutoff30)

    // 알림 발송
    const notifSent7 = one("SELECT COUNT(*) n FROM notification_logs WHERE status = 'sent' AND created_at >= ?", cutoff7)
    const notifSent30 = one("SELECT COUNT(*) n FROM notification_logs WHERE status = 'sent' AND created_at >= ?", cutoff30)

    // 문의
    const inqTotal = one('SELECT COUNT(*) n FROM inquiries')
    const inqNew = one("SELECT COUNT(*) n FROM inquiries WHERE status = 'new'")
    const inqByType = db.prepare(
      "SELECT COALESCE(inquiry_type,'(미선택)') t, COUNT(*) n FROM inquiries GROUP BY t ORDER BY n DESC").all() as any[]

    return {
      generated_at: kst(),
      businesses: { total: bizTotal, paid: paidTotal, new7: bizNew7, new30: bizNew30, byPlan: bizByPlan, active7: activeBiz7, active30: activeBiz30 },
      employees: { active: empActive, total: empTotal },
      attendance: { today: attToday, last7: att7, daily: attDaily },
      logins: { users7: loginUsers7, users30: loginUsers30 },
      notifications: { sent7: notifSent7, sent30: notifSent30 },
      inquiries: { total: inqTotal, new: inqNew, byType: inqByType },
    }
  })
}
