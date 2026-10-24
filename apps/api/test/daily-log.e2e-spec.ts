import { SignJWT } from 'jose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { seedFoodEntry, seedUser, seedWaterEntry } from '../src/db/seed.js'
import { TEST_ENV, type TestApp, createTestApp } from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const DATE = '2026-10-24'
const TIME_ZONE = 'America/New_York'

const DEFAULT_GOALS = {
  calories: 1600,
  protein: 120,
  carbohydrate: 230,
  fat: 70,
  fiber: 25,
  sugar: 50,
  sodium: 2300,
  water: 64,
}

// New York is on daylight saving time (UTC-4) from 2026-10-23 to 2026-10-25.
const newYorkTime = (localDateTime: string) => new Date(`${localDateTime}-04:00`)

type Totals = Record<keyof typeof DEFAULT_GOALS | 'foodEntries', number>
type Entry = { type: 'food' | 'water'; name?: string; loggedAt: string }
type DailyLog = {
  date: string
  timeZone: string
  goals: typeof DEFAULT_GOALS
  totals: Totals
  entries: Entry[]
}

describe('GET /v1/daily-log (e2e)', () => {
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

  const accessToken = async (username = USERNAME) => {
    const response = await request(app.getHttpServer())
      .post('/v1/login')
      .send({ username, password: PASSWORD })
    return (response.body as { accessToken: string }).accessToken
  }

  const getDailyLog = (token: string | undefined, query: Record<string, string>) => {
    const pending = request(app.getHttpServer()).get('/v1/daily-log').query(query)
    return token === undefined ? pending : pending.set('Authorization', `Bearer ${token}`)
  }

  const dailyLog = async (query = { date: DATE, timeZone: TIME_ZONE }) => {
    const response = await getDailyLog(await accessToken(), query)
    expect(response.status).toBe(200)
    return response.body as DailyLog
  }

  const tortillas = {
    username: USERNAME,
    loggedAt: newYorkTime('2026-10-24T10:53:00'),
    name: '2 tortillas de maíz',
    servingSize: '1 serving',
    quantity: 1,
    calories: 100,
    protein: 2.5,
    carbohydrate: 21,
    fat: 1.2,
    fiber: 3,
    sugar: 0.4,
    sodium: 20,
  }

  describe('authentication', () => {
    const signToken = (secret: string, expiresAt: number) =>
      new SignJWT()
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(TEST_ENV.JWT_ISSUER)
        .setAudience(TEST_ENV.JWT_AUDIENCE)
        .setSubject('1')
        .setIssuedAt(expiresAt - 60)
        .setExpirationTime(expiresAt)
        .sign(new TextEncoder().encode(secret))

    const now = () => Math.floor(Date.now() / 1000)

    it('rejects a request without a token with 401', async () => {
      const response = await getDailyLog(undefined, { date: DATE, timeZone: TIME_ZONE })

      expect(response.status).toBe(401)
    })

    it.each([
      ['a malformed token', () => Promise.resolve('not-a-jwt')],
      ['an expired token', () => signToken(TEST_ENV.JWT_SECRET, now() - 60)],
      ['a token signed with another secret', () => signToken('x'.repeat(42), now() + 600)],
    ])('rejects %s with 401', async (_case, token) => {
      const response = await getDailyLog(await token(), { date: DATE, timeZone: TIME_ZONE })

      expect(response.status).toBe(401)
    })
  })

  describe('validation', () => {
    it.each([
      ['a missing date', { timeZone: TIME_ZONE }],
      ['a missing time zone', { date: DATE }],
      ['a date in another format', { date: '24-10-2026', timeZone: TIME_ZONE }],
      ['a date that does not exist', { date: '2026-02-30', timeZone: TIME_ZONE }],
      ['an unknown time zone', { date: DATE, timeZone: 'Mars/Olympus_Mons' }],
    ])('rejects %s with 400', async (_case, query) => {
      const response = await getDailyLog(await accessToken(), query)

      expect(response.status).toBe(400)
    })
  })

  it('echoes the requested date and time zone', async () => {
    const log = await dailyLog()

    expect(log.date).toBe(DATE)
    expect(log.timeZone).toBe(TIME_ZONE)
  })

  it('returns the default daily goals', async () => {
    expect((await dailyLog()).goals).toEqual(DEFAULT_GOALS)
  })

  it('returns no entries and zero totals for an empty day', async () => {
    const log = await dailyLog()

    expect(log.entries).toEqual([])
    expect(log.totals).toEqual({
      calories: 0,
      protein: 0,
      carbohydrate: 0,
      fat: 0,
      fiber: 0,
      sugar: 0,
      sodium: 0,
      water: 0,
      foodEntries: 0,
    })
  })

  describe('entries', () => {
    it('returns a food entry with all its fields', async () => {
      await seedFoodEntry(database, tortillas)

      expect((await dailyLog()).entries).toEqual([
        {
          id: expect.any(Number) as unknown,
          type: 'food',
          loggedAt: '2026-10-24T14:53:00.000Z',
          name: '2 tortillas de maíz',
          source: 'manual',
          servingSize: '1 serving',
          quantity: 1,
          calories: 100,
          protein: 2.5,
          carbohydrate: 21,
          fat: 1.2,
          fiber: 3,
          sugar: 0.4,
          sodium: 20,
        },
      ])
    })

    it('returns null for the nutrients a food entry has no data for', async () => {
      await seedFoodEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T09:00:00'),
        name: 'Café',
        servingSize: '1 cup',
        quantity: 2,
        calories: 4,
      })

      expect((await dailyLog()).entries).toEqual([
        expect.objectContaining({
          servingSize: '1 cup',
          quantity: 2,
          calories: 4,
          protein: null,
          carbohydrate: null,
          fat: null,
          fiber: null,
          sugar: null,
          sodium: null,
        }),
      ])
    })

    it('returns a water entry', async () => {
      await seedWaterEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T10:43:00'),
        amount: 16.9,
      })

      expect((await dailyLog()).entries).toEqual([
        {
          id: expect.any(Number) as unknown,
          type: 'water',
          loggedAt: '2026-10-24T14:43:00.000Z',
          amount: 16.9,
        },
      ])
    })

    it('sorts the entries newest first', async () => {
      await seedWaterEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T10:43:00'),
        amount: 16.9,
      })
      await seedFoodEntry(database, { ...tortillas, loggedAt: newYorkTime('2026-10-24T10:53:00') })
      await seedFoodEntry(database, {
        ...tortillas,
        name: 'Desayuno',
        loggedAt: newYorkTime('2026-10-24T08:00:00'),
      })

      const { entries } = await dailyLog()

      expect(entries.map((entry) => entry.loggedAt)).toEqual([
        '2026-10-24T14:53:00.000Z',
        '2026-10-24T14:43:00.000Z',
        '2026-10-24T12:00:00.000Z',
      ])
    })

    it('only returns the entries of the requested day in the requested time zone', async () => {
      for (const [name, localDateTime] of [
        ['Day before', '2026-10-23T23:59:59'],
        ['Start of day', '2026-10-24T00:00:00'],
        ['End of day', '2026-10-24T23:59:59'],
        ['Day after', '2026-10-25T00:00:00'],
      ] as const) {
        await seedFoodEntry(database, { ...tortillas, name, loggedAt: newYorkTime(localDateTime) })
      }

      const { entries } = await dailyLog()

      expect(entries.map((entry) => entry.name)).toEqual(['End of day', 'Start of day'])
    })

    it('uses the time zone to decide which day an entry belongs to', async () => {
      // 2026-10-24 22:00 in New York is already 2026-10-25 in Tokyo.
      await seedFoodEntry(database, { ...tortillas, loggedAt: newYorkTime('2026-10-24T22:00:00') })

      const newYork = await dailyLog({ date: '2026-10-24', timeZone: 'America/New_York' })
      const tokyo = await dailyLog({ date: '2026-10-25', timeZone: 'Asia/Tokyo' })
      const tokyoDayBefore = await dailyLog({ date: '2026-10-24', timeZone: 'Asia/Tokyo' })

      expect(newYork.entries).toHaveLength(1)
      expect(tokyo.entries).toHaveLength(1)
      expect(tokyoDayBefore.entries).toEqual([])
    })

    it("does not return other users' entries", async () => {
      await seedFoodEntry(database, { ...tortillas, username: OTHER_USERNAME, name: 'Pizza' })
      await seedWaterEntry(database, {
        username: OTHER_USERNAME,
        loggedAt: newYorkTime('2026-10-24T12:00:00'),
        amount: 8,
      })

      const log = await dailyLog()

      expect(log.entries).toEqual([])
      expect(log.totals.calories).toBe(0)
      expect(log.totals.water).toBe(0)
    })
  })

  describe('totals', () => {
    it('adds up the calories and nutrients of the day', async () => {
      await seedFoodEntry(database, tortillas)
      await seedFoodEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T10:54:00'),
        name: '2 huevos + medio tomate + 2 cdas frijoles',
        servingSize: '1 serving',
        quantity: 1,
        calories: 181,
        protein: 14,
        carbohydrate: 8.3,
        fat: 11.4,
        fiber: 0,
        sugar: 2.6,
        sodium: 380,
      })

      const { totals } = await dailyLog()

      expect(totals.calories).toBeCloseTo(281)
      expect(totals.protein).toBeCloseTo(16.5)
      expect(totals.carbohydrate).toBeCloseTo(29.3)
      expect(totals.fat).toBeCloseTo(12.6)
      expect(totals.fiber).toBeCloseTo(3)
      expect(totals.sugar).toBeCloseTo(3)
      expect(totals.sodium).toBeCloseTo(400)
    })

    it('counts a missing nutrient as 0', async () => {
      await seedFoodEntry(database, { ...tortillas, sugar: 10 })
      await seedFoodEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T12:00:00'),
        name: 'Sin datos de azúcar',
        servingSize: '1 serving',
        quantity: 1,
        calories: 50,
      })

      const { totals } = await dailyLog()

      expect(totals.sugar).toBeCloseTo(10)
      expect(totals.calories).toBeCloseTo(150)
    })

    it('counts only food entries, not water, as food entries', async () => {
      await seedFoodEntry(database, tortillas)
      await seedFoodEntry(database, { ...tortillas, name: 'Otra' })
      await seedWaterEntry(database, {
        username: USERNAME,
        loggedAt: newYorkTime('2026-10-24T10:43:00'),
        amount: 16.9,
      })

      expect((await dailyLog()).totals.foodEntries).toBe(2)
    })

    it('adds up the water of the day', async () => {
      for (const amount of [10, 6.9]) {
        await seedWaterEntry(database, {
          username: USERNAME,
          loggedAt: newYorkTime('2026-10-24T10:43:00'),
          amount,
        })
      }

      const { totals } = await dailyLog()

      expect(totals.water).toBeCloseTo(16.9)
      expect(totals.calories).toBe(0)
    })
  })
})
