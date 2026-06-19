// 알림 추상화 레이어.
// 출근/퇴근 등 "도메인 이벤트"를 받아 메시지를 만들고 활성 채널로 발송한다.
// 지금은 SMS(solapi)만 사용하지만, 나중에 카카오 알림톡으로 교체할 때
// 이 파일의 발송 호출부만 바꾸면 되도록 라우트/도메인 코드와 분리한다.
import { sendSms, SmsResult } from './sms'

export type NotifyResult = SmsResult

export interface CheckInNotifyParams {
  employeeName: string
  clockInTime: string // 'YYYY-MM-DD HH:mm:ss' (KST)
  ownerPhone: string // 사업주(수신) 번호
  businessName?: string
}

// 출근 알림 메시지 본문 (채널 무관 — 알림톡 전환 시 템플릿만 분리하면 됨)
function buildCheckInText(p: CheckInNotifyParams): string {
  const hhmm = p.clockInTime.length >= 16 ? p.clockInTime.slice(11, 16) : p.clockInTime
  const prefix = p.businessName ? `[${p.businessName}] ` : '[퍼펙트 근태관리] '
  return `${prefix}${p.employeeName}님이 ${hhmm}에 출근했습니다.`
}

// 출근 알림 발송.
// 추후 알림톡으로 교체: 아래 sendSms(...) 한 줄을 sendAlimtalk(...) 로 바꾸면 됨.
export async function notifyCheckIn(p: CheckInNotifyParams): Promise<NotifyResult> {
  const text = buildCheckInText(p)
  return sendSms({ to: p.ownerPhone, text, template: 'check_in' })
}
