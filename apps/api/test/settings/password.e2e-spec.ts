import {
  INCORRECT_CURRENT_PASSWORD_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@open-calorie-tracker/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../../src/db/database.js'
import { users } from '../../src/db/schema.js'
import { seedUser } from '../../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from '../app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'
const NEW_PASSWORD = 'new-password-1'

const CHANGE = {
  currentPassword: PASSWORD,
  newPassword: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
}

const withNewPassword = (newPassword: string) => ({
  ...CHANGE,
  newPassword,
  confirmPassword: newPassword,
})

describe('settings: password (e2e)', () => {
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
  const change = (body?: object, bearer: string | null = token) => {
    const pending = withBearer(request(app.getHttpServer()).put('/v1/settings/password'), bearer)
    return body === undefined ? pending : pending.send(body)
  }

  const loginStatus = async (password: string, username = USERNAME) =>
    (await request(app.getHttpServer()).post('/v1/login').send({ username, password })).status

  const storedHash = async (username = USERNAME) =>
    (await app.get(Database).db.query.users.findFirst({ where: eq(users.username, username) }))
      ?.passwordHash

  describe('PUT /v1/settings/password', () => {
    it('answers 204 with no body', async () => {
      const response = await change(CHANGE)

      expect(response.status).toBe(204)
      expect(response.text).toBe('')
    })

    it('lets the user log in with the new password and not with the old one', async () => {
      await change(CHANGE)

      expect(await loginStatus(NEW_PASSWORD)).toBe(200)
      expect(await loginStatus(PASSWORD)).toBe(401)
    })

    it('stores an Argon2id hash of the new password', async () => {
      const before = await storedHash()

      await change(CHANGE)

      const after = await storedHash()
      expect(after).toMatch(/^\$argon2id\$/)
      expect(after).not.toBe(before)
      expect(after).not.toContain(NEW_PASSWORD)
    })

    it('keeps the token used for the change working', async () => {
      await change(CHANGE)

      const response = await withBearer(
        request(app.getHttpServer()).get('/v1/settings/daily-goals'),
        token,
      )

      expect(response.status).toBe(200)
    })

    it('rejects a wrong current password with 403 and keeps the password', async () => {
      const response = await change({ ...CHANGE, currentPassword: 'wrong-password' })

      expect(response.status).toBe(403)
      expect((response.body as { message: unknown }).message).toBe(
        INCORRECT_CURRENT_PASSWORD_MESSAGE,
      )
      expect(await loginStatus(PASSWORD)).toBe(200)
    })

    it('changes only the password of the user the token belongs to', async () => {
      await change(CHANGE)

      expect(await loginStatus(PASSWORD, OTHER_USERNAME)).toBe(200)
    })

    describe('validation', () => {
      it.each([
        ['no body', undefined],
        ['an empty current password', { ...CHANGE, currentPassword: '' }],
        [
          `a current password longer than ${PASSWORD_MAX_LENGTH} characters`,
          { ...CHANGE, currentPassword: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) },
        ],
        [
          `a new password shorter than ${PASSWORD_MIN_LENGTH} characters`,
          withNewPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)),
        ],
        [
          `a new password longer than ${PASSWORD_MAX_LENGTH} characters`,
          withNewPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)),
        ],
        ['a confirmation that does not match', { ...CHANGE, confirmPassword: 'new-password-2' }],
        ['a missing confirmation', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }],
        ['a new password equal to the current one', withNewPassword(PASSWORD)],
      ])('rejects %s with 400 and keeps the password', async (_case, body) => {
        const response = await change(body)

        expect(response.status).toBe(400)
        expect(await loginStatus(PASSWORD)).toBe(200)
      })
    })

    describe('authentication', () => {
      it('rejects a request without a token with 401 and keeps the password', async () => {
        expect((await change(CHANGE, null)).status).toBe(401)
        expect(await loginStatus(PASSWORD)).toBe(200)
      })

      it.each(INVALID_TOKENS)(
        'rejects %s with 401 and keeps the password',
        async (_case, invalid) => {
          expect((await change(CHANGE, await invalid())).status).toBe(401)
          expect(await loginStatus(PASSWORD)).toBe(200)
        },
      )
    })
  })
})
