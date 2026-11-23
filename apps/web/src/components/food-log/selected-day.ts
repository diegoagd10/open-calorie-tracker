import { parseDay } from './format'

export const shiftDay = (date: string, days: number) => {
  const day = parseDay(date)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

// oxlint-disable-next-line local/no-comments
// The Date constructor applies the offset for that date (including DST), not the offset in effect
// today. When the clocks skip the end of that day, it moves a skipped time to the next day.
export const loggedAtOnDay = (date: string) => {
  const day = parseDay(date)
  const now = new Date()
  const sameTime = new Date(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  )
  const nextDay = new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1)
  return new Date(Math.min(sameTime.getTime(), nextDay.getTime() - 1)).toISOString()
}
