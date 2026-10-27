import {
  DEFAULT_DAILY_GOALS,
  GENERIC_ERROR_MESSAGE,
  MAX_FOOD_NAME_LENGTH,
  MAX_PER_SERVING,
  MAX_SERVING_SIZE_LENGTH,
  MAX_SERVINGS,
  MIN_SERVINGS,
  SERVINGS_STEP,
} from '@open-calorie-tracker/shared'
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  chromium,
} from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Database } from '../../api/src/db/database'
import { MOBILE, box, eventually, holdRequests, isHidden, textOf } from './browser'
import {
  homePage,
  minutesIntoToday,
  newYorkTime,
  openLog,
  seedFoodEntry,
  storedFoodEntries,
  timeLabel,
} from './daily-log'
import { deleteFoodEntry } from './database'
import { clearFault, injectFault, receivedRequests } from './fault-proxy'
import { SEEDED, signAccessToken } from './fixtures'
import { connectDatabase, createUser, sendToRoute, setSessionCookie, signedInPage } from './session'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

const FOOD_ENTRIES_URL = `${WEB_URL}/api/food-entries`
const SERVING_SIZES_URL = `${WEB_URL}/api/serving-sizes`

const GOAL = DEFAULT_DAILY_GOALS.calories

// Seeded entries sit a minute into the real today, older than the ones the page creates; see
// minutesIntoToday.
const FIRST = minutesIntoToday(1)
const SECOND = minutesIntoToday(2)

// Long before today, so the entries that give a user serving sizes add nothing to today's log.
const LONG_AGO = newYorkTime('2026-01-01T12:00:00')

const NUTRIENTS = [
  { label: 'Protein', unit: 'g' },
  { label: 'Carbohydrate', unit: 'g' },
  { label: 'Fat', unit: 'g' },
  { label: 'Fiber', unit: 'g' },
  { label: 'Sugar', unit: 'g' },
  { label: 'Sodium', unit: 'mg' },
] as const

type NutrientLabel = (typeof NUTRIENTS)[number]['label']

type Food = {
  name: string
  servingSize: string
  servings?: number
  calories: string
  nutrients?: Partial<Record<NutrientLabel, string>>
}

const GREEK_YOGURT: Food = {
  name: 'Greek yogurt with honey',
  servingSize: '1 cup (245 g)',
  servings: 1.5,
  calories: '180',
  nutrients: { Protein: '17', Carbohydrate: '20', Fat: '4', Fiber: '0', Sugar: '18', Sodium: '85' },
}

describe('Food (e2e)', () => {
  let browser: Browser
  let database: Database
  let context: BrowserContext
  let page: Page
  let username: string
  let token: string
  let home: ReturnType<typeof homePage>
  // The page's requests to the food and serving size routes, e.g. "POST /api/food-entries".
  let foodRequests: string[]

  beforeAll(async () => {
    browser = await chromium.launch()
    database = await connectDatabase()
  })

  afterAll(async () => {
    database.close()
    await browser.close()
  })

  // A fresh page with a new user, who starts with no entries and no serving sizes.
  const openNewPage = async (options: BrowserContextOptions = {}) => {
    ;({ context, page, username, token } = await signedInPage(browser, database, options))
    home = homePage(page)
    foodRequests = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/food-entries') || pathname.startsWith('/api/serving-sizes')) {
        foodRequests.push(`${request.method()} ${pathname}`)
      }
    })
  }

  beforeEach(async () => {
    await openNewPage()
  })

  afterEach(async () => {
    await clearFault(PROXY_URL, username)
    await context.close()
  })

  // Today's calories so far, as one entry.
  const seedCalories = (calories: number) =>
    seedFoodEntry(database, {
      username,
      loggedAt: FIRST,
      name: 'Breakfast',
      servingSize: '1 plate',
      quantity: 1,
      calories,
    })

  // Greek yogurt with honey, 1.5 servings, stored as the totals: 180 kcal per serving.
  const seedYogurt = () =>
    seedFoodEntry(database, {
      username,
      loggedAt: SECOND,
      name: 'Greek yogurt with honey',
      servingSize: '1 cup (245 g)',
      quantity: 1.5,
      calories: 270,
      protein: 25.5,
      carbohydrate: 30,
      fat: 6,
      fiber: null,
      sugar: 27,
      sodium: 127.5,
    })

  // The id of the user's newest entry, the yogurt wherever it is seeded.
  const yogurtId = async () => (await storedFoodEntries(database, username)).at(-1)?.id ?? 0

  // Gives the user serving sizes, from entries logged long ago.
  const seedServingSizes = async (names: string[], owner = username) => {
    for (const servingSize of names) {
      await seedFoodEntry(database, {
        username: owner,
        loggedAt: LONG_AGO,
        name: 'Something',
        servingSize,
        quantity: 1,
        calories: 1,
      })
    }
  }

  const main = () => page.getByRole('main')
  const addFoodButton = () => main().getByRole('button', { name: 'Add food', exact: true })
  // Whichever food dialog is open; there is only ever one.
  const dialog = () => page.getByRole('dialog', { name: /^(Add|Edit) food$/ })
  const addDialog = () => page.getByRole('dialog', { name: 'Add food' })
  const editDialog = () => page.getByRole('dialog', { name: 'Edit food' })
  const entryButton = (name = 'Greek yogurt with honey') => home.entry(name).getByRole('button')
  const button = (name: string) => dialog().getByRole('button', { name, exact: true })
  const foodField = () => dialog().getByRole('textbox', { name: 'Food', exact: true })
  const servingField = () => dialog().getByRole('combobox', { name: 'Serving size' })
  const servings = () => dialog().getByRole('group', { name: 'Servings' })
  const caloriesField = () => dialog().getByRole('textbox', { name: 'Calories per serving' })
  const nutrientsToggle = () => dialog().getByRole('button', { name: /^Nutrients/ })
  const nutrientField = (label: NutrientLabel) => {
    const unit = NUTRIENTS.find((nutrient) => nutrient.label === label)?.unit
    return dialog().getByRole('textbox', { name: `${label} ${unit}`, exact: true })
  }
  const servingList = () => dialog().getByRole('group', { name: 'Serving sizes' })
  const servingOptions = () =>
    servingList()
      .getByRole('button')
      .filter({ hasNotText: /^Create/ })
  const servingOption = (name: string) =>
    servingOptions().filter({ hasText: new RegExp(`^${name.replaceAll(/[()]/g, '\\$&')}$`) })
  const createOption = (name: string) =>
    servingList().getByRole('button', { name: `Create “${name}”` })
  // "Add food" or "Save" while the form is incomplete, "Add 270 kcal" or "Save 270 kcal" once it
  // is complete.
  const submit = () =>
    dialog().getByRole('button', { name: /^(Add (food|[\d,.]+ kcal)|Save( [\d,.]+ kcal)?)$/ })

  const dialogText = () => textOf(dialog())
  const optionNames = async () =>
    (await servingOptions().allInnerTexts()).map((text) => text.replaceAll(/\s+/g, ' ').trim())
  const entryTexts = async () =>
    (await home.entries().allInnerTexts()).map((text) => text.replaceAll(/\s+/g, ' ').trim())
  const summaryText = (name: string) => textOf(home.summary(name))

  const requestsTo = (method: string, path: string) =>
    foodRequests.filter((request) => request === `${method} ${path}`)
  // The page's requests that change the log, e.g. "PATCH /api/food-entries/7".
  const changes = () => foodRequests.filter((request) => !request.startsWith('GET '))
  const patches = () => foodRequests.filter((request) => request.startsWith('PATCH '))

  const openDialog = async () => {
    await openLog(page)
    await addFoodButton().click()
    await expect.poll(() => addDialog().isVisible(), eventually).toBe(true)
  }

  const openEditDialog = async (name?: string) => {
    await openLog(page)
    await entryButton(name).click()
    await expect.poll(() => editDialog().isVisible(), eventually).toBe(true)
  }

  const setServings = async (target: number) => {
    let current = Number(await textOf(servings()))
    while (current !== target) {
      await button(current < target ? 'More servings' : 'Fewer servings').click()
      current = Number(await textOf(servings()))
    }
  }

  // Fills the form; a click on the calories field closes the serving size list.
  const fillForm = async ({
    name,
    servingSize,
    servings: count = 1,
    calories,
    nutrients,
  }: Food) => {
    await foodField().fill(name)
    await servingField().fill(servingSize)
    await caloriesField().click()
    await setServings(count)
    await caloriesField().fill(calories)
    if (nutrients !== undefined) {
      await nutrientsToggle().click()
      for (const [label, value] of Object.entries(nutrients)) {
        await nutrientField(label as NutrientLabel).fill(value)
      }
    }
  }

  const addFood = async (food: Food) => {
    await fillForm(food)
    await submit().click()
    await expect.poll(isHidden(dialog()), eventually).toBe(true)
  }

  // The color a CSS variable of the theme resolves to, as computed styles report it.
  const themeColor = (variable: string) =>
    page.evaluate((name) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }, variable)

  const stripedBackgrounds = () =>
    dialog().evaluate((root) =>
      [...root.querySelectorAll('*')]
        .map((element) => getComputedStyle(element).backgroundImage)
        .filter((image) => image.includes('repeating-linear-gradient')),
    )

  describe('the Add food dialog', () => {
    it('opens from "Add food" with an empty form', async () => {
      await seedCalories(1240)

      await openDialog()

      expect(await dialogText()).toContain(`1,240 of 1,600 kcal today · 360 to go`)
      expect(await foodField().inputValue()).toBe('')
      expect(await servingField().inputValue()).toBe('')
      expect(await textOf(servings())).toBe('1')
      expect(await caloriesField().inputValue()).toBe('')
      expect(await nutrientsToggle().getAttribute('aria-expanded')).toBe('false')
      expect(await textOf(nutrientsToggle())).toContain('Optional · protein, carbs, fat and more')
      expect(await textOf(submit())).toBe('Add food')
      expect(await submit().isDisabled()).toBe(true)
    })

    it.each([
      [0, `0 of 1,600 kcal today · 1,600 to go`],
      [GOAL, `1,600 of 1,600 kcal today · goal reached`],
      [GOAL + 100, `1,700 of 1,600 kcal today · 100 over`],
    ])('says how today with %s kcal stands against the goal', async (calories, subtitle) => {
      if (calories > 0) await seedCalories(calories)

      await openDialog()

      expect(await dialogText()).toContain(subtitle)
    })

    it.each([
      ['clicking Cancel', () => button('Cancel').click()],
      ['clicking Close', () => button('Close').click()],
      ['pressing Escape', () => page.keyboard.press('Escape')],
      ['clicking outside the dialog', () => page.mouse.click(10, 10)],
    ])('closes without saving anything when %s', async (_case, close) => {
      await openDialog()
      await foodField().fill('Overnight oats')

      await close()

      await expect.poll(isHidden(dialog()), eventually).toBe(true)
      expect(foodRequests.filter((request) => request.startsWith('POST '))).toEqual([])
      await addFoodButton().click()
      expect(await foodField().inputValue()).toBe('')
    })
  })

  describe('form rules', () => {
    beforeEach(async () => {
      await openDialog()
    })

    it(`stops the food name at ${MAX_FOOD_NAME_LENGTH} characters when typing`, async () => {
      await foodField().pressSequentially('a'.repeat(MAX_FOOD_NAME_LENGTH + 20))

      expect(await foodField().inputValue()).toBe('a'.repeat(MAX_FOOD_NAME_LENGTH))
    })

    it(`stops the food name at ${MAX_FOOD_NAME_LENGTH} characters when pasting`, async () => {
      await foodField().focus()
      await page.keyboard.insertText('a'.repeat(MAX_FOOD_NAME_LENGTH + 20))

      expect(await foodField().inputValue()).toBe('a'.repeat(MAX_FOOD_NAME_LENGTH))
    })

    it.each([
      ['180', '180'],
      ['0', '0'],
      ['12.55', '12.5'],
      ['abc-1,8', '18'],
      [`${MAX_PER_SERVING}0`, String(MAX_PER_SERVING)],
    ])('shows %j typed into the calories as %j', async (typed, shown) => {
      await caloriesField().pressSequentially(typed)

      expect(await caloriesField().inputValue()).toBe(shown)
    })

    it.each([
      ['1.2.3', '1.2'],
      [String(MAX_PER_SERVING + 1), ''],
    ])('shows %j pasted into the calories as %j', async (pasted, shown) => {
      await caloriesField().focus()
      await page.keyboard.insertText(pasted)

      expect(await caloriesField().inputValue()).toBe(shown)
    })

    it.each([
      [1, 'More servings', '1.5'],
      [1, 'Fewer servings', '0.5'],
      [MAX_SERVINGS - SERVINGS_STEP, 'More servings', String(MAX_SERVINGS)],
    ])('changes %s servings with %s to %s', async (from, stepper, shown) => {
      await setServings(from)

      await button(stepper).click()

      expect(await textOf(servings())).toBe(shown)
    })

    it.each([
      ['Fewer servings', MIN_SERVINGS],
      ['More servings', MAX_SERVINGS],
    ])('disables %s at %s', async (stepper, at) => {
      await setServings(at)

      expect(await button(stepper).isDisabled()).toBe(true)
    })

    it.each([
      ['Greek yogurt with honey', '1 cup', '180', 'Add 180 kcal', true],
      ['Black coffee', '1 cup', '0', 'Add 0 kcal', true],
      ['', '1 cup', '180', 'Add food', false],
      ['   ', '1 cup', '180', 'Add food', false],
      ['Greek yogurt with honey', '', '180', 'Add food', false],
      ['Greek yogurt with honey', '   ', '180', 'Add food', false],
      ['Greek yogurt with honey', '1 cup', '', 'Add food', false],
    ])(
      'with %j, %j and %j kcal reads %j, enabled: %s',
      async (name, servingSize, calories, label, enabled) => {
        await fillForm({ name, servingSize, calories })

        expect(await textOf(submit())).toBe(label)
        expect(await submit().isEnabled()).toBe(enabled)
      },
    )

    it('sends nothing when Enter is pressed on an incomplete form', async () => {
      await fillForm({ name: '', servingSize: '1 cup', calories: '180' })

      await caloriesField().press('Enter')

      expect(foodRequests.filter((request) => request.startsWith('POST '))).toEqual([])
      expect(await dialog().isVisible()).toBe(true)
    })

    it('explains the calories per serving, and the multiplication once servings is not 1', async () => {
      await caloriesField().fill('180')
      expect(await dialogText()).toContain('As printed on the label, for one serving.')

      await button('More servings').click()

      expect(await dialogText()).toContain('1.5 × 180 kcal = 270 kcal')
      expect(await dialogText()).not.toContain('As printed on the label, for one serving.')
    })
  })

  describe('the preview', () => {
    it("shows where today's calories would go, and the button names the total", async () => {
      await seedCalories(1240)
      await openDialog()

      await fillForm({ name: 'Greek yogurt', servingSize: '1 cup', servings: 1.5, calories: '180' })

      expect(await dialogText()).toContain('With 270 kcal: 1,510 / 1,600 kcal')
      expect(await dialogText()).not.toContain('over')
      expect(await textOf(submit())).toBe('Add 270 kcal')
    })

    it('warns in the danger color when the entry goes over the goal', async () => {
      await seedCalories(1520)
      await openDialog()

      await fillForm({ name: 'Pizza', servingSize: '1 slice', servings: 2, calories: '225' })

      const preview = dialog().getByText('With 450 kcal: 1,970 / 1,600 kcal · 370 over')
      expect(await preview.isVisible()).toBe(true)
      expect(await preview.evaluate((element) => getComputedStyle(element).color)).toBe(
        await themeColor('--danger-text'),
      )
      expect((await stripedBackgrounds()).join()).toContain(await themeColor('--danger'))
    })

    it('appears once the calories have a value, 0 included', async () => {
      await seedCalories(1240)
      await openDialog()

      expect(await dialogText()).not.toContain('With ')

      await caloriesField().fill('0')

      expect(await dialogText()).toContain('With 0 kcal: 1,240 / 1,600 kcal')
    })
  })

  describe('serving size', () => {
    it('shows no list when the empty field is focused', async () => {
      await seedServingSizes(['1 cup', '1 slice'])
      await openDialog()

      await servingField().focus()

      expect(await servingList().isVisible()).toBe(false)
    })

    it("filters the user's serving sizes as they type, regardless of case and alphabetically", async () => {
      await seedServingSizes(['1 jar (250 g)', '1 cup (245 g)', '1 cup', '100 g'])
      await openDialog()

      await servingField().pressSequentially('CUP')

      await expect.poll(optionNames, eventually).toEqual(['1 cup', '1 cup (245 g)'])
      expect(await textOf(servingList())).toContain('Matching serving sizes')
      expect(await textOf(createOption('CUP'))).toContain(
        'Saved to your serving sizes when you add this food',
      )
    })

    it('lists at most 5 matches', async () => {
      await seedServingSizes(['1 cup a', '1 cup b', '1 cup c', '1 cup d', '1 cup e', '1 cup f'])
      await openDialog()

      await servingField().pressSequentially('cup')

      await expect
        .poll(optionNames, eventually)
        .toEqual(['1 cup a', '1 cup b', '1 cup c', '1 cup d', '1 cup e'])
    })

    it('fills the field with the option picked and closes the list', async () => {
      await seedServingSizes(['1 jar (250 g)'])
      await openDialog()
      await servingField().pressSequentially('jar')

      await servingOption('1 jar (250 g)').click()

      expect(await servingField().inputValue()).toBe('1 jar (250 g)')
      expect(await servingList().isVisible()).toBe(false)
    })

    it('marks an exact match regardless of case and offers no Create', async () => {
      await seedServingSizes(['1 cup', '1 cup (245 g)'])
      await openDialog()

      await servingField().pressSequentially('1 CUP')

      await expect
        .poll(
          () => servingOption('1 cup').getByRole('img', { name: 'Selected' }).count(),
          eventually,
        )
        .toBe(1)
      expect(await servingList().getByRole('img', { name: 'Selected' }).count()).toBe(1)
      expect(await createOption('1 CUP').count()).toBe(0)
    })

    it('only marks a created serving size as new, saving nothing yet', async () => {
      await openDialog()
      await servingField().pressSequentially('1 bowl')

      await createOption('1 bowl').click()

      expect(await servingList().isVisible()).toBe(false)
      expect(await servingField().inputValue()).toBe('1 bowl')
      expect(await dialogText()).toContain(
        'New serving size · it will be saved when you add this food',
      )
      expect(requestsTo('POST', '/api/serving-sizes')).toEqual([])
    })

    it('says when nothing matches and offers to create it', async () => {
      await seedServingSizes(['1 cup'])
      await openDialog()

      await servingField().pressSequentially('1 bowl')

      await expect
        .poll(() => textOf(servingList()), eventually)
        .toContain('No saved serving size matches')
      expect(await servingOptions().count()).toBe(0)
      expect(await createOption('1 bowl').isVisible()).toBe(true)
    })

    it('hides the list when the field is cleared', async () => {
      await seedServingSizes(['1 cup'])
      await openDialog()
      await servingField().pressSequentially('cup')
      await expect.poll(() => servingList().isVisible(), eventually).toBe(true)

      await servingField().clear()

      expect(await servingList().isVisible()).toBe(false)
    })

    it("never lists another user's serving sizes", async () => {
      const other = await createUser(database)
      await seedServingSizes(['1 burrito'], other)
      await openDialog()

      await servingField().pressSequentially('burrito')

      await expect.poll(() => createOption('burrito').isVisible(), eventually).toBe(true)
      expect(await servingOptions().count()).toBe(0)
    })

    it(`stops at ${MAX_SERVING_SIZE_LENGTH} characters when typing or pasting`, async () => {
      await openDialog()

      await servingField().pressSequentially('a'.repeat(MAX_SERVING_SIZE_LENGTH + 20))
      expect(await servingField().inputValue()).toBe('a'.repeat(MAX_SERVING_SIZE_LENGTH))

      await servingField().clear()
      await page.keyboard.insertText('b'.repeat(MAX_SERVING_SIZE_LENGTH + 20))
      expect(await servingField().inputValue()).toBe('b'.repeat(MAX_SERVING_SIZE_LENGTH))
    })

    it.each([
      ['Food', () => foodField().focus()],
      ['Calories per serving', () => caloriesField().focus()],
    ])('closes the list when %s is focused', async (_field, focus) => {
      await seedServingSizes(['1 cup'])
      await openDialog()
      await servingField().pressSequentially('cup')
      await expect.poll(() => servingList().isVisible(), eventually).toBe(true)

      await focus()

      expect(await servingList().isVisible()).toBe(false)
    })

    it('still lets the user type a serving size when theirs fail to load', async () => {
      await page.route(SERVING_SIZES_URL, (route) =>
        route.request().method() === 'GET' ? route.fulfill({ status: 500 }) : route.continue(),
      )
      await openDialog()

      await servingField().pressSequentially('1 cup')
      expect(await createOption('1 cup').isVisible()).toBe(true)
      await addFood({ name: 'Milk', servingSize: '1 cup', calories: '120' })

      await expect.poll(entryTexts, eventually).toEqual([expect.stringContaining('Milk')])
    })
  })

  describe('nutrients', () => {
    beforeEach(async () => {
      await openDialog()
    })

    it('opens six empty optional fields, per serving', async () => {
      await nutrientsToggle().click()

      expect(await nutrientsToggle().getAttribute('aria-expanded')).toBe('true')
      for (const { label } of NUTRIENTS) {
        expect(await nutrientField(label).inputValue()).toBe('')
      }
      expect(await dialogText()).toContain("Per serving. Leave blank when the label doesn't say.")
    })

    it('counts the nutrients filled and keeps them when collapsed', async () => {
      await nutrientsToggle().click()
      await nutrientField('Protein').fill('17')
      await nutrientField('Carbohydrate').fill('20')
      await nutrientField('Fat').fill('4')

      await nutrientsToggle().click()

      expect(await textOf(nutrientsToggle())).toContain('3 of 6 added')
      await nutrientsToggle().click()
      expect(await nutrientField('Protein').inputValue()).toBe('17')
    })

    it.each([
      ['Protein', '12.55', '12.5'],
      ['Fiber', '0', '0'],
      ['Sodium', `${MAX_PER_SERVING}0`, String(MAX_PER_SERVING)],
    ] as const)('shows %s typed as %j as %j', async (label, typed, shown) => {
      await nutrientsToggle().click()

      await nutrientField(label).pressSequentially(typed)

      expect(await nutrientField(label).inputValue()).toBe(shown)
    })

    it('leaves the nutrients as typed when the servings change, with no breakdown', async () => {
      await nutrientsToggle().click()
      await nutrientField('Protein').fill('17')
      await setServings(1.5)

      await setServings(4)

      expect(await nutrientField('Protein').inputValue()).toBe('17')
      expect(await dialogText()).not.toContain('This entry adds')
    })
  })

  describe('saving', () => {
    it('adds the food multiplied by the servings at the top of the log', async () => {
      await seedCalories(1240)
      await seedServingSizes(['1 cup (245 g)'])
      await openDialog()

      await addFood(GREEK_YOGURT)

      expect(foodRequests.filter((request) => request.startsWith('POST '))).toEqual([
        'POST /api/food-entries',
      ])
      await expect.poll(entryTexts, eventually).toHaveLength(2)
      expect((await entryTexts())[0]).toContain(
        'Greek yogurt with honey Manual 1 cup (245 g) × 1.5 270 kcal',
      )
      expect(await summaryText('Calories')).toContain(`1,510 / 1,600 kcal`)
      const { protein, carbohydrate, fat, fiber, sugar, sodium } = DEFAULT_DAILY_GOALS
      expect(await summaryText('Protein')).toContain(`25.5 / ${protein} g`)
      expect(await summaryText('Carbohydrate')).toContain(`30 / ${carbohydrate} g`)
      expect(await summaryText('Fat')).toContain(`6 / ${fat} g`)
      expect(await summaryText('Fiber')).toContain(`0 / ${fiber} g`)
      expect(await summaryText('Sugar max')).toContain(`27 / ${sugar} g`)
      expect(await summaryText('Sodium max')).toContain(
        `127.5 / ${sodium.toLocaleString('en-US')} mg`,
      )
    })

    it('adds the food when Enter is pressed on a complete form', async () => {
      await openDialog()
      await fillForm({ name: 'Apple', servingSize: '1 medium', calories: '95' })

      await caloriesField().press('Enter')

      await expect.poll(entryTexts, eventually).toEqual([expect.stringContaining('Apple')])
    })

    it('saves blank nutrients as no data, counted as 0 in the totals', async () => {
      await openDialog()

      await addFood({ name: 'Black coffee', servingSize: '1 cup', calories: '0' })

      await expect.poll(entryTexts, eventually).toHaveLength(1)
      expect(await storedFoodEntries(database, username)).toEqual([
        expect.objectContaining({
          calories: 0,
          protein: null,
          carbohydrate: null,
          fat: null,
          fiber: null,
          sugar: null,
          sodium: null,
        }),
      ])
      expect(await summaryText('Protein')).toContain(`0 / ${DEFAULT_DAILY_GOALS.protein} g`)
    })

    it('trims the food name and the serving size', async () => {
      await openDialog()

      await addFood({ name: '  Greek yogurt  ', servingSize: '  1   bowl  ', calories: '100' })

      await expect.poll(entryTexts, eventually).toHaveLength(1)
      expect((await entryTexts())[0]).toContain('Greek yogurt Manual 1 bowl × 1 100 kcal')
      expect((await storedFoodEntries(database, username))[0]?.name).toBe('Greek yogurt')
    })

    it('saves a new serving size first, then the food', async () => {
      await openDialog()

      await addFood({ name: 'Oatmeal', servingSize: '1 bowl', calories: '150' })

      await expect.poll(entryTexts, eventually).toHaveLength(1)
      expect(foodRequests.filter((request) => request.startsWith('POST '))).toEqual([
        'POST /api/serving-sizes',
        'POST /api/food-entries',
      ])
      expect((await entryTexts())[0]).toContain('1 bowl × 1')
    })

    it('reuses a serving size typed in another case without saving it again', async () => {
      await seedServingSizes(['1 cup (245 g)'])
      await openDialog()

      await addFood({ name: 'Greek yogurt', servingSize: '1 CUP (245 G)', calories: '180' })

      await expect.poll(entryTexts, eventually).toHaveLength(1)
      expect(requestsTo('POST', '/api/serving-sizes')).toEqual([])
      expect((await entryTexts())[0]).toContain('1 cup (245 g) × 1')
    })

    it('lists a new serving size the next time', async () => {
      await openDialog()
      await addFood({ name: 'Oatmeal', servingSize: '1 bowl', calories: '150' })
      await expect.poll(entryTexts, eventually).toHaveLength(1)

      await addFoodButton().click()
      await servingField().pressSequentially('bowl')

      await expect.poll(optionNames, eventually).toEqual(['1 bowl'])
      expect(await createOption('bowl').isVisible()).toBe(true)
      await servingField().fill('1 bowl')
      expect(await createOption('1 bowl').count()).toBe(0)
    })

    it('counts the first food entry of the day', async () => {
      await openDialog()
      expect(await summaryText('Calories')).toContain('No Food Entries')

      await addFood({ name: 'Apple', servingSize: '1 medium', calories: '95' })

      await expect.poll(() => summaryText('Calories'), eventually).toContain('1 Food Entry')
    })
  })

  describe('editing food', () => {
    const YOGURT_ROW = `${timeLabel(SECOND)} Greek yogurt with honey Manual 1 cup (245 g) × 1.5 270 kcal`
    const BREAKFAST_ROW = `${timeLabel(FIRST)} Breakfast Manual 1 plate × 1 500 kcal`

    const save = async () => {
      await submit().click()
      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
    }

    beforeEach(async () => {
      await seedCalories(500)
      await seedYogurt()
    })

    it('opens a food entry in the Edit food dialog, with its name as the subtitle', async () => {
      await openEditDialog()

      expect(await dialogText()).toContain('Greek yogurt with honey')
      expect(await dialogText()).not.toContain('logged at')
      for (const name of ['Close', 'Cancel']) {
        expect(await button(name).isVisible()).toBe(true)
      }
      expect(await textOf(submit())).toBe('Save 270 kcal')
    })

    it('opens the form per serving, as the label prints it', async () => {
      await openEditDialog()

      expect(await foodField().inputValue()).toBe('Greek yogurt with honey')
      expect(await servingField().inputValue()).toBe('1 cup (245 g)')
      expect(await textOf(servings())).toBe('1.5')
      expect(await caloriesField().inputValue()).toBe('180')
      expect(await nutrientsToggle().getAttribute('aria-expanded')).toBe('false')
      expect(await textOf(nutrientsToggle())).toContain('5 of 6 added')
      await nutrientsToggle().click()
      const shown = {
        Protein: '17',
        Carbohydrate: '20',
        Fat: '4',
        Fiber: '',
        Sugar: '18',
        Sodium: '85',
      }
      for (const [label, value] of Object.entries(shown)) {
        expect(await nutrientField(label as NutrientLabel).inputValue()).toBe(value)
      }
    })

    it('makes the food row a button named after the entry, which keeps its look', async () => {
      await openLog(page)

      expect(await entryTexts()).toEqual([YOGURT_ROW, BREAKFAST_ROW])
      const row = page.getByRole('button', {
        name: `Greek yogurt with honey, 270 kcal, ${timeLabel(SECOND)}`,
        exact: true,
      })
      await row.focus()
      await page.keyboard.press('Enter')

      await expect.poll(() => editDialog().isVisible(), eventually).toBe(true)
    })

    it("previews today's calories with the entry's new calories in place of its old ones", async () => {
      await openEditDialog()
      expect(await dialogText()).toContain('With 270 kcal: 770 / 1,600 kcal')

      await caloriesField().fill('200')

      expect(await dialogText()).toContain('With 300 kcal: 800 / 1,600 kcal')
      expect(await textOf(submit())).toBe('Save 300 kcal')
    })

    it('warns in the danger color when the change goes over the goal', async () => {
      await openEditDialog()

      await caloriesField().fill('800')

      const preview = dialog().getByText('With 1,200 kcal: 1,700 / 1,600 kcal · 100 over')
      expect(await preview.isVisible()).toBe(true)
      expect(await preview.evaluate((element) => getComputedStyle(element).color)).toBe(
        await themeColor('--danger-text'),
      )
    })

    it.each([
      ['Food', () => foodField()],
      ['Serving size', () => servingField()],
      ['Calories per serving', () => caloriesField()],
    ])('disables Save and sends nothing on Enter when %s is cleared', async (_field, field) => {
      await openEditDialog()

      await field().clear()
      await field().press('Enter')

      expect(await textOf(submit())).toBe('Save')
      expect(await submit().isDisabled()).toBe(true)
      expect(changes()).toEqual([])
      expect(await editDialog().isVisible()).toBe(true)
    })

    it('applies the same form rules as adding', async () => {
      await openEditDialog()

      await foodField().clear()
      await page.keyboard.insertText('a'.repeat(MAX_FOOD_NAME_LENGTH + 20))
      expect(await foodField().inputValue()).toBe('a'.repeat(MAX_FOOD_NAME_LENGTH))

      await servingField().clear()
      await page.keyboard.insertText('b'.repeat(MAX_SERVING_SIZE_LENGTH + 20))
      expect(await servingField().inputValue()).toBe('b'.repeat(MAX_SERVING_SIZE_LENGTH))

      await caloriesField().clear()
      await caloriesField().pressSequentially('1a2.55')
      expect(await caloriesField().inputValue()).toBe('12.5')

      await setServings(MAX_SERVINGS)
      expect(await button('More servings').isDisabled()).toBe(true)
      await setServings(MIN_SERVINGS)
      expect(await button('Fewer servings').isDisabled()).toBe(true)
    })

    it("lists the user's serving sizes, marks an exact match and offers to create one", async () => {
      await openEditDialog()

      await servingField().fill('cup')
      await expect.poll(optionNames, eventually).toEqual(['1 cup (245 g)'])
      expect(await createOption('cup').isVisible()).toBe(true)

      await servingField().fill('1 CUP (245 G)')
      expect(
        await servingOption('1 cup (245 g)').getByRole('img', { name: 'Selected' }).count(),
      ).toBe(1)
      expect(await createOption('1 CUP (245 G)').count()).toBe(0)
    })

    it('saves the changes and keeps the time and the position of the entry', async () => {
      await openEditDialog()

      await foodField().fill('Skyr')
      await setServings(2)
      await caloriesField().fill('100')
      expect(await textOf(submit())).toBe('Save 200 kcal')
      await save()

      const expected = [
        `${timeLabel(SECOND)} Skyr Manual 1 cup (245 g) × 2 200 kcal`,
        BREAKFAST_ROW,
      ]
      await expect.poll(entryTexts, eventually).toEqual(expected)
      expect(await summaryText('Calories')).toContain('700 / 1,600 kcal')
      await openLog(page)
      await expect.poll(entryTexts, eventually).toEqual(expected)
      expect(changes()).toEqual([`PATCH /api/food-entries/${await yogurtId()}`])
    })

    it('stores the nutrients multiplied by the servings', async () => {
      await openEditDialog()

      await setServings(2)
      await save()

      await expect
        .poll(async () => (await storedFoodEntries(database, username)).at(-1), eventually)
        .toEqual(
          expect.objectContaining({
            quantity: 2,
            calories: 360,
            protein: 34,
            carbohydrate: 40,
            fat: 8,
            fiber: null,
            sugar: 36,
            sodium: 170,
          }),
        )
    })

    it('stores a cleared nutrient as no data and a filled one multiplied', async () => {
      await openEditDialog()

      await nutrientsToggle().click()
      await nutrientField('Protein').clear()
      await nutrientField('Fiber').fill('3')
      await save()

      await expect
        .poll(async () => (await storedFoodEntries(database, username)).at(-1), eventually)
        .toEqual(expect.objectContaining({ protein: null, fiber: 4.5 }))
      await expect
        .poll(() => summaryText('Protein'), eventually)
        .toContain(`0 / ${DEFAULT_DAILY_GOALS.protein} g`)
    })

    it('saves a new serving size first, then the entry', async () => {
      await openEditDialog()

      await servingField().fill('1 bowl')
      await createOption('1 bowl').click()
      await save()

      await expect
        .poll(entryTexts, eventually)
        .toContain(`${timeLabel(SECOND)} Greek yogurt with honey Manual 1 bowl × 1.5 270 kcal`)
      expect(changes()).toEqual([
        'POST /api/serving-sizes',
        `PATCH /api/food-entries/${await yogurtId()}`,
      ])
      const response = await sendToRoute(SERVING_SIZES_URL, 'GET', token)
      const names = ((await response.json()) as { name: string }[]).map((size) => size.name)
      expect(names).toContain('1 bowl')
    })

    it('reuses a serving size typed in another case without saving it again', async () => {
      await openEditDialog()

      await servingField().fill('1 CUP (245 G)')
      await caloriesField().fill('150')
      await save()

      await expect
        .poll(entryTexts, eventually)
        .toContain(
          `${timeLabel(SECOND)} Greek yogurt with honey Manual 1 cup (245 g) × 1.5 225 kcal`,
        )
      expect(requestsTo('POST', '/api/serving-sizes')).toEqual([])
    })

    it('sends nothing when nothing changed', async () => {
      await openEditDialog()

      await save()

      expect(patches()).toEqual([])
      expect(await entryTexts()).toEqual([YOGURT_ROW, BREAKFAST_ROW])
    })

    it('sends nothing when only spaces around the name were added', async () => {
      await openEditDialog()

      await foodField().fill('  Greek yogurt with honey  ')
      await save()

      expect(patches()).toEqual([])
    })

    it('keeps the entry as it was when cancelled', async () => {
      await openEditDialog()

      await caloriesField().fill('999')
      await button('Cancel').click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      expect(await entryTexts()).toEqual([YOGURT_ROW, BREAKFAST_ROW])
      expect(patches()).toEqual([])
    })
  })

  describe('the /api/food-entries and /api/serving-sizes routes', () => {
    const send = (url: string, method: string, body?: object, cookie: string | null = token) =>
      sendToRoute(url, method, cookie, body)

    const createServingSize = async (name: string) => {
      const response = await send(SERVING_SIZES_URL, 'POST', { name })
      return (await response.json()) as { id: number; name: string }
    }

    it('forwards POST /api/serving-sizes to the API with the session token', async () => {
      const response = await send(SERVING_SIZES_URL, 'POST', { name: '1 bowl' })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ id: expect.any(Number) as unknown, name: '1 bowl' })
      expect(await receivedRequests(PROXY_URL, username)).toContain('POST /v1/serving-sizes')
    })

    it('forwards GET /api/serving-sizes to the API with the session token', async () => {
      const bowl = await createServingSize('1 bowl')

      const response = await send(SERVING_SIZES_URL, 'GET')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([bowl])
      expect(await receivedRequests(PROXY_URL, username)).toContain('GET /v1/serving-sizes')
    })

    it('forwards POST /api/food-entries to the API with the session token', async () => {
      const { id } = await createServingSize('1 bowl')

      const response = await send(FOOD_ENTRIES_URL, 'POST', {
        name: 'Oatmeal',
        servingSizeId: id,
        quantity: 1,
        calories: 150,
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(
        expect.objectContaining({ type: 'food', name: 'Oatmeal', servingSize: '1 bowl' }),
      )
      expect(await receivedRequests(PROXY_URL, username)).toContain('POST /v1/food-entries')
    })

    it('forwards PATCH /api/food-entries/:id to the API with the session token', async () => {
      await seedYogurt()
      const id = await yogurtId()
      const { id: servingSizeId } = await createServingSize('1 cup (245 g)')

      const response = await send(`${FOOD_ENTRIES_URL}/${id}`, 'PATCH', {
        name: 'Skyr',
        servingSizeId,
        quantity: 1,
        calories: 100,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(
        expect.objectContaining({ id, type: 'food', name: 'Skyr', calories: 100 }),
      )
      expect(await receivedRequests(PROXY_URL, username)).toContain(`PATCH /v1/food-entries/${id}`)
    })

    it('answers every route without a session cookie with 401', async () => {
      const statuses = [
        (await send(SERVING_SIZES_URL, 'POST', { name: '1 bowl' }, null)).status,
        (await send(SERVING_SIZES_URL, 'GET', undefined, null)).status,
        (await send(FOOD_ENTRIES_URL, 'POST', { name: 'Oatmeal' }, null)).status,
        (await send(`${FOOD_ENTRIES_URL}/1`, 'PATCH', { name: 'Oatmeal' }, null)).status,
      ]

      expect(statuses).toEqual([401, 401, 401, 401])
      expect(await storedFoodEntries(database, username)).toEqual([])
    })

    it.each([
      ['answers 500', { status: 500 } as const],
      ['is unreachable', 'connection-reset' as const],
    ])('answers 502 to every request when the API %s', async (_case, fault) => {
      await injectFault(PROXY_URL, fault, username)

      const statuses = [
        (await send(SERVING_SIZES_URL, 'POST', { name: '1 bowl' })).status,
        (await send(SERVING_SIZES_URL, 'GET')).status,
        (await send(FOOD_ENTRIES_URL, 'POST', { name: 'Oatmeal' })).status,
        (await send(`${FOOD_ENTRIES_URL}/1`, 'PATCH', { name: 'Oatmeal' })).status,
      ]

      expect(statuses).toEqual([502, 502, 502, 502])
    })

    it('forwards 400, 401 and 404 as they are', async () => {
      const expired = await signAccessToken(Math.floor(Date.now() / 1000) - 60)
      const { id: servingSizeId } = await createServingSize('1 bowl')
      const oatmeal = { name: 'Oatmeal', servingSizeId, quantity: 1, calories: 150 }

      const statuses = [
        (await send(SERVING_SIZES_URL, 'POST', { name: '' })).status,
        (await send(FOOD_ENTRIES_URL, 'POST', { name: '' })).status,
        (await send(`${FOOD_ENTRIES_URL}/1`, 'PATCH', { name: '' })).status,
        (await send(SERVING_SIZES_URL, 'GET', undefined, expired)).status,
        (await send(`${FOOD_ENTRIES_URL}/99999`, 'PATCH', oatmeal)).status,
      ]

      expect(statuses).toEqual([400, 400, 400, 401, 404])
    })
  })

  describe('failures and timing', () => {
    const NEW_BOWL: Food = { name: 'Oatmeal', servingSize: '1 bowl', calories: '150' }

    const alertText = () => dialog().getByRole('alert').textContent()

    it('keeps the dialog open with what was typed when saving fails, and lets the user retry', async () => {
      await page.route(FOOD_ENTRIES_URL, (route) => route.fulfill({ status: 500 }))
      await openDialog()
      await fillForm(GREEK_YOGURT)

      await submit().click()

      await expect.poll(alertText, eventually).toBe(GENERIC_ERROR_MESSAGE)
      expect(await foodField().inputValue()).toBe(GREEK_YOGURT.name)
      expect(await servingField().inputValue()).toBe(GREEK_YOGURT.servingSize)
      expect(await textOf(servings())).toBe('1.5')
      expect(await caloriesField().inputValue()).toBe('180')
      expect(await nutrientField('Sodium').inputValue()).toBe('85')
      expect(await home.entries().count()).toBe(0)

      await page.unroute(FOOD_ENTRIES_URL)
      await submit().click()

      await expect.poll(isHidden(dialog()), eventually).toBe(true)
      await expect.poll(entryTexts, eventually).toHaveLength(1)
    })

    // Saving a food with the new serving size "1 bowl", by adding one or by editing the yogurt.
    const SAVES = [
      [
        'adding',
        'POST',
        async () => {
          await openDialog()
          await fillForm(NEW_BOWL)
        },
      ],
      [
        'editing',
        'PATCH',
        async () => {
          await seedYogurt()
          await openEditDialog()
          await servingField().fill('1 bowl')
          await caloriesField().click()
        },
      ],
    ] as const

    // The requests that add or change a food entry.
    const entryRequests = (method: string) =>
      foodRequests.filter((request) => request.startsWith(`${method} /api/food-entries`))

    it.each(SAVES)(
      'sends a single request of each kind when the submit button is double-clicked while %s',
      async (_case, method, prepare) => {
        await prepare()
        const release = await holdRequests(page, SERVING_SIZES_URL, 'POST')

        await submit().dblclick()
        release()

        await expect.poll(isHidden(dialog()), eventually).toBe(true)
        expect(requestsTo('POST', '/api/serving-sizes')).toHaveLength(1)
        expect(entryRequests(method)).toHaveLength(1)
      },
    )

    it.each(SAVES)(
      'disables the buttons and ignores Escape while %s',
      async (_case, _method, prepare) => {
        await prepare()
        const release = await holdRequests(page, '**/api/**', 'POST')

        await submit().click()

        for (const name of ['Cancel', 'Close']) {
          expect(await button(name).isDisabled()).toBe(true)
        }
        expect(await submit().isDisabled()).toBe(true)
        await page.keyboard.press('Escape')
        expect(await dialog().isVisible()).toBe(true)
        release()
        await expect.poll(isHidden(dialog()), eventually).toBe(true)
      },
    )

    it.each(SAVES)(
      'goes to the login page when the session expired before %s',
      async (_case, _method, prepare) => {
        await prepare()
        await setSessionCookie(context, await signAccessToken(Math.floor(Date.now() / 1000) - 60))

        await submit().click()

        await page.waitForURL(`${WEB_URL}/login`)
      },
    )

    it.each(SAVES)(
      'does not send the food when saving the new serving size fails while %s',
      async (_case, method, prepare) => {
        await page.route(SERVING_SIZES_URL, (route) =>
          route.request().method() === 'POST' ? route.fulfill({ status: 500 }) : route.continue(),
        )
        await prepare()

        await submit().click()

        await expect.poll(alertText, eventually).toBe(GENERIC_ERROR_MESSAGE)
        expect(entryRequests(method)).toEqual([])
      },
    )

    it.each(SAVES)(
      'does not save the serving size twice when the food fails and is retried while %s',
      async (_case, _method, prepare) => {
        let failures = 1
        await page.route(`${FOOD_ENTRIES_URL}**`, async (route) => {
          if (failures > 0) {
            failures -= 1
            await route.fulfill({ status: 500 })
          } else {
            await route.continue()
          }
        })
        await prepare()

        await submit().click()
        await expect.poll(alertText, eventually).toBe(GENERIC_ERROR_MESSAGE)
        await submit().click()

        await expect.poll(entryTexts, eventually).toEqual([expect.stringContaining('1 bowl × 1')])
        const response = await sendToRoute(SERVING_SIZES_URL, 'GET', token)
        const names = ((await response.json()) as { name: string }[]).map((size) => size.name)
        expect(names.filter((name) => name === '1 bowl')).toHaveLength(1)
      },
    )

    it('keeps the Edit food dialog open with what was typed when saving fails, and lets the user retry', async () => {
      await seedYogurt()
      await page.route(`${FOOD_ENTRIES_URL}/*`, (route) => route.fulfill({ status: 500 }))
      await openEditDialog()
      await caloriesField().fill('200')

      await submit().click()

      await expect.poll(alertText, eventually).toBe(GENERIC_ERROR_MESSAGE)
      expect(await foodField().inputValue()).toBe('Greek yogurt with honey')
      expect(await textOf(servings())).toBe('1.5')
      expect(await caloriesField().inputValue()).toBe('200')
      expect(await entryTexts()).toEqual([expect.stringContaining('270 kcal')])

      await page.unroute(`${FOOD_ENTRIES_URL}/*`)
      await submit().click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      await expect.poll(entryTexts, eventually).toEqual([expect.stringContaining('300 kcal')])
    })

    it('drops an entry deleted elsewhere without an error when saving it', async () => {
      await seedCalories(500)
      await seedYogurt()
      await openEditDialog()
      await deleteFoodEntry(SEEDED, await yogurtId())
      await caloriesField().fill('200')

      await submit().click()

      await expect.poll(isHidden(editDialog()), eventually).toBe(true)
      await expect.poll(entryTexts, eventually).toEqual([expect.stringContaining('Breakfast')])
      expect(await page.getByRole('alert').filter({ hasText: GENERIC_ERROR_MESSAGE }).count()).toBe(
        0,
      )
    })
  })

  describe('screens and themes', () => {
    // Replaces the desktop page with one for the given screen, for a new user.
    const reopenWith = async (options: BrowserContextOptions) => {
      await context.close()
      await openNewPage(options)
    }

    it('opens as a bottom sheet with a decimal keypad on a phone', async () => {
      await reopenWith(MOBILE)
      await openLog(page)

      await addFoodButton().tap()

      await expect.poll(() => dialog().isVisible(), eventually).toBe(true)
      const sheet = await box(dialog())
      expect(Math.abs(sheet.y + sheet.height - MOBILE.viewport.height)).toBeLessThanOrEqual(1)
      expect(await caloriesField().getAttribute('inputmode')).toBe('decimal')
      await nutrientsToggle().tap()
      for (const { label } of NUTRIENTS) {
        expect(await nutrientField(label).getAttribute('inputmode')).toBe('decimal')
      }
    })

    it('opens Edit food as a bottom sheet with a decimal keypad on a phone', async () => {
      await reopenWith(MOBILE)
      await seedYogurt()
      await openLog(page)

      await entryButton().tap()

      await expect.poll(() => editDialog().isVisible(), eventually).toBe(true)
      const sheet = await box(editDialog())
      expect(Math.abs(sheet.y + sheet.height - MOBILE.viewport.height)).toBeLessThanOrEqual(1)
      expect(await caloriesField().getAttribute('inputmode')).toBe('decimal')
    })

    it.each([
      ['Add food', () => openDialog()],
      [
        'Edit food',
        async () => {
          await seedYogurt()
          await openEditDialog()
        },
      ],
    ])('opens %s centered on a wide screen', async (_name, open) => {
      const viewport = { width: 1280, height: 860 }
      await reopenWith({ viewport })

      await open()

      const centered = await box(dialog())
      expect(Math.abs(centered.x + centered.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
      expect(centered.y + centered.height).toBeLessThan(viewport.height - 1)
    })

    it.each([
      ['light', 'rgb(255, 255, 255)'],
      ['dark', 'rgb(28, 27, 24)'],
    ] as const)('follows the system %s theme', async (colorScheme, background) => {
      await reopenWith({ colorScheme })

      await openDialog()

      expect(await dialog().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        background,
      )
    })
  })
})
