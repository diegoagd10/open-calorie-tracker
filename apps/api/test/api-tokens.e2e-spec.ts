import {
  type ApiKey,
  type ApiKeyExpiresIn,
  INSUFFICIENT_SCOPE_MESSAGE,
  INVALID_API_KEY_MESSAGE,
} from '@open-calorie-tracker/shared'
import { decodeJwt, jwtVerify } from 'jose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { seedApiKey, seedUser } from '../src/db/seed.js'
import {
  TEST_ENV,
  type TestApp,
  accessTokenFor,
  createTestApp,
  seedEntries,
  signAccessToken,
  userIdOf,
  withBearer,
} from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const NOW = new Date('2026-10-26T14:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow)

const DATE = '2026-10-26'
const TIME_ZONE = 'America/New_York'

// Every key's token carries these, in this order.
const SCOPES = [
  'daily-log:read',
  'food-entries:read',
  'food-entries:write',
  'water-entries:read',
  'water-entries:write',
  'serving-sizes:read',
  'serving-sizes:write',
]

type TokenResponse = { accessToken: string; tokenType: string; expiresIn: number; scopes: string[] }
type DailyLog = { entries: { type: string; name?: string }[] }

describe('API tokens (e2e)', () => {
  let app: TestApp
  let database: Database
  // diego's login token, for what the third-party app does not do.
  let loginToken: string
  // diego's "Zapier" key, which never expires.
  let zapier: ApiKey

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    loginToken = await accessTokenFor(app, USERNAME, PASSWORD)
    zapier = await seedKey({ name: 'Zapier', expiresIn: 'never' })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  const seedKey = (key: { name: string; expiresIn: ApiKeyExpiresIn; createdAt?: Date }) =>
    seedApiKey(database, { username: USERNAME, ...key }, TEST_ENV.API_KEY_SECRET)

  const exchange = (body?: object) => {
    const pending = http().post('/v1/token')
    return body === undefined ? pending : pending.send(body)
  }

  // Exchanges the key and returns the access token.
  const tokenFor = async (apiKey = zapier.key) => {
    const response = await exchange({ apiKey })
    expect(response.status).toBe(200)
    return (response.body as TokenResponse).accessToken
  }

  const getDailyLog = (bearer: string) =>
    withBearer(http().get('/v1/daily-log').query({ date: DATE, timeZone: TIME_ZONE }), bearer)

  const dailyLog = async (bearer: string) => {
    const response = await getDailyLog(bearer)
    expect(response.status).toBe(200)
    return response.body as DailyLog
  }

  const keys = async () => {
    const response = await withBearer(http().get('/v1/settings/api-keys'), loginToken)
    expect(response.status).toBe(200)
    return response.body as ApiKey[]
  }

  const revoke = async (id: number) => {
    const response = await withBearer(http().delete(`/v1/settings/api-keys/${id}`), loginToken)
    expect(response.status).toBe(204)
  }

  describe('A — exchanging a key', () => {
    it('A1 — a valid key is exchanged for a 10-minute access token', async () => {
      const response = await exchange({ apiKey: zapier.key })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        accessToken: expect.any(String) as unknown,
        tokenType: 'Bearer',
        expiresIn: 600,
        scopes: SCOPES,
      })
    })

    it('A2 — the token carries the key owner and the scopes', async () => {
      const token = await tokenFor()

      const { payload } = await jwtVerify(token, new TextEncoder().encode(TEST_ENV.JWT_SECRET))

      const login = decodeJwt(loginToken)
      expect(payload.sub).toBe(String(await userIdOf(database, USERNAME)))
      expect(payload['scope']).toBe(
        'daily-log:read food-entries:read food-entries:write water-entries:read water-entries:write serving-sizes:read serving-sizes:write',
      )
      expect(payload.iat).toBe(NOW.getTime() / 1000)
      expect(payload.exp).toBe(NOW.getTime() / 1000 + 600)
      expect(payload.iss).toBe(login.iss)
      expect(payload.aud).toEqual(login.aud)
    })

    it('A3 — a successful exchange records when the key was used', async () => {
      await tokenFor()

      const [key] = await keys()

      expect(key).toEqual({ ...zapier, lastUsedAt: NOW.toISOString() })
    })

    it('A4 — a key expiring later today still works', async () => {
      const soon = await seedKey({
        name: 'Soon',
        expiresIn: '30d',
        createdAt: at(-30 * DAY_MS + 1),
      })
      expect(soon.expiresAt).toBe('2026-10-26T14:00:00.001Z')

      expect((await exchange({ apiKey: soon.key })).status).toBe(200)
    })
  })

  describe('B — rejected exchanges', () => {
    const BAD_KEYS: [string, () => Promise<string>][] = [
      ['an unknown key', () => Promise.resolve(`oct_live_${'A'.repeat(32)}`)],
      [
        'a key with the wrong prefix',
        () => Promise.resolve(`oct_test_${zapier.key.slice('oct_live_'.length)}`),
      ],
      ['a malformed key', () => Promise.resolve('not-a-key')],
      ['an empty string', () => Promise.resolve('')],
      [
        'a revoked key',
        async () => {
          const revoked = await seedKey({ name: 'Revoked', expiresIn: 'never' })
          await revoke(revoked.id)
          return revoked.key
        },
      ],
      [
        'a key at its expiresAt',
        async () =>
          (await seedKey({ name: 'Expired', expiresIn: '30d', createdAt: at(-30 * DAY_MS) })).key,
      ],
      [
        'a key past its expiresAt',
        async () =>
          (await seedKey({ name: 'Expired', expiresIn: '30d', createdAt: at(-31 * DAY_MS) })).key,
      ],
    ]

    it.each(BAD_KEYS)('B1 — %s gets 401 with one generic message', async (_case, badKey) => {
      const apiKey = await badKey()

      const response = await exchange({ apiKey })

      expect(response.status).toBe(401)
      expect((response.body as { message: unknown }).message).toBe(INVALID_API_KEY_MESSAGE)
      expect((await keys()).filter((key) => key.lastUsedAt !== null)).toEqual([])
    })

    it.each([
      ['no body', () => undefined],
      ['no apiKey', () => ({})],
      ['an apiKey that is not a string', () => ({ apiKey: 123 })],
      ['an unknown field', () => ({ apiKey: zapier.key, scope: 'all' })],
    ])('B2 — %s gets 400', async (_case, body) => {
      expect((await exchange(body())).status).toBe(400)
    })

    it('B3 — the key itself is not a bearer token', async () => {
      expect((await getDailyLog(zapier.key)).status).toBe(401)
    })
  })

  // What a key's token can and cannot do. Each endpoint sends a valid request with the given token.
  describe('C, D — scopes', () => {
    let ids: Awaited<ReturnType<typeof seedEntries>>

    beforeEach(async () => {
      ids = await seedEntries(database, USERNAME)
    })

    const apple = () => ({
      name: 'Apple',
      servingSizeId: ids.servingSizeId,
      quantity: 1,
      calories: 95,
    })

    const ENDPOINTS: [string, string, number, (bearer: string) => request.Test][] = [
      ['GET', '/v1/daily-log', 200, (bearer) => getDailyLog(bearer)],
      [
        'GET',
        '/v1/daily-summaries',
        200,
        (bearer) =>
          withBearer(
            http()
              .get('/v1/daily-summaries')
              .query({ from: '2026-10-26', to: '2026-11-01', timeZone: 'America/New_York' }),
            bearer,
          ),
      ],
      [
        'GET',
        '/v1/food-entries/:id',
        200,
        (bearer) => withBearer(http().get(`/v1/food-entries/${ids.foodId}`), bearer),
      ],
      [
        'GET',
        '/v1/water-entries/:id',
        200,
        (bearer) => withBearer(http().get(`/v1/water-entries/${ids.waterId}`), bearer),
      ],
      [
        'POST',
        '/v1/food-entries',
        201,
        (bearer) => withBearer(http().post('/v1/food-entries').send(apple()), bearer),
      ],
      [
        'PATCH',
        '/v1/food-entries/:id',
        200,
        (bearer) =>
          withBearer(http().patch(`/v1/food-entries/${ids.foodId}`).send(apple()), bearer),
      ],
      [
        'DELETE',
        '/v1/food-entries/:id',
        204,
        (bearer) => withBearer(http().delete(`/v1/food-entries/${ids.foodId}`), bearer),
      ],
      [
        'POST',
        '/v1/water-entries',
        201,
        (bearer) => withBearer(http().post('/v1/water-entries').send({ amount: 8 }), bearer),
      ],
      [
        'PATCH',
        '/v1/water-entries/:id',
        200,
        (bearer) =>
          withBearer(http().patch(`/v1/water-entries/${ids.waterId}`).send({ amount: 8 }), bearer),
      ],
      [
        'DELETE',
        '/v1/water-entries/:id',
        204,
        (bearer) => withBearer(http().delete(`/v1/water-entries/${ids.waterId}`), bearer),
      ],
      [
        'GET',
        '/v1/serving-sizes',
        200,
        (bearer) => withBearer(http().get('/v1/serving-sizes'), bearer),
      ],
      [
        'POST',
        '/v1/serving-sizes',
        201,
        (bearer) => withBearer(http().post('/v1/serving-sizes').send({ name: '1 slice' }), bearer),
      ],
    ]

    const endpoint = (method: string, path: string) => {
      const found = ENDPOINTS.find(([m, p]) => m === method && p === path)
      if (found === undefined) throw new Error(`No endpoint ${method} ${path}`)
      return found[3]
    }

    it.each(ENDPOINTS)('C1 — %s %s accepts a key token with %i', async (_m, _p, status, send) => {
      expect((await send(await tokenFor())).status).toBe(status)
    })

    it.each([
      ['daily-log:read', 'POST', '/v1/food-entries'],
      ['daily-log:read', 'DELETE', '/v1/water-entries/:id'],
      ['serving-sizes:read', 'POST', '/v1/serving-sizes'],
      ['serving-sizes:write', 'GET', '/v1/serving-sizes'],
      ['food-entries:write', 'GET', '/v1/daily-log'],
      ['food-entries:read', 'GET', '/v1/daily-summaries'],
      ['food-entries:write', 'GET', '/v1/food-entries/:id'],
      ['water-entries:write', 'GET', '/v1/water-entries/:id'],
      ['daily-log:read', 'GET', '/v1/food-entries/:id'],
      ['food-entries:read', 'PATCH', '/v1/food-entries/:id'],
      ['water-entries:read', 'DELETE', '/v1/water-entries/:id'],
    ])('C2 — a token with only %s gets 403 on %s %s', async (scope, method, path) => {
      const token = await signAccessToken({
        subject: String(await userIdOf(database, USERNAME)),
        scope,
      })

      const response = await endpoint(method, path)(token)

      expect(response.status).toBe(403)
      expect((response.body as { message: unknown }).message).toBe(INSUFFICIENT_SCOPE_MESSAGE)
    })

    // Settings, which a key's token never reaches.
    const SETTINGS: [string, string, (bearer: string) => request.Test][] = [
      [
        'GET',
        '/v1/settings/api-keys',
        (bearer) => withBearer(http().get('/v1/settings/api-keys'), bearer),
      ],
      [
        'POST',
        '/v1/settings/api-keys',
        (bearer) =>
          withBearer(
            http().post('/v1/settings/api-keys').send({ name: 'Sneaky', expiresIn: 'never' }),
            bearer,
          ),
      ],
      [
        'DELETE',
        '/v1/settings/api-keys/:id',
        (bearer) => withBearer(http().delete(`/v1/settings/api-keys/${zapier.id}`), bearer),
      ],
      [
        'GET',
        '/v1/settings/profile',
        (bearer) => withBearer(http().get('/v1/settings/profile'), bearer),
      ],
      [
        'PUT',
        '/v1/settings/password',
        (bearer) =>
          withBearer(
            http().put('/v1/settings/password').send({
              currentPassword: PASSWORD,
              newPassword: 'another-horse-battery-staple',
              confirmPassword: 'another-horse-battery-staple',
            }),
            bearer,
          ),
      ],
      [
        'GET',
        '/v1/settings/daily-goals',
        (bearer) => withBearer(http().get('/v1/settings/daily-goals'), bearer),
      ],
      [
        'PATCH',
        '/v1/settings/daily-goals',
        (bearer) =>
          withBearer(http().patch('/v1/settings/daily-goals').send({ calories: 1800 }), bearer),
      ],
    ]

    // What the settings requests could change.
    const settingsOfDiego = async () => ({
      keys: await keys(),
      goals: (await withBearer(http().get('/v1/settings/daily-goals'), loginToken)).body as unknown,
      loginStatus: (await http().post('/v1/login').send({ username: USERNAME, password: PASSWORD }))
        .status,
    })

    it.each(SETTINGS)('D1 — %s %s rejects a key token with 403', async (_m, _p, send) => {
      const token = await tokenFor()
      const before = await settingsOfDiego()

      const response = await send(token)

      expect(response.status).toBe(403)
      expect((response.body as { message: unknown }).message).toBe(INSUFFICIENT_SCOPE_MESSAGE)
      expect(await settingsOfDiego()).toEqual(before)
    })

    it.each([
      ...ENDPOINTS.map(([method, path, , send]) => [method, path, send] as const),
      ...SETTINGS,
    ])('D2 — %s %s keeps accepting a login token', async (_m, _p, send) => {
      expect((await send(loginToken)).status).not.toBe(403)
    })
  })

  describe('E — lifetime and revocation', () => {
    it('E1 — the token works until its 10 minutes are up', async () => {
      const token = await tokenFor()

      vi.setSystemTime(at(599_000))

      expect((await getDailyLog(token)).status).toBe(200)
    })

    it('E2 — the token is rejected once it expires', async () => {
      const token = await tokenFor()

      vi.setSystemTime(at(600_000))

      expect((await getDailyLog(token)).status).toBe(401)
    })

    it('E3 — revoking the key stops new exchanges, not issued tokens', async () => {
      const token = await tokenFor()
      vi.setSystemTime(at(60_000))
      await revoke(zapier.id)

      vi.setSystemTime(at(120_000))

      expect((await getDailyLog(token)).status).toBe(200)
      const again = await exchange({ apiKey: zapier.key })
      expect(again.status).toBe(401)
      expect((again.body as { message: unknown }).message).toBe(INVALID_API_KEY_MESSAGE)
    })

    it('E4 — exchanging again gives a new token', async () => {
      const first = await tokenFor()
      const second = await tokenFor()

      expect(first).not.toBe(second)
      expect((await getDailyLog(first)).status).toBe(200)
      expect((await getDailyLog(second)).status).toBe(200)
    })
  })

  describe('F — ownership', () => {
    it("F1 — entries created with a key belong to the key's owner", async () => {
      const { servingSizeId } = await seedEntries(database, USERNAME)
      const token = await tokenFor()

      const response = await withBearer(
        http().post('/v1/food-entries').send({
          name: 'Apple',
          servingSizeId,
          quantity: 1,
          calories: 95,
          loggedAt: '2026-10-26T12:00:00-04:00',
        }),
        token,
      )

      expect(response.status).toBe(201)
      const names = (log: DailyLog) => log.entries.map((entry) => entry.name)
      expect(names(await dailyLog(loginToken))).toContain('Apple')
      const anaToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      expect(names(await dailyLog(anaToken))).not.toContain('Apple')
    })

    it("F2 — another user's entries answer like missing ones", async () => {
      const { foodId, waterId } = await seedEntries(database, OTHER_USERNAME)
      const { servingSizeId } = await seedEntries(database, USERNAME)
      const anaToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      const before = await dailyLog(anaToken)
      const token = await tokenFor()
      const apple = { name: 'Apple', servingSizeId, quantity: 1, calories: 95 }

      const responses = [
        await withBearer(http().get(`/v1/food-entries/${foodId}`), token),
        await withBearer(http().get(`/v1/water-entries/${waterId}`), token),
        await withBearer(http().patch(`/v1/food-entries/${foodId}`).send(apple), token),
        await withBearer(http().delete(`/v1/food-entries/${foodId}`), token),
        await withBearer(http().patch(`/v1/water-entries/${waterId}`).send({ amount: 8 }), token),
        await withBearer(http().delete(`/v1/water-entries/${waterId}`), token),
      ]

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])
      expect(await dailyLog(anaToken)).toEqual(before)
    })
  })
})
