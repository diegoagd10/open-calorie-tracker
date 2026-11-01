import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Locator, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { MOBILE, box, eventually, openPage, textOf } from './browser'
import {
  dailyLogRequests,
  finger,
  homePage,
  newYorkTime,
  openHome,
  pullToRefresh,
  seedFoodEntry,
} from './daily-log'
import { clearFault, clearReceivedRequests, injectFault } from './fault-proxy'
import { SEEDED } from './fixtures'
import { header } from './header'
import { connectDatabase, createUser, logIn } from './session'

const { proxyUrl: PROXY_URL } = SEEDED

// Long enough to make sure a reload that should not happen did not.
const QUIET_PERIOD_MS = 1_000

describe('Pull to refresh (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext | undefined
  let page: Page
  let username: string
  let home: ReturnType<typeof homePage>

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  const open = async (device: object) => {
    const opened = await openPage(browser, device)
    context = opened.context
    page = opened.page
    home = homePage(page)
    await logIn(opened.context, username)
    await openHome(page)
  }

  const logFood = (name: string, calories: number, localDateTime = '2026-10-24T10:53:00') =>
    seedFoodEntry(database, {
      username,
      loggedAt: newYorkTime(localDateTime),
      name,
      servingSize: '1 serving',
      quantity: 1,
      calories,
    })

  const waitForEntry = (name: string) =>
    expect.poll(() => home.entry(name).count(), eventually).toBe(1)

  const topOf = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN

  beforeEach(async () => {
    username = await createUser(database)
    await logFood('2 tortillas de maíz', 100)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context?.close()
    context = undefined
  })

  describe('on a mobile device, scrolled to the top', () => {
    beforeEach(async () => {
      await open(MOBILE)
      await waitForEntry('2 tortillas de maíz')
    })

    it('reloads the day when pulled down past 80 px', async () => {
      await logFood('Manzana', 95, '2026-10-24T10:58:00')
      const titleTop = await topOf(home.title())
      const weekTop = await topOf(home.week())
      // Slow the reload down so the loader can be observed.
      await injectFault(PROXY_URL, { delayMs: 1_000 }, username)

      const touch = await finger(page)
      await touch.down()
      await touch.drag(120)

      // The whole screen, week strip included, follows the finger.
      expect(await topOf(home.title())).toBeGreaterThan(titleTop)
      expect(await topOf(home.week())).toBeGreaterThan(weekTop)
      await home.loader().waitFor()

      await touch.up()

      await waitForEntry('Manzana')
      await home.loader().waitFor({ state: 'hidden' })
      await expect.poll(() => topOf(home.title()), eventually).toBe(titleTop)
      await expect.poll(() => textOf(home.summary('Calories')), eventually).toContain('195')
      expect(await textOf(home.summary('Calories'))).toContain('2 Food Entries')
    })

    it('shows the loader only once the finger has moved 80 px', async () => {
      const titleTop = await topOf(home.title())

      const touch = await finger(page)
      await touch.down()
      await touch.drag(60)

      expect(await topOf(home.title())).toBeGreaterThan(titleTop)
      expect(await home.loader().count()).toBe(0)

      await touch.drag(60)

      await home.loader().waitFor()
      await touch.up()
    })

    it('does not reload when released before 80 px', async () => {
      await logFood('Manzana', 95, '2026-10-24T10:58:00')
      await clearReceivedRequests(PROXY_URL, username)
      const titleTop = await topOf(home.title())

      await pullToRefresh(page, 60)

      await expect.poll(() => topOf(home.title()), eventually).toBe(titleTop)
      await page.waitForTimeout(QUIET_PERIOD_MS)
      expect(await home.loader().count()).toBe(0)
      expect(await dailyLogRequests(username)).toEqual([])
      expect(await home.entry('Manzana').count()).toBe(0)
    })

    it('moves the screen no more than 100 px however far the finger goes', async () => {
      const titleTop = await topOf(home.title())

      const touch = await finger(page)
      await touch.down()
      await touch.drag(600)

      expect(await topOf(home.title())).toBeLessThanOrEqual(titleTop + 100)
      await touch.up()
    })

    it('shows the loader in the gap between the header and the Food Log', async () => {
      const touch = await finger(page)
      await touch.down()
      await touch.drag(120)
      await home.loader().waitFor()

      const loader = await box(home.loader())
      const banner = await box(header(page).banner())
      expect(loader.y).toBeGreaterThanOrEqual(banner.y + banner.height)
      expect(loader.y + loader.height).toBeLessThanOrEqual(await topOf(home.title()))
      await touch.up()
    })

    // Phones can swallow the release, e.g. an app opened from the iOS home screen.
    it('reloads when the finger stops past 80 px and its release never arrives', async () => {
      await logFood('Manzana', 95, '2026-10-24T10:58:00')
      const titleTop = await topOf(home.title())

      const touch = await finger(page)
      await touch.down()
      await touch.drag(120)

      await waitForEntry('Manzana')
      await home.loader().waitFor({ state: 'hidden' })
      await expect.poll(() => topOf(home.title()), eventually).toBe(titleTop)
    })

    it('springs back without reloading when the finger stops before 80 px and its release never arrives', async () => {
      await clearReceivedRequests(PROXY_URL, username)
      const titleTop = await topOf(home.title())

      const touch = await finger(page)
      await touch.down()
      await touch.drag(60)

      await expect.poll(() => topOf(home.title()), eventually).toBe(titleTop)
      expect(await home.loader().count()).toBe(0)
      expect(await dailyLogRequests(username)).toEqual([])
    })

    it('shows an error and keeps the entries on screen when the reload fails', async () => {
      await injectFault(PROXY_URL, { status: 500 }, username)

      await pullToRefresh(page)

      await expect.poll(() => home.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
      await home.loader().waitFor({ state: 'hidden' })
      expect(await home.entry('2 tortillas de maíz').isVisible()).toBe(true)
    })

    it('does not start another reload while one is in progress', async () => {
      await clearReceivedRequests(PROXY_URL, username)
      await injectFault(PROXY_URL, { delayMs: 2_000 }, username)

      await pullToRefresh(page)
      await home.loader().waitFor()
      await pullToRefresh(page)

      await home.loader().waitFor({ state: 'hidden', timeout: 10_000 })
      expect(await dailyLogRequests(username)).toHaveLength(1)
    })
  })

  describe('on a mobile device, scrolled down', () => {
    beforeEach(async () => {
      for (let minute = 10; minute < 30; minute++) {
        await logFood(`Snack ${minute}`, 10, `2026-10-24T09:${minute}:00`)
      }
      await open(MOBILE)
      await waitForEntry('Snack 10')
    })

    it('scrolls the page instead of reloading', async () => {
      await page.evaluate(() => window.scrollTo(0, 600))
      const scrolledTo = await page.evaluate(() => window.scrollY)
      expect(scrolledTo).toBeGreaterThan(0)
      await clearReceivedRequests(PROXY_URL, username)

      await pullToRefresh(page, 150)

      await expect
        .poll(() => page.evaluate(() => window.scrollY), eventually)
        .toBeLessThan(scrolledTo)
      await page.waitForTimeout(QUIET_PERIOD_MS)
      expect(await home.loader().count()).toBe(0)
      expect(await dailyLogRequests(username)).toEqual([])
    })
  })

  describe('on desktop', () => {
    beforeEach(async () => {
      await open({ viewport: { width: 1280, height: 800 } })
      await waitForEntry('2 tortillas de maíz')
    })

    it('does not reload when dragging down with the mouse', async () => {
      await clearReceivedRequests(PROXY_URL, username)

      await page.mouse.move(640, 200)
      await page.mouse.down()
      await page.mouse.move(640, 400, { steps: 10 })
      await page.mouse.up()

      await page.waitForTimeout(QUIET_PERIOD_MS)
      expect(await home.loader().count()).toBe(0)
      expect(await dailyLogRequests(username)).toEqual([])
    })
  })
})
