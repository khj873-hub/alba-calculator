import { Resend } from 'resend'

// Resend는 API key 있을 때만 초기화. 없으면 발송 함수가 자동 skip.
const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

const FROM = process.env.RESEND_FROM || 'onboarding@resend.dev'
const TO = process.env.ADMIN_NOTIFY_EMAIL || ''
const ADMIN_URL = process.env.PUBLIC_ORIGIN
  ? `${process.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/admin`
  : 'https://alba-calculator-production.up.railway.app/admin'

function esc(s: string | null | undefined) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export interface InquiryNotificationData {
  business_name: string
  phone: string
  inquiry_type?: string | null
  source?: string | null
  content?: string | null
  agreed_marketing: boolean
  ip?: string | null
  created_at: string
}

export async function sendInquiryNotification(data: InquiryNotificationData) {
  if (!resend) {
    console.log('[email] RESEND_API_KEY 없음 — 이메일 발송 skip')
    return { skipped: true }
  }
  if (!TO) {
    console.log('[email] ADMIN_NOTIFY_EMAIL 없음 — 이메일 발송 skip')
    return { skipped: true }
  }

  const subject = `[퍼펙트 근태관리] 신규 도입 문의 — ${data.business_name}`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
      <div style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;padding:24px;border-radius:12px;margin-bottom:24px">
        <div style="font-size:13px;font-weight:700;letter-spacing:1px;opacity:.9">NEW INQUIRY</div>
        <div style="font-size:20px;font-weight:800;margin-top:6px">신규 도입 문의가 접수됐어요</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:10px 0;color:#6b7280;width:90px">사업장명</td><td style="padding:10px 0;font-weight:700">${esc(data.business_name)}</td></tr>
        <tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">휴대폰</td><td style="padding:10px 0;border-top:1px solid #f3f4f6"><a href="tel:${esc(data.phone)}" style="color:#10b981;text-decoration:none;font-weight:700">${esc(data.phone)}</a></td></tr>
        <tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">문의 유형</td><td style="padding:10px 0;border-top:1px solid #f3f4f6"><b>${esc(data.inquiry_type) || '<span style="color:#9ca3af">(미선택)</span>'}</b></td></tr>
        <tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">도입 경로</td><td style="padding:10px 0;border-top:1px solid #f3f4f6">${esc(data.source) || '<span style="color:#9ca3af">(미입력)</span>'}</td></tr>
        <tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">접수 시각</td><td style="padding:10px 0;border-top:1px solid #f3f4f6">${esc(data.created_at)} KST</td></tr>
        <tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">마케팅 동의</td><td style="padding:10px 0;border-top:1px solid #f3f4f6">${data.agreed_marketing ? '✅ 예' : '❌ 아니오'}</td></tr>
        ${data.ip ? `<tr><td style="padding:10px 0;color:#6b7280;border-top:1px solid #f3f4f6">IP</td><td style="padding:10px 0;border-top:1px solid #f3f4f6;color:#9ca3af;font-family:monospace;font-size:12px">${esc(data.ip)}</td></tr>` : ''}
      </table>

      ${data.content ? `
      <div style="margin-top:20px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:8px">문의 내용</div>
        <div style="background:#f9fafb;border-left:3px solid #10b981;padding:14px 16px;border-radius:0 8px 8px 0;font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(data.content)}</div>
      </div>
      ` : ''}

      <div style="margin-top:28px;text-align:center">
        <a href="${ADMIN_URL}" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px">운영자 콘솔에서 확인 →</a>
      </div>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:12px;text-align:center">
        퍼펙트 근태관리 · 자동 발송 메일입니다
      </div>
    </div>
  `

  const text = [
    `[퍼펙트 근태관리] 신규 도입 문의`,
    ``,
    `사업장명: ${data.business_name}`,
    `휴대폰:   ${data.phone}`,
    `문의 유형: ${data.inquiry_type || '(미선택)'}`,
    `도입 경로: ${data.source || '(미입력)'}`,
    `접수 시각: ${data.created_at} KST`,
    `마케팅 동의: ${data.agreed_marketing ? '예' : '아니오'}`,
    data.ip ? `IP: ${data.ip}` : '',
    '',
    data.content ? `[문의 내용]\n${data.content}` : '',
    '',
    `운영자 콘솔: ${ADMIN_URL}`,
  ].filter(Boolean).join('\n')

  try {
    const result = await resend.emails.send({
      from: `퍼펙트 근태관리 <${FROM}>`,
      to: TO,
      subject,
      html,
      text,
    })
    if ((result as any).error) {
      console.error('[email] Resend 발송 실패:', (result as any).error)
      return { skipped: false, ok: false, error: (result as any).error }
    }
    return { skipped: false, ok: true, id: (result as any).data?.id }
  } catch (e: any) {
    console.error('[email] 예외:', e?.message || e)
    return { skipped: false, ok: false, error: e?.message }
  }
}
