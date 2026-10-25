import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'
import { Database } from '../../api/src/db/database'
import { seedUser } from '../../api/src/db/seed'
import { openPage } from './browser'
import { SEEDED, SEED_USER } from './fixtures'

// These tests add their own users to the environment that already has an account.
const { databasePath, proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const PASSWORD = SEED_USER.password

// The tests write to the same database the API reads.
export const connectDatabase = () => Database.connect(`file:${databasePath}`)

let users = 0

// A fresh user per test, so every test starts with an empty log.
export const createUser = async (database: Database) => {
  users += 1
  const username = `diego${Date.now()}${users}`
  await seedUser(database, { username, password: PASSWORD })
  return username
}

export const setSessionCookie = (context: BrowserContext, token: string) =>
  context.addCookies([
    {
      name: 'access_token',
      value: token,
      url: WEB_URL,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ])

// Logs in through the fault proxy, which then knows the token belongs to this user, and stores the
// session cookie the same way the login page does. Returns the token.
export const logIn = async (context: BrowserContext, username: string) => {
  const response = await fetch(`${PROXY_URL}/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  const { accessToken } = (await response.json()) as { accessToken: string }
  await setSessionCookie(context, accessToken)
  return accessToken
}

export const sessionCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === 'access_token')

// A fresh page with a new user already logged in.
export const signedInPage = async (
  browser: Browser,
  database: Database,
  options: BrowserContextOptions = {},
) => {
  const { context, page } = await openPage(browser, options)
  const username = await createUser(database)
  const token = await logIn(context, username)
  return { context, page, username, token }
}
