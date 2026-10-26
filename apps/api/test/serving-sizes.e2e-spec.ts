import { MAX_SERVING_SIZE_LENGTH } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { seedUser } from '../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

type ServingSize = { id: number; name: string }

describe('serving sizes (e2e)', () => {
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
  type Bearer = string | null | undefined

  const withToken = (pending: request.Test, bearer: Bearer) =>
    withBearer(pending, bearer === undefined ? token : bearer)

  const create = (body: object, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).post('/v1/serving-sizes').send(body), bearer)

  const list = (bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).get('/v1/serving-sizes'), bearer)

  const tokenOf = (username: string) => accessTokenFor(app, username, PASSWORD)

  const servingSizesOf = async (bearer?: Bearer) => {
    const response = await list(bearer)
    expect(response.status).toBe(200)
    return response.body as ServingSize[]
  }

  const created = async (name: string, bearer?: Bearer) => {
    const response = await create({ name }, bearer)
    expect(response.status).toBe(201)
    return response.body as ServingSize
  }

  describe('POST /v1/serving-sizes', () => {
    it('adds a new serving size to the list with 201, trimmed and with single spaces', async () => {
      const response = await create({ name: '  1   bowl ' })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({ id: expect.any(Number) as unknown, name: '1 bowl' })
      expect(await servingSizesOf()).toEqual([response.body])
    })

    it('returns the existing one with 200 regardless of case', async () => {
      const existing = await created('1 cup (245 g)')

      const response = await create({ name: '1 CUP (245 G)' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual(existing)
      expect(await servingSizesOf()).toEqual([existing])
    })

    it("keeps another user's serving size with the same text apart", async () => {
      const otherToken = await tokenOf(OTHER_USERNAME)
      const theirs = await created('1 burrito', otherToken)

      const mine = await created('1 burrito')

      expect(mine.id).not.toBe(theirs.id)
      expect(await servingSizesOf()).toEqual([mine])
      expect(await servingSizesOf(otherToken)).toEqual([theirs])
    })

    it(`accepts a name of ${MAX_SERVING_SIZE_LENGTH} characters`, async () => {
      const name = 'a'.repeat(MAX_SERVING_SIZE_LENGTH)

      expect((await created(name)).name).toBe(name)
    })
  })

  describe('GET /v1/serving-sizes', () => {
    it('returns an empty list to a user without serving sizes', async () => {
      expect(await servingSizesOf()).toEqual([])
    })

    it("returns only the user's own, alphabetically regardless of case", async () => {
      await created('1 burrito', await tokenOf(OTHER_USERNAME))
      for (const name of ['1 slice', 'Bowl', '1 cup', 'apple']) await created(name)

      const names = (await servingSizesOf()).map((servingSize) => servingSize.name)

      expect(names).toEqual(['1 cup', '1 slice', 'apple', 'Bowl'])
    })
  })

  describe('validation', () => {
    it.each([
      ['an empty name', { name: '' }],
      ['a blank name', { name: '   ' }],
      ['a name that is too long', { name: 'a'.repeat(MAX_SERVING_SIZE_LENGTH + 1) }],
      ['a missing name', {}],
      ['an unknown key', { name: '1 cup', userId: 2 }],
    ])('rejects %s with 400 and adds nothing', async (_case, body) => {
      const response = await create(body)

      expect(response.status).toBe(400)
      expect(await servingSizesOf()).toEqual([])
    })
  })

  describe('authentication', () => {
    const requests = [
      ['POST', (bearer?: Bearer) => create({ name: '1 cup' }, bearer)],
      ['GET', (bearer?: Bearer) => list(bearer)],
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
