// Google AdSense 광고 슬롯 (랜딩 등 '공개 페이지 전용').
// 환경변수가 있을 때만 렌더 — KakaoFloatButton 과 동일한 안전 패턴.
//   VITE_ADSENSE_CLIENT       : ca-pub-XXXXXXXXXXXXXXXX (게시자 ID)
//   VITE_ADSENSE_SLOT_LANDING : 광고 단위 슬롯 ID (승인 후 발급)
// 둘 중 하나라도 비어 있으면 null 을 반환해 아무것도 표시하지 않는다.
// ⚠️ 로그인 뒤 도구 화면에는 절대 넣지 말 것 (AdSense 정책 위반 + 크롤링 불가).
import { useEffect, useRef } from 'react'

const ADSENSE_CLIENT = (import.meta as any).env?.VITE_ADSENSE_CLIENT || ''

// 로더 스크립트를 최초 1회만 <head> 에 주입
function ensureAdScript() {
  if (!ADSENSE_CLIENT) return
  if (document.querySelector('script[data-adsbygoogle-loader]')) return
  const s = document.createElement('script')
  s.async = true
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`
  s.crossOrigin = 'anonymous'
  s.setAttribute('data-adsbygoogle-loader', '')
  document.head.appendChild(s)
}

type Props = { slot?: string; className?: string }

export default function AdSlot({ slot, className }: Props) {
  const pushed = useRef(false)

  useEffect(() => {
    if (!ADSENSE_CLIENT || !slot || pushed.current) return
    ensureAdScript()
    try {
      ;((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
      pushed.current = true
    } catch {
      // 광고 로드 실패는 페이지 동작에 영향을 주지 않도록 무시
    }
  }, [slot])

  // 환경변수 미설정/슬롯 없음 → 아무것도 렌더하지 않음 (개발·승인 전 안전)
  if (!ADSENSE_CLIENT || !slot) return null

  return (
    <ins
      className={`adsbygoogle block ${className || ''}`}
      style={{ display: 'block' }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  )
}
