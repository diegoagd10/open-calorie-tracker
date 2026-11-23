import { DAILY_SUMMARIES_MAX_DAYS } from '@open-calorie-tracker/shared'
import { z } from 'zod'

// oxlint-disable-next-line local/no-comments
// Temporal does not know legacy names that Intl accepts, like PST. Intl resolves them to the IANA
// names that it does know.
const ianaName = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone

const isTimeZone = (timeZone: string) => {
  try {
    Temporal.Now.zonedDateTimeISO(ianaName(timeZone))
    return true
  } catch {
    return false
  }
}

const parseDate = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  return { year, month, day }
}

// oxlint-disable-next-line local/no-comments
// Rejects dates that do not exist, like 2026-02-30, which Date.UTC would roll over. Zod runs it
// even when the format is wrong, which makes an invalid Date.
const isCalendarDate = (date: string) => {
  const { year, month, day } = parseDate(date)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
}

export const calendarDate = (name: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${name} must be YYYY-MM-DD`)
    .refine(isCalendarDate, `${name} does not exist`)

export const timeZone = z.string().refine(isTimeZone, 'timeZone must be an IANA time zone')

export const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())

export const dayQuerySchema = z.object({ date: calendarDate('date'), timeZone })

export type DayQuery = z.infer<typeof dayQuerySchema>

export const datesBetween = (from: string, to: string) => {
  const start = parseDate(from)
  const dates: string[] = []
  for (let offset = 0; ; offset++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset))
      .toISOString()
      .slice(0, 10)
    if (date > to) return dates
    dates.push(date)
  }
}

export const rangeQuerySchema = z
  .object({ from: calendarDate('from'), to: calendarDate('to'), timeZone })
  .refine(({ from, to }) => from <= to, 'to must not be before from')
  .refine(
    ({ from, to }) => datesBetween(from, to).length <= DAILY_SUMMARIES_MAX_DAYS,
    `the range must not be longer than ${DAILY_SUMMARIES_MAX_DAYS} days`,
  )

export type RangeQuery = z.infer<typeof rangeQuerySchema>

export const dayRange = ({ date, timeZone }: DayQuery) => {
  const zone = ianaName(timeZone)
  const startOf = (day: Temporal.PlainDate) => new Date(day.toZonedDateTime(zone).epochMilliseconds)
  const day = Temporal.PlainDate.from(date)
  return { start: startOf(day), end: startOf(day.add({ days: 1 })) }
}
