// 솔라피 SMS 테스트 발송 스크립트 (1단계 검증용).
// 사용법:
//   1) server/.env 에 SOLAPI_API_KEY / SOLAPI_API_SECRET / SENDER_PHONE 채우기
//   2) npx tsx src/scripts/test-sms.ts 01012345678
//      (번호 생략 시 .env 의 TEST_NOTIFY_PHONE 사용)
import 'dotenv/config'
import { sendSms } from '../utils/sms'

async function main() {
  const to = process.argv[2] || process.env.TEST_NOTIFY_PHONE || ''
  if (!to) {
    console.error('❌ 수신번호가 없습니다.')
    console.error('   사용법: npx tsx src/scripts/test-sms.ts 01012345678')
    console.error('   또는 server/.env 에 TEST_NOTIFY_PHONE=010... 설정')
    process.exit(1)
  }

  const haveKeys = !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SENDER_PHONE)
  if (!haveKeys) {
    console.warn('⚠️  SOLAPI_API_KEY / SOLAPI_API_SECRET / SENDER_PHONE 중 일부가 없습니다.')
    console.warn('   → 실제 발송 없이 skip 으로 처리되고, notification_logs 에 기록만 남습니다.')
  }

  console.log(`📨 ${to} 로 테스트 SMS 발송 시도...`)
  const result = await sendSms({
    to,
    text: '[퍼펙트 근태관리] 솔라피 테스트 발송입니다. 이 문자를 받으셨다면 SMS 연동 성공!',
    template: 'test',
  })

  if (result.ok) {
    console.log('✅ 발송 성공!', result.providerId ? `(messageId: ${result.providerId})` : '')
    console.log('   휴대폰에서 수신 여부를 확인하세요.')
  } else if (result.skipped) {
    console.log('⏭️  skip 됨 (환경변수 미설정 또는 수신번호 없음). notification_logs 확인.')
  } else {
    console.error('❌ 발송 실패:', result.error)
  }
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error('예외:', e)
  process.exit(1)
})
