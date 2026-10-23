import { type Browser, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { clearFault, injectFault } from './fault-proxy'
import { PROXY_URL, SEED_USER, WEB_URL } from './fixtures'

const USERNAME_MAX_LENGTH = 32
const PASSWORD_MAX_LENGTH = 128
const MAX_FAILED_ATTEMPTS = 5
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

const GENERIC_ERROR = 'Something went wrong. Please try again later.'

describe('Login page (e2e)', () => {
  let browser: Browser
  let page: Page
  let postRequests: string[]

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
    postRequests = []
    page.on('request', (request) => {
      if (request.method() === 'POST') postRequests.push(request.url())
    })
    await page.goto(`${WEB_URL}/login`)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL)
    await page.context().close()
  })

  const usernameField = () => page.getByLabel('Username')
  const passwordField = () => page.getByLabel('Password')
  const submitButton = () => page.getByRole('button', { name: 'Log in' })

  const fill = async (username: string, password: string) => {
    await usernameField().fill(username)
    await passwordField().fill(password)
  }

  const submit = async (username: string, password: string) => {
    await fill(username, password)
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST'),
      submitButton().click(),
    ])
  }

  const alertText = () => page.getByRole('alert').textContent()

  const accessTokenCookie = async () =>
    (await page.context().cookies()).find((cookie) => cookie.name === 'access_token')

  it('renders the username and password fields', async () => {
    expect(await usernameField().getAttribute('type')).toBe('text')
    expect(await passwordField().getAttribute('type')).toBe('password')
    expect(await submitButton().isVisible()).toBe(true)
  })

  describe('client-side validation', () => {
    it.each([
      ['an empty username', '', SEED_USER.password, 'Username is required'],
      ['an empty password', SEED_USER.username, '', 'Password is required'],
      [
        `a username longer than ${USERNAME_MAX_LENGTH} characters`,
        'a'.repeat(USERNAME_MAX_LENGTH + 1),
        SEED_USER.password,
        `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
      ],
      [
        `a password longer than ${PASSWORD_MAX_LENGTH} characters`,
        SEED_USER.username,
        'a'.repeat(PASSWORD_MAX_LENGTH + 1),
        `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      ],
    ])('rejects %s without calling the server', async (_case, username, password, message) => {
      await fill(username, password)
      await submitButton().click()

      expect(await page.getByText(message).isVisible()).toBe(true)
      expect(postRequests).toEqual([])
    })
  })

  it('logs in, stores the session in a secure HTTP-only cookie and redirects home', async () => {
    const loggedInAt = Date.now() / 1000

    await submit(SEED_USER.username, SEED_USER.password)
    await page.waitForURL(`${WEB_URL}/`)

    const cookie = await accessTokenCookie()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
    expect(cookie?.path).toBe('/')
    expect(cookie?.expires).toBeCloseTo(loggedInAt + ACCESS_TOKEN_TTL_SECONDS, -1)
    expect(await page.evaluate(() => document.cookie)).not.toContain('access_token')
  })

  it('shows an error and sets no cookie when the credentials are wrong', async () => {
    await submit(SEED_USER.username, 'wrong-password')

    expect(await alertText()).toBe('Invalid username or password')
    expect(page.url()).toBe(`${WEB_URL}/login`)
    expect(await accessTokenCookie()).toBeUndefined()
  })

  it('tells the user when the account gets locked', async () => {
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      await submit('locked-user', 'wrong-password')
    }

    expect(await alertText()).toBe(
      'Your account has been locked after too many failed login attempts. Please try again later.',
    )
    expect(await accessTokenCookie()).toBeUndefined()
  })

  describe('backend failures', () => {
    it('shows a generic error when the backend responds 500', async () => {
      await injectFault(PROXY_URL, { status: 500 })

      await submit(SEED_USER.username, SEED_USER.password)

      expect(await alertText()).toBe(GENERIC_ERROR)
      expect(page.url()).toBe(`${WEB_URL}/login`)
      expect(await accessTokenCookie()).toBeUndefined()
    })

    it('shows a generic error when the backend is unreachable', async () => {
      await injectFault(PROXY_URL, 'connection-reset')

      await submit(SEED_USER.username, SEED_USER.password)

      expect(await alertText()).toBe(GENERIC_ERROR)
      expect(page.url()).toBe(`${WEB_URL}/login`)
      expect(await accessTokenCookie()).toBeUndefined()
    })
  })
})
