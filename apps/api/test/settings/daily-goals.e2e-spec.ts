import { DEFAULT_DAILY_GOALS, MAX_DAILY_GOAL } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../../src/db/database.js'
import { seedUser } from '../../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from '../app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const NEW_GOALS = {
  calories: 2000,
  protein: 150,
  carbohydrate: 200,
  fat: 60,
  fiber: 30,
  sugar: 40,
  sodium: 1500,
  water: 80,
}

describe('settings: daily goals (e2e)', () => {
  let app: TestApp
  let token: string

  beforeEach(async () => {
    app = await createTestApp()
    const database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    token = await accessTokenFor(app, USERNAME, PASSWORD)
  })

  afterEach(async () => {
    await app.close()
  })

  // Sends diego's token unless the test passes another one, or null for none.
  const read = (bearer: string | null = token) =>
    withBearer(request(app.getHttpServer()).get('/v1/settings/daily-goals'), bearer)

  const change = (body?: object, bearer: string | null = token) => {
    const pending = withBearer(
      request(app.getHttpServer()).patch('/v1/settings/daily-goals'),
      bearer,
    )
    return body === undefined ? pending : pending.send(body)
  }

  const goals = async (bearer?: string) => {
    const response = await read(bearer)
    expect(response.status).toBe(200)
    return response.body as unknown
  }

  const dailyLogGoals = async (bearer = token) => {
    const response = await withBearer(
      request(app.getHttpServer())
        .get('/v1/daily-log')
        .query({ date: '2026-10-24', timeZone: 'America/New_York' }),
      bearer,
    )
    expect(response.status).toBe(200)
    return (response.body as { goals: unknown }).goals
  }

  describe('GET /v1/settings/daily-goals', () => {
    it('answers the default goals to a user who never saved any', async () => {
      expect(await goals()).toEqual(DEFAULT_DAILY_GOALS)
    })
  })

  describe('PATCH /v1/settings/daily-goals', () => {
    it('changes every goal and answers them', async () => {
      const response = await change(NEW_GOALS)

      expect(response.status).toBe(200)
      expect(response.body).toEqual(NEW_GOALS)
      expect(await goals()).toEqual(NEW_GOALS)
    })

    it('keeps the goals the body leaves out', async () => {
      await change({ protein: 150 })

      const response = await change({ calories: 2000 })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 2000, protein: 150 })
    })

    it('answers the current goals and changes nothing for an empty body object', async () => {
      await change({ calories: 2000 })

      const response = await change({})

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 2000 })
    })

    it('keeps the last value when saved twice', async () => {
      await change({ calories: 2000 })

      await change({ calories: 1800 })

      expect(await goals()).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 1800 })
    })

    it.each([
      ['a goal of 0', { calories: 0 }],
      ['a goal over the maximum', { calories: MAX_DAILY_GOAL + 1 }],
      ['a decimal goal', { protein: 12.5 }],
      ['a negative goal', { fat: -70 }],
      ['a goal sent as text', { water: '64' }],
      ['a null goal', { sodium: null }],
      ['an unknown goal', { calories: 1800, alcohol: 10 }],
      ['no body', undefined],
    ])('rejects %s with 400 and stores nothing', async (_case, body) => {
      await change({ calories: 2000 })

      const response = await change(body)

      expect(response.status).toBe(400)
      expect(await goals()).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 2000 })
    })
  })

  it('reports the saved goals in the daily log', async () => {
    await change({ calories: 2000 })

    expect(await dailyLogGoals()).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 2000 })
  })

  it("keeps each user's goals apart", async () => {
    await change({ calories: 2000 })
    const otherToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)

    expect(await goals(otherToken)).toEqual(DEFAULT_DAILY_GOALS)
    expect(await dailyLogGoals(otherToken)).toEqual(DEFAULT_DAILY_GOALS)
  })

  describe('authentication', () => {
    const requests = [
      ['GET', (bearer: string | null) => read(bearer)],
      ['PATCH', (bearer: string | null) => change({ calories: 1800 }, bearer)],
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
