const LOCALE = 'en-US'

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

export const formatNumber = (value: number) => numberFormat.format(value)

export const roundForDisplay = (value: number) => Math.round(value * 10) / 10

export const parseDay = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const dayFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' })

const longDay = dayFormat({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortWeekday = dayFormat({ weekday: 'short' })
const shortDay = dayFormat({ month: 'short', day: 'numeric' })

export const formatLongDay = (day: Date) => longDay.format(day)

export const formatShortWeekday = (day: Date) => shortWeekday.format(day)

export const formatShortDay = (day: Date) => shortDay.format(day)

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

export const formatTime = (instant: string) => timeFormat.format(new Date(instant))
