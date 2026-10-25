import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { eventually, openPage, textOf } from './browser'
import { homePage, newYorkTime, openHome, seedFoodEntry, seedWaterEntry } from './daily-log'
import { clearFault, injectFault } from './fault-proxy'
import { SEEDED } from './fixtures'
import { connectDatabase, createUser, logIn } from './session'

const { proxyUrl: PROXY_URL } = SEEDED

const food = (username: string, overrides: Partial<Parameters<typeof seedFoodEntry>[1]> = {}) => ({
  username,
  loggedAt: newYorkTime('2026-10-24T10:53:00'),
  name: '2 tortillas de maíz',
  servingSize: '1 serving',
  quantity: 1,
  calories: 100,
  ...overrides,
})

describe('Home page (e2e)', () => {
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

  beforeEach(async () => {
    ;({ context, page } = await openPage(browser))
    home = homePage(page)
    username = await createUser(database)
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  describe('when logged in', () => {
    beforeEach(async () => {
      await logIn(context, username)
    })

    describe('header, week and footer', () => {
      it("shows the page title and today's date", async () => {
        await openHome(page)

        expect(await home.title().isVisible()).toBe(true)
        await expect.poll(() => textOf(home.dailyLog()), eventually).toContain('Daily log')
        expect(await textOf(home.dailyLog())).toContain('Saturday, October 24, 2026')
      })

      it('shows the current week with today highlighted', async () => {
        await openHome(page)

        await expect
          .poll(async () => Promise.all((await home.weekDays().all()).map(textOf)), eventually)
          .toEqual(['Mon 19', 'Tue 20', 'Wed 21', 'Thu 22', 'Fri 23', 'Sat 24', 'Sun 25'])
        expect(await textOf(home.week().locator('[aria-current="date"]'))).toBe('Sat 24')
      })

      it('shows the log date and the browser time zone in the footer', async () => {
        await openHome(page)

        await expect
          .poll(() => textOf(home.footer()), eventually)
          .toBe('Food Log date 2026-10-24 · Time zone America/New_York')
      })
    })

    describe('entries', () => {
      it('shows a food entry', async () => {
        await seedFoodEntry(database, food(username))

        await openHome(page)

        const entry = home.entry('2 tortillas de maíz')
        await expect.poll(() => textOf(entry), eventually).toContain('10:53 AM')
        const text = await textOf(entry)
        expect(text).toContain('Manual')
        expect(text).toContain('1 serving × 1')
        expect(text).toContain('100 kcal')
        expect(await entry.getByRole('img', { name: 'Food' }).isVisible()).toBe(true)
      })

      it('shows the portion as serving size × quantity', async () => {
        await seedFoodEntry(
          database,
          food(username, { name: 'Café', servingSize: '1 cup', quantity: 2 }),
        )

        await openHome(page)

        await expect.poll(() => textOf(home.entry('Café')), eventually).toContain('1 cup × 2')
      })

      it('shows a water entry without calories', async () => {
        await seedWaterEntry(database, {
          username,
          loggedAt: newYorkTime('2026-10-24T10:43:00'),
          amount: 16.9,
        })

        await openHome(page)

        const entry = home.entries().first()
        await expect.poll(() => textOf(entry), eventually).toContain('16.9 fl oz')
        const text = await textOf(entry)
        expect(text).toContain('10:43 AM')
        expect(text).toContain('Water')
        expect(text).not.toContain('kcal')
        expect(await entry.getByRole('img', { name: 'Water' }).isVisible()).toBe(true)
      })

      it('sorts the entries newest first', async () => {
        await seedWaterEntry(database, {
          username,
          loggedAt: newYorkTime('2026-10-24T10:43:00'),
          amount: 16.9,
        })
        await seedFoodEntry(database, food(username))

        await openHome(page)

        await expect.poll(() => home.entries().count(), eventually).toBe(2)
        expect(await textOf(home.entries().nth(0))).toContain('10:53 AM')
        expect(await textOf(home.entries().nth(1))).toContain('10:43 AM')
      })

      it("shows only today's entries, using the browser time zone", async () => {
        for (const [name, localDateTime] of [
          ['Yesterday late snack', '2026-10-23T23:59:00'],
          ['Midnight snack', '2026-10-24T00:00:00'],
          ['Tomorrow midnight snack', '2026-10-25T00:00:00'],
        ] as const) {
          await seedFoodEntry(
            database,
            food(username, { name, loggedAt: newYorkTime(localDateTime) }),
          )
        }

        await openHome(page)

        await expect
          .poll(async () => Promise.all((await home.entries().all()).map(textOf)), eventually)
          .toEqual([expect.stringContaining('Midnight snack')])
        expect(await textOf(home.entries().first())).toContain('12:00 AM')
      })

      it("does not show other users' entries", async () => {
        const otherUser = await createUser(database)
        await seedFoodEntry(database, food(otherUser, { name: 'Pizza' }))
        await seedFoodEntry(database, food(username))

        await openHome(page)

        await expect.poll(() => home.entries().count(), eventually).toBe(1)
        expect(await page.getByText('Pizza').count()).toBe(0)
      })
    })

    describe('summary', () => {
      const seedBreakfast = async () => {
        await seedFoodEntry(
          database,
          food(username, {
            protein: 2.5,
            carbohydrate: 21,
            fat: 1.2,
            fiber: 3,
            sugar: 4,
            sodium: 20,
          }),
        )
        await seedFoodEntry(
          database,
          food(username, {
            name: '2 huevos + medio tomate + 2 cdas frijoles',
            calories: 181,
            protein: 14,
            carbohydrate: 8.3,
            fat: 11.4,
            fiber: 0,
            sugar: 8,
            sodium: 380,
          }),
        )
      }

      it("adds up the calories of today's foods, not counting water as a food entry", async () => {
        await seedBreakfast()
        await seedWaterEntry(database, {
          username,
          loggedAt: newYorkTime('2026-10-24T10:43:00'),
          amount: 16.9,
        })

        await openHome(page)

        const calories = home.summary('Calories')
        await expect.poll(() => textOf(calories), eventually).toContain('281')
        expect(await textOf(calories)).toContain('/ 1,600 kcal')
        expect(await textOf(calories)).toContain('2 Food Entries')
        expect(await home.progress('Calories').getAttribute('aria-valuenow')).toBe('281')
        expect(await home.progress('Calories').getAttribute('aria-valuemax')).toBe('1600')
      })

      it('uses the singular for a single food entry', async () => {
        await seedFoodEntry(database, food(username))

        await openHome(page)

        await expect
          .poll(() => textOf(home.summary('Calories')), eventually)
          .toContain('1 Food Entry')
        expect(await textOf(home.summary('Calories'))).not.toContain('1 Food Entries')
      })

      it.each([
        ['Protein', '16.5', '/ 120 g', '120'],
        ['Carbohydrate', '29.3', '/ 230 g', '230'],
        ['Fat', '12.6', '/ 70 g', '70'],
        ['Fiber', '3', '/ 25 g', '25'],
        ['Sugar max', '12', '/ 50 g', '50'],
        ['Sodium max', '400', '/ 2,300 mg', '2300'],
      ])('shows the %s total against its goal', async (nutrient, total, goal, max) => {
        await seedBreakfast()

        await openHome(page)

        const progress = home.progress(nutrient)
        await expect.poll(() => progress.getAttribute('aria-valuenow'), eventually).toBe(total)
        expect(await progress.getAttribute('aria-valuemax')).toBe(max)
        const text = await textOf(home.summary(nutrient))
        expect(text).toContain(total)
        expect(text).toContain(goal)
      })

      it('counts a missing nutrient as 0', async () => {
        await seedFoodEntry(database, food(username, { sugar: 10 }))
        await seedFoodEntry(database, food(username, { name: 'Sin datos de azúcar' }))

        await openHome(page)

        await expect
          .poll(() => home.progress('Sugar max').getAttribute('aria-valuenow'), eventually)
          .toBe('10')
        expect(await textOf(home.summary('Sugar max'))).toContain('/ 50 g')
        expect(await page.getByText('Incomplete').count()).toBe(0)
        expect(await page.getByText('known').count()).toBe(0)
      })

      it('changes the color of a bar that goes over its goal', async () => {
        await seedFoodEntry(database, food(username, { calories: 2000, protein: 10 }))

        await openHome(page)

        await expect.poll(() => textOf(home.summary('Calories')), eventually).toContain('2,000')
        expect(await home.progress('Calories').getAttribute('data-over-goal')).toBe('true')
        expect(await home.progress('Protein').getAttribute('data-over-goal')).toBe('false')
      })

      it("adds up today's water", async () => {
        for (const amount of [10, 6.9]) {
          await seedWaterEntry(database, {
            username,
            loggedAt: newYorkTime('2026-10-24T10:43:00'),
            amount,
          })
        }

        await openHome(page)

        await expect.poll(() => textOf(home.summary('Water')), eventually).toContain('16.9 fl oz')
        expect(await textOf(home.summary('Water'))).toContain('/ 64 fl oz')
        expect(await home.progress('Water').getAttribute('aria-valuenow')).toBe('16.9')
        expect(await home.progress('Water').getAttribute('aria-valuemax')).toBe('64')
      })
    })

    describe('empty day and errors', () => {
      it('shows an empty state and zero totals when nothing was logged today', async () => {
        await openHome(page)

        await expect
          .poll(() => textOf(home.dailyLog()), eventually)
          .toContain('No entries for this day')
        expect(await textOf(home.dailyLog())).toContain("Add food or water when you're ready.")
        expect(await home.entries().count()).toBe(0)

        const calories = await textOf(home.summary('Calories'))
        expect(calories).toContain('/ 1,600 kcal')
        expect(calories).toContain('No Food Entries')
        for (const name of [
          'Calories',
          'Protein',
          'Carbohydrate',
          'Fat',
          'Fiber',
          'Sugar max',
          'Sodium max',
          'Water',
        ]) {
          expect(await home.progress(name).getAttribute('aria-valuenow')).toBe('0')
        }
        expect(await textOf(home.summary('Water'))).toContain('0 fl oz')
        expect(await textOf(home.summary('Water'))).toContain('/ 64 fl oz')
      })

      it('shows a generic error when the log cannot be loaded', async () => {
        await injectFault(PROXY_URL, { status: 500 }, username)

        await openHome(page)

        await expect.poll(() => home.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
      })

      it('shows a generic error when the backend is unreachable', async () => {
        await injectFault(PROXY_URL, 'connection-reset', username)

        await openHome(page)

        await expect.poll(() => home.alert().textContent(), eventually).toBe(GENERIC_ERROR_MESSAGE)
      })
    })
  })
})
