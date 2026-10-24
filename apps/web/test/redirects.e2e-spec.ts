import { SignJWT } from 'jose'
import { type Browser, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { JWT, SEEDED, SEED_USER } from './fixtures'

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

  const signToken = (expiresAt: number) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT.issuer)
      .setAudience(JWT.audience)
      .setSubject('1')
      .setIssuedAt(expiresAt - 60)
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(JWT.secret))

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
      await setAccessToken(await signToken(Math.floor(Date.now() / 1000) - 60))

      await page.goto(`${WEB_URL}/`)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    })
  })

  it('lets a logged-in user stay on /', async () => {
    await setAccessToken(await loginThroughApi())

    await page.goto(`${WEB_URL}/`)

    expect(page.url()).toBe(`${WEB_URL}/`)
  })
})
