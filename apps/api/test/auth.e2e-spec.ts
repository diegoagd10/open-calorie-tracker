import { decodeJwt, jwtVerify } from 'jose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { createApp } from '../src/app.js'
import { Database } from '../src/db/database.js'
import { seedUser } from '../src/db/seed.js'

const USERNAME = 'ana'
// The seeded user is the only row in a fresh in-memory database.
const SEED_USER_ID = '1'
const PASSWORD = 'correct-horse-battery-staple'

const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'
const JWT_ISSUER = 'open-calorie-tracker-api'
const JWT_AUDIENCE = 'open-calorie-tracker-web'
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

const USERNAME_MAX_LENGTH = 32
const PASSWORD_MAX_LENGTH = 128

const MAX_FAILED_ATTEMPTS = 5

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const secretKey = new TextEncoder().encode(JWT_SECRET)

type LoginResponse = { accessToken: string }

describe('POST /v1/login (e2e)', () => {
  let app: Awaited<ReturnType<typeof createApp>>

  beforeEach(async () => {
    process.env['DATABASE_URL'] = ':memory:'
    process.env['JWT_SECRET'] = JWT_SECRET
    process.env['JWT_ISSUER'] = JWT_ISSUER
    process.env['JWT_AUDIENCE'] = JWT_AUDIENCE
    process.env['TRUST_PROXY'] = 'loopback'

    app = await createApp()
    await app.init()
    await seedUser(app.get(Database), { username: USERNAME, password: PASSWORD })
  })

  afterEach(async () => {
    await app.close()
  })

  const login = (body: object, ip = '203.0.113.1') =>
    request(app.getHttpServer()).post('/v1/login').set('X-Forwarded-For', ip).send(body)

  const accessTokenFrom = async (ip?: string) => {
    const response = await login({ username: USERNAME, password: PASSWORD }, ip)
    return (response.body as LoginResponse).accessToken
  }

  describe('credentials', () => {
    it('issues a signed JWT with the expected header and claims', async () => {
      const issuedAt = Math.floor(Date.now() / 1000)

      const { payload, protectedHeader } = await jwtVerify(await accessTokenFrom(), secretKey, {
        algorithms: ['HS256'],
      })

      expect(protectedHeader).toEqual({ alg: 'HS256', typ: 'JWT' })
      const { jti, iat, ...claims } = payload
      expect(claims).toEqual({
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        sub: SEED_USER_ID,
        exp: (iat ?? 0) + ACCESS_TOKEN_TTL_SECONDS,
      })
      expect(jti).toMatch(UUID_PATTERN)
      expect(iat).toBeCloseTo(issuedAt, -1)
    })

    it('issues a unique token id on every login', async () => {
      const first = decodeJwt(await accessTokenFrom())
      const second = decodeJwt(await accessTokenFrom())

      expect(first.jti).not.toBe(second.jti)
    })

    it('rejects a wrong password with 401 and no token', async () => {
      const response = await login({ username: USERNAME, password: 'wrong-password' })

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('accessToken')
    })

    it('rejects an unknown username with 401 and no token', async () => {
      const response = await login({ username: 'nobody', password: PASSWORD })

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('accessToken')
    })

    it('does not reveal whether the username exists', async () => {
      const wrongPassword = await login({ username: USERNAME, password: 'wrong-password' })
      const unknownUsername = await login({ username: 'nobody', password: PASSWORD })

      expect(wrongPassword.body).toEqual(unknownUsername.body)
    })
  })

  describe('validation', () => {
    it.each([
      ['missing username', { password: PASSWORD }],
      ['missing password', { username: USERNAME }],
      ['empty username', { username: '', password: PASSWORD }],
      ['empty password', { username: USERNAME, password: '' }],
      [
        `username longer than ${USERNAME_MAX_LENGTH} characters`,
        { username: 'a'.repeat(USERNAME_MAX_LENGTH + 1), password: PASSWORD },
      ],
      [
        `password longer than ${PASSWORD_MAX_LENGTH} characters`,
        { username: USERNAME, password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) },
      ],
    ])('rejects %s with 400', async (_case, body) => {
      const response = await login(body)

      expect(response.status).toBe(400)
    })

    it.each([
      [
        `a ${USERNAME_MAX_LENGTH}-character username`,
        { username: 'a'.repeat(USERNAME_MAX_LENGTH), password: PASSWORD },
      ],
      [
        `a ${PASSWORD_MAX_LENGTH}-character password`,
        { username: USERNAME, password: 'a'.repeat(PASSWORD_MAX_LENGTH) },
      ],
    ])('accepts %s as valid input', async (_case, body) => {
      const response = await login(body)

      expect(response.status).toBe(401)
    })
  })

  describe('account lockout', () => {
    const failLogin = (ip: string, username = USERNAME) =>
      login({ username, password: 'wrong-password' }, ip)

    const failRepeatedly = async (ip: string, times: number) => {
      for (let attempt = 0; attempt < times; attempt++) await failLogin(ip)
    }

    it(`locks the account with 423 on failed attempt #${MAX_FAILED_ATTEMPTS}`, async () => {
      const ip = '203.0.113.10'

      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
        expect((await failLogin(ip)).status).toBe(401)
      }

      expect((await failLogin(ip)).status).toBe(423)
    })

    it('keeps rejecting the correct password from the locked IP', async () => {
      const ip = '203.0.113.11'
      await failRepeatedly(ip, MAX_FAILED_ATTEMPTS)

      const response = await login({ username: USERNAME, password: PASSWORD }, ip)

      expect(response.status).toBe(423)
      expect(response.body).not.toHaveProperty('accessToken')
    })

    it('still allows the same account to log in from another IP', async () => {
      await failRepeatedly('203.0.113.12', MAX_FAILED_ATTEMPTS)

      const response = await login({ username: USERNAME, password: PASSWORD }, '203.0.113.13')

      expect(response.status).toBe(200)
    })

    it('does not lock other accounts from the same IP', async () => {
      const ip = '203.0.113.14'
      await failRepeatedly(ip, MAX_FAILED_ATTEMPTS)

      const response = await failLogin(ip, 'other')

      expect(response.status).toBe(401)
    })

    it('resets the failed attempts after a successful login', async () => {
      const ip = '203.0.113.15'
      await failRepeatedly(ip, MAX_FAILED_ATTEMPTS - 1)

      expect((await login({ username: USERNAME, password: PASSWORD }, ip)).status).toBe(200)

      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
        expect((await failLogin(ip)).status).toBe(401)
      }
    })
  })
})
