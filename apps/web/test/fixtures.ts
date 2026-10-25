import { SignJWT } from 'jose'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Environment = {
  webUrl: string
  apiUrl: string
  // Next.js talks to the API through the fault proxy.
  proxyUrl: string
  databasePath: string
}

// Override with WEB_TEST_BASE_PORT to run alongside another checkout's tests. The seeded
// environment uses the base port and the next two; the empty one starts 100 ports higher.
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

// Per base port, so two runs on different ports never share a database.
export const TEST_DATA_DIR = join(tmpdir(), `open-calorie-tracker-web-test-${BASE_PORT}`)

const environment = (name: string, basePort: number): Environment => ({
  webUrl: `http://localhost:${basePort}`,
  apiUrl: `http://localhost:${basePort + 1}`,
  proxyUrl: `http://localhost:${basePort + 2}`,
  databasePath: join(TEST_DATA_DIR, `${name}.sqlite`),
})

// Already has the seed user: for logging in and the redirects to /login.
export const SEEDED = environment('seeded', BASE_PORT)

// Starts with no users: for registering and the redirects to /register.
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

// A token signed like the API's, for user 1, that expires at the given Unix time.
export const signAccessToken = (expiresAt: number) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT.issuer)
    .setAudience(JWT.audience)
    .setSubject('1')
    .setIssuedAt(expiresAt - 60)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(JWT.secret))

// Session cookie values the web app must treat as no session.
export const INVALID_TOKENS = [
  ['is not a valid token', () => Promise.resolve('not-a-token')],
  ['has expired', () => signAccessToken(Math.floor(Date.now() / 1000) - 60)],
] as const
