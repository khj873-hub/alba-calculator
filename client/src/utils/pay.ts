// startDay: 1=월요일 시작, 0=일요일 시작
export function getWeekKey(dateStr: string, startDay: 0 | 1 = 1): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const offset = startDay === 1 ? (day === 0 ? 6 : day - 1) : day
  const weekStart = new Date(d)
  weekStart.setDate(d.getDate() - offset)
  return weekStart.toISOString().slice(0, 10)
}

export function calcWeeklyHolidayPay(
  segments: { date: string; mins: number }[],
  hourlyRate: number,
  thresholdHours = 15,
  startDay: 0 | 1 = 1
): number {
  const weekMap = new Map<string, number>()
  for (const s of segments) {
    const wk = getWeekKey(s.date + 'T00:00:00', startDay)
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + s.mins)
  }
  let total = 0
  const thresholdMins = thresholdHours * 60
  for (const weekMins of weekMap.values()) {
    if (weekMins >= thresholdMins) {
      total += Math.floor((weekMins / 60 / 40) * 8 * hourlyRate)
    }
  }
  return total
}
