import { USERNAME_MAX_LENGTH } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../../src/db/database.js'
import { seedUser } from '../../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from '../app.js'

const OTHER_USERNAME = 'diego'
const PASSWORD = 'correct-horse-battery-staple'

describe('settings: profile (e2e)', () => {
  let app: TestApp
  let database: Database

  beforeEach(async () => {
    app = await createTestApp()
    database = app.get(Database)
    // Seeded with a capital, so the answer shows the username as stored.
    await seedUser(database, { username: 'Ana', password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
  })

  afterEach(async () => {
    await app.close()
  })

  const read = (bearer: string | null) =>
    withBearer(request(app.getHttpServer()).get('/v1/settings/profile'), bearer)

  const profileOf = async (username: string) => {
    const response = await read(await accessTokenFor(app, username, PASSWORD))
    expect(response.status).toBe(200)
    return response.body as unknown
  }

  describe('GET /v1/settings/profile', () => {
    it('answers only the username, in lowercase as stored', async () => {
      expect(await profileOf('ana')).toEqual({ username: 'ana' })
    })

    it('answers a username of the maximum length whole', async () => {
      const longest = 'a'.repeat(USERNAME_MAX_LENGTH)
      await seedUser(database, { username: longest, password: PASSWORD })

      expect(await profileOf(longest)).toEqual({ username: longest })
    })

    it('answers the username of the user the token belongs to', async () => {
      expect(await profileOf(OTHER_USERNAME)).toEqual({ username: OTHER_USERNAME })
    })
  })

  describe('authentication', () => {
    it('rejects a request without a token with 401', async () => {
      expect((await read(null)).status).toBe(401)
    })

    it.each(INVALID_TOKENS)('rejects %s with 401', async (_case, invalid) => {
      expect((await read(await invalid())).status).toBe(401)
    })
  })
})
