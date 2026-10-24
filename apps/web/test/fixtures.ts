import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Environment = {
  webUrl: string
  apiUrl: string
  // Next.js talks to the API through the fault proxy.
  proxyUrl: string
  databasePath: string
}

export const TEST_DATA_DIR = join(tmpdir(), 'open-calorie-tracker-web-test')

const environment = (name: string, basePort: number): Environment => ({
  webUrl: `http://localhost:${basePort}`,
  apiUrl: `http://localhost:${basePort + 1}`,
  proxyUrl: `http://localhost:${basePort + 2}`,
  databasePath: join(TEST_DATA_DIR, `${name}.sqlite`),
})

// Already has the seed user: for logging in and the redirects to /login.
export const SEEDED = environment('seeded', 3100)

// Starts with no users: for registering and the redirects to /register.
export const EMPTY = environment('empty', 3200)

export const SEED_USER = {
  username: 'ana',
  password: 'correct-horse-battery-staple',
}

export const JWT = {
  secret: 'web-test-secret-that-is-long-enough',
  issuer: 'open-calorie-tracker-api',
  audience: 'open-calorie-tracker-web',
}
