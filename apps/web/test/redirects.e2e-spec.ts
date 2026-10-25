import { type Browser, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { INVALID_TOKENS, SEEDED, SEED_USER, signAccessToken } from './fixtures'

const { apiUrl: API_URL, webUrl: WEB_URL } = SEEDED

describe('Redirects once the account exists (e2e)', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  beforeEach(async () => {
    // A fresh context per test, so no cookies leak between tests.
    page = await (await browser.newContext()).newPage()
    page.setDefaultTimeout(5_000)
  })

  afterEach(async () => {
    await page.context().close()
  })

  const setAccessToken = (value: string) =>
    page.context().addCookies([{ name: 'access_token', value, url: WEB_URL }])

  const loginThroughApi = async () => {
    const response = await fetch(`${API_URL}/v1/login`, {
      method: 'POST',
      // Its own client IP, so failed logins in other test files can never lock it out.
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.1' },
      body: JSON.stringify(SEED_USER),
    })
    return ((await response.json()) as { accessToken: string }).accessToken
  }

  it('sends /register to /login', async () => {
    await page.goto(`${WEB_URL}/register`)

    expect(page.url()).toBe(`${WEB_URL}/login`)
  })

  describe('without a session', () => {
    it.each(['/', '/settings'])('sends %s to /login', async (path) => {
      await page.goto(`${WEB_URL}${path}`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    })

    it('sends / to /login when the session cookie is not a valid token', async () => {
      await setAccessToken('not-a-token')

      await page.goto(`${WEB_URL}/`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    })

    it('sends / to /login when the session token has expired', async () => {
      await setAccessToken(await signAccessToken(Math.floor(Date.now() / 1000) - 60))

      await page.goto(`${WEB_URL}/`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    })
  })

  it.each(INVALID_TOKENS)(
    'shows the login form when the session token %s',
    async (_case, token) => {
      await setAccessToken(await token())

      await page.goto(`${WEB_URL}/login`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
      expect(await page.getByRole('form', { name: 'Log in' }).isVisible()).toBe(true)
    },
  )

  it.each(INVALID_TOKENS)(
    'sends /register to /login when the session token %s',
    async (_case, token) => {
      await setAccessToken(await token())

      await page.goto(`${WEB_URL}/register`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    },
  )

  describe('with a session', () => {
    beforeEach(async () => {
      await setAccessToken(await loginThroughApi())
    })

    it('lets the user stay on /', async () => {
      await page.goto(`${WEB_URL}/`)

      expect(page.url()).toBe(`${WEB_URL}/`)
    })

    it.each(['/login', '/register'])('sends %s straight to /', async (path) => {
      const visited: string[] = []
      page.on('request', (request) => {
        if (request.isNavigationRequest()) visited.push(request.url())
      })

      await page.goto(`${WEB_URL}${path}`)

      expect(visited).toEqual([`${WEB_URL}${path}`, `${WEB_URL}/`])
    })
  })
})
