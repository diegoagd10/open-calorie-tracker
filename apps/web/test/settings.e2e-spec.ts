import { DEFAULT_DAILY_GOALS } from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Locator, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { box, eventually, sameRow, textOf } from './browser'
import { homePage, openHome } from './daily-log'
import { INVALID_TOKENS, SEEDED } from './fixtures'
import { header } from './header'
import { connectDatabase, sessionCookie, signedInPage } from './session'

const { webUrl: WEB_URL } = SEEDED

const SETTINGS_URL = `${WEB_URL}/settings`

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
    ;({ context, page } = await signedInPage(browser, database))
    home = homePage(page)
    banner = header(page)
    settings = settingsPage(page)
  })

  afterEach(async () => {
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
    it('shows the notice under the title and the three sections in order', async () => {
      await openSettings()

      const notice = page
        .getByRole('main')
        .getByText('Changing these settings isn’t available yet.')
      expect((await box(notice)).y).toBeGreaterThan((await box(settings.title())).y)
      expect(await settings.sectionTitles().allTextContents()).toEqual([
        'Profile',
        'Daily goals',
        'API keys',
      ])
      for (const name of ['Profile', 'Daily goals', 'API keys']) {
        expect(await settings.section(name).isVisible()).toBe(true)
      }
    })

    it('shows the profile with a disabled username and a disabled password button', async () => {
      await openSettings()

      const profile = settings.section('Profile')
      expect(await profile.getByText('Your username and password.').isVisible()).toBe(true)
      const username = profile.getByLabel('Username')
      expect(await username.isDisabled()).toBe(true)
      expect(await username.inputValue()).toBe('')
      expect(await profile.getByText('Password', { exact: true }).isVisible()).toBe(true)
      expect(await profile.getByText('Used to log in on this server.').isVisible()).toBe(true)
      expect(await profile.getByRole('button', { name: 'Change password' }).isDisabled()).toBe(true)
    })

    it.each(GOALS)(
      'shows the default $label goal, disabled, in $unit',
      async ({ label, key, unit }) => {
        await openSettings()

        const section = settings.section('Daily goals')
        expect(
          await section
            .getByText('The targets the Food Log measures each day against.')
            .isVisible(),
        ).toBe(true)
        const field = settings.goals().getByRole('textbox', { name: label, exact: true })
        expect(await field.isDisabled()).toBe(true)
        expect(await field.inputValue()).toBe(String(DEFAULT_DAILY_GOALS[key]))
        expect(await descriptionOf(field)).toBe(unit)
      },
    )

    it('shows a disabled Save button for the daily goals', async () => {
      await openSettings()

      expect(await settings.goals().getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)
    })

    it('shows no API keys and a disabled Create API key button', async () => {
      await openSettings()

      const apiKeys = settings.section('API keys')
      expect(
        await apiKeys.getByText('Keys for connecting other apps to your account.').isVisible(),
      ).toBe(true)
      expect(await apiKeys.getByText('No API keys yet').isVisible()).toBe(true)
      expect(await apiKeys.getByRole('button', { name: 'Create API key' }).isDisabled()).toBe(true)
    })

    it('sends no request to the web API', async () => {
      const apiRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().startsWith(`${WEB_URL}/api/`)) apiRequests.push(request.url())
      })

      await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })

      expect(await settings.title().isVisible()).toBe(true)
      expect(apiRequests).toEqual([])
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
