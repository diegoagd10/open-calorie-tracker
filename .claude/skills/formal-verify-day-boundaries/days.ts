export const FIRST_YEAR = 1970
export const FIRST_YEAR_OF_WHOLE_DAYS = 2011
export const LAST_YEAR = 2037
const EVERY_DAY_OF = [2026]
const DAYS_AROUND_A_CHANGE = 2

export type DayRange = (day: { date: string; timeZone: string }) => { start: Date; end: Date }

export type Day = { date: string; timeZone: string }

export const ZONES = Intl.supportedValuesOf('timeZone')

export const shift = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export const localDateIn = (timeZone: string) => {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return (instant: number) => format.format(instant)
}

export const clockChangesOf = (timeZone: string): number[] => {
  const changes: number[] = []
  let from = Temporal.Instant.from(`${FIRST_YEAR}-01-01T00:00Z`).toZonedDateTimeISO(timeZone)
  for (;;) {
    const change = from.getTimeZoneTransition('next')
    if (change === null || change.year > LAST_YEAR) return changes
    changes.push(change.epochMilliseconds)
    from = change
  }
}

const everyDay = EVERY_DAY_OF.flatMap((year) => {
  const days: string[] = []
  for (let date = `${year}-01-01`; date.startsWith(String(year)); date = shift(date, 1)) {
    days.push(date)
  }
  return days
})

export const daysOf = (timeZone: string): string[] => {
  const localDate = localDateIn(timeZone)
  const days = new Set(everyDay)
  for (const change of clockChangesOf(timeZone)) {
    for (let offset = -DAYS_AROUND_A_CHANGE; offset <= DAYS_AROUND_A_CHANGE; offset++) {
      days.add(shift(localDate(change), offset))
    }
  }
  return [...days]
}
