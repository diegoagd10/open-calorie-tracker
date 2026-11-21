import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { seedApiKey, seedUser } from '../src/db/seed.js'
import {
  TEST_ENV,
  type TestApp,
  accessTokenFor,
  createTestApp,
  signAccessToken,
  userIdOf,
  withBearer,
} from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const NOW = new Date('2026-10-26T14:00:00Z')
const TODAY = '2026-10-26'
const TIME_ZONE = 'America/New_York'

type WeightEntry = { date: string; weight: number }
type WeightGoal = { startWeight: number; goalWeight: number; startDate: string }
type WeightHistory = {
  entries: (WeightEntry & { trend: number })[]
  goal: WeightGoal | null
  stats: {
    current: number | null
    lost: number | null
    toGo: number | null
    progress: number | null
  }
}

describe('weight entries (e2e)', () => {
  let app: TestApp
  let database: Database
  let token: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    token = await accessTokenFor(app, USERNAME, PASSWORD)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  const logWeight = (body: object, bearer: string | null = token) =>
    withBearer(http().post('/v1/weight-entries').send(body), bearer)

  const getHistory = (query: object = {}, bearer: string | null = token) =>
    withBearer(http().get('/v1/weight-history').query(query), bearer)

  const history = async (query: object = {}, bearer: string | null = token) => {
    const response = await getHistory(query, bearer)
    expect(response.status).toBe(200)
    return response.body as WeightHistory
  }

  const logged = async (weight: number, date?: string, bearer: string | null = token) => {
    const response = await logWeight(
      date === undefined ? { weight, timeZone: TIME_ZONE } : { weight, date, timeZone: TIME_ZONE },
      bearer,
    )
    expect(response.status).toBe(200)
    return response.body as WeightEntry
  }

  const saveGoal = async (startWeight: number, goalWeight: number, date = TODAY) => {
    const response = await withBearer(
      http().put('/v1/settings/weight-goal').send({ startWeight, goalWeight, date }),
      token,
    )
    expect(response.status).toBe(200)
  }

  const scopedToken = async (scope: string) =>
    signAccessToken({ subject: String(await userIdOf(database, USERNAME)), scope })

  describe('authentication', () => {
    it.each<[string, (bearer: string | null) => request.Test]>([
      [
        'POST /v1/weight-entries',
        (bearer) => logWeight({ weight: 180, timeZone: TIME_ZONE }, bearer),
      ],
      ['GET /v1/weight-history', (bearer) => getHistory({}, bearer)],
      [
        'GET /v1/settings/weight-goal',
        (bearer) => withBearer(http().get('/v1/settings/weight-goal'), bearer),
      ],
      [
        'PUT /v1/settings/weight-goal',
        (bearer) =>
          withBearer(
            http()
              .put('/v1/settings/weight-goal')
              .send({ startWeight: 180, goalWeight: 150, date: TODAY }),
            bearer,
          ),
      ],
    ])('A1 — %s without a token answers 401', async (_endpoint, send) => {
      expect((await send(null)).status).toBe(401)
    })
  })

  describe('POST /v1/weight-entries', () => {
    it.each([
      [TIME_ZONE, '2026-10-26'],
      ['Pacific/Kiritimati', '2026-10-27'],
    ])('A2 — without a date, logs today in %s (%s)', async (timeZone, date) => {
      const response = await logWeight({ weight: 179.4, timeZone })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ date, weight: 179.4 })
      expect((await history()).entries).toEqual([{ date, weight: 179.4, trend: 179.4 }])
    })

    it("A3 — logging again the same day replaces that day's weight", async () => {
      await logged(179.4)

      expect(await logged(178.6)).toEqual({ date: TODAY, weight: 178.6 })

      expect((await history()).entries).toEqual([{ date: TODAY, weight: 178.6, trend: 178.6 }])
    })

    it('A4 — logs the weight of a past day', async () => {
      expect(await logged(175, '2026-10-23')).toEqual({ date: '2026-10-23', weight: 175 })

      expect((await history()).entries).toEqual([{ date: '2026-10-23', weight: 175, trend: 175 }])
    })

    it("A5 — logging a past day again replaces that day's weight", async () => {
      await logged(175, '2026-10-23')

      await logged(174.5, '2026-10-23')

      expect((await history()).entries).toEqual([
        { date: '2026-10-23', weight: 174.5, trend: 174.5 },
      ])
    })

    it('A6 — rejects tomorrow in the given time zone with 400 and stores nothing', async () => {
      const response = await logWeight({ weight: 179.4, date: '2026-10-27', timeZone: TIME_ZONE })

      expect(response.status).toBe(400)
      expect((await history()).entries).toEqual([])
    })

    it.each([
      ['a weight under 50', { weight: 49.9 }],
      ['a weight over 999', { weight: 1000 }],
      ['a weight with two decimals', { weight: 179.45 }],
      ['no weight', {}],
    ])('A7 — rejects %s with 400 and stores nothing', async (_case, body) => {
      const response = await logWeight({ ...body, timeZone: TIME_ZONE })

      expect(response.status).toBe(400)
      expect((await history()).entries).toEqual([])
    })

    it.each([
      ['a date that does not exist', { date: '2026-02-30', timeZone: TIME_ZONE }],
      ['a date that is not YYYY-MM-DD', { date: '26/10/2026', timeZone: TIME_ZONE }],
      ['an unknown time zone', { timeZone: 'Mars/Olympus' }],
    ])('A8 — rejects %s with 400 and stores nothing', async (_case, body) => {
      const response = await logWeight({ weight: 179.4, ...body })

      expect(response.status).toBe(400)
      expect((await history()).entries).toEqual([])
    })

    it('A9 — weight entries cannot be deleted', async () => {
      await logged(179.4)

      const response = await withBearer(http().delete(`/v1/weight-entries/${TODAY}`), token)

      expect(response.status).toBe(404)
      expect((await history()).entries).toHaveLength(1)
    })
  })

  describe('users', () => {
    it("A10 — another user's weights never show in the history", async () => {
      const otherToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      await logged(140, '2026-10-25', otherToken)

      expect((await history()).entries).toEqual([])
    })

    it('A11 — two users log the same day independently', async () => {
      const otherToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      await logged(140, undefined, otherToken)

      await logged(179.4)

      expect((await history()).entries).toEqual([{ date: TODAY, weight: 179.4, trend: 179.4 }])
      expect((await history({}, otherToken)).entries).toEqual([
        { date: TODAY, weight: 140, trend: 140 },
      ])
    })
  })

  describe('GET /v1/weight-history', () => {
    it('A12 — with no weights and no goal', async () => {
      expect(await history()).toEqual({
        entries: [],
        goal: null,
        stats: { current: null, lost: null, toGo: null, progress: null },
      })
    })

    it('A13 — answers the weights oldest first, each with its 7-day trend', async () => {
      await logged(178, '2026-10-26')
      await logged(180, '2026-10-24')
      await logged(179, '2026-10-25')

      expect((await history()).entries).toEqual([
        { date: '2026-10-24', weight: 180, trend: 180 },
        { date: '2026-10-25', weight: 179, trend: 179.5 },
        { date: '2026-10-26', weight: 178, trend: 179 },
      ])
    })

    it('A14 — the trend averages the weights of the last 7 calendar days, that day included', async () => {
      await logged(180, '2026-10-01')
      await logged(178, '2026-10-04')
      await logged(176, '2026-10-09')

      expect((await history()).entries).toEqual([
        { date: '2026-10-01', weight: 180, trend: 180 },
        { date: '2026-10-04', weight: 178, trend: 179 },
        { date: '2026-10-09', weight: 176, trend: 177 },
      ])
    })

    it('A15 — a range answers its weights only, trended with the 6 days before it', async () => {
      await logged(190, '2026-10-01')
      await logged(180, '2026-10-08')
      await logged(170, '2026-10-10')
      await logged(168, '2026-10-20')
      await logged(160, '2026-10-21')

      const { entries } = await history({ from: '2026-10-10', to: '2026-10-20' })

      expect(entries).toEqual([
        { date: '2026-10-10', weight: 170, trend: 175 },
        { date: '2026-10-20', weight: 168, trend: 168 },
      ])
    })

    it('A16 — without a range, answers every weight', async () => {
      await logged(200, '2026-04-09')
      await logged(190, '2026-07-01')
      await logged(180, TODAY)

      expect((await history()).entries.map((entry) => entry.date)).toEqual([
        '2026-04-09',
        '2026-07-01',
        TODAY,
      ])
    })

    it('A17 — rejects a range that ends before it starts with 400', async () => {
      const response = await getHistory({ from: '2026-10-20', to: '2026-10-10' })

      expect(response.status).toBe(400)
    })

    it('A18 — answers the goal and the figures of the page', async () => {
      await saveGoal(180, 150, '2026-09-01')
      await logged(175, '2026-10-01')
      await logged(170.8, TODAY)

      const { goal, stats } = await history()

      expect(goal).toEqual({ startWeight: 180, goalWeight: 150, startDate: '2026-09-01' })
      expect(stats).toEqual({ current: 170.8, lost: 9.2, toGo: 20.8, progress: 31 })
    })

    it('A19 — once the goal is reached, nothing is left to go and the progress is 100', async () => {
      await saveGoal(180, 150)
      await logged(149)

      expect((await history()).stats).toEqual({ current: 149, lost: 31, toGo: 0, progress: 100 })
    })
  })

  describe('API keys', () => {
    it('A27 — a token with only weight-entries:read cannot log a weight', async () => {
      const response = await logWeight(
        { weight: 179.4, timeZone: TIME_ZONE },
        await scopedToken('weight-entries:read'),
      )

      expect(response.status).toBe(403)
      expect((await history()).entries).toEqual([])
    })

    it('A28 — a token with only weight-entries:read reads the history', async () => {
      await logged(179.4)

      const response = await getHistory({}, await scopedToken('weight-entries:read'))

      expect(response.status).toBe(200)
      expect((response.body as WeightHistory).entries).toEqual([
        { date: TODAY, weight: 179.4, trend: 179.4 },
      ])
    })

    it('A29 — a token with weight-entries:write logs a weight', async () => {
      const response = await logWeight(
        { weight: 179.4, timeZone: TIME_ZONE },
        await scopedToken('weight-entries:write'),
      )

      expect(response.status).toBe(200)
      expect((await history()).entries).toEqual([{ date: TODAY, weight: 179.4, trend: 179.4 }])
    })

    it("U41 — a key's token carries weight-entries:read and weight-entries:write", async () => {
      const key = await seedApiKey(
        database,
        { username: USERNAME, name: 'Zapier', expiresIn: 'never' },
        TEST_ENV.API_KEY_SECRET,
      )

      const response = await http().post('/v1/token').send({ apiKey: key.key })

      expect(response.status).toBe(200)
      expect((response.body as { scopes: string[] }).scopes).toEqual(
        expect.arrayContaining(['weight-entries:read', 'weight-entries:write']),
      )
    })
  })
})
