// 알림 추상화 레이어.
// 출근/퇴근 등 "도메인 이벤트"를 받아 메시지를 만들고 활성 채널로 발송한다.
// 카카오 알림톡 우선 + 실패 시 SMS 자동 대체(sendAlimtalk 내부 폴백).
// pfId/템플릿 환경변수가 없으면 자동으로 SMS만 발송되므로 라우트 코드는 그대로 둔다.
import { sendAlimtalk, SmsResult } from './sms'

export type NotifyResult = SmsResult

// 승인된 알림톡 템플릿 ID (env로 override 가능). 본문 변수: #{사업장명} #{직원명} #{시간}
const TPL_CHECKIN = process.env.KAKAO_TPL_CHECKIN || 'KA01TP2606191356563121V3vmpsY7t3'
const TPL_CHECKOUT = process.env.KAKAO_TPL_CHECKOUT || 'KA01TP260619140047363RjLXYzUER7o'

function hhmmOf(ts: string): string {
  return ts.length >= 16 ? ts.slice(11, 16) : ts
}

export interface CheckInNotifyParams {
  employeeName: string
  clockInTime: string // 'YYYY-MM-DD HH:mm:ss' (KST)
  ownerPhone: string // 사업주(수신) 번호
  businessName?: string
}

// 출근 알림 발송 (알림톡 → SMS 폴백).
export async function notifyCheckIn(p: CheckInNotifyParams): Promise<NotifyResult> {
  const biz = p.businessName || '퍼펙트 근태관리'
  const hhmm = hhmmOf(p.clockInTime)
  const fallbackText = `[${biz}] ${p.employeeName}님이 ${hhmm}에 출근했습니다.`
  return sendAlimtalk({
    to: p.ownerPhone,
    templateId: TPL_CHECKIN,
    variables: { '#{사업장명}': biz, '#{직원명}': p.employeeName, '#{시간}': hhmm },
    fallbackText,
    template: 'check_in',
  })
}

export interface CheckOutNotifyParams {
  employeeName: string
  clockOutTime: string // 'YYYY-MM-DD HH:mm:ss' (KST)
  ownerPhone: string // 사업주(수신) 번호
  businessName?: string
}

// 퇴근 알림 발송 (알림톡 → SMS 폴백).
export async function notifyCheckOut(p: CheckOutNotifyParams): Promise<NotifyResult> {
  const biz = p.businessName || '퍼펙트 근태관리'
  const hhmm = hhmmOf(p.clockOutTime)
  const fallbackText = `[${biz}] ${p.employeeName}님이 ${hhmm}에 퇴근했습니다.`
  return sendAlimtalk({
    to: p.ownerPhone,
    templateId: TPL_CHECKOUT,
    variables: { '#{사업장명}': biz, '#{직원명}': p.employeeName, '#{시간}': hhmm },
    fallbackText,
    template: 'check_out',
  })
}
