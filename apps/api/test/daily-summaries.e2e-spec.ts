import { DAILY_SUMMARIES_MAX_DAYS, DEFAULT_DAILY_GOALS } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { seedDailyGoals, seedFoodEntry, seedUser, seedWaterEntry } from '../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp } from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

// Monday to Sunday. New York leaves daylight saving time (UTC-4 → UTC-5) on Sunday 2026-11-01.
const WEEK = { from: '2026-10-26', to: '2026-11-01', timeZone: 'America/New_York' }

const newYorkTime = (localDateTime: string, offset = '-04:00') =>
  new Date(`${localDateTime}${offset}`)

type DaySummary = { date: string; calories: number; foodEntries: number }
type DailySummaries = {
  from: string
  to: string
  timeZone: string
  goals: typeof DEFAULT_DAILY_GOALS
  days: DaySummary[]
}

describe('GET /v1/daily-summaries (e2e)', () => {
  let app: TestApp
  let database: Database

  beforeEach(async () => {
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
  })

  afterEach(async () => {
    await app.close()
  })

  const getSummaries = (token: string | undefined, query: Record<string, string>) => {
    const pending = request(app.getHttpServer()).get('/v1/daily-summaries').query(query)
    return token === undefined ? pending : pending.set('Authorization', `Bearer ${token}`)
  }

  const summaries = async (query: Record<string, string> = WEEK) => {
    const response = await getSummaries(await accessTokenFor(app, USERNAME, PASSWORD), query)
    expect(response.status).toBe(200)
    return response.body as DailySummaries
  }

  const food = (localDateTime: string, calories: number, offset?: string) => ({
    username: USERNAME,
    loggedAt: newYorkTime(localDateTime, offset),
    name: 'Tacos',
    servingSize: '1 serving',
    quantity: 1,
    calories,
  })

  const day = (summary: DailySummaries, date: string) =>
    summary.days.find((candidate) => candidate.date === date)

  describe('authentication', () => {
    it('rejects a request without a token with 401', async () => {
      expect((await getSummaries(undefined, WEEK)).status).toBe(401)
    })

    it.each(INVALID_TOKENS)('rejects %s with 401', async (_case, token) => {
      expect((await getSummaries(await token(), WEEK)).status).toBe(401)
    })
  })

  describe('validation', () => {
    it.each([
      ['a missing start', { to: WEEK.to, timeZone: WEEK.timeZone }],
      ['a missing end', { from: WEEK.from, timeZone: WEEK.timeZone }],
      ['a missing time zone', { from: WEEK.from, to: WEEK.to }],
      ['a start in another format', { ...WEEK, from: '26-10-2026' }],
      ['an end that does not exist', { ...WEEK, to: '2026-02-30' }],
      ['an unknown time zone', { ...WEEK, timeZone: 'Mars/Olympus_Mons' }],
      ['an end before the start', { ...WEEK, from: '2026-11-01', to: '2026-10-31' }],
      [
        `more than ${DAILY_SUMMARIES_MAX_DAYS} days`,
        { ...WEEK, from: '2026-10-01', to: `2026-11-${String(DAILY_SUMMARIES_MAX_DAYS - 30)}` },
      ],
    ])('rejects %s with 400', async (_case, query) => {
      const response = await getSummaries(await accessTokenFor(app, USERNAME, PASSWORD), query)

      expect(response.status).toBe(400)
    })

    it(`accepts exactly ${DAILY_SUMMARIES_MAX_DAYS} days`, async () => {
      const { days } = await summaries({
        ...WEEK,
        from: '2026-10-01',
        to: `2026-10-${String(DAILY_SUMMARIES_MAX_DAYS)}`,
      })

      expect(days).toHaveLength(DAILY_SUMMARIES_MAX_DAYS)
    })
  })

  it('echoes the requested range and time zone', async () => {
    const summary = await summaries()

    expect({ from: summary.from, to: summary.to, timeZone: summary.timeZone }).toEqual(WEEK)
  })

  it("returns the user's daily goals", async () => {
    expect((await summaries()).goals).toEqual(DEFAULT_DAILY_GOALS)

    await seedDailyGoals(database, { username: USERNAME, calories: 2000 })

    expect((await summaries()).goals.calories).toBe(2000)
  })

  it('returns every day of the range in order, empty days included', async () => {
    const { days } = await summaries()

    expect(days).toEqual(
      [
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
      ].map((date) => ({ date, calories: 0, foodEntries: 0 })),
    )
  })

  it('returns a single day when the range starts and ends on it', async () => {
    const { days } = await summaries({ ...WEEK, from: '2026-10-28', to: '2026-10-28' })

    expect(days.map((summary) => summary.date)).toEqual(['2026-10-28'])
  })

  it('adds up the calories and counts the food entries of each day', async () => {
    await seedFoodEntry(database, food('2026-10-26T08:00:00', 300))
    await seedFoodEntry(database, food('2026-10-26T13:00:00', 650.5))
    await seedFoodEntry(database, food('2026-10-28T19:00:00', 900))

    const summary = await summaries()

    expect(day(summary, '2026-10-26')).toEqual({
      date: '2026-10-26',
      calories: 950.5,
      foodEntries: 2,
    })
    expect(day(summary, '2026-10-27')).toEqual({ date: '2026-10-27', calories: 0, foodEntries: 0 })
    expect(day(summary, '2026-10-28')).toEqual({
      date: '2026-10-28',
      calories: 900,
      foodEntries: 1,
    })
  })

  it('puts each entry on its day in the requested time zone, across daylight saving time', async () => {
    for (const [localDateTime, offset] of [
      ['2026-10-25T23:59:59', '-04:00'],
      ['2026-10-26T00:00:00', '-04:00'],
      ['2026-10-31T23:59:59', '-04:00'],
      // The last day is 25 hours long.
      ['2026-11-01T23:30:00', '-05:00'],
      ['2026-11-02T00:00:00', '-05:00'],
    ] as const) {
      await seedFoodEntry(database, food(localDateTime, 100, offset))
    }

    const summary = await summaries()

    expect(summary.days.map((summary) => summary.foodEntries)).toEqual([1, 0, 0, 0, 0, 1, 1])
    // In Tokyo, the first two fall on 2026-10-26, the third on 2026-11-01 and the last two after
    // the range.
    const tokyo = await summaries({ ...WEEK, timeZone: 'Asia/Tokyo' })
    expect(tokyo.days.map((summary) => summary.foodEntries)).toEqual([2, 0, 0, 0, 0, 0, 1])
  })

  it("ignores water and other users' entries", async () => {
    await seedWaterEntry(database, {
      username: USERNAME,
      loggedAt: newYorkTime('2026-10-27T10:00:00'),
      amount: 16,
    })
    await seedFoodEntry(database, { ...food('2026-10-27T10:00:00', 500), username: OTHER_USERNAME })

    expect(day(await summaries(), '2026-10-27')).toEqual({
      date: '2026-10-27',
      calories: 0,
      foodEntries: 0,
    })
  })
})
