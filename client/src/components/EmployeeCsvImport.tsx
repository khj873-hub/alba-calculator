import { useState } from 'react'
import { bulkCreateEmployees } from '../api'
import type { BulkEmployeeRow } from '../api'

// UTF-8 BOM + 헤더 + 예시 2행 (엑셀 한글 호환)
const TEMPLATE = '﻿이름,시급,부서,주휴수당포함,급여계산\n김민수,10320,홀,N,Y\n박지영,11000,주방,N,Y\n'

// 경량 CSV 파서 — BOM/CRLF/따옴표 필드/트레일링 개행 처리(naive split 금지)
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== '')) // 빈 행 제거
}

interface PreviewRow { name: string; hourly_rate: string; department: string; pay_includes_holiday: boolean; pay_enabled: boolean; error?: string }

export default function EmployeeCsvImport({ slug, onClose }: { slug: string; onClose: (created: number, unmatchedDepartments?: string[]) => void }) {
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = '직원등록_양식.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setErr(''); setRows([])
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result))
      if (parsed.length < 2) { setErr('데이터 행이 없습니다. 양식에 직원을 입력하세요.'); return }
      const header = parsed[0].map((h) => h.trim())
      const idx = (name: string) => header.indexOf(name)
      const iName = idx('이름'), iRate = idx('시급'), iDept = idx('부서'), iHoliday = idx('주휴수당포함'), iPay = idx('급여계산')
      if (iName < 0) { setErr("'이름' 컬럼을 찾을 수 없습니다. 제공된 양식을 사용하세요."); return }
      const pr: PreviewRow[] = parsed.slice(1).map((r) => {
        const name = (r[iName] || '').trim()
        const rate = iRate >= 0 ? (r[iRate] || '').trim() : ''
        let error: string | undefined
        if (!name) error = '이름 누락'
        else if (rate && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) error = '시급 오류' // 서버 검증과 동일(음수 불가)
        return {
          name, hourly_rate: rate,
          department: iDept >= 0 ? (r[iDept] || '').trim() : '',
          pay_includes_holiday: iHoliday >= 0 ? (r[iHoliday] || '').trim().toUpperCase() === 'Y' : false,
          pay_enabled: iPay >= 0 ? (r[iPay] || 'Y').trim().toUpperCase() !== 'N' : true,
          error,
        }
      })
      setRows(pr)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = '' // 같은 파일 수정 후 재선택 허용
  }

  const valid = rows.filter((r) => !r.error)
  const errorCount = rows.length - valid.length

  const submit = async () => {
    if (rows.length === 0 || errorCount > 0) return
    setSaving(true); setErr('')
    try {
      const payload: BulkEmployeeRow[] = valid.map((r) => ({
        name: r.name,
        hourly_rate: r.hourly_rate || undefined,
        department: r.department || undefined,
        pay_includes_holiday: r.pay_includes_holiday,
        pay_enabled: r.pay_enabled,
      }))
      const res = await bulkCreateEmployees(slug, payload)
      onClose(res.created, res.unmatchedDepartments)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '등록에 실패했습니다')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => onClose(0)}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold text-gray-800">📋 직원 CSV 일괄 등록</h3>
          <button onClick={() => onClose(0)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 leading-relaxed mb-3">
          ① 양식을 받아 직원 명단을 채우고 ② CSV로 저장해 업로드하세요.
          이름만 있으면 등록되고, 시급을 비우면 최저시급, 부서는 미리 만든 부서명과 같아야 배정됩니다.
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={downloadTemplate} className="flex-1 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2.5 transition">
            ⬇ 양식 다운로드
          </button>
          <label className="flex-1 text-center text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2.5 transition cursor-pointer">
            📁 파일 선택
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          </label>
        </div>
        {fileName && <p className="text-xs text-gray-400 mb-2">{fileName}</p>}
        {err && <p className="text-sm text-red-500 mb-2">{err}</p>}

        {rows.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              총 {rows.length}명 · <span className="text-green-600">유효 {valid.length}</span>
              {errorCount > 0 && <span className="text-red-500"> · 오류 {errorCount}</span>}
            </p>
            <div className="border border-gray-100 rounded-lg overflow-hidden mb-3 max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr><th className="px-2 py-1.5 text-left">이름</th><th className="px-2 py-1.5 text-left">시급</th><th className="px-2 py-1.5 text-left">부서</th><th className="px-2 py-1.5 text-left">상태</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.error ? 'bg-red-50' : ''}>
                      <td className="px-2 py-1.5">{r.name || <span className="text-red-400">(없음)</span>}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.hourly_rate || '기본'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.department || '-'}</td>
                      <td className="px-2 py-1.5">{r.error ? <span className="text-red-500">{r.error}</span> : <span className="text-green-600">✓</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errorCount > 0 && <p className="text-xs text-red-500 mb-2">오류 행을 수정한 뒤 다시 업로드하세요. (오류가 있으면 등록되지 않습니다)</p>}
            <button onClick={submit} disabled={saving || errorCount > 0 || valid.length === 0}
              className="w-full py-3 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition disabled:opacity-50">
              {saving ? '등록 중...' : `${valid.length}명 등록`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
