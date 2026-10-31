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
  API_KEY_SECRET: 'test-api-key-secret-that-is-long-enough',
}

export type TestApp = Awaited<ReturnType<typeof createApp>>

export const createTestApp = async (): Promise<TestApp> => {
  Object.assign(process.env, TEST_ENV)
  const app = await createApp()
  await app.init()
  return app
}

// Sends the request with the bearer token, or with no Authorization header when it is null.
export const withBearer = (pending: request.Test, token: string | null) =>
  token === null ? pending : pending.set('Authorization', `Bearer ${token}`)

// Logs in through the API and returns the access token.
export const accessTokenFor = async (app: TestApp, username: string, password: string) => {
  const response = await request(app.getHttpServer()).post('/v1/login').send({ username, password })
  return (response.body as { accessToken: string }).accessToken
}

const now = () => Math.floor(Date.now() / 1000)

// Signs a token like the API does, for user 1 and valid for 10 minutes unless told otherwise. A
// `scope` gives it the space-separated scopes of a token exchanged from an API key.
export const signAccessToken = ({
  secret = TEST_ENV.JWT_SECRET,
  subject = '1',
  expiresAt = now() + 600,
  scope,
}: { secret?: string; subject?: string; expiresAt?: number; scope?: string } = {}) =>
  new SignJWT(scope === undefined ? {} : { scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TEST_ENV.JWT_ISSUER)
    .setAudience(TEST_ENV.JWT_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(expiresAt - 60)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret))

// Bearer tokens every guarded endpoint must reject with 401.
export const INVALID_TOKENS = [
  ['a malformed token', () => Promise.resolve('not-a-jwt')],
  ['an expired token', () => signAccessToken({ expiresAt: now() - 60 })],
  ['a token signed with another secret', () => signAccessToken({ secret: 'x'.repeat(42) })],
] as const
