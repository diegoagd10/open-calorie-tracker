import { DAILY_SUMMARIES_MAX_DAYS } from '@open-calorie-tracker/shared'
import { z } from 'zod'

const isTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

const parseDate = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  return { year, month, day }
}

// Rejects dates that do not exist, like 2026-02-30, which Date.UTC would roll over. Zod runs it
// even when the format is wrong, which makes an invalid Date.
const isCalendarDate = (date: string) => {
  const { year, month, day } = parseDate(date)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
}

const calendarDate = (name: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${name} must be YYYY-MM-DD`)
    .refine(isCalendarDate, `${name} does not exist`)

const timeZone = z.string().refine(isTimeZone, 'timeZone must be an IANA time zone')

export const dayQuerySchema = z.object({ date: calendarDate('date'), timeZone })

export type DayQuery = z.infer<typeof dayQuerySchema>

// The calendar days from one date to another, both included.
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

// How far ahead of UTC the wall clock in timeZone is at the given instant, in milliseconds.
const utcOffset = (instant: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value)
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return wallClock - (instant - (instant % 1000))
}

// The instant the wall clock in timeZone shows midnight on the given day.
const midnight = (year: number, month: number, day: number, timeZone: string) => {
  const wallClock = Date.UTC(year, month - 1, day)
  const guess = wallClock - utcOffset(wallClock, timeZone)
  // Corrects the guess when the offset at midnight differs from the one a few hours away.
  return wallClock - utcOffset(guess, timeZone)
}

// The [start, end) instants of a calendar day in a time zone.
export const dayRange = ({ date, timeZone }: DayQuery) => {
  const { year, month, day } = parseDate(date)
  return {
    start: new Date(midnight(year, month, day, timeZone)),
    end: new Date(midnight(year, month, day + 1, timeZone)),
  }
}
