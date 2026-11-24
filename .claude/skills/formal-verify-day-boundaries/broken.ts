import type { DayRange } from './days.ts'

const DAY_MS = 24 * 60 * 60 * 1000

const utcOffset = (instant: number, timeZone: string) => {
  const local = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(timeZone)
  return local.offsetNanoseconds / 1_000_000
}

const guessedMidnight = (wallClock: number, timeZone: string) =>
  wallClock - utcOffset(wallClock - utcOffset(wallClock, timeZone), timeZone)

export const guessedOffset: DayRange = ({ date, timeZone }) => {
  const wallClock = Date.parse(`${date}T00:00:00Z`)
  return {
    start: new Date(guessedMidnight(wallClock, timeZone)),
    end: new Date(guessedMidnight(wallClock + DAY_MS, timeZone)),
  }
}

export const always24Hours: DayRange = ({ date, timeZone }) => {
  const { epochMilliseconds } = Temporal.PlainDate.from(date).toZonedDateTime(timeZone)
  return { start: new Date(epochMilliseconds), end: new Date(epochMilliseconds + DAY_MS) }
}

export const onlyTemporalZones: DayRange = ({ date, timeZone }) => {
  const day = Temporal.PlainDate.from(date)
  return {
    start: new Date(day.toZonedDateTime(timeZone).epochMilliseconds),
    end: new Date(day.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds),
  }
}
