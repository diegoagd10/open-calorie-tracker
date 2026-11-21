import { SignJWT } from 'jose'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Environment = {
  webUrl: string
  apiUrl: string
  proxyUrl: string
  databasePath: string
}

const DEFAULT_BASE_PORT = 3100

const basePortFromEnv = (value: string | undefined): number => {
  if (value === undefined || value === '') return DEFAULT_BASE_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 - 102) {
    throw new Error(`WEB_TEST_BASE_PORT must be a port between 1024 and ${65_535 - 102}`)
  }
  return port
}

const BASE_PORT = basePortFromEnv(process.env['WEB_TEST_BASE_PORT'])

export const TEST_DATA_DIR = join(tmpdir(), `open-calorie-tracker-web-test-${BASE_PORT}`)

const environment = (name: string, basePort: number): Environment => ({
  webUrl: `http://localhost:${basePort}`,
  apiUrl: `http://localhost:${basePort + 1}`,
  proxyUrl: `http://localhost:${basePort + 2}`,
  databasePath: join(TEST_DATA_DIR, `${name}.sqlite`),
})

export const SEEDED = environment('seeded', BASE_PORT)

export const EMPTY = environment('empty', BASE_PORT + 100)

export const SEED_USER = {
  username: 'ana',
  password: 'correct-horse-battery-staple',
}

export const JWT = {
  secret: 'web-test-secret-that-is-long-enough',
  issuer: 'open-calorie-tracker-api',
  audience: 'open-calorie-tracker-web',
}

export const API_KEY_SECRET = 'web-test-api-key-secret-that-is-long-enough'

export const signAccessToken = (expiresAt: number) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT.issuer)
    .setAudience(JWT.audience)
    .setSubject('1')
    .setIssuedAt(expiresAt - 60)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(JWT.secret))

export const INVALID_TOKENS = [
  ['is not a valid token', () => Promise.resolve('not-a-token')],
  ['has expired', () => signAccessToken(Math.floor(Date.now() / 1000) - 60)],
] as const
