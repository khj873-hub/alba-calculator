import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

// 사업장 출퇴근 QR — 매장 부착용. {도메인}/{slug} 를 인코딩.
export default function BusinessQR({ slug, businessName }: { slug: string; businessName?: string }) {
  const url = `${window.location.origin}/${slug}`
  const wrapRef = useRef<HTMLDivElement>(null)
  const name = businessName || '사업장'

  const getCanvas = () => wrapRef.current?.querySelector('canvas') as HTMLCanvasElement | null

  const handleDownload = () => {
    const canvas = getCanvas()
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${name}_출퇴근QR.png`
    a.click()
  }

  const handlePrint = () => {
    const canvas = getCanvas()
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name} 출퇴근 QR</title></head>
      <body style="text-align:center;font-family:-apple-system,sans-serif;padding:48px">
        <h1 style="font-size:28px;margin-bottom:8px">${name}</h1>
        <p style="font-size:18px;color:#444;margin-top:0">출근·퇴근은 아래 QR을 스캔하세요</p>
        <img src="${dataUrl}" style="width:320px;height:320px;margin:24px auto" />
        <p style="color:#999;font-size:13px">${url}</p>
        <script>window.onload=function(){window.print()}</script>
      </body></html>`)
    w.document.close()
  }

  return (
    <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center gap-3">
      <p className="text-xs text-gray-400 leading-relaxed text-center">
        이 QR을 인쇄해 매장에 붙이면, 직원이 스캔해서 바로 출퇴근 화면으로 접속할 수 있어요.
      </p>
      <div ref={wrapRef} className="bg-white p-3 rounded-xl border border-gray-100">
        <QRCodeCanvas value={url} size={180} level="M" includeMargin />
      </div>
      <div className="text-[11px] text-gray-400 font-mono break-all text-center">{url}</div>
      <div className="flex gap-2 w-full">
        <button onClick={handleDownload}
          className="flex-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition">
          🖼 이미지 저장
        </button>
        <button onClick={handlePrint}
          className="flex-1 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-2 transition">
          🖨 인쇄하기
        </button>
      </div>
    </div>
  )
}
