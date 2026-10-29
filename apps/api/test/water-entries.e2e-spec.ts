import { MAX_WATER_AMOUNT } from '@open-calorie-tracker/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { users, waterEntries } from '../src/db/schema.js'
import { seedUser, seedWaterEntry } from '../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const TIME_ZONE = 'America/New_York'

// New York is on daylight saving time (UTC-4) on 2026-10-24.
const NINE_AM = new Date('2026-10-24T09:00:00-04:00')

type WaterEntry = { id: number; type: 'water'; loggedAt: string; amount: number }

// The API stamps new entries with its own clock, so the day they land on is the real today.
const todayInNewYork = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())

describe('water entries (e2e)', () => {
  let app: TestApp
  let database: Database
  let token: string

  beforeEach(async () => {
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    token = await accessTokenFor(app, USERNAME, PASSWORD)
  })

  afterEach(async () => {
    await app.close()
  })

  // Sends diego's token unless the test passes another one, or null for none.
  type Bearer = string | null | undefined

  const withToken = (pending: request.Test, bearer: Bearer) =>
    withBearer(pending, bearer === undefined ? token : bearer)

  const create = (body: object, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).post('/v1/water-entries').send(body), bearer)

  const update = (id: number | string, body: object, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).patch(`/v1/water-entries/${id}`).send(body), bearer)

  const remove = (id: number | string, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).delete(`/v1/water-entries/${id}`), bearer)

  const dailyLogEntries = async (date: string) => {
    const response = await withToken(
      request(app.getHttpServer()).get('/v1/daily-log').query({ date, timeZone: TIME_ZONE }),
      undefined,
    )
    expect(response.status).toBe(200)
    return (response.body as { entries: WaterEntry[] }).entries
  }

  const storedEntries = async (username: string) =>
    database.db
      .select({ id: waterEntries.id, loggedAt: waterEntries.loggedAt, amount: waterEntries.amount })
      .from(waterEntries)
      .innerJoin(users, eq(waterEntries.userId, users.id))
      .where(eq(users.username, username))

  // Seeds a 16 fl oz entry at 9:00 AM and returns its id.
  const seedEntry = async (username = USERNAME) => {
    await seedWaterEntry(database, { username, loggedAt: NINE_AM, amount: 16 })
    const [entry] = await storedEntries(username)
    if (entry === undefined) throw new Error('The entry was not seeded')
    return entry.id
  }

  it('creates on the selected historical day and edits without moving it', async () => {
    const response = await create({ amount: 16, loggedAt: '2020-01-01T20:30:00-05:00' })
    expect(response.status).toBe(201)
    const created = response.body as WaterEntry
    expect(created.id).toEqual(expect.any(Number))
    expect(created).toEqual({
      id: created.id,
      type: 'water',
      amount: 16,
      loggedAt: '2020-01-02T01:30:00.000Z',
    })
    expect(await dailyLogEntries('2020-01-01')).toEqual([created])
    expect(await dailyLogEntries('2020-01-02')).toEqual([])
    expect(await dailyLogEntries(todayInNewYork())).toEqual([])

    // PATCH retains its existing behavior: extra keys are ignored, not persisted.
    const edited = await update(created.id, { amount: 20.5, loggedAt: '2020-01-03T12:00:00Z' })
    expect(edited.status).toBe(200)
    expect(edited.body).toEqual({ ...created, amount: 20.5 })
    expect(await dailyLogEntries('2020-01-01')).toEqual([edited.body])
    expect(await dailyLogEntries('2020-01-03')).toEqual([])
  })

  it.each([
    'not-a-date',
    '2020-02-30T12:00:00Z',
    '2020-01-01',
    '2020-01-01T12:00:00',
    '',
    null,
    123,
  ])(
    'rejects invalid creation timestamp %j without changing the log or consuming an id',
    async (loggedAt) => {
      const first = (await create({ amount: 16 })).body as WaterEntry
      const before = await dailyLogEntries(todayInNewYork())
      const response = await create({ amount: 8, loggedAt })
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [expect.any(String)],
      })
      expect(await dailyLogEntries(todayInNewYork())).toEqual(before)
      const next = await create({ amount: 16 })
      expect(next.status).toBe(201)
      expect((next.body as WaterEntry).id).toBe(first.id + 1)
    },
  )

  describe('POST /v1/water-entries', () => {
    it('creates an entry at the current time with 201', async () => {
      const before = Date.now()

      const response = await create({ amount: 16 })

      const after = Date.now()
      expect(response.status).toBe(201)
      const entry = response.body as WaterEntry
      expect(entry).toEqual({
        id: expect.any(Number) as unknown,
        type: 'water',
        loggedAt: expect.any(String) as unknown,
        amount: 16,
      })
      expect(Date.parse(entry.loggedAt)).toBeGreaterThanOrEqual(before)
      expect(Date.parse(entry.loggedAt)).toBeLessThanOrEqual(after)
      expect(await dailyLogEntries(todayInNewYork())).toEqual([entry])
    })

    it.each([0.1, MAX_WATER_AMOUNT])('accepts %s fl oz', async (amount) => {
      const response = await create({ amount })

      expect(response.status).toBe(201)
      expect((response.body as WaterEntry).amount).toBe(amount)
    })
  })

  describe('PATCH /v1/water-entries/:id', () => {
    it('changes the amount and keeps the time', async () => {
      const id = await seedEntry()

      const response = await update(id, { amount: 20.5 })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        id,
        type: 'water',
        loggedAt: '2026-10-24T13:00:00.000Z',
        amount: 20.5,
      })
      expect(await storedEntries(USERNAME)).toEqual([{ id, loggedAt: NINE_AM, amount: 20.5 }])
    })
  })

  describe('DELETE /v1/water-entries/:id', () => {
    it('removes the entry with 204', async () => {
      const id = await seedEntry()

      const response = await remove(id)

      expect(response.status).toBe(204)
      expect(await dailyLogEntries('2026-10-24')).toEqual([])
    })
  })

  describe('validation', () => {
    const INVALID_BODIES = [
      ['zero', { amount: 0 }],
      ['a negative amount', { amount: -8 }],
      ['more than the maximum', { amount: MAX_WATER_AMOUNT + 0.1 }],
      ['more than one decimal', { amount: 12.55 }],
      ['an amount sent as text', { amount: '16' }],
      ['a missing amount', {}],
    ] as const

    it.each(INVALID_BODIES)('rejects creating %s with 400', async (_case, body) => {
      const response = await create(body)

      expect(response.status).toBe(400)
      expect(await storedEntries(USERNAME)).toEqual([])
    })

    it.each(INVALID_BODIES)('rejects changing the amount to %s with 400', async (_case, body) => {
      const id = await seedEntry()

      const response = await update(id, body)

      expect(response.status).toBe(400)
      expect(await storedEntries(USERNAME)).toEqual([{ id, loggedAt: NINE_AM, amount: 16 }])
    })
  })

  describe("other users' entries and unknown ids", () => {
    const requests = [
      ['PATCH', (id: number | string) => update(id, { amount: 8 })],
      ['DELETE', (id: number | string) => remove(id)],
    ] as const

    it.each(requests)("answers %s on another user's entry with 404", async (_method, send) => {
      const id = await seedEntry(OTHER_USERNAME)

      const response = await send(id)

      expect(response.status).toBe(404)
      expect(await storedEntries(OTHER_USERNAME)).toEqual([{ id, loggedAt: NINE_AM, amount: 16 }])
    })

    it.each(requests)('answers %s on an id that does not exist with 404', async (_method, send) => {
      expect((await send(99_999)).status).toBe(404)
    })

    it.each(requests)(
      'answers %s on an id that is not a number with 400',
      async (_method, send) => {
        expect((await send('abc')).status).toBe(400)
      },
    )
  })

  describe('authentication', () => {
    const requests = [
      ['POST', (bearer?: Bearer) => create({ amount: 8 }, bearer)],
      ['PATCH', (bearer?: Bearer) => update(1, { amount: 8 }, bearer)],
      ['DELETE', (bearer?: Bearer) => remove(1, bearer)],
    ] as const

    it.each(requests)('rejects %s without a token with 401', async (_method, send) => {
      expect((await send(null)).status).toBe(401)
    })

    it.each(
      requests.flatMap(([method, send]) =>
        INVALID_TOKENS.map(([tokenCase, invalid]) => [method, tokenCase, send, invalid] as const),
      ),
    )('rejects %s with %s with 401', async (_method, _tokenCase, send, invalid) => {
      expect((await send(await invalid())).status).toBe(401)
    })
  })
})
