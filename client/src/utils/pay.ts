export function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().slice(0, 10)
}

export function calcWeeklyHolidayPay(
  records: { clock_in: string; duration_minutes: number }[],
  hourlyRate: number
): number {
  const weekMap = new Map<string, number>()
  for (const r of records) {
    const wk = getWeekKey(r.clock_in)
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + r.duration_minutes)
  }
  let total = 0
  for (const weekMins of weekMap.values()) {
    if (weekMins >= 15 * 60) {
      total += Math.floor((weekMins / 60 / 40) * 8 * hourlyRate)
    }
  }
  return total
}
