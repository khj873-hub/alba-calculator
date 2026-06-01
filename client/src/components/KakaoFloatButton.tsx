// 우하단 떠다니는 카카오톡 채팅 버튼.
// env로 override 가능, 기본값은 공식 카카오톡 채널.
const KAKAO_URL = (import.meta as any).env?.VITE_KAKAO_CHANNEL_URL || 'https://pf.kakao.com/_xdwVxjX'

export default function KakaoFloatButton() {
  if (!KAKAO_URL) return null
  return (
    <a
      href={KAKAO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="카카오톡으로 문의하기"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-yellow-300 hover:bg-yellow-400 text-gray-900 font-bold px-4 py-3 rounded-full shadow-lg transition transform hover:-translate-y-0.5 active:translate-y-0"
      style={{ boxShadow: '0 6px 18px rgba(0,0,0,0.15)' }}
    >
      <span className="text-lg leading-none">💬</span>
      <span className="text-sm">카톡 문의</span>
    </a>
  )
}
