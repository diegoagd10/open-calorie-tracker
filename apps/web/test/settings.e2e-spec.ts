import {
  DEFAULT_DAILY_GOALS,
  GENERIC_ERROR_MESSAGE,
  INCORRECT_CURRENT_PASSWORD_MESSAGE,
  MAX_DAILY_GOAL,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Locator, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { box, eventually, sameRow, textOf } from './browser'
import { homePage, openHome, seedDailyGoals } from './daily-log'
import { type Fault, clearFault, injectFault, receivedRequests } from './fault-proxy'
import { INVALID_TOKENS, SEEDED, SEED_USER, signAccessToken } from './fixtures'
import { header } from './header'
import { connectDatabase, sessionCookie, setSessionCookie, signedInPage } from './session'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const SETTINGS_URL = `${WEB_URL}/settings`

const DAILY_GOALS_URL = `${WEB_URL}/api/daily-goals`

const GOAL_ERROR = `Enter a number from 1 to ${MAX_DAILY_GOAL}`

const SHORT_PASSWORD_ERROR = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
const MISMATCH_ERROR = 'Passwords do not match'
const SAME_PASSWORD_ERROR = 'New password must be different from the current password'

const expiredToken = () => signAccessToken(Math.floor(Date.now() / 1000) - 60)

const API_FAILURES: [string, Fault][] = [
  ['answers 500', { status: 500 }],
  ['is unreachable', 'connection-reset'],
]

const GOALS = [
  { label: 'Calories', key: 'calories', unit: 'kcal' },
  { label: 'Protein', key: 'protein', unit: 'g' },
  { label: 'Carbohydrate', key: 'carbohydrate', unit: 'g' },
  { label: 'Fat', key: 'fat', unit: 'g' },
  { label: 'Fiber', key: 'fiber', unit: 'g' },
  { label: 'Sugar max', key: 'sugar', unit: 'g' },
  { label: 'Sodium max', key: 'sodium', unit: 'mg' },
  { label: 'Water', key: 'water', unit: 'fl oz' },
] as const

const settingsPage = (page: Page) => ({
  title: () => page.getByRole('heading', { level: 1, name: 'Settings' }),
  sectionTitles: () => page.getByRole('main').getByRole('heading', { level: 2 }),
  section: (name: string) => page.getByRole('region', { name, exact: true }),
  goals: () => page.getByRole('form', { name: 'Daily goals' }),
  goal: (label: string) =>
    page
      .getByRole('form', { name: 'Daily goals' })
      .getByRole('textbox', { name: label, exact: true }),
  goalFields: () => page.getByRole('form', { name: 'Daily goals' }).getByRole('textbox'),
  save: () => page.getByRole('form', { name: 'Daily goals' }).getByRole('button'),
  // The section's Alert, apart from the role="alert" route announcer Next.js renders.
  goalsAlert: () => page.getByRole('region', { name: 'Daily goals' }).getByRole('alert'),
  goalsSaved: () =>
    page.getByRole('region', { name: 'Daily goals' }).getByText('Daily goals saved.'),
})

// The text of the elements the field's aria-describedby points to.
const descriptionOf = (field: Locator) =>
  field.evaluate((element) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim(),
  )

describe('Settings page (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let home: ReturnType<typeof homePage>
  let banner: ReturnType<typeof header>
  let settings: ReturnType<typeof settingsPage>

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  beforeEach(async () => {
    ;({ context, page, username, token } = await signedInPage(browser, database))
    home = homePage(page)
    banner = header(page)
    settings = settingsPage(page)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  const openSettings = async () => {
    await page.goto(SETTINGS_URL)
    await expect.poll(() => settings.title().isVisible(), eventually).toBe(true)
  }

  describe('the Food Log header', () => {
    it('shows a Settings icon link left of Log out, in the same row as the logo', async () => {
      await openHome(page)

      expect(await textOf(banner.settings())).toBe('')
      expect(await banner.settings().locator('svg').count()).toBe(1)
      const link = await box(banner.settings())
      const button = await box(banner.logOut())
      expect(link.x + link.width).toBeLessThanOrEqual(button.x)
      expect(await sameRow(banner.logo(), banner.settings())).toBe(true)
    })

    it('opens Settings from the Settings link', async () => {
      await openHome(page)

      await banner.settings().click()
      await page.waitForURL(SETTINGS_URL)

      expect(await settings.title().isVisible()).toBe(true)
    })

    it.each([390, 1280])('shows the Settings link in a %i px wide window', async (width) => {
      await page.setViewportSize({ width, height: 844 })

      await openHome(page)

      expect(await banner.settings().isVisible()).toBe(true)
      const link = await box(banner.settings())
      expect(link.x + link.width).toBeLessThanOrEqual(width)
    })
  })

  describe('the Settings header', () => {
    it('shows the logo on the left, and Food Log and Log out on the right in its row', async () => {
      await openSettings()

      const logo = await box(banner.logo())
      for (const control of [banner.foodLog(), banner.logOut()]) {
        expect((await box(control)).x).toBeGreaterThan(logo.x + logo.width)
        expect(await sameRow(banner.logo(), control)).toBe(true)
      }
    })

    it('goes back to the Food Log from the Food Log link', async () => {
      await openSettings()

      await banner.foodLog().click()
      await page.waitForURL(`${WEB_URL}/`)

      expect(await home.title().isVisible()).toBe(true)
    })

    it('logs out from Settings', async () => {
      await openSettings()

      await banner.logOut().click()
      await page.waitForURL(`${WEB_URL}/login`)

      expect(await sessionCookie(context)).toBeUndefined()
    })
  })

  it.each([
    ['/', 'Settings'],
    ['/settings', 'Food Log'],
  ])('groups the %s header links in the Main navigation', async (path, link) => {
    await page.goto(`${WEB_URL}${path}`)

    const navigation = banner.navigation()
    expect(await navigation.getByRole('link', { name: link }).isVisible()).toBe(true)
    expect(await navigation.getByRole('button', { name: 'Log out' }).isVisible()).toBe(true)
  })

  it.each(INVALID_TOKENS)(
    'sends /settings to /login when the session token %s',
    async (_case, token) => {
      await context.clearCookies()
      await context.addCookies([{ name: 'access_token', value: await token(), url: WEB_URL }])

      await page.goto(SETTINGS_URL)

      expect(page.url()).toBe(`${WEB_URL}/login`)
    },
  )

  describe('the sections', () => {
    it('shows the three sections in order, with no notice that changes are unavailable', async () => {
      await openSettings()

      expect(
        await page
          .getByRole('main')
          .getByText('Changing these settings isn’t available yet.')
          .count(),
      ).toBe(0)
      expect(await settings.sectionTitles().allTextContents()).toEqual([
        'Profile',
        'Daily goals',
        'API keys',
      ])
      for (const name of ['Profile', 'Daily goals', 'API keys']) {
        expect(await settings.section(name).isVisible()).toBe(true)
      }
    })

    it('shows the profile with a disabled username and an enabled password button', async () => {
      await openSettings()

      const profile = settings.section('Profile')
      expect(await profile.getByText('Your username and password.').isVisible()).toBe(true)
      const usernameField = profile.getByLabel('Username')
      expect(await usernameField.isDisabled()).toBe(true)
      expect(await usernameField.inputValue()).toBe('')
      expect(await profile.getByText('Password', { exact: true }).isVisible()).toBe(true)
      expect(await profile.getByText('Used to log in on this server.').isVisible()).toBe(true)
      expect(await profile.getByRole('button', { name: 'Change password' }).isEnabled()).toBe(true)
    })

    it('shows no API keys and an enabled Create API key button', async () => {
      await openSettings()

      const apiKeys = settings.section('API keys')
      expect(
        await apiKeys.getByText('Keys for connecting other apps to your account.').isVisible(),
      ).toBe(true)
      await expect
        .poll(() => apiKeys.getByText('No API keys yet').isVisible(), eventually)
        .toBe(true)
      expect(
        await apiKeys
          .getByText('Create one to log food and water from scripts, shortcuts or other apps.')
          .isVisible(),
      ).toBe(true)
      expect(await apiKeys.getByRole('button', { name: 'Create API key' }).isEnabled()).toBe(true)
    })
  })

  describe('daily goals', () => {
    // The page's requests to the daily goals route, e.g. "PATCH {"calories":2000}".
    let goalsRequests: string[]

    beforeEach(() => {
      goalsRequests = []
      page.on('request', (request) => {
        if (request.url() === DAILY_GOALS_URL) {
          goalsRequests.push(`${request.method()} ${request.postData() ?? ''}`.trim())
        }
      })
    })

    // Opens Settings and waits for the goals to load.
    const openGoals = async () => {
      await openSettings()
      await expect.poll(() => settings.goal('Calories').isEnabled(), eventually).toBe(true)
    }

    const goalValues = async () =>
      Promise.all(GOALS.map(({ label }) => settings.goal(label).inputValue()))

    const fieldsAreEmptyAndDisabled = async () => {
      for (const { label } of GOALS) {
        expect(await settings.goal(label).inputValue()).toBe('')
        expect(await settings.goal(label).isDisabled()).toBe(true)
      }
      expect(await settings.save().isDisabled()).toBe(true)
    }

    // The section shows the generic error above the fields.
    const showsGenericErrorAboveFields = async () => {
      await expect
        .poll(() => settings.goalsAlert().textContent(), eventually)
        .toBe(GENERIC_ERROR_MESSAGE)
      const alert = await box(settings.goalsAlert())
      expect(alert.y + alert.height).toBeLessThanOrEqual((await box(settings.goal('Calories'))).y)
    }

    const clickSave = async () => {
      await settings.save().click()
      await expect.poll(() => settings.goalsSaved().isVisible(), eventually).toBe(true)
    }

    // Holds the page's PATCH requests to the daily goals route until released.
    const holdSaving = async () => {
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(DAILY_GOALS_URL, async (route) => {
        if (route.request().method() === 'PATCH') await released
        await route.continue()
      })
      return release
    }

    describe('seeing the goals', () => {
      it.each(GOALS)(
        'shows the default $label goal, editable, in $unit',
        async ({ label, key, unit }) => {
          await openGoals()

          expect(
            await settings
              .section('Daily goals')
              .getByText('The targets the Food Log measures each day against.')
              .isVisible(),
          ).toBe(true)
          const field = settings.goal(label)
          expect(await field.isEnabled()).toBe(true)
          expect(await field.inputValue()).toBe(String(DEFAULT_DAILY_GOALS[key]))
          expect(await descriptionOf(field)).toBe(unit)
        },
      )

      it('shows a disabled Save button until a goal changes', async () => {
        await openGoals()

        expect(await textOf(settings.save())).toBe('Save')
        expect(await settings.save().isDisabled()).toBe(true)
      })

      it('shows the goals the user saved', async () => {
        await seedDailyGoals(database, { username, calories: 2000, water: 80 })

        await openGoals()

        expect(await goalValues()).toEqual(
          GOALS.map(({ key }) =>
            String({ ...DEFAULT_DAILY_GOALS, calories: 2000, water: 80 }[key]),
          ),
        )
      })

      it('shows the fields empty and disabled while the goals load', async () => {
        await injectFault(PROXY_URL, { delayMs: 3_000 }, username)

        await page.goto(SETTINGS_URL)

        await fieldsAreEmptyAndDisabled()
      })

      it.each(API_FAILURES)(
        'shows the generic error and keeps the fields disabled when the API %s',
        async (_case, fault) => {
          await injectFault(PROXY_URL, fault, username)

          await openSettings()

          await showsGenericErrorAboveFields()
          await fieldsAreEmptyAndDisabled()
        },
      )

      it('goes to the login page when the session expired before the goals load', async () => {
        await page.route(DAILY_GOALS_URL, async (route) => {
          await setSessionCookie(context, await expiredToken())
          await route.fulfill({ status: 401 })
        })

        await page.goto(SETTINGS_URL)

        await page.waitForURL(`${WEB_URL}/login`)
      })

      it('asks the web API only for the daily goals and the API keys', async () => {
        const apiRequests: string[] = []
        page.on('request', (request) => {
          const { pathname } = new URL(request.url())
          if (pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${pathname}`)
        })

        await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })

        expect(await settings.title().isVisible()).toBe(true)
        expect(apiRequests.sort()).toEqual(['GET /api/api-keys', 'GET /api/daily-goals'])
      })
    })

    describe('editing the goals', () => {
      it('enables Save once a goal changes', async () => {
        await openGoals()

        await settings.goal('Calories').fill('2000')

        expect(await settings.save().isEnabled()).toBe(true)
      })

      it.each([
        ['Calories', '2000', '1600'],
        ['Sodium max', '1500', '2300'],
        ['Water', '100', '64'],
      ])(
        'disables Save again when %s goes back to its saved value',
        async (label, changed, saved) => {
          await openGoals()
          await settings.goal(label).fill(changed)

          await settings.goal(label).fill(saved)

          expect(await settings.save().isDisabled()).toBe(true)
        },
      )

      it('keeps Save enabled when only one of two changes is undone', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        await settings.goal('Water').fill('80')

        await settings.goal('Calories').fill('1600')

        expect(await settings.save().isEnabled()).toBe(true)
      })

      it.each([
        ['typed', '2000', '2000'],
        ['typed', '1.5', '15'],
        ['typed', '-200', '200'],
        ['typed', '2,000', '2000'],
        ['pasted', '2 000 kcal', '2000'],
        ['pasted', '1234567', '12345'],
        ['typed', 'abc', ''],
      ])('shows %s %j as %j', async (action, input, shown) => {
        await openGoals()
        const field = settings.goal('Calories')
        await field.fill('')

        if (action === 'typed') await field.pressSequentially(input)
        else await page.keyboard.insertText(input)

        expect(await field.inputValue()).toBe(shown)
      })

      it.each(['', '0', '000'])(
        'shows an error under the goal and disables Save for %j',
        async (input) => {
          await openGoals()
          const field = settings.goal('Protein')

          await field.fill(input)

          const error = settings.section('Daily goals').getByText(GOAL_ERROR)
          expect(await error.isVisible()).toBe(true)
          expect((await box(error)).y).toBeGreaterThan((await box(field)).y)
          expect(await descriptionOf(field)).toContain(GOAL_ERROR)
          expect(await settings.save().isDisabled()).toBe(true)
        },
      )

      it('drops leading zeros when saving', async () => {
        await openGoals()
        await settings.goal('Fat').fill('060')

        await clickSave()

        expect(goalsRequests).toContain('PATCH {"fat":60}')
        expect(await settings.goal('Fat').inputValue()).toBe('60')
      })
    })

    describe('saving the goals', () => {
      it('sends only the changed goals and confirms left of Save', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        await settings.goal('Water').fill('80')

        await clickSave()

        expect(goalsRequests).toEqual(['GET', 'PATCH {"calories":2000,"water":80}'])
        const saved = await box(settings.goalsSaved())
        expect(saved.x + saved.width).toBeLessThanOrEqual((await box(settings.save())).x)
        expect(await sameRow(settings.goalsSaved(), settings.save())).toBe(true)
        expect(await settings.save().isDisabled()).toBe(true)
      })

      it('keeps the saved goals after a reload', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        await clickSave()

        await openGoals()

        expect(await settings.goal('Calories').inputValue()).toBe('2000')
      })

      it('measures the Food Log against the saved goals', async () => {
        await seedDailyGoals(database, { username, calories: 2000, protein: 150, water: 80 })

        await openHome(page)

        await expect
          .poll(() => textOf(home.summary('Calories')), eventually)
          .toContain('/ 2,000 kcal')
        expect(await textOf(home.summary('Protein'))).toContain('/ 150 g')
        expect(await textOf(home.summary('Water'))).toContain('/ 80 fl oz')
      })

      it('disables the form and shows Saving… while the goals are saved', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        const release = await holdSaving()

        await settings.save().click()

        await expect.poll(() => textOf(settings.save()), eventually).toBe('Saving…')
        expect(await settings.save().isDisabled()).toBe(true)
        for (const field of await settings.goalFields().all()) {
          expect(await field.isDisabled()).toBe(true)
        }
        release()
        await expect.poll(() => settings.goalsSaved().isVisible(), eventually).toBe(true)
      })

      it.each(API_FAILURES)(
        'shows the generic error and keeps what was typed when the API %s',
        async (_case, fault) => {
          await openGoals()
          await settings.goal('Calories').fill('2000')
          await injectFault(PROXY_URL, fault, username)

          await settings.save().click()

          await showsGenericErrorAboveFields()
          expect(await settings.goal('Calories').inputValue()).toBe('2000')
          expect(await settings.save().isEnabled()).toBe(true)
          expect(await settings.goalsSaved().isVisible()).toBe(false)
        },
      )

      it('goes to the login page when the session expired before saving', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        await setSessionCookie(context, await expiredToken())

        await settings.save().click()

        await page.waitForURL(`${WEB_URL}/login`)
      })

      it('hides the confirmation once a goal changes again', async () => {
        await openGoals()
        await settings.goal('Calories').fill('2000')
        await clickSave()

        await settings.goal('Water').fill('90')

        expect(await settings.goalsSaved().isVisible()).toBe(false)
      })
    })

    describe('the /api/daily-goals route', () => {
      // Calls the route the way the page does, with the session cookie unless it is null.
      const send = (method: string, body?: object, cookie: string | null = token) => {
        const headers: Record<string, string> = {}
        const init: RequestInit = { method, headers, redirect: 'manual' }
        if (cookie !== null) headers['Cookie'] = `access_token=${cookie}`
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json'
          init.body = JSON.stringify(body)
        }
        return fetch(DAILY_GOALS_URL, init)
      }

      it('forwards GET to the API with the session token', async () => {
        const response = await send('GET')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(DEFAULT_DAILY_GOALS)
        expect(await receivedRequests(PROXY_URL, username)).toContain(
          'GET /v1/settings/daily-goals',
        )
      })

      it('forwards PATCH to the API with the session token', async () => {
        const response = await send('PATCH', { calories: 2000 })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ...DEFAULT_DAILY_GOALS, calories: 2000 })
        expect(await receivedRequests(PROXY_URL, username)).toContain(
          'PATCH /v1/settings/daily-goals',
        )
      })

      it('answers 401 without a session cookie and changes nothing', async () => {
        const response = await send('PATCH', { calories: 2000 }, null)

        expect(response.status).toBe(401)
        expect(await (await send('GET')).json()).toEqual(DEFAULT_DAILY_GOALS)
      })

      it('forwards 400 and 401 as they are', async () => {
        const statuses = [
          (await send('PATCH', { calories: 0 })).status,
          (await send('PATCH', { calories: 2000 }, await expiredToken())).status,
        ]

        expect(statuses).toEqual([400, 401])
      })

      it.each([
        ...API_FAILURES,
        ['answers 200 without JSON', { status: 200, body: 'not json' }] as [string, Fault],
      ])('answers 502 when the API %s', async (_case, fault) => {
        await injectFault(PROXY_URL, fault, username)

        const statuses = [
          (await send('GET')).status,
          (await send('PATCH', { calories: 2000 })).status,
        ]

        expect(statuses).toEqual([502, 502])
      })
    })
  })

  describe('changing the password', () => {
    const PASSWORD_URL = `${WEB_URL}/api/password`
    const CURRENT = SEED_USER.password
    const NEW = 'new-password-1'

    // The bodies of the page's PUT requests to the password route.
    let passwordRequests: string[]

    beforeEach(() => {
      passwordRequests = []
      page.on('request', (request) => {
        if (request.url() === PASSWORD_URL && request.method() === 'PUT') {
          passwordRequests.push(request.postData() ?? '')
        }
      })
    })

    const profile = () => settings.section('Profile')
    const openButton = () => profile().getByRole('button', { name: 'Change password' })
    const dialog = () => page.getByRole('dialog', { name: 'Change password' })
    const field = (label: string) => dialog().getByLabel(label, { exact: true })
    const current = () => field('Current password')
    const next = () => field('New password')
    const confirmation = () => field('Confirm new password')
    const passwordFields = () => [current(), next(), confirmation()]
    const submit = () => dialog().locator('button[type="submit"]')
    const cancel = () => dialog().getByRole('button', { name: 'Cancel' })
    const close = () => dialog().getByRole('button', { name: 'Close' })
    const dialogAlert = () => dialog().getByRole('alert')
    const usedToLogIn = () => profile().getByText('Used to log in on this server.')
    const changed = () => profile().getByRole('status')

    const openDialog = async () => {
      await openSettings()
      await openButton().click()
      await expect.poll(() => dialog().isVisible(), eventually).toBe(true)
    }

    const fillPasswords = async (currentValue: string, newValue: string, confirmValue: string) => {
      await current().fill(currentValue)
      await next().fill(newValue)
      await confirmation().fill(confirmValue)
    }

    const fieldValues = () => Promise.all(passwordFields().map((input) => input.inputValue()))

    // Clicks outside the dialog, on its backdrop.
    const clickBackdrop = () => page.mouse.click(5, 5)

    // Holds the page's PUT requests to the password route until released.
    const holdSaving = async () => {
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route(PASSWORD_URL, async (route) => {
        await released
        await route.continue()
      })
      return release
    }

    const changePassword = async () => {
      await fillPasswords(CURRENT, NEW, NEW)
      await submit().click()
      await expect.poll(() => dialog().isVisible(), eventually).toBe(false)
    }

    describe('the dialog', () => {
      it('opens with empty fields and a disabled Change password button', async () => {
        await openDialog()

        expect(
          await dialog()
            .getByText('Enter your current password, then choose a new one.')
            .isVisible(),
        ).toBe(true)
        expect(await fieldValues()).toEqual(['', '', ''])
        expect(await descriptionOf(next())).toBe(`At least ${PASSWORD_MIN_LENGTH} characters.`)
        expect(await textOf(submit())).toBe('Change password')
        expect(await submit().isDisabled()).toBe(true)
        expect(await cancel().isVisible()).toBe(true)
        expect(await close().isVisible()).toBe(true)
      })

      it('puts the focus on Current password', async () => {
        await openDialog()

        await expect
          .poll(() => current().evaluate((input) => input === document.activeElement), eventually)
          .toBe(true)
      })

      it.each([
        ['Current password', 'current-password'],
        ['New password', 'new-password'],
        ['Confirm new password', 'new-password'],
      ])('makes %s a password field with autocomplete %j', async (label, autocomplete) => {
        await openDialog()

        expect(await field(label).getAttribute('type')).toBe('password')
        expect(await field(label).getAttribute('autocomplete')).toBe(autocomplete)
      })

      it.each([
        ['clicking Cancel', () => cancel().click()],
        ['clicking Close', () => close().click()],
        ['pressing Escape', () => page.keyboard.press('Escape')],
        ['clicking the backdrop', clickBackdrop],
      ])('closes without sending anything on %s', async (_case, closeDialog) => {
        await openDialog()
        await fillPasswords(CURRENT, NEW, NEW)

        await closeDialog()

        await expect.poll(() => dialog().isVisible(), eventually).toBe(false)
        expect(passwordRequests).toEqual([])
      })

      it('opens empty and without errors again after Cancel', async () => {
        await openDialog()
        await fillPasswords(CURRENT, 'short', 'short')
        await submit().click()
        await expect.poll(() => next().getAttribute('aria-invalid'), eventually).toBe('true')
        await cancel().click()

        await openButton().click()

        expect(await fieldValues()).toEqual(['', '', ''])
        expect(await next().getAttribute('aria-invalid')).not.toBe('true')
        expect(await dialog().getByText(SHORT_PASSWORD_ERROR).count()).toBe(0)
      })
    })

    describe('the form rules', () => {
      it.each([
        ['a', NEW, NEW, true],
        ['a', 'short', 'short', true],
        ['', NEW, NEW, false],
        ['a', '', '', false],
        ['a', NEW, '', false],
        ['a', NEW, 'new-password-2', false],
        ['a', NEW, `${NEW} `, false],
      ])(
        'with %j, %j and %j enables Change password: %s',
        async (currentValue, newValue, confirmValue, enabled) => {
          await openDialog()

          await fillPasswords(currentValue, newValue, confirmValue)

          expect(await submit().isEnabled()).toBe(enabled)
        },
      )

      it.each([
        ['typed', 'Current password'],
        ['pasted', 'Current password'],
        ['typed', 'New password'],
        ['pasted', 'New password'],
        ['typed', 'Confirm new password'],
        ['pasted', 'Confirm new password'],
      ])(`keeps the first ${PASSWORD_MAX_LENGTH} characters %s into %s`, async (action, label) => {
        await openDialog()
        const input = 'a'.repeat(PASSWORD_MAX_LENGTH + 1)

        await field(label).focus()
        if (action === 'typed') await field(label).pressSequentially(input)
        else await page.keyboard.insertText(input)

        expect(await field(label).inputValue()).toBe('a'.repeat(PASSWORD_MAX_LENGTH))
      })

      it(`rejects a new password shorter than ${PASSWORD_MIN_LENGTH} characters on submit`, async () => {
        await openDialog()
        await fillPasswords(CURRENT, 'short', 'short')

        await submit().click()

        expect(await next().getAttribute('aria-invalid')).toBe('true')
        expect(await descriptionOf(next())).toContain(SHORT_PASSWORD_ERROR)
        expect(passwordRequests).toEqual([])
      })

      it.each([
        [NEW, 'new-password-2', true],
        [NEW, 'new', true],
        [NEW, NEW, false],
        [NEW, '', false],
        ['', NEW, false],
      ])(
        'with %j and %j shows the mismatch under Confirm new password: %s',
        async (newValue, confirmValue, mismatch) => {
          await openDialog()
          await current().fill(CURRENT)

          await next().fill(newValue)
          await confirmation().fill(confirmValue)

          expect((await confirmation().getAttribute('aria-invalid')) === 'true').toBe(mismatch)
          expect(await dialog().getByText(MISMATCH_ERROR).count()).toBe(mismatch ? 1 : 0)
          if (mismatch) {
            expect(await descriptionOf(confirmation())).toContain(MISMATCH_ERROR)
            expect(await submit().isDisabled()).toBe(true)
          }
        },
      )

      it('sends nothing when Enter is pressed with mismatched passwords', async () => {
        await openDialog()
        await fillPasswords(CURRENT, NEW, 'new-password-2')

        await confirmation().press('Enter')

        expect(await dialog().isVisible()).toBe(true)
        expect(passwordRequests).toEqual([])
      })

      it('rejects a new password equal to the current one on submit', async () => {
        await openDialog()
        await fillPasswords(CURRENT, CURRENT, CURRENT)

        await submit().click()

        expect(await next().getAttribute('aria-invalid')).toBe('true')
        expect(await descriptionOf(next())).toContain(SAME_PASSWORD_ERROR)
        expect(passwordRequests).toEqual([])
      })

      it('clears the error of the field being edited', async () => {
        await openDialog()
        await fillPasswords(CURRENT, 'short', 'short')
        await submit().click()
        await expect.poll(() => next().getAttribute('aria-invalid'), eventually).toBe('true')

        await next().press('x')

        expect(await next().getAttribute('aria-invalid')).not.toBe('true')
        expect(await dialog().getByText(SHORT_PASSWORD_ERROR).count()).toBe(0)
      })
    })

    describe('submitting', () => {
      it('sends the passwords, closes the dialog and confirms in the Profile', async () => {
        await openDialog()

        await changePassword()

        expect(passwordRequests.map((body) => JSON.parse(body) as unknown)).toEqual([
          { currentPassword: CURRENT, newPassword: NEW, confirmPassword: NEW },
        ])
        expect(await receivedRequests(PROXY_URL, username)).toContain('PUT /v1/settings/password')
        expect(await textOf(changed())).toBe('Password changed.')
        expect(await changed().getAttribute('aria-live')).toBe('polite')
        expect(await usedToLogIn().isVisible()).toBe(false)
        expect(page.url()).toBe(SETTINGS_URL)
      })

      it.each([
        ['the dialog opens again', () => openButton().click()],
        ['the page reloads', () => openSettings()],
      ])('stops confirming the change once %s', async (_case, action) => {
        await openDialog()
        await changePassword()

        await action()

        await expect.poll(() => usedToLogIn().isVisible(), eventually).toBe(true)
        expect(await profile().getByText('Password changed.').count()).toBe(0)
      })

      it('keeps the dialog open and marks Current password when it is wrong', async () => {
        await openDialog()
        await fillPasswords('wrong-password', NEW, NEW)

        await submit().click()

        await expect.poll(() => current().getAttribute('aria-invalid'), eventually).toBe('true')
        expect(await descriptionOf(current())).toContain(INCORRECT_CURRENT_PASSWORD_MESSAGE)
        expect(await dialog().isVisible()).toBe(true)
        expect(await fieldValues()).toEqual(['wrong-password', NEW, NEW])
      })

      it('locks the dialog and shows Saving… while the password is saved', async () => {
        await openDialog()
        await fillPasswords(CURRENT, NEW, NEW)
        const release = await holdSaving()

        await submit().click()

        await expect.poll(() => textOf(submit()), eventually).toBe('Saving…')
        expect(await submit().isDisabled()).toBe(true)
        for (const control of [...passwordFields(), cancel(), close()]) {
          expect(await control.isDisabled()).toBe(true)
        }
        await page.keyboard.press('Escape')
        await clickBackdrop()
        expect(await dialog().isVisible()).toBe(true)
        release()
        await expect.poll(() => dialog().isVisible(), eventually).toBe(false)
      })

      it.each(API_FAILURES)(
        'shows the generic error and keeps what was typed when the API %s',
        async (_case, fault) => {
          await openDialog()
          await fillPasswords(CURRENT, NEW, NEW)
          await injectFault(PROXY_URL, fault, username)

          await submit().click()

          await expect
            .poll(() => dialogAlert().textContent(), eventually)
            .toBe(GENERIC_ERROR_MESSAGE)
          expect(await fieldValues()).toEqual([CURRENT, NEW, NEW])
          for (const input of passwordFields()) {
            expect(await input.isEnabled()).toBe(true)
          }
          expect(await submit().isEnabled()).toBe(true)
        },
      )

      it('goes to the login page when the session expired before saving', async () => {
        await openDialog()
        await fillPasswords(CURRENT, NEW, NEW)
        await setSessionCookie(context, await expiredToken())

        await submit().click()

        await page.waitForURL(`${WEB_URL}/login`)
      })

      it('shows the dialog as a bottom sheet and changes the password on a phone', async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        await openDialog()

        const sheet = await box(dialog())
        expect(sheet.x).toBe(0)
        expect(sheet.width).toBe(390)
        expect(Math.round(sheet.y + sheet.height)).toBe(844)
        await changePassword()
        expect(await textOf(changed())).toBe('Password changed.')
      })
    })

    describe('the /api/password route', () => {
      // Calls the route the way the page does, with the session cookie unless it is null.
      const send = (body: object, cookie: string | null = token) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (cookie !== null) headers['Cookie'] = `access_token=${cookie}`
        return fetch(PASSWORD_URL, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
          redirect: 'manual',
        })
      }

      const CHANGE = { currentPassword: CURRENT, newPassword: NEW, confirmPassword: NEW }

      it('forwards PUT to the API with the session token', async () => {
        const response = await send(CHANGE)

        expect(response.status).toBe(204)
        expect(await receivedRequests(PROXY_URL, username)).toContain('PUT /v1/settings/password')
      })

      it('answers 401 without a session cookie and does not call the API', async () => {
        const response = await send(CHANGE, null)

        expect(response.status).toBe(401)
        expect(await receivedRequests(PROXY_URL, username)).not.toContain(
          'PUT /v1/settings/password',
        )
      })

      it('forwards 400, 401 and 403 as they are', async () => {
        const statuses = [
          (await send({ ...CHANGE, confirmPassword: 'new-password-2' })).status,
          (await send(CHANGE, await expiredToken())).status,
          (await send({ ...CHANGE, currentPassword: 'wrong-password' })).status,
        ]

        expect(statuses).toEqual([400, 401, 403])
      })

      it.each(API_FAILURES)('answers 502 when the API %s', async (_case, fault) => {
        await injectFault(PROXY_URL, fault, username)

        expect((await send(CHANGE)).status).toBe(502)
      })
    })
  })

  it.each([390, 1280])('fits a %i px wide window', async (width) => {
    await page.setViewportSize({ width, height: 844 })

    await openSettings()

    expect(await banner.foodLog().isVisible()).toBe(true)
    expect(await banner.logOut().isVisible()).toBe(true)
    for (const name of ['Profile', 'Daily goals', 'API keys']) {
      expect(await settings.section(name).isVisible()).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
  })
})
