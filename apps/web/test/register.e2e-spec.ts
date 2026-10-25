import {
  ACCESS_TOKEN_TTL_SECONDS,
  GENERIC_ERROR_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '@open-calorie-tracker/shared'
import { type Browser, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import { deleteAllUsers } from './database'
import { clearFault, injectFault } from './fault-proxy'
import { EMPTY } from './fixtures'

const { apiUrl: API_URL, proxyUrl: PROXY_URL, webUrl: WEB_URL } = EMPTY

const USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

describe('Register page (e2e)', () => {
  let browser: Browser
  let page: Page
  let postRequests: string[]
  let testNumber = 0

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  beforeEach(async () => {
    // Every test starts before the account exists.
    await deleteAllUsers(EMPTY)

    // A fresh context per test, so no cookies leak between tests. Each test also gets its own
    // client IP, because the API keeps its failed login counts in memory across tests.
    testNumber++
    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${testNumber}` },
    })
    page = await context.newPage()
    page.setDefaultTimeout(5_000)
    postRequests = []
    page.on('request', (request) => {
      if (request.method() === 'POST') postRequests.push(request.url())
    })
    await page.goto(`${WEB_URL}/register`)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL)
    await page.context().close()
  })

  const usernameField = () => page.getByLabel('Username')
  const passwordField = () => page.getByLabel('Password', { exact: true })
  const confirmPasswordField = () => page.getByLabel('Confirm password')
  const submitButton = () => page.getByRole('button', { name: 'Create account' })

  const fill = async (username: string, password: string, confirmPassword = password) => {
    await usernameField().fill(username)
    await passwordField().fill(password)
    await confirmPasswordField().fill(confirmPassword)
  }

  const submit = async (username: string, password: string, confirmPassword = password) => {
    await fill(username, password, confirmPassword)
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST'),
      submitButton().click(),
    ])
  }

  // Scoped to the form because Next.js renders its own role="alert" route announcer.
  const alert = () => page.getByRole('form', { name: 'Create account' }).getByRole('alert')

  const accessTokenCookie = async () =>
    (await page.context().cookies()).find((cookie) => cookie.name === 'access_token')

  describe('redirects while there is no account', () => {
    it.each(['/', '/login', '/settings'])('sends %s to /register', async (path) => {
      await page.goto(`${WEB_URL}${path}`)

      expect(page.url()).toBe(`${WEB_URL}/register`)
    })

    it('does not redirect API routes', async () => {
      const response = await fetch(`${WEB_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        redirect: 'manual',
      })

      expect(response.status).toBe(400)
    })

    it('does not redirect static files', async () => {
      const response = await fetch(`${WEB_URL}/favicon.ico`, { redirect: 'manual' })

      expect(response.status).toBe(200)
    })
  })

  it('renders the username, password and password confirmation fields', async () => {
    expect(await usernameField().getAttribute('type')).toBe('text')
    expect(await passwordField().getAttribute('type')).toBe('password')
    expect(await passwordField().getAttribute('autocomplete')).toBe('new-password')
    expect(await confirmPasswordField().getAttribute('type')).toBe('password')
    expect(await confirmPasswordField().getAttribute('autocomplete')).toBe('new-password')
    expect(await submitButton().isVisible()).toBe(true)
  })

  it('does not show the Log out button', async () => {
    expect(await page.getByRole('button', { name: 'Log out' }).count()).toBe(0)
  })

  describe('client-side validation', () => {
    it('enables the button only once all three fields are filled in', async () => {
      expect(await submitButton().isDisabled()).toBe(true)

      await fill(USERNAME, PASSWORD)

      expect(await submitButton().isDisabled()).toBe(false)
    })

    it.each([
      ['an empty username', '', PASSWORD, PASSWORD],
      ['an empty password', USERNAME, '', PASSWORD],
      ['an empty password confirmation', USERNAME, PASSWORD, ''],
    ])('keeps the button disabled with %s', async (_case, username, password, confirmPassword) => {
      await fill(username, password, confirmPassword)
      // Enter would submit the form if the disabled button did not block it.
      await confirmPasswordField().press('Enter')

      expect(await submitButton().isDisabled()).toBe(true)
      expect(postRequests).toEqual([])
    })

    it('rejects passwords that do not match without calling the server', async () => {
      await fill(USERNAME, PASSWORD, `${PASSWORD}-typo`)
      await submitButton().click()

      expect(await page.getByText('Passwords do not match').isVisible()).toBe(true)
      expect(postRequests).toEqual([])
    })

    it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters without calling the server`, async () => {
      await fill(USERNAME, 'a'.repeat(PASSWORD_MIN_LENGTH - 1))
      await submitButton().click()

      expect(
        await page
          .getByText(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
          .isVisible(),
      ).toBe(true)
      expect(postRequests).toEqual([])
    })

    it('clears a field error once that field is edited', async () => {
      await fill(USERNAME, PASSWORD, `${PASSWORD}-typo`)
      await submitButton().click()

      await confirmPasswordField().fill(PASSWORD)

      expect(await page.getByText('Passwords do not match').count()).toBe(0)
    })

    it('drops anything but letters and numbers typed into the username', async () => {
      await usernameField().pressSequentially('Ana_1 é-ñ!2')

      expect(await usernameField().inputValue()).toBe('Ana12')
    })

    it('drops anything but letters and numbers pasted into the username', async () => {
      await usernameField().focus()
      await page.keyboard.insertText('josé.peña')

      expect(await usernameField().inputValue()).toBe('jospea')
    })

    it.each([
      ['username', usernameField, USERNAME_MAX_LENGTH],
      ['password', passwordField, PASSWORD_MAX_LENGTH],
      ['password confirmation', confirmPasswordField, PASSWORD_MAX_LENGTH],
    ])('stops typing in the %s at its maximum length', async (_case, field, maxLength) => {
      await field().focus()
      await page.keyboard.insertText('a'.repeat(maxLength))
      await field().press('b')

      expect(await field().inputValue()).toBe('a'.repeat(maxLength))
    })

    it.each([
      ['username', usernameField, USERNAME_MAX_LENGTH],
      ['password', passwordField, PASSWORD_MAX_LENGTH],
      ['password confirmation', confirmPasswordField, PASSWORD_MAX_LENGTH],
    ])(
      'truncates text pasted into the %s to its maximum length',
      async (_case, field, maxLength) => {
        await field().focus()
        await page.keyboard.insertText('a'.repeat(maxLength) + 'b'.repeat(10))

        expect(await field().inputValue()).toBe('a'.repeat(maxLength))
      },
    )
  })

  it('disables the button while the account is being created', async () => {
    // Holds the request so the test can look at the form while it is in flight.
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/register', async (route) => {
      await released
      await route.continue()
    })
    await fill(USERNAME, PASSWORD)

    await submitButton().click()
    await confirmPasswordField().press('Enter')

    expect(await submitButton().isDisabled()).toBe(true)
    expect(postRequests).toHaveLength(1)
    const response = page.waitForResponse('**/api/register')
    release()
    await response
  })

  it('creates the account, stores the session in a secure HTTP-only cookie and redirects home', async () => {
    const registeredAt = Date.now() / 1000

    await submit(USERNAME, PASSWORD)
    await page.waitForURL(`${WEB_URL}/`)

    const cookie = await accessTokenCookie()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
    expect(cookie?.path).toBe('/')
    expect(cookie?.expires).toBeCloseTo(registeredAt + ACCESS_TOKEN_TTL_SECONDS, -1)
    expect(await page.evaluate(() => document.cookie)).not.toContain('access_token')
  })

  it('tells the user when someone else created the account first', async () => {
    await fill(USERNAME, PASSWORD)
    await fetch(`${API_URL}/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: PASSWORD, confirmPassword: PASSWORD }),
    })

    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST'),
      submitButton().click(),
    ])

    expect(await alert().textContent()).toContain('An account already exists')
    expect(await alert().getByRole('link').getAttribute('href')).toBe('/login')
    expect(await accessTokenCookie()).toBeUndefined()
  })

  describe('backend failures', () => {
    it('shows a generic error when the backend responds 500', async () => {
      await injectFault(PROXY_URL, { status: 500 })

      await submit(USERNAME, PASSWORD)

      expect(await alert().textContent()).toBe(GENERIC_ERROR_MESSAGE)
      expect(page.url()).toBe(`${WEB_URL}/register`)
      expect(await accessTokenCookie()).toBeUndefined()
    })

    it('shows a generic error when the backend is unreachable', async () => {
      await injectFault(PROXY_URL, 'connection-reset')

      await submit(USERNAME, PASSWORD)

      expect(await alert().textContent()).toBe(GENERIC_ERROR_MESSAGE)
      expect(page.url()).toBe(`${WEB_URL}/register`)
      expect(await accessTokenCookie()).toBeUndefined()
    })
  })
})
