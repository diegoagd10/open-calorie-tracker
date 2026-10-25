import { SignJWT } from 'jose'
import request from 'supertest'
import { createApp } from '../src/app.js'

// The only place the e2e tests configure the API, so a new variable is added here once.
export const TEST_ENV = {
  // A fresh in-memory database per app, so every test starts with no users.
  DATABASE_URL: ':memory:',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256',
  JWT_ISSUER: 'open-calorie-tracker-api',
  JWT_AUDIENCE: 'open-calorie-tracker-web',
  TRUST_PROXY: 'loopback',
}

export type TestApp = Awaited<ReturnType<typeof createApp>>

export const createTestApp = async (): Promise<TestApp> => {
  Object.assign(process.env, TEST_ENV)
  const app = await createApp()
  await app.init()
  return app
}

// Logs in through the API and returns the access token.
export const accessTokenFor = async (app: TestApp, username: string, password: string) => {
  const response = await request(app.getHttpServer()).post('/v1/login').send({ username, password })
  return (response.body as { accessToken: string }).accessToken
}

const signToken = (secret: string, expiresAt: number) =>
  new SignJWT()
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TEST_ENV.JWT_ISSUER)
    .setAudience(TEST_ENV.JWT_AUDIENCE)
    .setSubject('1')
    .setIssuedAt(expiresAt - 60)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret))

const now = () => Math.floor(Date.now() / 1000)

// Bearer tokens every guarded endpoint must reject with 401.
export const INVALID_TOKENS = [
  ['a malformed token', () => Promise.resolve('not-a-jwt')],
  ['an expired token', () => signToken(TEST_ENV.JWT_SECRET, now() - 60)],
  ['a token signed with another secret', () => signToken('x'.repeat(42), now() + 600)],
] as const
