import {
  API_KEY_NAME_MAX_LENGTH,
  type ApiKey,
  type ApiKeyExpiresIn,
} from '@open-calorie-tracker/shared'
import { sql } from 'drizzle-orm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppConfig } from '../../src/config/config.js'
import { Database } from '../../src/db/database.js'
import { seedApiKey, seedUser } from '../../src/db/seed.js'
import {
  INVALID_TOKENS,
  TEST_ENV,
  type TestApp,
  accessTokenFor,
  createTestApp,
  withBearer,
} from '../app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const NOW = new Date('2026-10-26T14:00:00Z')

const KEY_PATTERN = /^oct_live_[A-Za-z0-9]{32}$/

const randomPartOf = (key: string) => key.slice('oct_live_'.length)

// "oct_live_" + the first 4 and the last 4 characters of the random part.
const previewOf = (key: string) => {
  const random = randomPartOf(key)
  return `oct_live_${random.slice(0, 4)}…${random.slice(-4)}`
}

describe('settings: API keys (e2e)', () => {
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
    vi.useRealTimers()
    await app.close()
  })

  // Sends diego's token unless the test passes another one, or null for none.
  type Bearer = string | null | undefined

  const withToken = (pending: request.Test, bearer: Bearer) =>
    withBearer(pending, bearer === undefined ? token : bearer)

  const list = (bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).get('/v1/settings/api-keys'), bearer)

  const create = (body?: object, bearer?: Bearer) => {
    const pending = withToken(request(app.getHttpServer()).post('/v1/settings/api-keys'), bearer)
    return body === undefined ? pending : pending.send(body)
  }

  const remove = (id: number | string, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).delete(`/v1/settings/api-keys/${id}`), bearer)

  const keys = async (bearer?: Bearer) => {
    const response = await list(bearer)
    expect(response.status).toBe(200)
    return response.body as ApiKey[]
  }

  const keyNames = async (bearer?: Bearer) => (await keys(bearer)).map((key) => key.name)

  const seedKey = (
    entry: {
      name: string
      expiresIn?: ApiKeyExpiresIn
      createdAt?: Date
      lastUsedAt?: Date | null
    },
    username = USERNAME,
  ) => seedApiKey(database, { username, expiresIn: '90d', ...entry }, TEST_ENV.API_KEY_SECRET)

  const storedRows = () => database.db.all<Record<string, unknown>>(sql`SELECT * FROM api_keys`)

  describe('GET /v1/settings/api-keys', () => {
    it('answers an empty list to a user without keys', async () => {
      expect(await keys()).toEqual([])
    })

    it("answers only the user's keys, newest first", async () => {
      await seedKey({ name: 'A', createdAt: new Date('2026-06-01T14:00:00Z') })
      await seedKey({ name: 'C', createdAt: new Date('2026-10-26T14:00:00Z') })
      await seedKey({ name: 'B', createdAt: new Date('2026-08-03T14:00:00Z') })
      await seedKey({ name: "Ana's script" }, OTHER_USERNAME)

      expect(await keyNames()).toEqual(['C', 'B', 'A'])
    })

    it('answers every field of a key, with the full key', async () => {
      const seeded = await seedKey({
        name: 'Home Assistant',
        expiresIn: 'never',
        createdAt: new Date('2026-08-03T12:00:00Z'),
        lastUsedAt: new Date('2026-10-26T12:00:00Z'),
      })

      const [key] = await keys()

      expect(key).toEqual({
        id: seeded.id,
        name: 'Home Assistant',
        key: seeded.key,
        preview: previewOf(seeded.key),
        createdAt: '2026-08-03T12:00:00.000Z',
        lastUsedAt: '2026-10-26T12:00:00.000Z',
        expiresAt: null,
      })
      expect(seeded.key).toMatch(KEY_PATTERN)
    })
  })

  describe('POST /v1/settings/api-keys', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })

    it.each([
      ['30d', '2026-11-25T14:00:00.000Z'],
      ['90d', '2027-01-24T14:00:00.000Z'],
      ['1y', '2027-10-26T14:00:00.000Z'],
      ['never', null],
    ])('creates a key that expires in %s with 201', async (expiresIn, expiresAt) => {
      const response = await create({ name: 'Shortcuts on iPhone', expiresIn })

      expect(response.status).toBe(201)
      const created = response.body as ApiKey
      expect(created.key).toMatch(KEY_PATTERN)
      expect(created).toEqual({
        id: expect.any(Number),
        name: 'Shortcuts on iPhone',
        key: created.key,
        preview: previewOf(created.key),
        createdAt: NOW.toISOString(),
        lastUsedAt: null,
        expiresAt,
      })
      expect(await keys()).toEqual([created])
    })

    it('gives every key a different value', async () => {
      await create({ name: 'A', expiresIn: '90d' })
      await create({ name: 'B', expiresIn: '90d' })

      const [first, second] = await keys()

      expect(first?.key).not.toBe(second?.key)
    })

    it('trims the name and keeps its casing', async () => {
      const response = await create({ name: '  Shortcuts on iPhone  ', expiresIn: 'never' })

      expect(response.status).toBe(201)
      expect(await keyNames()).toEqual(['Shortcuts on iPhone'])
    })

    it(`accepts a name of ${API_KEY_NAME_MAX_LENGTH} characters`, async () => {
      const name = 'a'.repeat(API_KEY_NAME_MAX_LENGTH)

      expect((await create({ name, expiresIn: '90d' })).status).toBe(201)
    })

    it.each([
      ['no body', undefined],
      ['no name', { expiresIn: '90d' }],
      ['an empty name', { name: '', expiresIn: '90d' }],
      ['a name of spaces only', { name: '   ', expiresIn: '90d' }],
      [
        `a name over ${API_KEY_NAME_MAX_LENGTH} characters`,
        { name: 'a'.repeat(API_KEY_NAME_MAX_LENGTH + 1), expiresIn: '90d' },
      ],
      ['an unknown expiry', { name: 'A', expiresIn: '7d' }],
      ['no expiry', { name: 'A' }],
      ['an unknown field', { name: 'A', expiresIn: '90d', extra: 1 }],
    ])('rejects %s with 400 and creates nothing', async (_case, body) => {
      const response = await create(body)

      expect(response.status).toBe(400)
      expect(await keys()).toEqual([])
    })

    it.each(['Home Assistant', 'HOME ASSISTANT', ' Home Assistant '])(
      'rejects %j with 409 when the user has a key named "Home Assistant"',
      async (name) => {
        await seedKey({ name: 'Home Assistant' })

        const response = await create({ name, expiresIn: '90d' })

        expect(response.status).toBe(409)
        expect(await keyNames()).toEqual(['Home Assistant'])
      },
    )

    it('rejects the name of an expired key with 409', async () => {
      await seedKey({
        name: 'Old import script',
        createdAt: new Date('2026-07-03T14:00:00Z'),
        expiresIn: '90d',
      })

      expect((await create({ name: 'Old import script', expiresIn: '90d' })).status).toBe(409)
    })

    it("accepts a name another user's key already has", async () => {
      await seedKey({ name: 'Home Assistant' }, OTHER_USERNAME)

      expect((await create({ name: 'Home Assistant', expiresIn: '90d' })).status).toBe(201)
    })
  })

  describe('DELETE /v1/settings/api-keys/:id', () => {
    it('removes the key with 204', async () => {
      const { id } = await seedKey({ name: 'Home Assistant' })
      await seedKey({ name: 'Shortcuts on iPhone' })

      const response = await remove(id)

      expect(response.status).toBe(204)
      expect(await keyNames()).toEqual(['Shortcuts on iPhone'])
    })

    it('frees the name of the removed key', async () => {
      const { id } = await seedKey({ name: 'Home Assistant' })
      await remove(id)

      expect((await create({ name: 'Home Assistant', expiresIn: '90d' })).status).toBe(201)
    })

    it("answers 404 on another user's key and keeps it", async () => {
      const { id } = await seedKey({ name: "Ana's script" }, OTHER_USERNAME)

      const response = await remove(id)

      expect(response.status).toBe(404)
      const otherToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      expect(await keyNames(otherToken)).toEqual(["Ana's script"])
    })

    it('answers 404 on an id that does not exist', async () => {
      expect((await remove(99_999)).status).toBe(404)
    })

    // Like every other route with an id in its path.
    it('answers 400 on an id that is not a number', async () => {
      expect((await remove('abc')).status).toBe(400)
    })
  })

  describe('storage', () => {
    it('stores no column with the full key, and still answers it', async () => {
      const created = (await create({ name: 'Home Assistant', expiresIn: '90d' })).body as ApiKey

      const rows = JSON.stringify(await storedRows())

      expect(rows).not.toContain(randomPartOf(created.key))
      expect((await keys()).map((key) => key.key)).toEqual([created.key])
    })

    it("deletes the user's keys with the user", async () => {
      await seedKey({ name: 'Home Assistant' })
      await seedKey({ name: 'Shortcuts on iPhone' })

      await database.db.run(sql`DELETE FROM users WHERE username = ${USERNAME}`)

      expect(await storedRows()).toEqual([])
    })
  })

  describe('API_KEY_SECRET', () => {
    const { API_KEY_SECRET: _secret, ...withoutSecret } = TEST_ENV

    it.each([
      ['missing', withoutSecret],
      ['31 characters long', { ...TEST_ENV, API_KEY_SECRET: 'a'.repeat(31) }],
    ])('stops the API from starting when it is %s', (_case, env) => {
      expect(() => AppConfig.fromEnv(env)).toThrow()
    })

    it('accepts a secret of 32 characters', () => {
      expect(() => AppConfig.fromEnv({ ...TEST_ENV, API_KEY_SECRET: 'a'.repeat(32) })).not.toThrow()
    })
  })

  describe('authentication', () => {
    const requests = [
      ['GET', (bearer?: Bearer) => list(bearer)],
      ['POST', (bearer?: Bearer) => create({ name: 'Home Assistant', expiresIn: '90d' }, bearer)],
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
