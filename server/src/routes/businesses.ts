import { FastifyInstance } from 'fastify'
import { db, hashPin, verifyPinHash } from '../db'
import { requireManagerAuth } from '../middleware/auth'
import { planAllows } from '../plans'

// 세션 만료 비교용 KST 문자열 (다른 라우트와 동일 규칙: UTC+9, 'YYYY-MM-DD HH:MM:SS')
function nowKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

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
  // 사업장 생성 — 신규 가입은 구글 신원확인(signup_token) 필수 + 소유자(owner) 연결.
  // PIN은 병행(일상·키오스크용). signup_token은 구글 OAuth signup 흐름에서 발급된 1회용.
  app.post<{ Body: { name: string; manager_pin: string; signup_token?: string } }>(
    '/api/businesses', async (req, reply) => {
      const { name, manager_pin, signup_token } = req.body
      if (!name?.trim()) return reply.code(400).send({ error: '사업장명을 입력하세요' })
      if (!manager_pin || manager_pin.length < 4) return reply.code(400).send({ error: 'PIN은 4자리 이상이어야 합니다' })

      // 구글 신원확인 토큰 검증 → owner 결정 (1회용)
      let ownerUserId: number | null = null
      if (signup_token) {
        const row = db.prepare('SELECT slug FROM sessions WHERE token = ? AND expires_at > ?')
          .get(signup_token, nowKST()) as any
        if (row && typeof row.slug === 'string' && row.slug.startsWith('__signup__:')) {
          ownerUserId = Number(row.slug.split(':')[1]) || null
          db.prepare('DELETE FROM sessions WHERE token = ?').run(signup_token) // 1회 소진
        }
      }
      if (!ownerUserId) {
        return reply.code(403).send({
          error: '구글 로그인으로 본인 확인 후 사업장을 만들 수 있어요.',
          code: 'SIGNUP_GOOGLE_REQUIRED',
        })
      }

      const slug = generateSlug()
      const hashedPin = hashPin(manager_pin)
      // owner_user_id 연결 + time_off_enabled 명시적 OFF
      db.prepare('INSERT INTO businesses (slug, name, manager_pin, owner_user_id, time_off_enabled) VALUES (?, ?, ?, ?, 0)')
        .run(slug, name.trim(), hashedPin, ownerUserId)
      return { slug, name: name.trim() }
    }
  )

  // 전체 사업장 목록 (PIN 미포함)
  app.get('/api/businesses', async () => {
    return db.prepare('SELECT id, slug, name, created_at, lat, lng, radius_meters, home_mode, leave_pay_calc_mode, weekly_holiday_includes_leave, time_off_enabled, weekly_holiday_threshold_hours, week_start_day, notify_phone, sms_notify_enabled, plan FROM businesses ORDER BY created_at DESC').all()
  })

  // 사업장 존재 확인 (PIN 미포함)
  app.get<{ Params: { slug: string } }>(
    '/api/businesses/:slug', async (req, reply) => {
      const biz = db.prepare('SELECT id, slug, name, created_at, lat, lng, radius_meters, home_mode, leave_pay_calc_mode, weekly_holiday_includes_leave, time_off_enabled, weekly_holiday_threshold_hours, week_start_day, notify_phone, sms_notify_enabled, plan FROM businesses WHERE slug = ?').get(req.params.slug)
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
      const biz = db.prepare('SELECT manager_pin, plan FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      if (!verifyPinHash(pin, biz.manager_pin)) return reply.code(401).send({ error: 'PIN이 올바르지 않습니다' })
      // GPS 위치 제한은 유료 전용 — 무료 플랜은 위치 설정 불가(해제는 허용)
      if (lat != null && lng != null && !planAllows(biz.plan, 'gps')) {
        return reply.code(403).send({
          error: 'GPS 위치 제한은 유료 플랜 기능이에요. 플랜을 업그레이드해주세요.',
          code: 'PLAN_FEATURE', feature: 'gps', plan: biz.plan ?? 'free',
        })
      }
      db.prepare('UPDATE businesses SET lat=?, lng=?, radius_meters=? WHERE slug=?')
        .run(lat ?? null, lng ?? null, radius_meters ?? 300, req.params.slug)
      return { ok: true }
    }
  )

  // 휴가 정책 변경 (관리자 세션 인증)
  app.patch<{ Params: { slug: string }; Body: { leave_pay_calc_mode?: '8hours' | 'avg_workhours'; weekly_holiday_includes_leave?: boolean; time_off_enabled?: boolean; weekly_holiday_threshold_hours?: number; week_start_day?: 0 | 1 } }>(
    '/api/businesses/:slug/leave-policy', { preHandler: requireManagerAuth }, async (req, reply) => {
      const { leave_pay_calc_mode, weekly_holiday_includes_leave, time_off_enabled, weekly_holiday_threshold_hours, week_start_day } = req.body
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

      if (leave_pay_calc_mode != null && leave_pay_calc_mode !== '8hours' && leave_pay_calc_mode !== 'avg_workhours') {
        return reply.code(400).send({ error: 'leave_pay_calc_mode는 8hours 또는 avg_workhours여야 합니다' })
      }
      if (weekly_holiday_threshold_hours != null) {
        if (!Number.isFinite(weekly_holiday_threshold_hours) || weekly_holiday_threshold_hours < 0 || weekly_holiday_threshold_hours > 40) {
          return reply.code(400).send({ error: '주휴수당 기준 시간은 0~40 사이여야 합니다' })
        }
      }
      if (week_start_day != null && week_start_day !== 0 && week_start_day !== 1) {
        return reply.code(400).send({ error: 'week_start_day는 0(일) 또는 1(월)이어야 합니다' })
      }

      const updates: string[] = []
      const params: any[] = []
      if (leave_pay_calc_mode != null) { updates.push('leave_pay_calc_mode = ?'); params.push(leave_pay_calc_mode) }
      if (weekly_holiday_includes_leave != null) { updates.push('weekly_holiday_includes_leave = ?'); params.push(weekly_holiday_includes_leave ? 1 : 0) }
      if (time_off_enabled != null) { updates.push('time_off_enabled = ?'); params.push(time_off_enabled ? 1 : 0) }
      if (weekly_holiday_threshold_hours != null) { updates.push('weekly_holiday_threshold_hours = ?'); params.push(Math.floor(weekly_holiday_threshold_hours)) }
      if (week_start_day != null) { updates.push('week_start_day = ?'); params.push(week_start_day) }
      if (updates.length === 0) return reply.code(400).send({ error: '변경할 항목이 없습니다' })

      params.push(req.params.slug)
      db.prepare(`UPDATE businesses SET ${updates.join(', ')} WHERE slug = ?`).run(...params)
      const updated = db.prepare('SELECT leave_pay_calc_mode, weekly_holiday_includes_leave, time_off_enabled, weekly_holiday_threshold_hours, week_start_day FROM businesses WHERE slug = ?').get(req.params.slug)
      return { ok: true, ...updated as object }
    }
  )

  // 출근 SMS 알림 설정 (관리자 세션 인증)
  app.patch<{ Params: { slug: string }; Body: { notify_phone?: string | null; sms_notify_enabled?: boolean } }>(
    '/api/businesses/:slug/sms-notify', { preHandler: requireManagerAuth }, async (req, reply) => {
      const biz = db.prepare('SELECT id, notify_phone, plan FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })

      const { notify_phone, sms_notify_enabled } = req.body
      const updates: string[] = []
      const params: any[] = []

      // 최종적으로 적용될 수신번호 (이번 요청에 없으면 기존값 유지)
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
        // 알림은 유료 전용 — 무료 플랜은 켤 수 없음
        if (sms_notify_enabled && !planAllows(biz.plan, 'notifications')) {
          return reply.code(403).send({
            error: '출퇴근 알림은 유료 플랜에서 사용할 수 있어요. 플랜을 업그레이드해주세요.',
            code: 'PLAN_FEATURE', feature: 'notifications', plan: biz.plan ?? 'free',
          })
        }
        // 수신번호 없이 알림을 켤 수 없음
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

  // 홈 화면 모드 변경 (관리자 세션 인증)
  app.patch<{ Params: { slug: string }; Body: { home_mode: 'kiosk' | 'private' } }>(
    '/api/businesses/:slug/home-mode', { preHandler: requireManagerAuth }, async (req, reply) => {
      const { home_mode } = req.body
      if (home_mode !== 'kiosk' && home_mode !== 'private')
        return reply.code(400).send({ error: 'home_mode는 kiosk 또는 private여야 합니다' })
      const biz = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(req.params.slug) as any
      if (!biz) return reply.code(404).send({ error: '사업장을 찾을 수 없습니다' })
      db.prepare('UPDATE businesses SET home_mode = ? WHERE slug = ?').run(home_mode, req.params.slug)
      return { ok: true, home_mode }
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
