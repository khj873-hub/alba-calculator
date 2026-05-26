// 출퇴근 한 건을 자정 기준으로 분할.
// 모든 시각 문자열은 동일 타임존(KST) 가정. UTC 함수로 일관 처리해 TZ 영향 제거.

export interface Segment {
  date: string  // YYYY-MM-DD
  from: string  // HH:MM
  to: string    // HH:MM (자정에서 끊긴 segment는 '24:00')
  mins: number
}

function toMs(dt: string): number {
  const [d, t] = dt.split(' ')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi, se] = t.split(':').map(Number)
  return Date.UTC(y, mo - 1, da, h, mi, se)
}

function toDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function toHM(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function addDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return dt.toISOString().slice(0, 10)
}

export function splitByMidnight(clockIn: string, clockOut: string): Segment[] {
  const inMs = toMs(clockIn)
  const outMs = toMs(clockOut)
  if (outMs <= inMs) return []

  const segs: Segment[] = []
  let cursorMs = inMs
  while (cursorMs < outMs) {
    const cursorDate = toDateStr(cursorMs)
    const nextMidnightMs = toMs(`${addDay(cursorDate)} 00:00:00`)
    const segEndMs = Math.min(nextMidnightMs, outMs)
    segs.push({
      date: cursorDate,
      from: toHM(cursorMs),
      to: segEndMs === nextMidnightMs ? '24:00' : toHM(segEndMs),
      mins: Math.floor((segEndMs - cursorMs) / 60000),
    })
    cursorMs = segEndMs
  }
  return segs
}
