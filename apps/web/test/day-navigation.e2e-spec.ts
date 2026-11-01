import type { DailyLog } from '@open-calorie-tracker/shared'
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { MOBILE, eventually, textOf } from './browser'
import {
  homePage,
  newYorkTime,
  openHome,
  pullToRefresh,
  seedFoodEntry,
  seedWaterEntry,
  swipe,
} from './daily-log'
import { connectDatabase, signedInPage } from './session'
import { SEEDED } from './fixtures'

// All observations go through the browser or the public daily-log API, not database storage.
describe('Selected-day log (e2e)', () => {
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
    ;({ context, page, username } = await signedInPage(browser, database, MOBILE))
    home = homePage(page)
    await seedFoodEntry(database, {
      username,
      name: 'Today food',
      servingSize: '1 plate',
      quantity: 1,
      calories: 100,
      loggedAt: newYorkTime('2026-10-24T10:00:00'),
    })
    await seedWaterEntry(database, {
      username,
      amount: 8,
      loggedAt: newYorkTime('2026-10-24T10:01:00'),
    })
  })
  afterEach(async () => {
    await context.close()
  })

  const select = async (date: string) => {
    await home.week().getByRole('button', { name: date, exact: true }).click()
    await expect.poll(() => textOf(home.footer()), eventually).toContain(`date ${date}`)
  }
  // Phones turn the week with a swipe: to the left for the next one.
  const turnWeek = async (direction: 'next' | 'previous', date: string) => {
    await swipe(page, home.week(), direction === 'next' ? -150 : 150)
    await expect.poll(() => textOf(home.footer()), eventually).toContain(`date ${date}`)
  }
  const total = async (name: string, value: string) => {
    await expect
      .poll(() => home.progress(name).getAttribute('aria-valuenow'), eventually)
      .toBe(value)
  }
  const noFormDate = async () => {
    const dialog = page.getByRole('dialog')
    expect(await dialog.locator('input[type="date"], input[type="datetime-local"]').count()).toBe(0)
    expect(await textOf(dialog)).not.toMatch(/today|2026|October|October 23/i)
  }
  const apiLog = async (date: string): Promise<DailyLog> => {
    const response = await context.request.get(
      `${SEEDED.webUrl}/api/daily-log?date=${date}&timeZone=America%2FNew_York`,
    )
    expect(response.status()).toBe(200)
    return (await response.json()) as DailyLog
  }

  it('keeps the initial header connected while resolving the browser day', async () => {
    // Observe from document parsing, before hydration can replace the server-rendered header.
    await page.addInitScript(() => {
      let initialHeader: HTMLElement | null = null
      new MutationObserver(() => {
        initialHeader ??= document.querySelector('header')
        if (initialHeader !== null) {
          document.documentElement.setAttribute(
            'data-original-header-connected',
            String(initialHeader.isConnected),
          )
        }
      }).observe(document, { childList: true, subtree: true })
    })
    await openHome(page)
    await total('Calories', '100')
    expect(await page.locator('html').getAttribute('data-original-header-connected')).toBe('true')
  })

  it('keeps the header and Settings link connected across day switches', async () => {
    await openHome(page)
    await total('Calories', '100')
    const header = await page.getByRole('banner').elementHandle()
    const settings = await page.getByRole('link', { name: 'Settings', exact: true }).elementHandle()
    if (header === null || settings === null) throw new Error('Missing Food Log header')
    for (const date of ['2026-10-23', '2026-10-24']) {
      await select(date)
      await total('Calories', date === '2026-10-24' ? '100' : '0')
      expect(await header.evaluate((element) => element.isConnected)).toBe(true)
      expect(await settings.evaluate((element) => element.isConnected)).toBe(true)
      expect(await settings.boundingBox()).not.toBeNull()
    }
  })

  it('navigates days and weeks across month and year boundaries', async () => {
    await openHome(page)
    await total('Calories', '100')
    await select('2026-10-23')
    await total('Calories', '0')
    expect(await home.entry('Today food').count()).toBe(0)
    expect(await home.week().locator('[aria-current="date"]').getAttribute('aria-label')).toBe(
      '2026-10-23',
    )
    await turnWeek('next', '2026-10-30')
    await select('2026-11-01')
    await turnWeek('previous', '2026-10-25')
    await select('2026-10-24')
    await total('Calories', '100')
    // Ten weeks later, the same weekday.
    for (const date of [
      '2026-10-31',
      '2026-11-07',
      '2026-11-14',
      '2026-11-21',
      '2026-11-28',
      '2026-12-05',
      '2026-12-12',
      '2026-12-19',
      '2026-12-26',
      '2027-01-02',
    ]) {
      await turnWeek('next', date)
    }
    await select('2027-01-01')
    await total('Calories', '0')
    expect(await textOf(home.dailyLog())).toContain('Friday, January 1, 2027')
  })

  it('adds, edits and deletes both types on the viewed day without moving timestamps or changing today', async () => {
    await openHome(page)
    await total('Calories', '100')
    await select('2026-10-23')
    await total('Calories', '0')
    await page.getByRole('main').getByRole('button', { name: 'Add food', exact: true }).click()
    await noFormDate()
    const food = page.getByRole('dialog', { name: 'Add food', exact: true })
    await food.getByRole('textbox', { name: 'Food', exact: true }).fill('Yesterday food')
    await food.getByRole('combobox', { name: 'Serving size' }).fill('1 plate')
    await food.getByRole('textbox', { name: 'Calories per serving' }).fill('200')
    await food.getByRole('button', { name: 'Add 200 kcal', exact: true }).click()
    await total('Calories', '200')
    await page.getByRole('main').getByRole('button', { name: 'Add water', exact: true }).click()
    await noFormDate()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Glass/ })
      .click()
    await total('Water', '8')
    const original = await apiLog('2026-10-23')
    expect(original.entries).toHaveLength(2)
    for (const entry of original.entries) expect(entry.loggedAt).toBe('2026-10-23T15:00:00.000Z')

    await home.entry('Yesterday food').getByRole('button').click()
    await noFormDate()
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Calories per serving' })
      .fill('300')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save 300 kcal', exact: true })
      .click()
    await total('Calories', '300')
    await home.entry('Water').getByRole('button').click()
    await noFormDate()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Bottle/ })
      .click()
    await total('Water', '16')
    const edited = await apiLog('2026-10-23')
    expect(edited.entries.map((entry) => entry.loggedAt)).toEqual(
      original.entries.map((entry) => entry.loggedAt),
    )
    await select('2026-10-24')
    await total('Calories', '100')
    await total('Water', '8')
    expect(await home.entry('Yesterday food').count()).toBe(0)
    await select('2026-10-23')
    await total('Calories', '300')
    for (const name of ['Yesterday food', 'Water']) {
      await home.entry(name).getByRole('button').click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      const confirmation = page.getByRole('alertdialog')
      expect(await textOf(confirmation)).not.toMatch(/today|2026|October/i)
      await confirmation.getByRole('button', { name: /^Delete \d/ }).click()
      await expect.poll(() => confirmation.count(), eventually).toBe(0)
    }
    await total('Calories', '0')
    await total('Water', '0')
    expect((await apiLog('2026-10-23')).entries).toHaveLength(0)
    const today = await apiLog('2026-10-24')
    expect(today.entries).toHaveLength(2)
    expect(today.totals.calories).toBe(100)
    expect(today.totals.water).toBe(8)
  })

  // Hold a response after it has captured its payload, rather than merely delaying the request.
  const holdLog = async (date: string, status?: number) => {
    let release = () => {}
    let arrived = () => {}
    const ready = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let finished = () => {}
    const done = new Promise<void>((resolve) => {
      finished = resolve
    })
    await page.route(
      '**/api/daily-log?**',
      async (route) => {
        if (new URL(route.request().url()).searchParams.get('date') !== date) {
          await route.continue()
          return
        }
        const response = await route.fetch()
        arrived()
        await gate
        await route.fulfill(status === undefined ? { response } : { status, body: '{}' })
        finished()
      },
      { times: 1 },
    )
    return { ready, release, done }
  }
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )

  it.each([undefined, 500, 401])(
    'ignores an old day response (%s), including errors and authorization',
    async (status) => {
      await openHome(page)
      await total('Calories', '100')
      const old = await holdLog('2026-10-23', status)
      await select('2026-10-23')
      await old.ready
      // An unloaded day must never expose the previous day's entries or add buttons.
      expect(await home.entry('Today food').count()).toBe(0)
      expect(
        await page.getByRole('main').getByRole('button', { name: 'Add food', exact: true }).count(),
      ).toBe(0)
      await select('2026-10-24')
      await total('Calories', '100')
      old.release()
      await old.done
      await settle()
      expect(await home.alert().count()).toBe(0)
      expect(await home.progress('Calories').getAttribute('aria-valuenow')).toBe('100')
      expect(new URL(page.url()).pathname).toBe('/')
    },
  )

  it.each([undefined, 500, 401])(
    'ignores a reload from a previous visit to the same day (%s)',
    async (status) => {
      await openHome(page)
      await total('Calories', '100')
      const old = await holdLog('2026-10-24', status)
      await pullToRefresh(page)
      await old.ready
      await select('2026-10-23')
      await total('Calories', '0')
      await seedFoodEntry(database, {
        username,
        name: 'New today food',
        servingSize: '1 plate',
        quantity: 1,
        calories: 200,
        loggedAt: newYorkTime('2026-10-24T10:02:00'),
      })
      await select('2026-10-24')
      await total('Calories', '300')
      old.release()
      await old.done
      await settle()
      expect(await home.alert().count()).toBe(0)
      expect(await home.progress('Calories').getAttribute('aria-valuenow')).toBe('300')
      expect(new URL(page.url()).pathname).toBe('/')
    },
  )
})
