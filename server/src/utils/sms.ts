// 솔라피(Solapi) 발송 유틸 — SMS + 카카오 알림톡.
// email.ts 와 동일한 "환경변수 없으면 skip" 안전 패턴을 따른다.
//   SOLAPI_API_KEY    : 솔라피 API Key
//   SOLAPI_API_SECRET : 솔라피 API Secret
//   SENDER_PHONE      : 발신번호 (솔라피에 사전 등록·승인된 번호여야 함)
//   KAKAO_PFID        : 카카오 비즈채널 pfId (알림톡용, 없으면 SMS로 폴백)
// 모든 발송 시도는 notification_logs 테이블에 기록한다(성공/실패/skip 포함).
import { SolapiMessageService } from 'solapi'
import { db } from '../db'

const API_KEY = process.env.SOLAPI_API_KEY
const API_SECRET = process.env.SOLAPI_API_SECRET
const SENDER = process.env.SENDER_PHONE
const PFID = process.env.KAKAO_PFID

// 키가 모두 있을 때만 클라이언트 초기화. 없으면 자동 skip.
const service = API_KEY && API_SECRET ? new SolapiMessageService(API_KEY, API_SECRET) : null

export interface SmsResult {
  ok: boolean
  skipped: boolean
  channel?: 'sms' | 'alimtalk'
  providerId?: string
  error?: string
}

type LogStatus = 'sent' | 'failed' | 'skipped'

function logNotification(row: {
  channel: 'sms' | 'alimtalk'
  to: string
  template?: string
  message: string
  status: LogStatus
  providerId?: string
  error?: string
}) {
  try {
    db.prepare(
      `INSERT INTO notification_logs (channel, to_phone, template, message, status, provider_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.channel, row.to, row.template ?? null, row.message, row.status, row.providerId ?? null, row.error ?? null)
  } catch (e: any) {
    // 로그 저장 실패가 발송 흐름을 막지 않도록 삼킨다
    console.error('[notify] notification_logs 저장 실패:', e?.message || e)
  }
}

const onlyDigits = (s: string) => (s || '').replace(/[^0-9]/g, '')

function pickProviderId(res: any): string | undefined {
  return res?.groupInfo?.groupId || res?.groupId || res?.messageList?.[0]?.messageId || undefined
}

export async function sendSms(params: { to: string; text: string; template?: string }): Promise<SmsResult> {
  const { text, template } = params
  const to = onlyDigits(params.to)

  if (!service || !SENDER) {
    console.log('[sms] SOLAPI 환경변수 미설정 — 발송 skip')
    logNotification({ channel: 'sms', to, template, message: text, status: 'skipped' })
    return { ok: false, skipped: true, channel: 'sms' }
  }
  if (!to) {
    console.warn('[sms] 수신번호 없음 — 발송 skip')
    logNotification({ channel: 'sms', to: '', template, message: text, status: 'skipped', error: '수신번호 없음' })
    return { ok: false, skipped: true, channel: 'sms', error: '수신번호 없음' }
  }

  try {
    const res: any = await service.send({ to, from: onlyDigits(SENDER), text })
    const providerId = pickProviderId(res)
    logNotification({ channel: 'sms', to, template, message: text, status: 'sent', providerId })
    return { ok: true, skipped: false, channel: 'sms', providerId }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error('[sms] 발송 실패:', msg)
    logNotification({ channel: 'sms', to, template, message: text, status: 'failed', error: msg })
    return { ok: false, skipped: false, channel: 'sms', error: msg }
  }
}

// 카카오 알림톡 발송. 알림톡 우선, 실패 시 SMS 자동 대체발송(disableSms:false).
// pfId/템플릿/환경변수가 없으면 곧바로 SMS로 폴백한다(graceful degrade).
export async function sendAlimtalk(params: {
  to: string
  templateId: string
  variables: Record<string, string>
  fallbackText: string // 알림톡 실패 시 SMS 대체 본문(= 기존 SMS 문구)
  template?: string // 로그용 라벨
}): Promise<SmsResult> {
  const { templateId, variables, fallbackText, template } = params
  const to = onlyDigits(params.to)

  // 알림톡 불가 조건 → SMS로 폴백
  if (!service || !SENDER || !PFID || !templateId) {
    return sendSms({ to: params.to, text: fallbackText, template })
  }
  if (!to) {
    logNotification({ channel: 'alimtalk', to: '', template, message: fallbackText, status: 'skipped', error: '수신번호 없음' })
    return { ok: false, skipped: true, channel: 'alimtalk', error: '수신번호 없음' }
  }

  try {
    const res: any = await service.send({
      to,
      from: onlyDigits(SENDER),
      text: fallbackText, // 대체발송(SMS) 본문
      kakaoOptions: {
        pfId: PFID,
        templateId,
        variables,
        disableSms: false, // 알림톡 실패 시 SMS 자동 대체
      },
    })
    const providerId = pickProviderId(res)
    logNotification({ channel: 'alimtalk', to, template, message: fallbackText, status: 'sent', providerId })
    return { ok: true, skipped: false, channel: 'alimtalk', providerId }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error('[alimtalk] 발송 실패 → SMS 폴백:', msg)
    logNotification({ channel: 'alimtalk', to, template, message: fallbackText, status: 'failed', error: msg })
    // 알림톡 호출 자체가 실패하면 SMS로 한 번 더 시도
    return sendSms({ to: params.to, text: fallbackText, template })
  }
}
