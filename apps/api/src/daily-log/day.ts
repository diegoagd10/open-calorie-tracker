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

// Rejects dates that do not exist, like 2026-02-30, which Date.UTC would roll over.
const isCalendarDate = (date: string) => {
  const { year, month, day } = parseDate(date)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(date)
}

export const dayQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine(isCalendarDate, 'date does not exist'),
  timeZone: z.string().refine(isTimeZone, 'timeZone must be an IANA time zone'),
})

export type DayQuery = z.infer<typeof dayQuerySchema>

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
