import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  chromium,
} from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { box, eventually, textOf } from './browser'
import { openHome } from './daily-log'
import { clearFault, injectFault } from './fault-proxy'
import { SEEDED } from './fixtures'
import { header } from './header'
import { connectDatabase, signedInPage } from './session'
import {
  WEIGHT_URL,
  dateIn,
  logWeight,
  openWeight,
  saveWeightGoal,
  shortDate,
  weightHistory,
  weightPage,
} from './weight'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

// Long enough for canvas-confetti to have added its canvas, were it going to.
const CONFETTI_WAIT_MS = 1_000

describe('Weight page (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let weight: ReturnType<typeof weightPage>
  let banner: ReturnType<typeof header>

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  // A new user in a page with the given browser options.
  const signIn = async (options: BrowserContextOptions = {}) => {
    ;({ context, page, username, token } = await signedInPage(browser, database, options))
    weight = weightPage(page)
    banner = header(page)
  }

  beforeEach(async () => {
    await signIn()
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  // Starts over with another user in a page with the given browser options.
  const reopen = async (options: BrowserContextOptions) => {
    await context.close()
    await signIn(options)
  }

  const fieldValue = () => weight.field().inputValue()

  const tileText = (name: Parameters<typeof weight.tile>[0]) => textOf(weight.tile(name))

  // Saves the value and waits until the page says today's weight is saved.
  const saveWeight = async (value: string) => {
    await weight.field().fill(value)
    await weight.save().click()
    await expect.poll(() => weight.savedToday().isVisible(), eventually).toBe(true)
  }

  describe('the header', () => {
    it('U2 — the Food Log shows a Weight icon before the Settings icon, which opens /weight', async () => {
      await openHome(page)

      expect(await textOf(banner.weight())).toBe('')
      expect(await banner.weight().locator('svg').count()).toBe(1)
      const link = await box(banner.weight())
      const settings = await box(banner.settings())
      expect(link.x + link.width).toBeLessThanOrEqual(settings.x)

      await banner.weight().click()
      await page.waitForURL(WEIGHT_URL)
      expect(await weight.title().isVisible()).toBe(true)
    })

    it('U3 — Settings shows the Weight icon, which opens /weight', async () => {
      await page.goto(`${WEB_URL}/settings`)

      await banner.weight().click()
      await page.waitForURL(WEIGHT_URL)

      expect(await weight.title().isVisible()).toBe(true)
    })

    it('U4 — the Weight page shows the Weight icon, the Settings icon and Log out', async () => {
      await openWeight(page)

      expect(await banner.weight().isVisible()).toBe(true)
      expect(await banner.settings().isVisible()).toBe(true)
      expect(await banner.logOut().isVisible()).toBe(true)
    })
  })

  describe("today's weight", () => {
    it('U5 — with no weigh-ins, an empty field, no Save and no chart', async () => {
      await saveWeightGoal(token, 180, 150)

      await openWeight(page)

      await expect.poll(() => weight.noWeighIns().isVisible(), eventually).toBe(true)
      expect(await fieldValue()).toBe('')
      expect(await weight.field().getAttribute('placeholder')).toBe("Today's weight")
      expect(await weight.save().isDisabled()).toBe(true)
      for (const tile of ['Current', 'Lost', 'To go'] as const) {
        expect(await tileText(tile)).toContain('—')
      }
      expect(await tileText('Progress')).toContain('0%')
      expect(await weight.chart().count()).toBe(0)
    })

    it('U6 — saving the first weigh-in', async () => {
      await openWeight(page)
      await expect.poll(() => weight.noWeighIns().isVisible(), eventually).toBe(true)

      await saveWeight('179.4')

      expect(await fieldValue()).toBe('179.4')
      expect(await tileText('Current')).toContain('179.4 lb')
      expect(await weight.chartStartsTomorrow().isVisible()).toBe(true)
    })

    it("U7 — today's weight is still there after a reload", async () => {
      await openWeight(page)
      await saveWeight('179.4')

      await page.reload()

      await expect.poll(fieldValue, eventually).toBe('179.4')
      expect(await weight.savedToday().isVisible()).toBe(true)
    })

    it("U8 — saving again the same day replaces today's weight", async () => {
      await openWeight(page)
      await saveWeight('179.4')

      await saveWeight('178.6')

      expect(await fieldValue()).toBe('178.6')
      await expect.poll(() => tileText('Current'), eventually).toContain('178.6 lb')
      expect((await weightHistory(token)).entries).toEqual([
        expect.objectContaining({ date: dateIn(), weight: 178.6 }),
      ])
    })

    it('U9 — on a new day the field shows the last weigh-in and its date', async () => {
      await logWeight(token, 179.4, dateIn(1))

      await openWeight(page)

      await expect.poll(fieldValue, eventually).toBe('179.4')
      expect(await weight.lastWeighIn(dateIn(1)).isVisible()).toBe(true)
      expect(await weight.save().isEnabled()).toBe(true)
    })

    it("U10 — on a new day, Save without changes logs today's weight", async () => {
      await logWeight(token, 179.4, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('179.4')

      await weight.save().click()

      await expect.poll(() => weight.savedToday().isVisible(), eventually).toBe(true)
      expect((await weightHistory(token)).entries).toEqual([
        expect.objectContaining({ date: dateIn(1), weight: 179.4 }),
        expect.objectContaining({ date: dateIn(), weight: 179.4 }),
      ])
    })

    it("U11 — on a new day, a new weight is logged for today and yesterday's stays", async () => {
      await logWeight(token, 179.4, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('179.4')

      await saveWeight('178.2')

      expect((await weightHistory(token)).entries).toEqual([
        expect.objectContaining({ date: dateIn(1), weight: 179.4 }),
        expect.objectContaining({ date: dateIn(), weight: 178.2 }),
      ])
    })

    it('U12 — the field keeps digits and one point with one decimal', async () => {
      await openWeight(page)
      await expect.poll(() => weight.field().isEnabled(), eventually).toBe(true)

      await weight.field().pressSequentially('a17x9.45.6')

      expect(await fieldValue()).toBe('179.4')
    })

    it('U13 — a weight under 50 shows the range error and cannot be saved', async () => {
      await openWeight(page)
      await expect.poll(() => weight.field().isEnabled(), eventually).toBe(true)

      await weight.field().fill('49.9')

      await expect.poll(() => weight.rangeError().isVisible(), eventually).toBe(true)
      expect(await weight.save().isDisabled()).toBe(true)
    })

    it('U14 — the field keeps its value instead of going over 999', async () => {
      await openWeight(page)
      await expect.poll(() => weight.field().isEnabled(), eventually).toBe(true)
      await weight.field().fill('999')

      await weight.field().pressSequentially('9')

      expect(await fieldValue()).toBe('999')
    })

    it('U15 — an empty field cannot be saved', async () => {
      await logWeight(token, 179.4, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('179.4')

      await weight.field().fill('')

      expect(await weight.save().isDisabled()).toBe(true)
    })

    it('U16 — a failed save shows the generic error and keeps the value', async () => {
      await openWeight(page)
      await expect.poll(() => weight.noWeighIns().isVisible(), eventually).toBe(true)
      await injectFault(PROXY_URL, { status: 500 }, username)

      await weight.field().fill('179.4')
      await weight.save().click()

      await expect.poll(() => weight.alert().isVisible(), eventually).toBe(true)
      expect(await textOf(weight.alert())).toBe(GENERIC_ERROR_MESSAGE)
      expect(await fieldValue()).toBe('179.4')
    })

    it('U17 — a history that fails to load shows the generic error', async () => {
      await injectFault(PROXY_URL, { status: 500 }, username)

      await openWeight(page)

      await expect.poll(() => weight.alert().isVisible(), eventually).toBe(true)
      expect(await textOf(weight.alert())).toBe(GENERIC_ERROR_MESSAGE)
    })
  })

  describe('progress and chart', () => {
    it('U18 — the tiles measure the last weigh-in against the goal', async () => {
      await saveWeightGoal(token, 180, 150)
      await logWeight(token, 170.8, dateIn())

      await openWeight(page)

      await expect.poll(() => tileText('Current'), eventually).toContain('170.8 lb')
      expect(await tileText('Lost')).toContain('9.2 lb')
      expect(await tileText('To go')).toContain('20.8 lb')
      expect(await tileText('Progress')).toContain('31%')
    })

    it('U19 — two weigh-ins show the chart with its points, trend, goal and start', async () => {
      await saveWeightGoal(token, 180, 150)
      await logWeight(token, 179, dateIn(1))
      await logWeight(token, 178, dateIn())

      await openWeight(page)

      await expect.poll(() => weight.chart().isVisible(), eventually).toBe(true)
      expect(await weight.points().count()).toBe(2)
      expect(await weight.line('trend').count()).toBe(1)
      expect(await weight.line('goal').count()).toBe(1)
      expect(await weight.line('start').count()).toBe(1)
    })

    describe('periods', () => {
      beforeEach(async () => {
        for (const [daysAgo, pounds] of [
          [199, 190],
          [100, 180],
          [45, 175],
          [20, 172],
          [0, 170],
        ] as const) {
          await logWeight(token, pounds, dateIn(daysAgo))
        }
      })

      it('U20 — the chart opens on the last 90 days', async () => {
        await openWeight(page)

        await expect.poll(() => weight.chart().isVisible(), eventually).toBe(true)
        expect(await weight.period('90D').isChecked()).toBe(true)
        expect(await weight.points().count()).toBe(3)
      })

      it('U21 — 30D shows the last 30 days', async () => {
        await openWeight(page)
        await expect.poll(() => weight.chart().isVisible(), eventually).toBe(true)

        await weight.period('30D').click()

        await expect.poll(() => weight.points().count(), eventually).toBe(2)
      })

      it('U22 — All shows every weigh-in', async () => {
        await openWeight(page)
        await expect.poll(() => weight.chart().isVisible(), eventually).toBe(true)

        await weight.period('All').click()

        await expect.poll(() => weight.points().count(), eventually).toBe(5)
      })
    })

    it('U23 — the dates fit the weigh-ins, not the whole period', async () => {
      for (const daysAgo of [6, 3, 0]) await logWeight(token, 180 - daysAgo, dateIn(daysAgo))

      await openWeight(page)

      await expect.poll(() => weight.chart().isVisible(), eventually).toBe(true)
      expect(await weight.period('90D').isChecked()).toBe(true)
      expect(await textOf(weight.axisStart())).toBe(shortDate(dateIn(6)))
      expect(await textOf(weight.axisEnd())).toBe(shortDate(dateIn()))
    })

    it('U24 — without a goal, a notice, the current weight only, and no goal or start lines', async () => {
      await logWeight(token, 179, dateIn(1))
      await logWeight(token, 178, dateIn())

      await openWeight(page)

      await expect.poll(() => weight.noGoalNotice().isVisible(), eventually).toBe(true)
      expect(await weight.noGoalSettingsLink().isVisible()).toBe(true)
      expect(await tileText('Current')).toContain('178 lb')
      for (const tile of ['Lost', 'To go', 'Progress'] as const) {
        expect(await tileText(tile)).toContain('—')
      }
      expect(await weight.line('trend').count()).toBe(1)
      expect(await weight.line('goal').count()).toBe(0)
      expect(await weight.line('start').count()).toBe(0)
    })

    it("U25 — the notice's link opens the Weight goal section of Settings", async () => {
      await openWeight(page)
      await expect.poll(() => weight.noGoalNotice().isVisible(), eventually).toBe(true)

      await weight.noGoalSettingsLink().click()

      await page.waitForURL((url) => url.pathname === '/settings')
      await expect
        .poll(
          () => page.getByRole('region', { name: 'Weight goal', exact: true }).isVisible(),
          eventually,
        )
        .toBe(true)
    })

    it('U30 — a past day logged through the API shows in the chart and only today can be saved', async () => {
      await logWeight(token, 176, dateIn(5))
      await logWeight(token, 175, dateIn(3))

      await openWeight(page)

      await expect.poll(() => weight.point(dateIn(3)).count(), eventually).toBe(1)
      expect(await weight.chart().locator('button, a, input').count()).toBe(0)
      expect(await weight.lastWeighIn(dateIn(3)).isVisible()).toBe(true)

      await saveWeight('176')

      expect((await weightHistory(token)).entries).toEqual([
        expect.objectContaining({ date: dateIn(5), weight: 176 }),
        expect.objectContaining({ date: dateIn(3), weight: 175 }),
        expect.objectContaining({ date: dateIn(), weight: 176 }),
      ])
    })

    it("U31 — today is the browser's day in its time zone", async () => {
      const timeZone = 'Pacific/Kiritimati'
      await reopen({ timezoneId: timeZone })
      await openWeight(page)
      await expect.poll(() => weight.field().isEnabled(), eventually).toBe(true)

      await saveWeight('179.4')

      expect((await weightHistory(token)).entries).toEqual([
        expect.objectContaining({ date: dateIn(0, timeZone), weight: 179.4 }),
      ])
    })
  })

  describe('reaching the goal', () => {
    it('U26 — crossing the goal throws confetti and says the goal is reached', async () => {
      await saveWeightGoal(token, 180, 150)
      await logWeight(token, 151, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('151')

      await weight.field().fill('150')
      await weight.save().click()

      await expect.poll(() => weight.confetti().count(), eventually).toBeGreaterThan(0)
      await expect.poll(() => weight.goalReached().isVisible(), eventually).toBe(true)
      expect(await tileText('To go')).toContain('0 lb')
      expect(await tileText('Progress')).toContain('100%')
    })

    it('U27 — saving again under the goal throws no confetti', async () => {
      await saveWeightGoal(token, 180, 150)
      await logWeight(token, 149.5, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('149.5')

      await saveWeight('149')
      await page.waitForTimeout(CONFETTI_WAIT_MS)

      expect(await weight.confetti().count()).toBe(0)
      expect(await weight.goalReached().isVisible()).toBe(true)
    })

    it('U28 — a first weigh-in under the goal throws confetti, measured from the starting weight', async () => {
      await saveWeightGoal(token, 180, 150)
      await openWeight(page)
      await expect.poll(() => weight.noWeighIns().isVisible(), eventually).toBe(true)

      await weight.field().fill('149')
      await weight.save().click()

      await expect.poll(() => weight.confetti().count(), eventually).toBeGreaterThan(0)
    })

    it('U29 — with reduced motion, no confetti but the goal is reached', async () => {
      await reopen({ reducedMotion: 'reduce' })
      await saveWeightGoal(token, 180, 150)
      await logWeight(token, 151, dateIn(1))
      await openWeight(page)
      await expect.poll(fieldValue, eventually).toBe('151')

      await saveWeight('150')
      await page.waitForTimeout(CONFETTI_WAIT_MS)

      expect(await weight.confetti().count()).toBe(0)
      expect(await weight.goalReached().isVisible()).toBe(true)
    })
  })
})
