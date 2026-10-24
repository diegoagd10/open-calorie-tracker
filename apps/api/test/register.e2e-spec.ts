import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { createApp } from '../src/app.js'
import { Database } from '../src/db/database.js'
import { seedUser } from '../src/db/seed.js'

// Only registration enforces it: logging in still accepts shorter passwords.
const PASSWORD_MIN_LENGTH = 8

const USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'
const VALID = { username: USERNAME, password: PASSWORD, confirmPassword: PASSWORD }

const withPassword = (password: string) => ({ ...VALID, password, confirmPassword: password })

describe('registration (e2e)', () => {
  let app: Awaited<ReturnType<typeof createApp>>

  // A fresh in-memory database per test, so every test starts with no users.
  beforeEach(async () => {
    process.env['DATABASE_URL'] = ':memory:'
    process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-for-hs256'
    process.env['JWT_ISSUER'] = 'open-calorie-tracker-api'
    process.env['JWT_AUDIENCE'] = 'open-calorie-tracker-web'
    process.env['TRUST_PROXY'] = 'loopback'

    app = await createApp()
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const register = (body: object) => request(app.getHttpServer()).post('/v1/register').send(body)

  const login = (body: object) => request(app.getHttpServer()).post('/v1/login').send(body)

  const setupStatus = () => request(app.getHttpServer()).get('/v1/setup')

  const storedUsers = () => app.get(Database).db.query.users.findMany()

  const seedExistingUser = () =>
    seedUser(app.get(Database), { username: 'existing', password: PASSWORD })

  describe('GET /v1/setup', () => {
    it('reports that setup is needed when there are no users', async () => {
      const response = await setupStatus()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ needsSetup: true })
    })

    it('reports that setup is done once a user exists', async () => {
      await seedExistingUser()

      const response = await setupStatus()

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ needsSetup: false })
    })

    it('reports that setup is done after registering', async () => {
      await register(VALID)

      expect((await setupStatus()).body).toEqual({ needsSetup: false })
    })
  })

  describe('POST /v1/register', () => {
    it('creates the first account with 201', async () => {
      const response = await register(VALID)

      expect(response.status).toBe(201)
      expect((await storedUsers()).map((user) => user.username)).toEqual([USERNAME])
    })

    it('stores the username in lowercase', async () => {
      await register({ ...VALID, username: 'Ana123' })

      expect((await storedUsers()).map((user) => user.username)).toEqual(['ana123'])
    })

    it('stores an Argon2id hash instead of the password', async () => {
      await register(VALID)

      const [user] = await storedUsers()
      expect(user?.passwordHash).toMatch(/^\$argon2id\$/)
      expect(user?.passwordHash).not.toContain(PASSWORD)
    })

    it('lets the new account log in with the same credentials', async () => {
      await register(VALID)

      const response = await login({ username: USERNAME, password: PASSWORD })

      expect(response.status).toBe(200)
    })

    it('rejects a second account with 409', async () => {
      await seedExistingUser()

      const response = await register(VALID)

      expect(response.status).toBe(409)
      expect((await storedUsers()).map((user) => user.username)).toEqual(['existing'])
    })

    it('creates a single account when two registrations arrive at the same time', async () => {
      const responses = await Promise.all([
        register(VALID),
        register({ ...VALID, username: 'bob' }),
      ])

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409])
      expect(await storedUsers()).toHaveLength(1)
    })

    describe('validation', () => {
      it.each([
        ['no body', {}],
        ['a missing username', { password: PASSWORD, confirmPassword: PASSWORD }],
        ['a missing password', { username: USERNAME, confirmPassword: PASSWORD }],
        ['a missing password confirmation', { username: USERNAME, password: PASSWORD }],
        ['an empty username', { ...VALID, username: '' }],
        ['an empty password', withPassword('')],
        ['an empty password confirmation', { ...VALID, confirmPassword: '' }],
        ['a password confirmation that does not match', { ...VALID, confirmPassword: 'other' }],
        ['a username with an underscore', { ...VALID, username: 'ana_1' }],
        ['a username with a space', { ...VALID, username: 'ana 1' }],
        ['a username with an accent', { ...VALID, username: 'josé' }],
        ['a username with an ñ', { ...VALID, username: 'peña' }],
        [
          `a username longer than ${USERNAME_MAX_LENGTH} characters`,
          { ...VALID, username: 'a'.repeat(USERNAME_MAX_LENGTH + 1) },
        ],
        [
          `a password shorter than ${PASSWORD_MIN_LENGTH} characters`,
          withPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)),
        ],
        [
          `a password longer than ${PASSWORD_MAX_LENGTH} characters`,
          withPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)),
        ],
      ])('rejects %s with 400 and creates no user', async (_case, body) => {
        const response = await register(body)

        expect(response.status).toBe(400)
        expect(await storedUsers()).toEqual([])
      })

      it.each([
        [
          `a ${USERNAME_MAX_LENGTH}-character username`,
          { ...VALID, username: 'a'.repeat(USERNAME_MAX_LENGTH) },
        ],
        [
          `a ${PASSWORD_MIN_LENGTH}-character password`,
          withPassword('a'.repeat(PASSWORD_MIN_LENGTH)),
        ],
        [
          `a ${PASSWORD_MAX_LENGTH}-character password`,
          withPassword('a'.repeat(PASSWORD_MAX_LENGTH)),
        ],
      ])('accepts %s', async (_case, body) => {
        const response = await register(body)

        expect(response.status).toBe(201)
      })
    })
  })
})
