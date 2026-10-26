import type { Page } from 'playwright'
import { dayRange } from '../../api/src/daily-log/day'
import type { Database } from '../../api/src/db/database'
import { seedDailyGoals, seedFoodEntry, seedWaterEntry } from '../../api/src/db/seed'
import { expect } from 'vite-plus/test'
import { TIME_ZONE, eventually } from './browser'
import { receivedRequests } from './fault-proxy'
import { SEEDED } from './fixtures'

export { seedDailyGoals, seedFoodEntry, seedWaterEntry }

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

// "Now" in the browser: Saturday 2026-10-24, 11:00 AM in New York (UTC-4 on that day).
export const NOW = new Date('2026-10-24T11:00:00-04:00')

export const newYorkTime = (localDateTime: string) => new Date(`${localDateTime}-04:00`)

// Tests that create entries through the API cannot fix its clock, so they work on the real today in
// New York instead of NOW. A minute into the day keeps seeded entries older than the ones a test
// creates, unless the test runs in the first minutes after midnight.
export const minutesIntoToday = (minutes: number) => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  return new Date(dayRange({ date, timeZone: TIME_ZONE }).start.getTime() + minutes * 60_000)
}

// How the Food Log shows the time of an entry, e.g. "12:01 AM".
export const timeLabel = (instant: Date) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE })
    .format(instant)
    .replaceAll(/\s/g, ' ')

const userIdOf = async (database: Database, username: string) => {
  const user = await database.db.query.users.findFirst({
    where: (table, { eq }) => eq(table.username, username),
  })
  if (user === undefined) throw new Error(`No user named "${username}"`)
  return user.id
}

// The user's water entries as stored, oldest first.
export const storedWaterEntries = async (database: Database, username: string) => {
  const userId = await userIdOf(database, username)
  return database.db.query.waterEntries.findMany({
    where: (table, { eq }) => eq(table.userId, userId),
    orderBy: (table, { asc }) => asc(table.loggedAt),
  })
}

// The user's food entries as stored, oldest first.
export const storedFoodEntries = async (database: Database, username: string) => {
  const userId = await userIdOf(database, username)
  return database.db.query.foodEntries.findMany({
    where: (table, { eq }) => eq(table.userId, userId),
    orderBy: (table, { asc }) => asc(table.loggedAt),
  })
}

// Opens the home page on the real clock, unlike openHome, so entries the page creates get the API's
// real time, and waits for the log.
export const openLog = async (page: Page) => {
  await page.goto(`${WEB_URL}/`)
  await expect.poll(() => homePage(page).summary('Calories').isVisible(), eventually).toBe(true)
}

// Fixes the browser clock and opens the home page.
export const openHome = async (page: Page) => {
  await page.clock.setFixedTime(NOW)
  await page.goto(`${WEB_URL}/`)
}

export const dailyLogRequests = async (username: string) =>
  (await receivedRequests(PROXY_URL, username)).filter((request) =>
    request.startsWith('GET /v1/daily-log'),
  )

export const homePage = (page: Page) => ({
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
