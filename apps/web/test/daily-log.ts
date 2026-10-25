import type { BrowserContext, Locator, Page } from 'playwright'
import { Database } from '../../api/src/db/database'
import { seedFoodEntry, seedUser, seedWaterEntry } from '../../api/src/db/seed'
import { receivedRequests } from './fault-proxy'
import { SEEDED, SEED_USER } from './fixtures'

export { seedFoodEntry, seedWaterEntry }

// The daily log tests add their own users to the environment that already has an account.
const { databasePath, proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

export const TIME_ZONE = 'America/New_York'

// "Now" in the browser: Saturday 2026-10-24, 11:00 AM in New York (UTC-4 on that day).
export const NOW = new Date('2026-10-24T11:00:00-04:00')

export const newYorkTime = (localDateTime: string) => new Date(`${localDateTime}-04:00`)

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

const setSessionCookie = (context: BrowserContext, token: string) =>
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

// Fixes the browser clock and opens the home page.
export const openHome = async (page: Page) => {
  await page.clock.setFixedTime(NOW)
  await page.goto(`${WEB_URL}/`)
}

export const textOf = async (locator: Locator) =>
  (await locator.innerText()).replaceAll(/\s+/g, ' ').trim()

// Waits for the UI to settle on a value, since the log loads after the page renders.
export const eventually = { timeout: 5_000, interval: 100 }

export const dailyLogRequests = async (username: string) =>
  (await receivedRequests(PROXY_URL, username)).filter((request) =>
    request.startsWith('GET /v1/daily-log'),
  )

export const homePage = (page: Page) => ({
  logo: () => page.getByRole('banner').getByText('Open Calorie Tracker'),
  logOut: () => page.getByRole('banner').getByRole('button', { name: 'Log out' }),
  settings: () => page.getByRole('banner').getByRole('link', { name: 'Settings' }),
  title: () => page.getByRole('heading', { level: 1, name: 'Food Log' }),
  dailyLog: () => page.getByRole('region', { name: 'Daily log' }),
  week: () => page.getByRole('list', { name: 'Week' }),
  weekDays: () => page.getByRole('list', { name: 'Week' }).getByRole('listitem'),
  entries: () => page.getByRole('list', { name: 'Entries' }).getByRole('listitem'),
  entry: (name: string) =>
    page.getByRole('list', { name: 'Entries' }).getByRole('listitem').filter({ hasText: name }),
  summary: (name: string) => page.getByRole('group', { name, exact: true }),
  progress: (name: string) => page.getByRole('progressbar', { name, exact: true }),
  footer: () => page.getByRole('contentinfo'),
  loader: () => page.getByRole('status', { name: 'Reloading' }),
  // The page's Alert, scoped to <main> because Next.js renders its own role="alert" route announcer.
  alert: () => page.getByRole('main').getByRole('alert'),
})

// A single finger on a touch screen, driven through the Chrome DevTools Protocol because
// Playwright only offers taps.
export const finger = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page)
  const x = 195
  let y = 0
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })

  return {
    down: async (startY = 200) => {
      y = startY
      await touch('touchStart', [{ x, y }])
    },
    drag: async (distance: number, steps = 10) => {
      for (let step = 0; step < steps; step++) {
        y += distance / steps
        await touch('touchMove', [{ x, y }])
      }
    },
    up: () => touch('touchEnd', []),
  }
}

export const pullToRefresh = async (page: Page, distance = 120) => {
  const touch = await finger(page)
  await touch.down()
  await touch.drag(distance)
  await touch.up()
}
