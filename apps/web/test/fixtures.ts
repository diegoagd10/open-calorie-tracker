import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const API_PORT = 3101
export const API_URL = `http://localhost:${API_PORT}`

// Next.js talks to the API through the fault proxy.
export const PROXY_PORT = 3102
export const PROXY_URL = `http://localhost:${PROXY_PORT}`

export const WEB_PORT = 3100
export const WEB_URL = `http://localhost:${WEB_PORT}`

export const SEED_USER = {
  username: 'ana',
  password: 'correct-horse-battery-staple',
}

// Shared by the API, which signs the session tokens, and Next.js, which may verify them.
export const JWT = {
  secret: 'web-test-secret-that-is-long-enough',
  issuer: 'open-calorie-tracker-api',
  audience: 'open-calorie-tracker-web',
}

// A fixed path, so the tests can seed the same database the API reads.
export const DATABASE_PATH = join(tmpdir(), 'open-calorie-tracker-web-test.db')
export const DATABASE_URL = `file:${DATABASE_PATH}`
