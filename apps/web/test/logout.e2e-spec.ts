import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Page, type Route, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import {
  TIME_ZONE,
  connectDatabase,
  createUser,
  eventually,
  homePage,
  logIn,
  openHome,
  sessionCookie,
} from './daily-log'
import { clearFault, injectFault } from './fault-proxy'
import { INVALID_TOKENS, SEEDED, SEED_USER } from './fixtures'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const LOGOUT_URL = `${WEB_URL}/api/logout`

describe('Log out (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let home: ReturnType<typeof homePage>

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  beforeEach(async () => {
    context = await browser.newContext({ timezoneId: TIME_ZONE, locale: 'en-US' })
    page = await context.newPage()
    page.setDefaultTimeout(5_000)
    home = homePage(page)
    username = await createUser(database)
    token = await logIn(context, username)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  // The log loads in the browser, so once it shows the page is interactive.
  const openLoadedHome = async () => {
    await openHome(page)
    await expect.poll(() => home.summary('Calories').isVisible(), eventually).toBe(true)
  }

  const logOut = async () => {
    await openLoadedHome()
    await home.logOut().click()
    await page.waitForURL(`${WEB_URL}/login`)
  }

  const loginForm = () => page.getByRole('form', { name: 'Log in' })

  // The cookie the response sets for the session, as lowercase attributes after its value.
  const sessionSetCookie = (response: Response) => {
    const header = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('access_token='))
    if (header === undefined) return undefined
    const [pair = '', ...attributes] = header.split(';').map((part) => part.trim())
    return {
      value: pair.slice('access_token='.length),
      attributes: attributes.map((a) => a.toLowerCase()),
    }
  }

  const postLogout = (cookie?: string) =>
    fetch(LOGOUT_URL, {
      method: 'POST',
      headers: cookie === undefined ? {} : { Cookie: `access_token=${cookie}` },
      redirect: 'manual',
    })

  describe('the button', () => {
    it('shows Log out on the right of the header, in the same row as the logo', async () => {
      await openLoadedHome()

      expect(await home.logOut().textContent()).toBe('Log out')
      const logo = await home.logo().boundingBox()
      const button = await home.logOut().boundingBox()
      if (logo === null || button === null) throw new Error('The logo or the button is hidden')
      expect(button.x).toBeGreaterThan(logo.x + logo.width)
      expect(button.y).toBeLessThan(logo.y + logo.height)
      expect(button.y + button.height).toBeGreaterThan(logo.y)
    })

    it.each([390, 1280])('shows Log out in a %i px wide window', async (width) => {
      await page.setViewportSize({ width, height: 844 })

      await openLoadedHome()

      expect(await home.logOut().isVisible()).toBe(true)
      const button = await home.logOut().boundingBox()
      expect((button?.x ?? Number.NaN) + (button?.width ?? 0)).toBeLessThanOrEqual(width)
    })
  })

  describe('logging out', () => {
    it('deletes the session cookie and shows the login form', async () => {
      await logOut()

      expect(await sessionCookie(context)).toBeUndefined()
      expect(await loginForm().isVisible()).toBe(true)
    })

    it('sends / to /login afterwards', async () => {
      await logOut()

      await page.goto(`${WEB_URL}/`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    })

    it('does not bring the Food Log back with the Back button', async () => {
      await logOut()

      await page.goBack()

      expect(page.url()).not.toBe(`${WEB_URL}/`)
      expect(await home.title().isVisible()).toBe(false)
    })

    it('lets the user log in again', async () => {
      await logOut()

      await page.getByLabel('Username').fill(username)
      await page.getByLabel('Password').fill(SEED_USER.password)
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.waitForURL(`${WEB_URL}/`)

      await expect.poll(() => home.summary('Calories').isVisible(), eventually).toBe(true)
    })

    it('disables the button while logging out, so a double click sends one request', async () => {
      let requests = 0
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(LOGOUT_URL, async (route) => {
        requests += 1
        await released
        await route.continue()
      })
      await openLoadedHome()

      await home.logOut().dblclick()

      expect(await home.logOut().isDisabled()).toBe(true)
      release()
      await page.waitForURL(`${WEB_URL}/login`)
      expect(requests).toBe(1)
    })
  })

  describe('the /api/logout route', () => {
    it('answers 204 and deletes the session cookie', async () => {
      const response = await postLogout(token)

      expect(response.status).toBe(204)
      const cookie = sessionSetCookie(response)
      expect(cookie?.value).toBe('')
      expect(cookie?.attributes).toEqual(
        expect.arrayContaining(['max-age=0', 'path=/', 'httponly', 'secure', 'samesite=strict']),
      )
    })

    it('answers 204 without a session cookie', async () => {
      const response = await postLogout()

      expect(response.status).toBe(204)
    })

    it.each(INVALID_TOKENS)('answers 204 when the session token %s', async (_case, invalid) => {
      const response = await postLogout(await invalid())

      expect(response.status).toBe(204)
    })

    it('answers 405 to GET and keeps the session cookie', async () => {
      const response = await fetch(LOGOUT_URL, {
        headers: { Cookie: `access_token=${token}` },
        redirect: 'manual',
      })

      expect(response.status).toBe(405)
      expect(sessionSetCookie(response)).toBeUndefined()
    })
  })

  describe('failures', () => {
    it.each([
      ['fails with a network error', (route: Route) => route.abort()],
      ['answers 500', (route: Route) => route.fulfill({ status: 500 })],
    ])('stays on the Food Log when the request %s', async (_case, fail) => {
      await page.route(LOGOUT_URL, fail)
      await openLoadedHome()

      await home.logOut().click()

      await expect
        .poll(
          () => page.getByRole('alert').filter({ hasText: GENERIC_ERROR_MESSAGE }).count(),
          eventually,
        )
        .toBe(1)
      expect(page.url()).toBe(`${WEB_URL}/`)
      expect(await home.summary('Calories').isVisible()).toBe(true)
      expect(await home.logOut().isEnabled()).toBe(true)
      expect(await sessionCookie(context)).toBeDefined()
    })

    it('logs out while the API is down', async () => {
      await openLoadedHome()
      await injectFault(PROXY_URL, 'connection-reset', username)

      await home.logOut().click()
      await page.waitForURL(`${WEB_URL}/login`)

      expect(await sessionCookie(context)).toBeUndefined()
    })
  })
})
