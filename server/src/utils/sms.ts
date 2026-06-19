// 솔라피(Solapi) SMS 발송 유틸.
// email.ts 와 동일한 "환경변수 없으면 skip" 안전 패턴을 따른다.
//   SOLAPI_API_KEY    : 솔라피 API Key
//   SOLAPI_API_SECRET : 솔라피 API Secret
//   SENDER_PHONE      : 발신번호 (솔라피에 사전 등록·승인된 번호여야 함)
// 모든 발송 시도는 notification_logs 테이블에 기록한다(성공/실패/skip 포함).
import { SolapiMessageService } from 'solapi'
import { db } from '../db'

const API_KEY = process.env.SOLAPI_API_KEY
const API_SECRET = process.env.SOLAPI_API_SECRET
const SENDER = process.env.SENDER_PHONE

// 키가 모두 있을 때만 클라이언트 초기화. 없으면 sendSms 가 자동 skip.
const service = API_KEY && API_SECRET ? new SolapiMessageService(API_KEY, API_SECRET) : null

export interface SmsResult {
  ok: boolean
  skipped: boolean
  providerId?: string
  error?: string
}

type LogStatus = 'sent' | 'failed' | 'skipped'

function logNotification(row: {
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
    ).run('sms', row.to, row.template ?? null, row.message, row.status, row.providerId ?? null, row.error ?? null)
  } catch (e: any) {
    // 로그 저장 실패가 발송 흐름을 막지 않도록 삼킨다
    console.error('[sms] notification_logs 저장 실패:', e?.message || e)
  }
}

const onlyDigits = (s: string) => (s || '').replace(/[^0-9]/g, '')

export async function sendSms(params: { to: string; text: string; template?: string }): Promise<SmsResult> {
  const { text, template } = params
  const to = onlyDigits(params.to)

  if (!service || !SENDER) {
    console.log('[sms] SOLAPI 환경변수 미설정 — 발송 skip')
    logNotification({ to, template, message: text, status: 'skipped' })
    return { ok: false, skipped: true }
  }
  if (!to) {
    console.warn('[sms] 수신번호 없음 — 발송 skip')
    logNotification({ to: '', template, message: text, status: 'skipped', error: '수신번호 없음' })
    return { ok: false, skipped: true, error: '수신번호 없음' }
  }

  try {
    // solapi v6: send() 가 sendOne/sendMany 를 대체. 단건은 메시지 객체 1개 전달.
    const res: any = await service.send({ to, from: onlyDigits(SENDER), text })
    const providerId =
      res?.groupInfo?.groupId || res?.groupId || res?.messageList?.[0]?.messageId || undefined
    logNotification({ to, template, message: text, status: 'sent', providerId })
    return { ok: true, skipped: false, providerId }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error('[sms] 발송 실패:', msg)
    logNotification({ to, template, message: text, status: 'failed', error: msg })
    return { ok: false, skipped: false, error: msg }
  }
}
