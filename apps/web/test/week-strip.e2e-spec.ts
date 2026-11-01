import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { MOBILE, eventually, textOf } from './browser'
import {
  homePage,
  newYorkTime,
  openHome,
  seedDailyGoals,
  seedFoodEntry,
  seedWaterEntry,
  swipe,
} from './daily-log'
import { connectDatabase, signedInPage } from './session'

// The week of NOW, Saturday 2026-10-24.
const WEEK = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
]

describe('Week strip (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
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
  afterEach(async () => {
    await context.close()
  })

  const open = async (device: object = {}) => {
    ;({ context, page, username } = await signedInPage(browser, database, device))
    home = homePage(page)
    await seedDailyGoals(database, { username, calories: 2000 })
  }

  const logFood = (localDateTime: string, calories: number) =>
    seedFoodEntry(database, {
      username,
      loggedAt: newYorkTime(localDateTime),
      name: 'Tacos',
      servingSize: '1 serving',
      quantity: 1,
      calories,
    })

  const descriptions = async () =>
    Promise.all(WEEK.map((date) => home.day(date).getAttribute('aria-description')))
  const statuses = async () =>
    Promise.all(WEEK.map((date) => home.day(date).getAttribute('data-status')))
  const weekLabel = () => textOf(page.getByRole('main').getByText(/^\w{3} \d+ – \w{3} \d+/))
  const footerDate = async (date: string) => {
    await expect.poll(() => textOf(home.footer()), eventually).toContain(`date ${date}`)
  }
  const todayButton = () => page.getByRole('button', { name: 'Today', exact: true })

  describe('on a computer', () => {
    beforeEach(async () => {
      await open()
    })

    it('shows how each day went against the calorie goal', async () => {
      await logFood('2026-10-19T08:00:00', 600)
      await logFood('2026-10-19T13:00:00', 400)
      // 90% of the goal is on target.
      await logFood('2026-10-20T13:00:00', 1800)
      await logFood('2026-10-21T13:00:00', 2400)
      // Water alone is nothing logged.
      await seedWaterEntry(database, {
        username,
        loggedAt: newYorkTime('2026-10-23T10:00:00'),
        amount: 16,
      })
      await logFood('2026-10-24T10:00:00', 100)

      await openHome(page)

      await expect
        .poll(descriptions, eventually)
        .toEqual([
          '1,000 of 2,000 kcal',
          '1,800 of 2,000 kcal',
          '2,400 of 2,000 kcal',
          'Nothing logged',
          'Nothing logged',
          'Today, 100 of 2,000 kcal',
          'Upcoming',
        ])
      expect(await statuses()).toEqual(['under', 'on', 'over', 'none', 'none', 'under', 'future'])
    })

    it('keeps marking today when another day is selected', async () => {
      await openHome(page)
      await expect.poll(descriptions, eventually).toContain('Today, Nothing logged')

      await home.day('2026-10-23').click()

      await footerDate('2026-10-23')
      expect(await home.week().locator('[aria-current="date"]').getAttribute('aria-label')).toBe(
        '2026-10-23',
      )
      expect(await home.day('2026-10-24').getAttribute('aria-description')).toBe(
        'Today, Nothing logged',
      )
    })

    it('names the viewed week and how far it is from this one', async () => {
      await openHome(page)
      await expect.poll(weekLabel, eventually).toBe('Oct 19 – Oct 25 · This week')

      await page.getByRole('button', { name: 'Next week', exact: true }).click()
      await expect.poll(weekLabel, eventually).toBe('Oct 26 – Nov 1 · Next week')

      for (const _week of [1, 2]) {
        await page.getByRole('button', { name: 'Previous week', exact: true }).click()
      }
      await expect.poll(weekLabel, eventually).toBe('Oct 12 – Oct 18 · Last week')

      await page.getByRole('button', { name: 'Previous week', exact: true }).click()
      await expect.poll(weekLabel, eventually).toBe('Oct 5 – Oct 11')
    })

    it('goes back to today with the Today button, shown only away from today', async () => {
      await openHome(page)
      await footerDate('2026-10-24')
      expect(await todayButton().count()).toBe(0)

      for (const _week of [1, 2]) {
        await page.getByRole('button', { name: 'Next week', exact: true }).click()
      }
      await footerDate('2026-11-07')
      await todayButton().click()

      await footerDate('2026-10-24')
      expect(await weekLabel()).toBe('Oct 19 – Oct 25 · This week')
      await expect.poll(() => todayButton().count(), eventually).toBe(0)
    })

    it("updates the day's progress after logging food on it", async () => {
      await openHome(page)
      await home.day('2026-10-22').click()
      await footerDate('2026-10-22')
      await expect
        .poll(() => home.day('2026-10-22').getAttribute('data-status'), eventually)
        .toBe('none')

      await page.getByRole('main').getByRole('button', { name: 'Add food', exact: true }).click()
      const food = page.getByRole('dialog', { name: 'Add food', exact: true })
      await food.getByRole('textbox', { name: 'Food', exact: true }).fill('Tacos')
      await food.getByRole('combobox', { name: 'Serving size' }).fill('1 serving')
      await food.getByRole('textbox', { name: 'Calories per serving' }).fill('200')
      await food.getByRole('button', { name: 'Add 200 kcal', exact: true }).click()

      await expect
        .poll(() => home.day('2026-10-22').getAttribute('aria-description'), eventually)
        .toBe('200 of 2,000 kcal')
      expect(await home.day('2026-10-22').getAttribute('data-status')).toBe('under')
    })
  })

  describe('on a mobile device', () => {
    beforeEach(async () => {
      await open(MOBILE)
      await openHome(page)
      await footerDate('2026-10-24')
    })

    const days = async () => Promise.all((await home.weekDays().all()).map(textOf))

    it('swipes left to the next week and right to the previous ones', async () => {
      await swipe(page, home.week(), -150)

      await footerDate('2026-10-31')
      expect(await weekLabel()).toBe('Oct 26 – Nov 1 · Next week')
      expect(await days()).toEqual([
        'Mon 26',
        'Tue 27',
        'Wed 28',
        'Thu 29',
        'Fri 30',
        'Sat 31',
        'Sun 1',
      ])

      await swipe(page, home.week(), 150)
      await footerDate('2026-10-24')
      await swipe(page, home.week(), 150)

      await footerDate('2026-10-17')
      expect(await weekLabel()).toBe('Oct 12 – Oct 18 · Last week')
    })

    it('stays on the week after a short swipe', async () => {
      await swipe(page, home.week(), -30)

      await page.waitForTimeout(500)
      expect(await textOf(home.footer())).toContain('date 2026-10-24')
      expect(await weekLabel()).toBe('Oct 19 – Oct 25 · This week')
    })

    it('still selects a day by tapping it after a swipe', async () => {
      await swipe(page, home.week(), -150)
      await footerDate('2026-10-31')

      await home.day('2026-10-28').tap()

      await footerDate('2026-10-28')
    })
  })
})
