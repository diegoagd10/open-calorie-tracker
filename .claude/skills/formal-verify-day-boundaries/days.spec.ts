import { afterEach, beforeAll, expect, it, vi } from 'vite-plus/test'
import { DailyLogService } from '../../../apps/api/src/daily-log/daily-log.service.js'
import { dayQuerySchema, dayRange } from '../../../apps/api/src/daily-log/day.js'
import { Database } from '../../../apps/api/src/db/database.js'
import { seedUser, seedFoodEntry } from '../../../apps/api/src/db/seed.js'
import { DailyGoalsService } from '../../../apps/api/src/settings/daily-goals/daily-goals.service.js'
import { loggedAtOnDay } from '../../../apps/web/src/components/food-log/selected-day.ts'
import { always24Hours, guessedOffset, onlyTemporalZones } from './broken.ts'
import {
  type Day,
  type DayRange,
  FIRST_YEAR_OF_WHOLE_DAYS,
  ZONES,
  clockChangesOf,
  daysOf,
  localDateIn,
  shift,
} from './days.ts'

const ZONES_FOR_BROKEN_DESIGNS = [
  'America/Santiago',
  'America/Havana',
  'America/Nuuk',
  'Atlantic/Azores',
  'Europe/Madrid',
]
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const HALF_HOURS = Array.from({ length: 48 }, (_, half) => half)
const LEGACY_ZONES = ['PST', 'IST', 'JST', 'AET', 'SystemV/EST5', 'utc', 'US/Pacific', '+05:30']

type Outcome = { checked: number; violations: string[] }

const zoneDays: Day[] = []

beforeAll(() => {
  for (const timeZone of ZONES) {
    for (const date of daysOf(timeZone)) zoneDays.push({ date, timeZone })
  }
})

afterEach(() => vi.useRealTimers())

const daysIn = (zones: string[]) =>
  zones === ZONES ? zoneDays : zoneDays.filter(({ timeZone }) => zones.includes(timeZone))

const text = ({ date, timeZone }: Day) => `${timeZone} ${date}`

const inWholeDayYears = ({ date }: Day) => Number(date.slice(0, 4)) >= FIRST_YEAR_OF_WHOLE_DAYS

const ranges = new Map<DayRange, Map<string, { start: number; end: number }>>()

const cached = (range: DayRange, day: Day) => {
  const known = ranges.get(range) ?? new Map<string, { start: number; end: number }>()
  ranges.set(range, known)
  const found = known.get(text(day))
  if (found !== undefined) return found
  const { start, end } = range(day)
  const made = { start: start.getTime(), end: end.getTime() }
  known.set(text(day), made)
  return made
}

const firstMoment = (range: DayRange, zones = ZONES): Outcome => {
  const violations: string[] = []
  const localDates = new Map(ZONES.map((timeZone) => [timeZone, localDateIn(timeZone)]))
  for (const day of daysIn(zones)) {
    const localDate = localDates.get(day.timeZone) ?? localDateIn(day.timeZone)
    const { start } = cached(range, day)
    const reads = localDate(start)
    if (reads < day.date || localDate(start - 1) >= day.date) {
      violations.push(`${text(day)} starts at ${new Date(start).toISOString()}, on ${reads}`)
    }
  }
  return { checked: daysIn(zones).length, violations }
}

const daysTile = (range: DayRange, zones = ZONES): Outcome => {
  const days = daysIn(zones)
  const violations = days.flatMap((day) => {
    const { start, end } = cached(range, day)
    const next = cached(range, { ...day, date: shift(day.date, 1) }).start
    return start <= end && end === next
      ? []
      : [`${text(day)} ends at ${new Date(end).toISOString()}, the next day starts elsewhere`]
  })
  return { checked: days.length, violations }
}

const ownDay = (range: DayRange, zones = ZONES): Outcome => {
  const violations: string[] = []
  let checked = 0
  for (const timeZone of zones) {
    const localDate = localDateIn(timeZone)
    for (const change of clockChangesOf(timeZone)) {
      for (let minutes = -25 * 60; minutes <= 25 * 60; minutes += 30) {
        for (const instant of [change + minutes * MINUTE_MS, change + minutes * MINUTE_MS - 1]) {
          const day = { date: localDate(instant), timeZone }
          if (!inWholeDayYears(day)) continue
          checked++
          const { start, end } = cached(range, day)
          if (instant < start || instant >= end) {
            violations.push(`${new Date(instant).toISOString()} is not in ${text(day)}`)
          }
        }
      }
    }
  }
  return { checked, violations }
}

const everyZone = (range: DayRange, zones = ZONES): Outcome => {
  const names = [...zones, ...LEGACY_ZONES].filter(
    (timeZone) => dayQuerySchema.safeParse({ date: '2026-11-23', timeZone }).success,
  )
  const violations = names.flatMap((timeZone) => {
    try {
      const { start, end } = range({ date: '2026-11-23', timeZone })
      return end.getTime() - start.getTime() === 24 * HOUR_MS ? [] : [`${timeZone} has no day`]
    } catch {
      return [`${timeZone} is accepted and throws`]
    }
  })
  return { checked: names.length, violations }
}

const logsOnItsDay = (range: DayRange, zones = ZONES): Outcome => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const violations: string[] = []
  let checked = 0
  for (const timeZone of zones) {
    process.env['TZ'] = timeZone
    const days = daysIn([timeZone]).filter(inWholeDayYears)
    for (const day of days) {
      const { start, end } = cached(range, day)
      if (start === end) continue
      for (const half of HALF_HOURS) {
        vi.setSystemTime(new Date(2026, 0, 15, Math.floor(half / 2), (half % 2) * 30))
        const loggedAt = Date.parse(loggedAtOnDay(day.date))
        checked++
        if (loggedAt < start || loggedAt >= end) {
          violations.push(`${text(day)}: an entry goes to ${new Date(loggedAt).toISOString()}`)
        }
      }
    }
  }
  delete process.env['TZ']
  return { checked, violations }
}

const summary = ({ violations }: Outcome) => {
  const example = violations.find((line) => /Santiago.*2026/.test(line)) ?? violations[0]
  return `${violations.length} times, such as ${example}`
}

const RULES = { firstMoment, daysTile, ownDay, everyZone, logsOnItsDay }

const NAMES: Record<keyof typeof RULES, string> = {
  firstMoment: 'FirstMoment',
  daysTile: 'DaysTile',
  ownDay: 'OwnDay',
  everyZone: 'EveryZone',
  logsOnItsDay: 'LogsOnItsDay',
}

const rules = Object.keys(RULES) as (keyof typeof RULES)[]

it.each(rules)('%s holds', (rule) => {
  const outcome = RULES[rule](dayRange)
  const holds = outcome.checked > 0 && outcome.violations.length === 0
  console.log(
    holds
      ? `PASS  ${NAMES[rule]} holds in ${outcome.checked} cases`
      : `FAIL  ${NAMES[rule]} breaks ${summary(outcome)}`,
  )
  expect(holds).toBe(true)
})

it('the daily log and the summaries put an entry on its own day', async () => {
  const database = await Database.connect(':memory:')
  try {
    const username = 'ana'
    await seedUser(database, { username, password: 'correct-horse-battery-staple' })
    const log = new DailyLogService(database, new DailyGoalsService(database))
    const changes = ZONES.flatMap((timeZone) =>
      clockChangesOf(timeZone).map((change) => ({ timeZone, change })),
    ).filter(({ change }) => new Date(change).getUTCFullYear() === 2026)
    const instants = [
      ...new Set(changes.flatMap(({ change }) => [change - 1, change - HOUR_MS / 2, change])),
    ]
    for (const instant of instants) {
      await seedFoodEntry(database, {
        username,
        loggedAt: new Date(instant),
        name: 'x',
        servingSize: '1',
        quantity: 1,
        calories: 1,
      })
    }

    const violations: string[] = []
    for (const { timeZone, change } of changes) {
      const localDate = localDateIn(timeZone)
      const date = localDate(change)
      const from = shift(date, -2)
      const to = shift(date, 2)
      const { days } = await log.dailySummaries(1, { from, to, timeZone })
      for (const day of days) {
        const expected = instants.filter((instant) => localDate(instant) === day.date).length
        const { entries } = await log.dailyLog(1, { date: day.date, timeZone })
        if (entries.length !== expected || day.foodEntries !== expected) {
          violations.push(
            `${timeZone} ${day.date}: ${expected} entries, the log has ${entries.length} and the summary ${day.foodEntries}`,
          )
        }
      }
    }
    const outcome = { checked: changes.length * 5, violations }
    const holds = outcome.checked > 0 && violations.length === 0
    console.log(
      holds
        ? `PASS  The daily log and the summaries hold in ${outcome.checked} cases`
        : `FAIL  The daily log and the summaries break ${summary(outcome)}`,
    )
    expect(holds).toBe(true)
  } finally {
    database.close()
  }
})

const BROKEN = [
  { design: 'guessedOffset', range: guessedOffset, breaks: 'firstMoment' },
  { design: 'guessedOffset', range: guessedOffset, breaks: 'ownDay' },
  { design: 'guessedOffset', range: guessedOffset, breaks: 'logsOnItsDay' },
  { design: 'always24Hours', range: always24Hours, breaks: 'daysTile' },
  { design: 'onlyTemporalZones', range: onlyTemporalZones, breaks: 'everyZone' },
] as const

it.each(BROKEN)('$design breaks $breaks', ({ design, range, breaks }) => {
  const caught = RULES[breaks](range, ZONES_FOR_BROKEN_DESIGNS).violations.length > 0
  console.log(
    `${caught ? 'PASS' : 'FAIL'}  The broken ${design} ${caught ? 'breaks' : 'does not break'} ${NAMES[breaks]}`,
  )
  expect(caught).toBe(true)
})
