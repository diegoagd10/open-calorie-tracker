import { parseDay } from './format'

// Calendar arithmetic stays at UTC midnight, like the week strip's existing date helpers.
export const shiftDay = (date: string, days: number) => {
  const day = parseDay(date)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

// Use the selected local date and the browser's current local clock. The Date constructor
// applies the offset for that date (including DST), not the offset in effect today.
export const loggedAtOnDay = (date: string) => {
  const day = parseDay(date)
  const now = new Date()
  return new Date(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  ).toISOString()
}
