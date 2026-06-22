// 카카오 알림톡 테스트 발송 스크립트.
// 사용법:
//   npx tsx src/scripts/test-alimtalk.ts 01012345678 [in|out]
//   (번호 생략 시 .env 의 TEST_NOTIFY_PHONE, 종류 생략 시 출근(in))
// 필요한 .env: SOLAPI_API_KEY / SOLAPI_API_SECRET / SENDER_PHONE / KAKAO_PFID
import 'dotenv/config'
import { notifyCheckIn, notifyCheckOut } from '../utils/notify'

function kstNowString(): string {
  // 'YYYY-MM-DD HH:mm:ss' (KST 벽시계). notify가 [11:16]에서 HH:mm 추출.
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

async function main() {
  const to = process.argv[2] || process.env.TEST_NOTIFY_PHONE || ''
  const kind = (process.argv[3] || 'in').toLowerCase() // in | out
  if (!to) {
    console.error('❌ 수신번호가 없습니다. 사용법: npx tsx src/scripts/test-alimtalk.ts 01012345678 [in|out]')
    process.exit(1)
  }

  console.log('— 환경 점검 —')
  console.log('  SOLAPI 키:', process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET ? '있음' : '없음')
  console.log('  발신번호:', process.env.SENDER_PHONE || '(없음)')
  console.log('  KAKAO_PFID:', process.env.KAKAO_PFID ? '설정됨(알림톡 시도)' : '없음(SMS로 폴백됨)')
  console.log(`📨 ${to} 로 ${kind === 'out' ? '퇴근' : '출근'} 알림톡 발송 시도...`)

  const params = {
    employeeName: '테스트직원',
    ownerPhone: to,
    businessName: '테스트 사업장',
  }
  const result =
    kind === 'out'
      ? await notifyCheckOut({ ...params, clockOutTime: kstNowString() })
      : await notifyCheckIn({ ...params, clockInTime: kstNowString() })

  console.log('— 결과 —')
  console.log(' ', result)
  if (result.ok) {
    console.log(`✅ 발송 성공 (채널: ${result.channel})${result.providerId ? ` · id: ${result.providerId}` : ''}`)
    console.log('   카카오톡(알림톡)에서 수신 여부를 확인하세요. (미설치/차단 시 SMS로 대체발송)')
  } else if (result.skipped) {
    console.log('⏭️  skip (환경변수/번호 문제). notification_logs 확인.')
  } else {
    console.error('❌ 발송 실패:', result.error)
  }
  process.exit(result.ok ? 0 : 1)
}

main()
