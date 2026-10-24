// Display helpers. The app is in English, so dates and numbers use the en-US formats.

const LOCALE = 'en-US'

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

// 1600 → "1,600", 16.94 → "16.9".
export const formatNumber = (value: number) => numberFormat.format(value)

// The value progress bars report, rounded like formatNumber but without grouping.
export const roundForDisplay = (value: number) => Math.round(value * 10) / 10

// A calendar day, YYYY-MM-DD, kept as UTC midnight so formatting never shifts it.
export const parseDay = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const dayFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' })

const longDay = dayFormat({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortWeekday = dayFormat({ weekday: 'short' })

// "Saturday, October 24, 2026".
export const formatLongDay = (day: Date) => longDay.format(day)

export const formatShortWeekday = (day: Date) => shortWeekday.format(day)

// Monday to Sunday of the week the day is in.
export const weekOf = (day: Date) => {
  const daysSinceMonday = (day.getUTCDay() + 6) % 7
  return Array.from(
    { length: 7 },
    (_, index) =>
      new Date(
        Date.UTC(
          day.getUTCFullYear(),
          day.getUTCMonth(),
          day.getUTCDate() - daysSinceMonday + index,
        ),
      ),
  )
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' })

// "10:53 AM" in the browser's time zone.
export const formatTime = (instant: string) => timeFormat.format(new Date(instant))
