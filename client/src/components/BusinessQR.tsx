import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

// 사업장 출퇴근 QR — 매장 부착용 포스터(사업장명·안내문·브랜딩 포함)로 저장/인쇄.
export default function BusinessQR({ slug, businessName }: { slug: string; businessName?: string }) {
  const url = `${window.location.origin}/${slug}`
  const wrapRef = useRef<HTMLDivElement>(null)
  const name = businessName || '사업장'

  // 화면엔 작게(180) 보이지만 캔버스는 고해상도(480)로 렌더 → 포스터 합성 시 선명
  const getQrCanvas = () => wrapRef.current?.querySelector('canvas') as HTMLCanvasElement | null

  // 디자인된 포스터 이미지(dataURL) 합성
  const buildPoster = (): string | null => {
    const qr = getQrCanvas()
    if (!qr) return null
    const W = 800, H = 1040
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    if (!ctx) return null
    const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'

    // 배경
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    // 상단 그린 헤더
    ctx.fillStyle = '#22c55e'; ctx.fillRect(0, 0, W, 180)
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'
    // 사업장명 (길면 폰트 축소)
    let fs = 52
    ctx.font = `bold ${fs}px ${FONT}`
    while (ctx.measureText(name).width > W - 80 && fs > 28) { fs -= 2; ctx.font = `bold ${fs}px ${FONT}` }
    ctx.fillText(name, W / 2, 95)
    ctx.font = `26px ${FONT}`
    ctx.fillText('출 · 퇴근 체크', W / 2, 140)

    // QR (고해상도 캔버스를 흰 박스 위에 배치)
    const qrSize = 460
    const qx = (W - qrSize) / 2, qy = 250
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 2
    ctx.strokeRect(qx - 16, qy - 16, qrSize + 32, qrSize + 32)
    ctx.drawImage(qr, qx, qy, qrSize, qrSize)

    // 안내 문구
    ctx.fillStyle = '#111827'
    ctx.font = `bold 36px ${FONT}`
    ctx.fillText('휴대폰으로 QR을 스캔하세요', W / 2, qy + qrSize + 80)
    ctx.fillStyle = '#6b7280'
    ctx.font = `24px ${FONT}`
    ctx.fillText('출근·퇴근을 바로 기록할 수 있어요', W / 2, qy + qrSize + 122)

    // 푸터
    ctx.fillStyle = '#9ca3af'
    ctx.font = `18px ui-monospace, monospace`
    ctx.fillText(url, W / 2, H - 64)
    ctx.fillStyle = '#22c55e'
    ctx.font = `bold 22px ${FONT}`
    ctx.fillText('퍼펙트 근태관리', W / 2, H - 32)

    return c.toDataURL('image/png')
  }

  const handleDownload = () => {
    const data = buildPoster()
    if (!data) return
    const a = document.createElement('a')
    a.href = data
    a.download = `${name}_출퇴근QR.png`
    a.click()
  }

  const handlePrint = () => {
    const data = buildPoster()
    if (!data) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name} 출퇴근 QR</title></head>
      <body style="margin:0;text-align:center"><img src="${data}" style="width:100%;max-width:480px" />
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  return (
    <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center gap-3">
      <p className="text-xs text-gray-400 leading-relaxed text-center">
        저장·인쇄하면 사업장명과 안내문이 들어간 포스터로 나와요. 매장에 붙이면 직원이 스캔해서 바로 출퇴근할 수 있어요.
      </p>
      <div ref={wrapRef} className="bg-white p-3 rounded-xl border border-gray-100">
        <QRCodeCanvas value={url} size={480} level="M" includeMargin style={{ width: 180, height: 180 }} />
      </div>
      <div className="text-[11px] text-gray-400 font-mono break-all text-center">{url}</div>
      <div className="flex gap-2 w-full">
        <button onClick={handleDownload}
          className="flex-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition">
          🖼 포스터 저장
        </button>
        <button onClick={handlePrint}
          className="flex-1 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-2 transition">
          🖨 인쇄하기
        </button>
      </div>
    </div>
  )
}
