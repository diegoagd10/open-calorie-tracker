import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'
import { Database } from '../../api/src/db/database'
import { seedUser } from '../../api/src/db/seed'
import { openPage } from './browser'
import { SEEDED, SEED_USER } from './fixtures'

const { databasePath, proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const PASSWORD = SEED_USER.password

export const connectDatabase = () => Database.connect(`file:${databasePath}`)

let users = 0

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

export const sendToRoute = (url: string, method: string, cookie: string | null, body?: object) => {
  const headers: Record<string, string> = {}
  const init: RequestInit = { method, headers, redirect: 'manual' }
  if (cookie !== null) headers['Cookie'] = `access_token=${cookie}`
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return fetch(url, init)
}
