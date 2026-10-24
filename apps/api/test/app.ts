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
