import {
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_NAME_TAKEN_ERROR,
  type ApiKey,
  type ApiKeyExpiresIn,
  GENERIC_ERROR_MESSAGE,
} from '@open-calorie-tracker/shared'
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  chromium,
} from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { seedApiKey } from '../../api/src/db/seed'
import { MOBILE, TIME_ZONE, box, eventually, sameRow, textOf } from './browser'
import { deleteApiKey } from './database'
import { type Fault, clearFault, injectFault, receivedRequests } from './fault-proxy'
import { API_KEY_SECRET, SEEDED, signAccessToken } from './fixtures'
import { connectDatabase, createUser, setSessionCookie, signedInPage } from './session'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const SETTINGS_URL = `${WEB_URL}/settings`

const API_KEYS_URL = `${WEB_URL}/api/api-keys`

// "Now" in the browser: Monday 2026-10-26, 10:00 AM in New York (UTC-4 on that day).
const NOW = new Date('2026-10-26T10:00:00-04:00')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (ms: number) => new Date(NOW.getTime() - ms)

const API_FAILURES: [string, Fault][] = [
  ['answers 500', { status: 500 }],
  ['is unreachable', 'connection-reset'],
]

const CLIPBOARD: BrowserContextOptions = { permissions: ['clipboard-read', 'clipboard-write'] }

const expiredToken = () => signAccessToken(Math.floor(Date.now() / 1000) - 60)

// How the page shows a date, e.g. "Jan 24, 2027".
const dateLabel = (instant: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(instant)

// "oct_live_" + the first 4 and the last 4 characters of the random part.
const previewOf = (key: string) => {
  const random = key.slice('oct_live_'.length)
  return `oct_live_${random.slice(0, 4)}…${random.slice(-4)}`
}

const apiKeysSection = (page: Page) => {
  const section = page.getByRole('region', { name: 'API keys', exact: true })
  const list = section.getByRole('list', { name: 'API keys' })
  const item = (name: string) => list.getByRole('listitem').filter({ hasText: name })
  const createDialog = page.getByRole('dialog', { name: 'Create API key' })
  const createdDialog = page.getByRole('dialog', { name: 'Key created' })
  const revokeDialog = page.getByRole('alertdialog', { name: 'Revoke this key?' })
  return {
    section: () => section,
    heading: () => section.getByRole('heading', { level: 2, name: 'API keys' }),
    create: () => section.getByRole('button', { name: 'Create API key' }),
    // The section's Alert, apart from the role="alert" route announcer Next.js renders.
    alert: () => section.getByRole('alert'),
    empty: () => section.getByText('No API keys yet'),
    footnote: () =>
      section.getByText(
        'Copy puts the full key on your clipboard. Anyone with a key can use your account: revoke it if it leaks.',
      ),
    list: () => list,
    items: () => list.getByRole('listitem'),
    item,
    button: (name: string, label: string) =>
      item(name).getByRole('button', { name: label, exact: true }),
    createDialog: () => createDialog,
    nameField: () => createDialog.getByRole('textbox', { name: 'Name' }),
    expiry: (choice: string) =>
      createDialog
        .getByRole('radiogroup', { name: 'Expires' })
        .getByRole('radio', { name: choice, exact: true }),
    expiryChoices: () =>
      createDialog.getByRole('radiogroup', { name: 'Expires' }).getByRole('radio'),
    createKey: () => createDialog.getByRole('button', { name: 'Create key', exact: true }),
    createdDialog: () => createdDialog,
    createdKey: () => createdDialog.getByRole('textbox', { name: 'Your API key' }),
    revokeDialog: () => revokeDialog,
    dialogButton: (dialog: Locator, name: string) =>
      dialog.getByRole('button', { name, exact: true }),
  }
}

describe('API keys (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let keys: ReturnType<typeof apiKeysSection>
  // The page's requests to the API keys routes, e.g. "POST /api/api-keys".
  let keyRequests: string[]

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  // A fresh page with a new user, who can use the clipboard unless the test takes it away.
  const startAs = async (options: BrowserContextOptions = {}) => {
    ;({ context, page, username, token } = await signedInPage(browser, database, {
      ...CLIPBOARD,
      ...options,
    }))
    keys = apiKeysSection(page)
    keyRequests = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/api-keys')) keyRequests.push(`${request.method()} ${pathname}`)
    })
  }

  beforeEach(async () => {
    await startAs()
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  const seedKey = (
    entry: {
      name: string
      expiresIn?: ApiKeyExpiresIn
      createdAt?: Date
      lastUsedAt?: Date | null
    },
    owner = username,
  ) => seedApiKey(database, { username: owner, expiresIn: '90d', ...entry }, API_KEY_SECRET)

  // Seeds a key that expires at the given instant.
  const seedKeyExpiringAt = (name: string, expiresAt: Date) =>
    seedKey({ name, expiresIn: '30d', createdAt: new Date(expiresAt.getTime() - 30 * DAY) })

  const HOME_ASSISTANT = {
    name: 'Home Assistant',
    expiresIn: 'never',
    createdAt: new Date('2026-08-03T12:00:00-04:00'),
    lastUsedAt: ago(2 * HOUR),
  } as const

  // Opens Settings and waits for the keys to load. With the browser clock fixed at NOW unless the
  // test needs the real one, e.g. to show keys the page creates, which get the API's real time.
  const openKeys = async ({ fixedClock = true } = {}) => {
    if (fixedClock) await page.clock.setFixedTime(NOW)
    await page.goto(SETTINGS_URL)
    await expect.poll(() => keys.create().isEnabled(), eventually).toBe(true)
  }

  const openCreateDialog = async (options?: { fixedClock?: boolean }) => {
    await openKeys(options)
    await keys.create().click()
    await expect.poll(() => keys.createDialog().isVisible(), eventually).toBe(true)
  }

  // Creates a key through the page and waits for the Key created dialog. Uses the real clock.
  const createKey = async (name: string, expiry = '90 days') => {
    await openCreateDialog({ fixedClock: false })
    await keys.nameField().fill(name)
    await keys.expiry(expiry).click()
    await keys.createKey().click()
    await expect.poll(() => keys.createdDialog().isVisible(), eventually).toBe(true)
  }

  const openRevokeDialog = async (name = 'Home Assistant') => {
    await openKeys()
    await keys.button(name, 'Revoke').click()
    await expect.poll(() => keys.revokeDialog().isVisible(), eventually).toBe(true)
  }

  const isHidden = (locator: Locator) => async () => !(await locator.isVisible())

  // Which of the given names each listed key starts with, in the order they are listed.
  const itemNames = async (...names: string[]) =>
    (await keys.items().allInnerTexts()).map((text) => {
      const normalized = text.replaceAll(/\s+/g, ' ').trim()
      return names.find((name) => normalized.startsWith(name)) ?? normalized
    })

  const itemText = (name: string) => textOf(keys.item(name))

  const clipboard = () => page.evaluate(() => navigator.clipboard.readText())

  // The keys as the web API answers them to this user.
  const storedKeys = async () => {
    const response = await fetch(API_KEYS_URL, { headers: { Cookie: `access_token=${token}` } })
    expect(response.status).toBe(200)
    return (await response.json()) as ApiKey[]
  }

  const requestsTo = (method: string) =>
    keyRequests.filter((request) => request.startsWith(`${method} `))

  // Holds the page's requests with this method to the API keys routes until released.
  const holdRequests = async (method: string) => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/api-keys**', async (route) => {
      if (route.request().method() === method) await released
      await route.continue()
    })
    return release
  }

  const isFocused = (locator: Locator) =>
    locator.evaluate((element) => element === document.activeElement)

  describe('the section', () => {
    it('lists each key with its preview, dates and buttons, none marked "New"', async () => {
      const homeAssistant = await seedKey(HOME_ASSISTANT)
      await seedKey({ name: 'Old import script', createdAt: new Date('2026-07-03T10:00:00-04:00') })

      await openKeys()

      expect(await itemText('Home Assistant')).toContain(
        `Home Assistant ${homeAssistant.preview} Created Aug 3, 2026 · Last used 2 hours ago · Never expires`,
      )
      expect(await keys.button('Home Assistant', 'Copy').isVisible()).toBe(true)
      expect(await keys.button('Home Assistant', 'Revoke').isVisible()).toBe(true)
      expect(await keys.section().getByText('New', { exact: true }).count()).toBe(0)
    })

    it('marks an expired key and offers only Delete for it', async () => {
      const old = await seedKey({
        name: 'Old import script',
        createdAt: new Date('2026-07-03T10:00:00-04:00'),
      })

      await openKeys()

      expect(await itemText('Old import script')).toContain(
        `Old import script Expired ${old.preview} Created Jul 3, 2026 · Expired Oct 1, 2026`,
      )
      expect(await keys.item('Old import script').getByRole('button').allInnerTexts()).toEqual([
        'Delete',
      ])
    })

    it('lists the newest key first', async () => {
      await seedKey({ name: 'A', createdAt: new Date('2026-06-01T12:00:00-04:00') })
      await seedKey({ name: 'C', createdAt: new Date('2026-10-26T08:00:00-04:00') })
      await seedKey({ name: 'B', createdAt: new Date('2026-08-03T12:00:00-04:00') })

      await openKeys()

      expect(await itemNames('A', 'B', 'C')).toEqual(['C', 'B', 'A'])
    })

    it('puts Create API key right of the title and the footnote under the list', async () => {
      await page.setViewportSize({ width: 1280, height: 844 })
      await seedKey(HOME_ASSISTANT)

      await openKeys()

      const heading = await box(keys.heading())
      expect((await box(keys.create())).x).toBeGreaterThan(heading.x + heading.width)
      expect(await sameRow(keys.heading(), keys.create())).toBe(true)
      const list = await box(keys.list())
      expect((await box(keys.footnote())).y).toBeGreaterThanOrEqual(list.y + list.height)
      expect(await keys.empty().isVisible()).toBe(false)
    })

    it.each([
      ['created', { createdAt: new Date('2026-10-26T00:30:00-04:00') }, 'Created today'],
      ['created', { createdAt: new Date('2026-10-25T23:30:00-04:00') }, 'Created Oct 25, 2026'],
      ['last used', { lastUsedAt: null }, 'Never used'],
      ['last used', { lastUsedAt: ago(30_000) }, 'Last used just now'],
      ['last used', { lastUsedAt: ago(MINUTE) }, 'Last used 1 minute ago'],
      ['last used', { lastUsedAt: ago(45 * MINUTE) }, 'Last used 45 minutes ago'],
      ['last used', { lastUsedAt: ago(HOUR) }, 'Last used 1 hour ago'],
      ['last used', { lastUsedAt: ago(2 * HOUR) }, 'Last used 2 hours ago'],
      ['last used', { lastUsedAt: new Date('2026-10-26T00:30:00-04:00') }, 'Last used 9 hours ago'],
      ['last used', { lastUsedAt: new Date('2026-10-25T09:00:00-04:00') }, 'Last used yesterday'],
      [
        'last used',
        { lastUsedAt: new Date('2026-10-24T23:00:00-04:00') },
        'Last used Oct 24, 2026',
      ],
      ['expiry', { expiresIn: 'never' }, 'Never expires'],
      [
        'expiry',
        { expiresIn: '90d', createdAt: new Date('2026-10-26T10:00:00-04:00') },
        'Expires Jan 24, 2027',
      ],
      [
        'expiry',
        { expiresIn: '90d', createdAt: new Date('2026-07-03T10:00:00-04:00') },
        'Expired Oct 1, 2026',
      ],
    ] as const)('shows the %s date as %j', async (_field, dates, text) => {
      await seedKey({
        name: 'Home Assistant',
        expiresIn: 'never',
        createdAt: ago(DAY * 30),
        ...dates,
      })

      await openKeys()

      expect(await itemText('Home Assistant')).toContain(text)
    })

    it('treats a key as expired from its exact expiry instant', async () => {
      await seedKeyExpiringAt('Home Assistant', new Date(NOW.getTime() + 1000))

      await openKeys()

      expect(await keys.button('Home Assistant', 'Copy').isVisible()).toBe(true)
      expect(await keys.button('Home Assistant', 'Revoke').isVisible()).toBe(true)

      await page.clock.setFixedTime(new Date(NOW.getTime() + 2000))
      await page.reload()

      await expect
        .poll(() => keys.button('Home Assistant', 'Delete').isVisible(), eventually)
        .toBe(true)
      expect(await itemText('Home Assistant')).toContain('Expired')
      expect(await keys.item('Home Assistant').getByRole('button').count()).toBe(1)
    })

    it('disables Create API key and shows no empty state while the keys load', async () => {
      await injectFault(PROXY_URL, { delayMs: 3_000 }, username)

      await page.goto(SETTINGS_URL)

      await expect.poll(() => keys.create().isVisible(), eventually).toBe(true)
      expect(await keys.create().isDisabled()).toBe(true)
      expect(await keys.empty().isVisible()).toBe(false)
    })

    it.each(API_FAILURES)(
      'shows the generic error and disables Create API key when the API %s',
      async (_case, fault) => {
        await injectFault(PROXY_URL, fault, username)

        await page.goto(SETTINGS_URL)

        await expect.poll(() => keys.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
        expect(await keys.create().isDisabled()).toBe(true)
        expect(await keys.empty().isVisible()).toBe(false)
      },
    )

    it('keeps the daily goals working when only the keys fail to load', async () => {
      await page.route(API_KEYS_URL, (route) => route.fulfill({ status: 502 }))

      await page.goto(SETTINGS_URL)

      await expect.poll(() => keys.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
      await expect
        .poll(
          () =>
            page
              .getByRole('form', { name: 'Daily goals' })
              .getByRole('textbox', { name: 'Calories', exact: true })
              .isEnabled(),
          eventually,
        )
        .toBe(true)
    })

    it('goes to the login page when the session expired before the keys load', async () => {
      await page.route(API_KEYS_URL, async (route) => {
        await setSessionCookie(context, await expiredToken())
        await route.fulfill({ status: 401 })
      })

      await page.goto(SETTINGS_URL)

      await page.waitForURL(`${WEB_URL}/login`)
    })

    it("shows no other user's keys", async () => {
      await seedKey({ name: "Ana's script" }, await createUser(database))

      await openKeys()

      expect(await keys.empty().isVisible()).toBe(true)
      expect(await page.getByText("Ana's script").count()).toBe(0)
    })
  })

  describe('creating a key', () => {
    it('opens the Create API key dialog with the name empty and 90 days chosen', async () => {
      await openCreateDialog()

      expect(await textOf(keys.createDialog())).toContain(
        'A key acts as you: it can read and change your log.',
      )
      expect(await keys.nameField().inputValue()).toBe('')
      expect(await isFocused(keys.nameField())).toBe(true)
      expect(await textOf(keys.createDialog())).toContain(
        `So you can tell your keys apart. Up to ${API_KEY_NAME_MAX_LENGTH} characters.`,
      )
      expect(await keys.expiryChoices().allInnerTexts()).toEqual([
        '30 days',
        '90 days',
        '1 year',
        'Never',
      ])
      expect(await keys.expiry('90 days').isChecked()).toBe(true)
      expect(await textOf(keys.createDialog())).toContain('Expires on Jan 24, 2027.')
      expect(await keys.createKey().isDisabled()).toBe(true)
    })

    it.each([
      ['30 days', 'Expires on Nov 25, 2026.'],
      ['90 days', 'Expires on Jan 24, 2027.'],
      ['1 year', 'Expires on Oct 26, 2027.'],
      ['Never', 'This key never expires.'],
    ])('says when a key that expires in %s expires', async (choice, text) => {
      await openCreateDialog()

      await keys.expiry(choice).click()

      expect(await keys.expiry(choice).isChecked()).toBe(true)
      expect(await textOf(keys.createDialog())).toContain(text)
    })

    it.each(['typed', 'pasted'])(
      `keeps only the first ${API_KEY_NAME_MAX_LENGTH} characters of a longer name %s`,
      async (action) => {
        const name = 'abcdefghij'.repeat(6)
        await openCreateDialog()
        await keys.nameField().focus()

        if (action === 'typed') await keys.nameField().pressSequentially(name)
        else await page.keyboard.insertText(name)

        expect(await keys.nameField().inputValue()).toBe(name.slice(0, API_KEY_NAME_MAX_LENGTH))
      },
    )

    it.each([
      ['an empty name', '', false],
      ['a name of spaces only', '   ', false],
      ['a name', 'Shortcuts on iPhone', true],
    ])('enables Create key only with a name: %s', async (_case, name, enabled) => {
      await openCreateDialog()

      await keys.nameField().fill(name)

      expect(await keys.createKey().isEnabled()).toBe(enabled)
    })

    it('creates the key with the name trimmed and the expiry chosen', async () => {
      await createKey('  Shortcuts on iPhone  ')

      const [stored] = await storedKeys()
      expect(stored?.name).toBe('Shortcuts on iPhone')
      expect(Date.parse(stored?.expiresAt ?? '') - Date.parse(stored?.createdAt ?? '')).toBe(
        90 * DAY,
      )
      expect(requestsTo('POST')).toHaveLength(1)
    })

    it.each(['Home Assistant', 'home assistant', '  Home Assistant '])(
      'rejects %j while typing when the user has a key named "Home Assistant"',
      async (name) => {
        await seedKey(HOME_ASSISTANT)
        await openCreateDialog()

        await keys.nameField().fill(name)

        const error = keys.createDialog().getByText(API_KEY_NAME_TAKEN_ERROR)
        expect(await error.isVisible()).toBe(true)
        expect((await box(error)).y).toBeGreaterThan((await box(keys.nameField())).y)
        expect(await keys.nameField().getAttribute('aria-invalid')).toBe('true')
        expect(await keys.createKey().isDisabled()).toBe(true)
      },
    )

    it('rejects the name of an expired key until it is deleted', async () => {
      await seedKey({ name: 'Old import script', createdAt: new Date('2026-07-03T10:00:00-04:00') })
      await openCreateDialog()

      await keys.nameField().fill('Old import script')

      expect(await keys.createDialog().getByText(API_KEY_NAME_TAKEN_ERROR).isVisible()).toBe(true)
    })

    it('shows the error under the name when another tab took it meanwhile', async () => {
      await openCreateDialog()
      await keys.nameField().fill('Shortcuts')
      await seedKey({ name: 'Shortcuts' })

      await keys.createKey().click()

      await expect
        .poll(() => keys.createDialog().getByText(API_KEY_NAME_TAKEN_ERROR).isVisible(), eventually)
        .toBe(true)
      expect(await keys.createDialog().isVisible()).toBe(true)
      expect(await keys.createdDialog().isVisible()).toBe(false)
    })

    it.each([
      ['clicking Cancel', () => keys.dialogButton(keys.createDialog(), 'Cancel').click()],
      ['clicking Close', () => keys.dialogButton(keys.createDialog(), 'Close').click()],
      ['pressing Escape', () => page.keyboard.press('Escape')],
      ['clicking outside the dialog', () => page.mouse.click(10, 10)],
    ])('closes without creating anything when %s, and opens clean again', async (_case, close) => {
      await openCreateDialog()
      await keys.nameField().fill('Shortcuts on iPhone')
      await keys.expiry('Never').click()

      await close()

      await expect.poll(isHidden(keys.createDialog()), eventually).toBe(true)
      expect(requestsTo('POST')).toEqual([])
      await keys.create().click()
      expect(await keys.nameField().inputValue()).toBe('')
      expect(await keys.expiry('90 days').isChecked()).toBe(true)
    })

    it('disables the whole dialog and keeps it open while the key is created', async () => {
      await openCreateDialog({ fixedClock: false })
      await keys.nameField().fill('Shortcuts on iPhone')
      const release = await holdRequests('POST')

      await keys.createKey().dblclick()

      for (const control of [
        ...(await keys.createDialog().getByRole('button').all()),
        ...(await keys.expiryChoices().all()),
        keys.nameField(),
      ]) {
        expect(await control.isDisabled()).toBe(true)
      }
      await page.keyboard.press('Escape')
      await page.mouse.click(10, 10)
      expect(await keys.createDialog().isVisible()).toBe(true)
      release()
      await expect.poll(() => keys.createdDialog().isVisible(), eventually).toBe(true)
      expect(requestsTo('POST')).toHaveLength(1)
    })

    it.each(API_FAILURES)(
      'keeps the dialog open with what was entered when the API %s, and retries',
      async (_case, fault) => {
        await openCreateDialog({ fixedClock: false })
        await keys.nameField().fill('Shortcuts on iPhone')
        await keys.expiry('1 year').click()
        await injectFault(PROXY_URL, fault, username)

        await keys.createKey().click()

        await expect
          .poll(() => keys.createDialog().getByRole('alert').textContent(), eventually)
          .toBe(GENERIC_ERROR_MESSAGE)
        expect(await keys.nameField().inputValue()).toBe('Shortcuts on iPhone')
        expect(await keys.expiry('1 year').isChecked()).toBe(true)
        expect(await keys.createKey().isEnabled()).toBe(true)

        await clearFault(PROXY_URL, username)
        await keys.createKey().click()

        await expect.poll(() => keys.createdDialog().isVisible(), eventually).toBe(true)
      },
    )

    it('goes to the login page when the session expired before creating', async () => {
      await openCreateDialog()
      await keys.nameField().fill('Shortcuts on iPhone')
      await setSessionCookie(context, await expiredToken())

      await keys.createKey().click()

      await page.waitForURL(`${WEB_URL}/login`)
    })
  })

  describe('the created key', () => {
    it('shows the full key, how to send it and when it expires', async () => {
      await createKey('Shortcuts on iPhone')

      const key = await keys.createdKey().inputValue()
      expect(key).toMatch(/^oct_live_[A-Za-z0-9]{32}$/)
      const [stored] = await storedKeys()
      expect(stored?.key).toBe(key)
      const text = await textOf(keys.createdDialog())
      expect(text).toContain(
        `Shortcuts on iPhone · expires ${dateLabel(new Date(stored?.expiresAt ?? ''))}`,
      )
      expect(text).toContain(
        'You can copy it again anytime from Settings › API keys. Keep it private: it works like your password.',
      )
      expect(text).toContain('Send it in the Authorization header:')
      expect(text).toContain(`Authorization: Bearer ${previewOf(key)}`)
      expect(await keys.dialogButton(keys.createdDialog(), 'Copy').isVisible()).toBe(true)
      expect(await keys.dialogButton(keys.createdDialog(), 'Done').isVisible()).toBe(true)
    })

    it('says a key created with Never never expires', async () => {
      await createKey('Home Assistant', 'Never')

      expect(await textOf(keys.createdDialog())).toContain('Home Assistant · never expires')
    })

    it('copies the full key from the dialog', async () => {
      await createKey('Shortcuts on iPhone')

      await keys.dialogButton(keys.createdDialog(), 'Copy').click()

      await expect
        .poll(() => keys.dialogButton(keys.createdDialog(), 'Copied').isVisible(), eventually)
        .toBe(true)
      expect(await clipboard()).toBe(await keys.createdKey().inputValue())
    })

    it('lists the new key first, marked "New", once Done is clicked', async () => {
      await seedKey({ ...HOME_ASSISTANT, createdAt: ago(DAY) })
      await createKey('Shortcuts on iPhone')
      const [stored] = await storedKeys()

      await keys.dialogButton(keys.createdDialog(), 'Done').click()

      await expect.poll(isHidden(keys.createdDialog()), eventually).toBe(true)
      expect(await itemNames('Shortcuts on iPhone', 'Home Assistant')).toEqual([
        'Shortcuts on iPhone',
        'Home Assistant',
      ])
      expect(await itemText('Shortcuts on iPhone')).toContain(
        `Shortcuts on iPhone New ${stored?.preview} Created today · Never used · Expires ${dateLabel(new Date(stored?.expiresAt ?? ''))}`,
      )
      expect(await keys.item('Home Assistant').getByText('New', { exact: true }).count()).toBe(0)
    })

    it('drops the "New" mark once the page reloads', async () => {
      await createKey('Shortcuts on iPhone')
      await keys.dialogButton(keys.createdDialog(), 'Done').click()

      await openKeys({ fixedClock: false })

      expect(await keys.item('Shortcuts on iPhone').isVisible()).toBe(true)
      expect(await keys.section().getByText('New', { exact: true }).count()).toBe(0)
    })

    it.each([
      ['pressing Escape', () => page.keyboard.press('Escape')],
      ['clicking outside the dialog', () => page.mouse.click(10, 10)],
    ])('closes like Done when %s', async (_case, close) => {
      await createKey('Shortcuts on iPhone')

      await close()

      await expect.poll(isHidden(keys.createdDialog()), eventually).toBe(true)
      expect(await itemText('Shortcuts on iPhone')).toContain('New')
    })
  })

  describe('copying a key', () => {
    it('puts the full key on the clipboard and marks only its button "Copied"', async () => {
      const homeAssistant = await seedKey(HOME_ASSISTANT)
      await seedKey({ name: 'Shortcuts on iPhone' })
      await openKeys()

      await keys.button('Home Assistant', 'Copy').click()

      await expect
        .poll(() => keys.button('Home Assistant', 'Copied').isVisible(), eventually)
        .toBe(true)
      expect(await clipboard()).toBe(homeAssistant.key)
      expect(await keys.button('Shortcuts on iPhone', 'Copy').isVisible()).toBe(true)
    })

    it('goes back to "Copy" 2 seconds later', async () => {
      await seedKey(HOME_ASSISTANT)
      await openKeys()

      await keys.button('Home Assistant', 'Copy').click()

      await expect
        .poll(() => keys.button('Home Assistant', 'Copied').isVisible(), eventually)
        .toBe(true)
      await page.waitForTimeout(1_500)
      expect(await keys.button('Home Assistant', 'Copied').isVisible()).toBe(true)
      await expect
        .poll(() => keys.button('Home Assistant', 'Copy').isVisible(), {
          timeout: 1_500,
          interval: 100,
        })
        .toBe(true)
    })

    it('moves "Copied" to the key copied last', async () => {
      await seedKey(HOME_ASSISTANT)
      const shortcuts = await seedKey({ name: 'Shortcuts on iPhone' })
      await openKeys()
      await keys.button('Home Assistant', 'Copy').click()

      await keys.button('Shortcuts on iPhone', 'Copy').click()

      await expect
        .poll(() => keys.button('Shortcuts on iPhone', 'Copied').isVisible(), eventually)
        .toBe(true)
      expect(await keys.button('Home Assistant', 'Copy').isVisible()).toBe(true)
      expect(await clipboard()).toBe(shortcuts.key)
    })

    it('says it could not copy when the clipboard is not available', async () => {
      await seedKey(HOME_ASSISTANT)
      await page.addInitScript(() => {
        navigator.clipboard.writeText = () => Promise.reject(new Error('Denied'))
      })
      await openKeys()

      await keys.button('Home Assistant', 'Copy').click()

      await expect
        .poll(() => keys.button('Home Assistant', 'Couldn’t copy').isVisible(), eventually)
        .toBe(true)
      await expect
        .poll(() => keys.button('Home Assistant', 'Copy').isVisible(), {
          timeout: 3_000,
          interval: 100,
        })
        .toBe(true)
    })
  })

  describe('revoking a key', () => {
    beforeEach(async () => {
      await seedKey(HOME_ASSISTANT)
    })

    it('asks for confirmation, naming the key', async () => {
      const [homeAssistant] = await storedKeys()

      await openRevokeDialog()

      const text = await textOf(keys.revokeDialog())
      expect(text).toContain('Apps using it stop working right away. This can’t be undone.')
      expect(text).toContain(`Home Assistant ${homeAssistant?.preview} Last used 2 hours ago`)
      expect(await keys.dialogButton(keys.revokeDialog(), 'Keep it').isVisible()).toBe(true)
      expect(await keys.dialogButton(keys.revokeDialog(), 'Revoke key').isVisible()).toBe(true)
    })

    it.each([
      ['clicking Keep it', () => keys.dialogButton(keys.revokeDialog(), 'Keep it').click()],
      ['pressing Escape', () => page.keyboard.press('Escape')],
      ['clicking outside the dialog', () => page.mouse.click(10, 10)],
    ])('keeps the key when %s', async (_case, keep) => {
      await openRevokeDialog()

      await keep()

      await expect.poll(isHidden(keys.revokeDialog()), eventually).toBe(true)
      expect(requestsTo('DELETE')).toEqual([])
      expect(await keys.item('Home Assistant').isVisible()).toBe(true)
    })

    it('deletes the key once confirmed', async () => {
      await seedKey({ name: 'Shortcuts on iPhone' })
      await openRevokeDialog()

      await keys.dialogButton(keys.revokeDialog(), 'Revoke key').click()

      await expect.poll(isHidden(keys.revokeDialog()), eventually).toBe(true)
      await expect.poll(isHidden(keys.item('Home Assistant')), eventually).toBe(true)
      expect((await storedKeys()).map((key) => key.name)).toEqual(['Shortcuts on iPhone'])
      await openKeys()
      expect(await itemNames('Shortcuts on iPhone', 'Home Assistant')).toEqual([
        'Shortcuts on iPhone',
      ])
    })

    it('shows the empty state after revoking the last key', async () => {
      await openRevokeDialog()

      await keys.dialogButton(keys.revokeDialog(), 'Revoke key').click()

      await expect.poll(() => keys.empty().isVisible(), eventually).toBe(true)
    })

    it('disables the dialog and keeps it open while the key is revoked', async () => {
      await openRevokeDialog()
      const release = await holdRequests('DELETE')

      await keys.dialogButton(keys.revokeDialog(), 'Revoke key').dblclick()

      for (const dialogButton of await keys.revokeDialog().getByRole('button').all()) {
        expect(await dialogButton.isDisabled()).toBe(true)
      }
      await page.keyboard.press('Escape')
      await page.mouse.click(10, 10)
      expect(await keys.revokeDialog().isVisible()).toBe(true)
      release()
      await expect.poll(isHidden(keys.revokeDialog()), eventually).toBe(true)
      expect(requestsTo('DELETE')).toHaveLength(1)
    })

    it.each(API_FAILURES)(
      'keeps the dialog open and the key when the API %s',
      async (_case, fault) => {
        await openRevokeDialog()
        await injectFault(PROXY_URL, fault, username)

        await keys.dialogButton(keys.revokeDialog(), 'Revoke key').click()

        await expect
          .poll(() => keys.revokeDialog().getByRole('alert').textContent(), eventually)
          .toBe(GENERIC_ERROR_MESSAGE)
        expect(await keys.item('Home Assistant').isVisible()).toBe(true)
      },
    )

    it('drops a key revoked elsewhere without an error', async () => {
      await openRevokeDialog()
      const [homeAssistant] = await storedKeys()
      await deleteApiKey(SEEDED, homeAssistant?.id ?? 0)

      await keys.dialogButton(keys.revokeDialog(), 'Revoke key').click()

      await expect.poll(isHidden(keys.revokeDialog()), eventually).toBe(true)
      await expect.poll(() => keys.empty().isVisible(), eventually).toBe(true)
      expect(await page.getByRole('alert').filter({ hasText: GENERIC_ERROR_MESSAGE }).count()).toBe(
        0,
      )
    })

    it('goes to the login page when the session expired before revoking', async () => {
      await openRevokeDialog()
      await setSessionCookie(context, await expiredToken())

      await keys.dialogButton(keys.revokeDialog(), 'Revoke key').click()

      await page.waitForURL(`${WEB_URL}/login`)
    })
  })

  describe('deleting an expired key', () => {
    beforeEach(async () => {
      await seedKey({ name: 'Old import script', createdAt: new Date('2026-07-03T10:00:00-04:00') })
      await seedKey(HOME_ASSISTANT)
    })

    it('deletes it at once, without asking', async () => {
      await openKeys()

      await keys.button('Old import script', 'Delete').click()

      await expect.poll(isHidden(keys.item('Old import script')), eventually).toBe(true)
      expect(await page.getByRole('alertdialog').count()).toBe(0)
      expect((await storedKeys()).map((key) => key.name)).toEqual(['Home Assistant'])
      await openKeys()
      expect(await itemNames('Old import script', 'Home Assistant')).toEqual(['Home Assistant'])
    })

    it.each(API_FAILURES)(
      'shows the generic error and keeps the key when the API %s',
      async (_case, fault) => {
        await openKeys()
        await injectFault(PROXY_URL, fault, username)

        await keys.button('Old import script', 'Delete').click()

        await expect.poll(() => keys.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
        expect(await keys.item('Old import script').isVisible()).toBe(true)
      },
    )
  })

  describe('on a phone', () => {
    // Replaces the desktop page with a phone one, for a new user.
    beforeEach(async () => {
      await context.close()
      await startAs(MOBILE)
    })

    it('stacks each key over its buttons and puts Create API key under the list', async () => {
      await seedKey(HOME_ASSISTANT)
      const shortcuts = await seedKey({ name: 'Shortcuts on iPhone' })

      await openKeys()

      expect(await itemText('Shortcuts on iPhone')).toContain(
        `Shortcuts on iPhone ${shortcuts.preview} Never used · Expires`,
      )
      expect(await itemText('Home Assistant')).toContain('Last used 2 hours ago · Never expires')
      expect(
        await keys
          .section()
          .getByText(/Created /)
          .count(),
      ).toBe(0)
      const name = await box(keys.item('Home Assistant').getByText('Home Assistant'))
      expect((await box(keys.button('Home Assistant', 'Copy'))).y).toBeGreaterThan(
        name.y + name.height,
      )
      expect(
        await sameRow(
          keys.button('Home Assistant', 'Copy'),
          keys.button('Home Assistant', 'Revoke'),
        ),
      ).toBe(true)
      const list = await box(keys.list())
      const create = await box(keys.create())
      expect(create.y).toBeGreaterThanOrEqual(list.y + list.height)
      expect(create.width).toBeGreaterThanOrEqual(list.width - 40)
    })
  })

  describe('the /api/api-keys routes', () => {
    // Calls the route the way the page does, with the session cookie unless it is null.
    const send = (method: string, path = '', body?: object, cookie: string | null = token) => {
      const headers: Record<string, string> = {}
      const init: RequestInit = { method, headers, redirect: 'manual' }
      if (cookie !== null) headers['Cookie'] = `access_token=${cookie}`
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(`${API_KEYS_URL}${path}`, init)
    }

    const NEW_KEY = { name: 'Shortcuts on iPhone', expiresIn: '90d' }

    const apiRequests = async () =>
      (await receivedRequests(PROXY_URL, username)).filter((request) =>
        request.includes('/v1/settings/api-keys'),
      )

    it('forwards GET to the API with the session token', async () => {
      const homeAssistant = await seedKey(HOME_ASSISTANT)

      const response = await send('GET')

      expect(response.status).toBe(200)
      expect(((await response.json()) as ApiKey[]).map((key) => key.key)).toEqual([
        homeAssistant.key,
      ])
      expect(await apiRequests()).toEqual(['GET /v1/settings/api-keys'])
    })

    it('forwards POST to the API with the session token', async () => {
      const response = await send('POST', '', NEW_KEY)

      expect(response.status).toBe(201)
      expect(((await response.json()) as ApiKey).name).toBe('Shortcuts on iPhone')
      expect(await apiRequests()).toEqual(['POST /v1/settings/api-keys'])
    })

    it('forwards DELETE to the API with the session token', async () => {
      const { id } = await seedKey(HOME_ASSISTANT)

      const response = await send('DELETE', `/${id}`)

      expect(response.status).toBe(204)
      expect(await storedKeys()).toEqual([])
      expect(await apiRequests()).toEqual([`DELETE /v1/settings/api-keys/${id}`])
    })

    it('answers 401 without a session cookie and does not call the API', async () => {
      const { id } = await seedKey(HOME_ASSISTANT)

      const statuses = [
        (await send('GET', '', undefined, null)).status,
        (await send('POST', '', NEW_KEY, null)).status,
        (await send('DELETE', `/${id}`, undefined, null)).status,
      ]

      expect(statuses).toEqual([401, 401, 401])
      expect(await apiRequests()).toEqual([])
      expect((await storedKeys()).map((key) => key.name)).toEqual(['Home Assistant'])
    })

    it('forwards 400, 401, 404 and 409 as they are', async () => {
      await seedKey(HOME_ASSISTANT)

      const statuses = [
        (await send('POST', '', { name: '', expiresIn: '90d' })).status,
        (await send('GET', '', undefined, await expiredToken())).status,
        (await send('DELETE', '/99999')).status,
        (await send('POST', '', { name: 'home assistant', expiresIn: '90d' })).status,
      ]

      expect(statuses).toEqual([400, 401, 404, 409])
    })

    it.each(API_FAILURES)('answers 502 when the API %s', async (_case, fault) => {
      const { id } = await seedKey(HOME_ASSISTANT)
      await injectFault(PROXY_URL, fault, username)

      const statuses = [
        (await send('GET')).status,
        (await send('POST', '', NEW_KEY)).status,
        (await send('DELETE', `/${id}`)).status,
      ]

      expect(statuses).toEqual([502, 502, 502])
    })

    it('answers 502 when the API answers a key or the list without JSON', async () => {
      await injectFault(PROXY_URL, { status: 200, body: 'not json' }, username)

      const statuses = [(await send('GET')).status, (await send('POST', '', NEW_KEY)).status]

      expect(statuses).toEqual([502, 502])
    })
  })
})
