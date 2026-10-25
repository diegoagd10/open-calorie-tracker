import {
  DEFAULT_DAILY_GOALS,
  GENERIC_ERROR_MESSAGE,
  MAX_WATER_AMOUNT,
  WATER_PRESETS,
} from '@open-calorie-tracker/shared'
import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
  chromium,
} from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { MOBILE, box, eventually, textOf } from './browser'
import { deleteWaterEntry } from './database'
import {
  homePage,
  minutesIntoToday,
  seedFoodEntry,
  seedWaterEntry,
  storedWaterEntries,
  timeLabel,
} from './daily-log'
import { clearFault, injectFault, receivedRequests } from './fault-proxy'
import { SEEDED, signAccessToken } from './fixtures'
import { connectDatabase, setSessionCookie, signedInPage } from './session'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const WATER_ENTRIES_URL = `${WEB_URL}/api/water-entries`

// "<total> fl oz / <goal> fl oz", as the Water summary shows it.
const ofGoal = (total: number) => `${total} fl oz / ${DEFAULT_DAILY_GOALS.water} fl oz`

// Seeded entries sit a few minutes into the real today; see minutesIntoToday.
const FIRST = minutesIntoToday(1)
const SECOND = minutesIntoToday(2)

describe('Water (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let home: ReturnType<typeof homePage>
  // The page's requests to the water routes, e.g. "POST /api/water-entries".
  let waterRequests: string[]

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
    waterRequests = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/water-entries')) {
        waterRequests.push(`${request.method()} ${pathname}`)
      }
    })
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  const seedWater = (amount: number, loggedAt = FIRST) =>
    seedWaterEntry(database, { username, loggedAt, amount })

  // Uses the real clock, unlike openHome: entries the page creates get the API's real time.
  const openLog = async () => {
    await page.goto(`${WEB_URL}/`)
    await expect.poll(() => home.summary('Calories').isVisible(), eventually).toBe(true)
  }

  const addButton = () => page.getByRole('button', { name: 'Add water' })
  const addDialog = () => page.getByRole('dialog', { name: 'Add water' })
  const editDialog = () => page.getByRole('dialog', { name: 'Edit water' })
  const confirmation = () => page.getByRole('alertdialog')
  const preset = (dialog: Locator, name: string) => dialog.getByRole('button', { name })
  const button = (dialog: Locator, name: string) =>
    dialog.getByRole('button', { name, exact: true })
  // "Add" or "Save" while there is no amount to log, "Add 12 fl oz" once there is.
  const submitButton = (dialog: Locator, verb: 'Add' | 'Save') =>
    dialog.getByRole('button', { name: new RegExp(`^${verb}( [\\d.]+ fl oz)?$`) })
  const addSubmit = () => submitButton(addDialog(), 'Add')
  const saveSubmit = () => submitButton(editDialog(), 'Save')
  const confirmDelete = () => confirmation().getByRole('button', { name: /^Delete [\d.]+ fl oz$/ })
  const amountField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Amount (fl oz)' })
  const entryButton = (amount: string, loggedAt: Date) =>
    page.getByRole('button', { name: `Water, ${amount} fl oz, ${timeLabel(loggedAt)}` })

  const waterSummary = () => textOf(home.summary('Water'))
  const entryTexts = async () => (await home.entries().allInnerTexts()).map(normalize)
  const normalize = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

  const isHidden = (locator: Locator) => async () => !(await locator.isVisible())

  const openAddDialog = async () => {
    await openLog()
    await addButton().click()
    await expect.poll(() => addDialog().isVisible(), eventually).toBe(true)
  }

  const openEditDialog = async (amount = '16', loggedAt = FIRST) => {
    await openLog()
    await entryButton(amount, loggedAt).click()
    await expect.poll(() => editDialog().isVisible(), eventually).toBe(true)
  }

  const openConfirmation = async () => {
    await openEditDialog()
    await button(editDialog(), 'Delete').click()
    await expect.poll(() => confirmation().isVisible(), eventually).toBe(true)
  }

  const goal = DEFAULT_DAILY_GOALS.water

  const requestsTo = (method: string) =>
    waterRequests.filter((request) => request.startsWith(`${method} `))

  // Holds the page's requests to the water routes until released.
  const holdWaterRequests = async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/water-entries**', async (route) => {
      await released
      await route.continue()
    })
    return release
  }

  describe('the water dialog', () => {
    it('opens from "Add water" with the presets and the amount field', async () => {
      await openAddDialog()

      for (const { name, amount } of WATER_PRESETS) {
        const text = await textOf(preset(addDialog(), name))
        expect(text).toContain(name)
        expect(text).toContain(`${amount} fl oz`)
      }
      expect(await amountField(addDialog()).inputValue()).toBe('')
      expect(await textOf(addDialog())).toContain(
        `Up to ${MAX_WATER_AMOUNT} fl oz, one decimal allowed.`,
      )
    })

    it.each([
      ['clicking Cancel', () => button(addDialog(), 'Cancel').click()],
      ['clicking Close', () => button(addDialog(), 'Close').click()],
      ['pressing Escape', () => page.keyboard.press('Escape')],
      ['clicking outside the dialog', () => page.mouse.click(10, 10)],
    ])('closes without saving anything when %s', async (_case, close) => {
      await openAddDialog()

      await close()

      await expect.poll(isHidden(addDialog()), eventually).toBe(true)
      expect(waterRequests).toEqual([])
    })

    it("shows today's water and what each preset would bring it to", async () => {
      await seedWater(24)
      await seedWater(16, SECOND)

      await openAddDialog()

      const text = await textOf(addDialog())
      expect(text).toContain(`40 of ${goal} fl oz today · ${goal - 40} to go`)
      expect(await textOf(preset(addDialog(), 'Glass'))).toContain('→ 48 today')
      expect(await textOf(preset(addDialog(), 'Bottle'))).toContain('→ 56 today')
      expect(await textOf(preset(addDialog(), 'Gallon'))).toContain('Goal reached')
    })

    it('shows the whole goal to go on an empty day', async () => {
      await openAddDialog()

      expect(await textOf(addDialog())).toContain(`0 of ${goal} fl oz today · ${goal} to go`)
    })

    it('says the goal is reached once today reaches it, and so does every preset', async () => {
      await seedWater(goal)

      await openAddDialog()

      expect(await textOf(addDialog())).toContain(`${goal} of ${goal} fl oz today · goal reached`)
      for (const { name } of WATER_PRESETS) {
        expect(await textOf(preset(addDialog(), name))).toContain('Goal reached')
      }
    })
  })

  describe('presets', () => {
    it.each(WATER_PRESETS)('logs a $name at once with one tap', async ({ name, amount }) => {
      await openAddDialog()
      const before = new Date()

      await preset(addDialog(), name).click()

      await expect.poll(isHidden(addDialog()), eventually).toBe(true)
      await expect.poll(entryTexts, eventually).toHaveLength(1)
      const after = new Date()
      const [entry = ''] = await entryTexts()
      expect(entry).toContain('Water')
      expect(entry).toContain(`${amount} fl oz`)
      expect([timeLabel(before), timeLabel(after)]).toContain(
        /\d{1,2}:\d{2} [AP]M/.exec(entry)?.[0],
      )
      expect(await waterSummary()).toContain(ofGoal(amount))
    })

    it('adds up with the water already logged today, newest first', async () => {
      await seedWater(16)
      await openAddDialog()

      await preset(addDialog(), 'Glass').click()

      await expect.poll(waterSummary, eventually).toContain(ofGoal(24))
      const entries = await entryTexts()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toContain('8 fl oz')
      expect(entries[1]).toContain(`${timeLabel(FIRST)} Water 16 fl oz`)
    })

    it('keeps adding up past the goal while the Water bar stays blue', async () => {
      await seedWater(DEFAULT_DAILY_GOALS.water)
      await openAddDialog()

      await preset(addDialog(), 'Glass').click()

      await expect.poll(waterSummary, eventually).toContain(ofGoal(DEFAULT_DAILY_GOALS.water + 8))
      expect(await home.progress('Water').getAttribute('data-over-goal')).toBe('false')
    })

    it('still turns the other bars red over their goal', async () => {
      await seedFoodEntry(database, {
        username,
        loggedAt: FIRST,
        name: 'Pozole',
        servingSize: '1 bowl',
        quantity: 1,
        calories: 2000,
      })
      await seedWater(DEFAULT_DAILY_GOALS.water + 8, SECOND)

      await openLog()

      expect(await home.progress('Calories').getAttribute('data-over-goal')).toBe('true')
      expect(await home.progress('Water').getAttribute('data-over-goal')).toBe('false')
    })
  })

  describe('custom amount', () => {
    it('logs the amount typed, from a button that names it', async () => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially('12.5')
      expect(await textOf(addSubmit())).toContain('Add 12.5 fl oz')
      await addSubmit().click()

      await expect.poll(isHidden(addDialog()), eventually).toBe(true)
      await expect.poll(waterSummary, eventually).toContain(ofGoal(12.5))
      expect(await entryTexts()).toEqual([expect.stringContaining('Water 12.5 fl oz')])
    })

    it('logs the amount when Enter is pressed', async () => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially('10')
      await amountField(addDialog()).press('Enter')

      await expect.poll(waterSummary, eventually).toContain(ofGoal(10))
    })

    it('previews the total with the amount typed', async () => {
      await seedWater(40)
      await openAddDialog()

      await amountField(addDialog()).pressSequentially('12')

      expect(await textOf(addDialog())).toContain(`With 12 fl oz: 52 / ${goal} fl oz`)
    })

    it.each([
      ['12.5', '12.5'],
      ['12.55', '12.5'],
      ['1a2', '12'],
      ['-5', '5'],
      ['1.2.3', '1.2'],
      [`${MAX_WATER_AMOUNT}0`, String(MAX_WATER_AMOUNT)],
      [String(MAX_WATER_AMOUNT), String(MAX_WATER_AMOUNT)],
    ])('shows %j typed as %j', async (typed, shown) => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially(typed)

      expect(await amountField(addDialog()).inputValue()).toBe(shown)
    })

    it.each([
      ['16 oz', '16'],
      [String(MAX_WATER_AMOUNT * 2), ''],
      ['7.25', '7.2'],
    ])('shows %j pasted as %j', async (pasted, shown) => {
      await openAddDialog()

      await amountField(addDialog()).focus()
      await page.keyboard.insertText(pasted)

      expect(await amountField(addDialog()).inputValue()).toBe(shown)
    })

    it('shows a disabled Add without a preview while the field is empty, so Enter sends nothing', async () => {
      await openAddDialog()

      expect(await textOf(addSubmit())).toBe('Add')
      expect(await addSubmit().isDisabled()).toBe(true)
      expect(await textOf(addDialog())).not.toContain('With ')
      await amountField(addDialog()).press('Enter')
      expect(requestsTo('POST')).toEqual([])
    })

    it('enables Add once an amount is typed and disables it again when cleared', async () => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially('8')
      expect(await addSubmit().isEnabled()).toBe(true)

      await amountField(addDialog()).clear()
      expect(await addSubmit().isDisabled()).toBe(true)
    })

    it.each(['0', '0.0', '.'])('keeps Add disabled for %j', async (typed) => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially(typed)

      expect(await addSubmit().isDisabled()).toBe(true)
    })

    it.each([
      ['', 'Increase amount', '1'],
      ['12', 'Increase amount', '13'],
      ['12.5', 'Increase amount', '13.5'],
      ['12', 'Decrease amount', '11'],
      ['1.5', 'Decrease amount', '0.5'],
    ])('turns %j into the amount %s gives', async (typed, stepper, shown) => {
      await openAddDialog()
      await amountField(addDialog()).pressSequentially(typed)

      await button(addDialog(), stepper).click()

      expect(await amountField(addDialog()).inputValue()).toBe(shown)
    })

    it.each([
      ['Decrease amount', ''],
      ['Decrease amount', '1'],
      ['Decrease amount', '0.5'],
      ['Increase amount', String(MAX_WATER_AMOUNT)],
      ['Increase amount', String(MAX_WATER_AMOUNT - 0.5)],
    ])('disables %s at %j', async (stepper, typed) => {
      await openAddDialog()

      await amountField(addDialog()).pressSequentially(typed)

      expect(await button(addDialog(), stepper).isDisabled()).toBe(true)
    })
  })

  describe('editing water', () => {
    beforeEach(async () => {
      await seedWater(16)
    })

    it('opens a water entry in the Edit water dialog', async () => {
      await openEditDialog()

      expect(await textOf(editDialog())).toContain(`Bottle · logged at ${timeLabel(FIRST)}`)
      for (const { name } of WATER_PRESETS) {
        expect(await preset(editDialog(), name).isVisible()).toBe(true)
      }
      expect(await amountField(editDialog()).inputValue()).toBe('16')
      for (const name of ['Delete', 'Cancel', 'Close']) {
        expect(await button(editDialog(), name).isVisible()).toBe(true)
      }
      expect(await textOf(saveSubmit())).toContain('Save 16 fl oz')
    })

    it('names an amount that matches no preset Water', async () => {
      await seedWater(12, SECOND)

      await openEditDialog('12', SECOND)

      expect(await textOf(editDialog())).toContain(`Water · logged at ${timeLabel(SECOND)}`)
    })

    it('previews what the change does to the total', async () => {
      await seedWater(8, SECOND)
      await openEditDialog()

      await amountField(editDialog()).fill('20')

      expect(await textOf(editDialog())).toContain('Was 16 · today 24 → 28 fl oz')
      expect(await textOf(saveSubmit())).toContain('Save 20 fl oz')
    })

    it('applies the same amount rules as adding', async () => {
      await openEditDialog()

      await amountField(editDialog()).clear()
      expect(await textOf(saveSubmit())).toBe('Save')
      expect(await saveSubmit().isDisabled()).toBe(true)

      await amountField(editDialog()).pressSequentially('1a2.55')
      expect(await amountField(editDialog()).inputValue()).toBe('12.5')

      await button(editDialog(), 'Increase amount').click()
      expect(await amountField(editDialog()).inputValue()).toBe('13.5')

      await amountField(editDialog()).clear()
      await amountField(editDialog()).pressSequentially('0')
      expect(await saveSubmit().isDisabled()).toBe(true)
    })

    it('replaces the amount with one tap on a preset', async () => {
      await openEditDialog()

      await preset(editDialog(), 'Glass').click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      await expect.poll(waterSummary, eventually).toContain(ofGoal(8))
      expect(await entryTexts()).toEqual([`${timeLabel(FIRST)} Water 8 fl oz`])
    })

    it('saves a custom amount and keeps the time and the position of the entry', async () => {
      await seedWater(8, SECOND)
      await openEditDialog()

      await amountField(editDialog()).fill('20.5')
      await saveSubmit().click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      const expected = [
        `${timeLabel(SECOND)} Water 8 fl oz`,
        `${timeLabel(FIRST)} Water 20.5 fl oz`,
      ]
      await expect.poll(entryTexts, eventually).toEqual(expected)
      await openLog()
      await expect.poll(entryTexts, eventually).toEqual(expected)
    })

    it('sends nothing when the amount did not change', async () => {
      await openEditDialog()

      await saveSubmit().click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      expect(requestsTo('PATCH')).toEqual([])
    })

    it('keeps the entry as it was when cancelled', async () => {
      await openEditDialog()

      await amountField(editDialog()).fill('30')
      await button(editDialog(), 'Cancel').click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      expect(await entryTexts()).toEqual([`${timeLabel(FIRST)} Water 16 fl oz`])
      expect(requestsTo('PATCH')).toEqual([])
    })
  })

  describe('deleting water', () => {
    beforeEach(async () => {
      await seedWater(16)
    })

    it('asks for confirmation, naming the entry and what it does to the total', async () => {
      await seedWater(24, SECOND)
      await openConfirmation()

      expect(await page.getByRole('alertdialog', { name: 'Delete this bottle?' }).isVisible()).toBe(
        true,
      )
      const text = await textOf(confirmation())
      expect(text).toContain('It comes off today’s total. This can’t be undone.')
      expect(text).toContain(`Bottle ${timeLabel(FIRST)} 16 fl oz`)
      expect(text).toContain(`Today’s water 40 → 24 / ${goal} fl oz`)
      expect(await textOf(confirmDelete())).toContain('Delete 16 fl oz')
      expect(await button(confirmation(), 'Keep it').isVisible()).toBe(true)
    })

    it('asks to delete a "water entry" when the amount matches no preset', async () => {
      await seedWater(12, SECOND)
      await openLog()
      await entryButton('12', SECOND).click()

      await button(editDialog(), 'Delete').click()

      await expect
        .poll(
          () => page.getByRole('alertdialog', { name: 'Delete this water entry?' }).isVisible(),
          eventually,
        )
        .toBe(true)
    })

    it('removes the entry and updates the total once confirmed', async () => {
      await seedWater(8, SECOND)
      await openConfirmation()

      await confirmDelete().click()

      await expect.poll(isHidden(confirmation()), eventually).toBe(true)
      expect(await editDialog().isVisible()).toBe(false)
      const expected = [`${timeLabel(SECOND)} Water 8 fl oz`]
      await expect.poll(entryTexts, eventually).toEqual(expected)
      expect(await waterSummary()).toContain(ofGoal(8))
      await openLog()
      await expect.poll(entryTexts, eventually).toEqual(expected)
    })

    it('goes back to the Edit water dialog when the entry is kept', async () => {
      await openConfirmation()

      await button(confirmation(), 'Keep it').click()

      await expect.poll(isHidden(confirmation()), eventually).toBe(true)
      expect(await editDialog().isVisible()).toBe(true)
      expect(requestsTo('DELETE')).toEqual([])
    })

    it('shows the empty state after deleting the last entry', async () => {
      await openConfirmation()

      await confirmDelete().click()

      await expect
        .poll(() => textOf(home.dailyLog()), eventually)
        .toContain('No entries for this day')
      expect(await waterSummary()).toContain(ofGoal(0))
    })
  })

  describe('the /api/water-entries routes', () => {
    // Calls the route the way the page does, with the session cookie unless it is null.
    const send = (method: string, path: string, body?: object, cookie: string | null = token) => {
      const headers: Record<string, string> = {}
      const init: RequestInit = { method, headers, redirect: 'manual' }
      if (cookie !== null) headers['Cookie'] = `access_token=${cookie}`
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(`${WATER_ENTRIES_URL}${path}`, init)
    }

    const seededId = async () => {
      await seedWater(16)
      const [entry] = await storedWaterEntries(database, username)
      if (entry === undefined) throw new Error('The entry was not seeded')
      return entry.id
    }

    it('forwards POST to the API with the session token', async () => {
      const response = await send('POST', '', { amount: 16 })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        id: expect.any(Number) as unknown,
        type: 'water',
        loggedAt: expect.any(String) as unknown,
        amount: 16,
      })
      expect(await receivedRequests(PROXY_URL, username)).toContain('POST /v1/water-entries')
    })

    it('forwards PATCH to the API with the session token', async () => {
      const id = await seededId()

      const response = await send('PATCH', `/${id}`, { amount: 20.5 })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({ id, amount: 20.5 }))
      expect(await receivedRequests(PROXY_URL, username)).toContain(`PATCH /v1/water-entries/${id}`)
    })

    it('forwards DELETE to the API with the session token', async () => {
      const id = await seededId()

      const response = await send('DELETE', `/${id}`)

      expect(response.status).toBe(204)
      expect(await receivedRequests(PROXY_URL, username)).toContain(
        `DELETE /v1/water-entries/${id}`,
      )
      expect(await storedWaterEntries(database, username)).toEqual([])
    })

    it.each([
      ['POST', false],
      ['PATCH', true],
      ['DELETE', true],
    ])('answers %s without a session cookie with 401', async (method, withId) => {
      const id = await seededId()

      const response = await send(method, withId ? `/${id}` : '', { amount: 8 }, null)

      expect(response.status).toBe(401)
      expect(await storedWaterEntries(database, username)).toEqual([
        expect.objectContaining({ id, amount: 16 }),
      ])
    })

    it.each([
      ['answers 500', { status: 500 } as const],
      ['is unreachable', 'connection-reset' as const],
    ])('answers 502 to every request when the API %s', async (_case, fault) => {
      const id = await seededId()
      await injectFault(PROXY_URL, fault, username)

      const statuses = [
        (await send('POST', '', { amount: 8 })).status,
        (await send('PATCH', `/${id}`, { amount: 8 })).status,
        (await send('DELETE', `/${id}`)).status,
      ]

      expect(statuses).toEqual([502, 502, 502])
    })

    it('forwards 400, 401 and 404 as they are', async () => {
      const expired = await signAccessToken(Math.floor(Date.now() / 1000) - 60)

      const statuses = [
        (await send('POST', '', { amount: 0 })).status,
        (await send('POST', '', { amount: 8 }, expired)).status,
        (await send('DELETE', '/99999')).status,
      ]

      expect(statuses).toEqual([400, 401, 404])
    })
  })

  describe('failures and timing', () => {
    const failWith = (route: Route) => route.fulfill({ status: 500 })
    const failNetwork = (route: Route) => route.abort()

    it('keeps the Add water dialog open with what was typed when adding fails', async () => {
      await page.route(WATER_ENTRIES_URL, failWith)
      await openAddDialog()
      await amountField(addDialog()).pressSequentially('12.5')

      await preset(addDialog(), 'Bottle').click()

      await expect
        .poll(() => addDialog().getByRole('alert').textContent(), eventually)
        .toBe(GENERIC_ERROR_MESSAGE)
      expect(await addDialog().isVisible()).toBe(true)
      expect(await amountField(addDialog()).inputValue()).toBe('12.5')
      expect(await waterSummary()).toContain(ofGoal(0))
      expect(await home.entries().count()).toBe(0)
    })

    it('keeps the Edit water dialog open with what was typed when saving fails', async () => {
      await seedWater(16)
      await page.route(`${WATER_ENTRIES_URL}/*`, failNetwork)
      await openEditDialog()
      await amountField(editDialog()).fill('30')

      await saveSubmit().click()

      await expect
        .poll(() => editDialog().getByRole('alert').textContent(), eventually)
        .toBe(GENERIC_ERROR_MESSAGE)
      expect(await editDialog().isVisible()).toBe(true)
      expect(await amountField(editDialog()).inputValue()).toBe('30')
      expect(await waterSummary()).toContain(ofGoal(16))
    })

    it('keeps the entry when deleting fails', async () => {
      await seedWater(16)
      await page.route(`${WATER_ENTRIES_URL}/*`, failNetwork)
      await openConfirmation()

      await confirmDelete().click()

      await expect
        .poll(() => confirmation().getByRole('alert').textContent(), eventually)
        .toBe(GENERIC_ERROR_MESSAGE)
      expect(await entryTexts()).toEqual([`${timeLabel(FIRST)} Water 16 fl oz`])
    })

    it.each([
      [
        'Bottle',
        'POST',
        async () => {
          await openAddDialog()
          return { dialog: addDialog(), target: preset(addDialog(), 'Bottle') }
        },
      ],
      [
        'Add',
        'POST',
        async () => {
          await openAddDialog()
          await amountField(addDialog()).pressSequentially('10')
          return { dialog: addDialog(), target: addSubmit() }
        },
      ],
      [
        'Save',
        'PATCH',
        async () => {
          await seedWater(16)
          await openEditDialog()
          await amountField(editDialog()).fill('30')
          return { dialog: editDialog(), target: saveSubmit() }
        },
      ],
      [
        'Delete',
        'DELETE',
        async () => {
          await seedWater(16)
          await openConfirmation()
          return { dialog: confirmation(), target: confirmDelete() }
        },
      ],
    ])('sends a single request when %s is double-clicked', async (_name, method, open) => {
      const { dialog, target } = await open()
      const release = await holdWaterRequests()

      await target.dblclick()

      for (const dialogButton of await dialog.getByRole('button').all()) {
        expect(await dialogButton.isDisabled()).toBe(true)
      }
      release()
      await expect.poll(isHidden(dialog), eventually).toBe(true)
      expect(requestsTo(method)).toHaveLength(1)
    })

    it.each([
      [
        'adding',
        async () => {
          await addButton().click()
          await preset(addDialog(), 'Glass').click()
        },
      ],
      [
        'saving',
        async () => {
          await entryButton('16', FIRST).click()
          await amountField(editDialog()).fill('30')
          await saveSubmit().click()
        },
      ],
      [
        'deleting',
        async () => {
          await entryButton('16', FIRST).click()
          await button(editDialog(), 'Delete').click()
          await confirmDelete().click()
        },
      ],
    ])('goes to the login page when the session expired before %s', async (_case, act) => {
      await seedWater(16)
      await openLog()
      await setSessionCookie(context, await signAccessToken(Math.floor(Date.now() / 1000) - 60))

      await act()

      await page.waitForURL(`${WEB_URL}/login`)
    })

    it.each([
      [
        'saving',
        async () => {
          await amountField(editDialog()).fill('30')
          await saveSubmit().click()
        },
      ],
      [
        'deleting',
        async () => {
          await button(editDialog(), 'Delete').click()
          await confirmDelete().click()
        },
      ],
    ])('drops an entry deleted elsewhere without an error when %s it', async (_case, act) => {
      await seedWater(16)
      await openEditDialog()
      const [entry] = await storedWaterEntries(database, username)
      await deleteWaterEntry(SEEDED, entry?.id ?? 0)

      await act()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      expect(await confirmation().isVisible()).toBe(false)
      await expect
        .poll(() => textOf(home.dailyLog()), eventually)
        .toContain('No entries for this day')
      expect(await page.getByRole('alert').filter({ hasText: GENERIC_ERROR_MESSAGE }).count()).toBe(
        0,
      )
    })
  })

  describe('on a phone', () => {
    // Replaces the desktop page with a phone one, for a new user.
    beforeEach(async () => {
      await context.close()
      ;({ context, page, username, token } = await signedInPage(browser, database, MOBILE))
      home = homePage(page)
    })

    const expectBottomSheet = async (dialog: Locator) => {
      await expect.poll(() => dialog.isVisible(), eventually).toBe(true)
      const sheet = await box(dialog)
      expect(Math.abs(sheet.y + sheet.height - MOBILE.viewport.height)).toBeLessThanOrEqual(1)
      for (const { name } of WATER_PRESETS) {
        expect((await box(preset(dialog, name))).height).toBeGreaterThanOrEqual(44)
      }
      expect(await amountField(dialog).getAttribute('inputmode')).toBe('decimal')
    }

    it('opens Add water as a bottom sheet with large presets and a decimal keypad', async () => {
      await openLog()

      await addButton().tap()

      await expectBottomSheet(addDialog())
    })

    it('opens Edit water as a bottom sheet', async () => {
      await seedWater(16)
      await openLog()

      await entryButton('16', FIRST).tap()

      await expectBottomSheet(editDialog())
    })
  })
})
