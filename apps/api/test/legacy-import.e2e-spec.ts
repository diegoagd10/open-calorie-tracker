import { DEFAULT_DAILY_GOALS, type DailyLog, type ServingSize } from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { importLegacyData } from '../src/db/legacy-import.js'
import { seedUser } from '../src/db/seed.js'
import { type TestApp, accessTokenFor, createTestApp, seedEntries, withBearer } from './app.js'
import { LegacyDatabase, type LegacyFood } from './legacy/legacy-database.js'

// The account registered in the new app, which receives the old user's data.
const ACCOUNT = 'diego'
const PASSWORD = 'correct-horse-battery-staple'

// The user of the old app, whose name the import ignores.
const LEGACY_USERNAME = 'diego-legacy'

const DATE = '2026-10-26'
const TIME_ZONE = 'America/New_York'
// 9:00 AM in New York on DATE.
const LOG_DATE = '2026-10-26T13:00:00.000Z'

const ONE_SERVING = { label: '1 serving', unit: 'serving', base: 1 } as const

// A manual food: 2 servings of a 210 kcal plate, with every nutrient but fiber and sugar.
const EGGS: LegacyFood = {
  logDate: LOG_DATE,
  originalName: '3 huevos estrellados',
  measurement: ONE_SERVING,
  quantity: 2,
  energyMilliKcal: 420_000,
  proteinMilligrams: 36_000,
  carbohydrateMilligrams: 3_000,
  fatMilligrams: 30_000,
  fiberMilligrams: null,
  sugarMilligrams: null,
  sodiumMilligrams: 450,
}

describe('legacy import (e2e)', () => {
  let app: TestApp
  let legacy: LegacyDatabase
  let legacyUserId: number

  beforeEach(async () => {
    app = await createTestApp()
    await seedUser(app.get(Database), { username: ACCOUNT, password: PASSWORD })
    legacy = await LegacyDatabase.create()
    legacyUserId = await legacy.addUser(LEGACY_USERNAME)
  })

  afterEach(async () => {
    await app.close()
    await legacy.remove()
  })

  const http = () => request(app.getHttpServer())

  const importLegacy = () => importLegacyData(app.get(Database), legacy.url)

  const login = (username: string, password: string) =>
    http().post('/v1/login').send({ username, password })

  const dailyLog = async (): Promise<DailyLog> => {
    const token = await accessTokenFor(app, ACCOUNT, PASSWORD)
    const response = await withBearer(
      http().get('/v1/daily-log').query({ date: DATE, timeZone: TIME_ZONE }),
      token,
    )
    expect(response.status).toBe(200)
    return response.body as DailyLog
  }

  const servingSizeNames = async () => {
    const token = await accessTokenFor(app, ACCOUNT, PASSWORD)
    const response = await withBearer(http().get('/v1/serving-sizes'), token)
    return (response.body as ServingSize[]).map((servingSize) => servingSize.name)
  }

  // The day's entries without their ids, which the import assigns.
  const entriesOf = (log: DailyLog) => log.entries.map(({ id: _id, ...entry }) => entry)

  // Imports one food and returns how the daily log shows it.
  const importedFood = async (food: Partial<LegacyFood>) => {
    await legacy.addFood(legacyUserId, { ...EGGS, ...food })
    await importLegacy()
    const [entry] = entriesOf(await dailyLog())
    return entry
  }

  describe('the account', () => {
    it('keeps its username and password, and gets no user of the old app', async () => {
      await importLegacy()

      expect((await login(ACCOUNT, PASSWORD)).status).toBe(200)
      expect((await login(LEGACY_USERNAME, PASSWORD)).status).toBe(401)
    })

    it.each([
      ['no account', []],
      ['two accounts', [ACCOUNT, 'ana']],
    ])('refuses a new app with %s', async (_case, usernames) => {
      const other = await createTestApp()
      for (const username of usernames) {
        await seedUser(other.get(Database), { username, password: PASSWORD })
      }

      await expect(importLegacyData(other.get(Database), legacy.url)).rejects.toThrow(
        'The new app must have exactly one account',
      )
      await other.close()
    })

    it('refuses an old app with more than one user', async () => {
      await legacy.addUser('ana')

      await expect(importLegacy()).rejects.toThrow('The old app must have exactly one user')
    })
  })

  describe('food', () => {
    it('logs each food at its instant with its totals in kcal, grams and mg of sodium', async () => {
      expect(await importedFood({})).toEqual({
        type: 'food',
        loggedAt: LOG_DATE,
        name: '3 huevos estrellados',
        source: 'manual',
        servingSize: '1 serving',
        quantity: 2,
        calories: 420,
        protein: 36,
        carbohydrate: 3,
        fat: 30,
        fiber: null,
        sugar: null,
        sodium: 450,
      })
    })

    it('names the food as the user edited it', async () => {
      const entry = await importedFood({ editedName: 'Huevos con salsa' })

      expect(entry).toMatchObject({ name: 'Huevos con salsa' })
    })

    it('logs a food without calories as 0 kcal', async () => {
      const entry = await importedFood({ energyMilliKcal: null })

      expect(entry).toMatchObject({ calories: 0 })
    })

    // The new app takes 0.5 to 20 servings in steps of 0.5. Any other quantity becomes 1 serving
    // of what was eaten, so the entry stays editable and keeps its totals.
    it.each([
      ['servings in steps of 0.5', ONE_SERVING, 14, '1 serving', 14],
      [
        'a measurement in grams',
        { label: '1 serving (19 g)', unit: 'g', base: 19 },
        2,
        '1 serving (19 g)',
        2,
      ],
      ['a fraction of a gram measurement', { label: '1 g', unit: 'g', base: 1 }, 11.4, '11.4 g', 1],
      ['more than 20 of a measurement', { label: '1 g', unit: 'g', base: 1 }, 60, '60 g', 1],
      [
        'a fraction of a measurement in grams',
        { label: '1 serving (19 g)', unit: 'g', base: 19 },
        0.2,
        '3.8 g',
        1,
      ],
      [
        'a fraction of a measurement in ml',
        { label: '1 serving (325 ml)', unit: 'ml', base: 325 },
        0.1,
        '32.5 ml',
        1,
      ],
      ['a fraction of a serving', ONE_SERVING, 0.2, '0.2 × 1 serving', 1],
    ] as const)(
      'turns %s into its serving size and quantity',
      async (_case, measurement, quantity, servingSize, expectedQuantity) => {
        const entry = await importedFood({ measurement, quantity })

        expect(entry).toMatchObject({ servingSize, quantity: expectedQuantity, calories: 420 })
      },
    )

    it('gives the account each serving size once, whatever its case', async () => {
      await legacy.addFood(legacyUserId, EGGS)
      await legacy.addFood(legacyUserId, {
        ...EGGS,
        measurement: { ...ONE_SERVING, label: '1 Serving' },
      })
      await legacy.addFood(legacyUserId, {
        ...EGGS,
        measurement: { label: '1 g', unit: 'g', base: 1 },
      })

      await importLegacy()

      expect((await servingSizeNames()).toSorted()).toEqual(['1 g', '1 serving'])
    })
  })

  describe('water', () => {
    it('logs each water at its instant with its fluid ounces', async () => {
      await legacy.addWater(legacyUserId, { logDate: LOG_DATE, ounces: '12.5' })

      await importLegacy()

      expect(entriesOf(await dailyLog())).toEqual([
        { type: 'water', loggedAt: LOG_DATE, amount: 12.5 },
      ])
    })
  })

  describe('daily goals', () => {
    it('keeps the goals the user set, in kcal, grams, mg of sodium and fluid ounces', async () => {
      await legacy.addGoals(legacyUserId, {
        calorieMilliKcal: 1_800_000,
        waterOunces: '80',
        proteinMilligrams: 150_000,
        carbohydrateMilligrams: 200_000,
        fatMilligrams: 60_000,
        fiberMilligrams: 30_000,
        sugarMilligrams: 40_000,
        sodiumMilligrams: 2_000,
      })

      await importLegacy()

      expect((await dailyLog()).goals).toEqual({
        calories: 1800,
        protein: 150,
        carbohydrate: 200,
        fat: 60,
        fiber: 30,
        sugar: 40,
        sodium: 2000,
        water: 80,
      })
    })

    it('gives the account the default goals when the user never set any', async () => {
      const token = await accessTokenFor(app, ACCOUNT, PASSWORD)
      await withBearer(http().patch('/v1/settings/daily-goals').send({ calories: 2500 }), token)

      await importLegacy()

      expect((await dailyLog()).goals).toEqual(DEFAULT_DAILY_GOALS)
    })
  })

  describe('replacing', () => {
    it("replaces the account's entries and serving sizes", async () => {
      await seedEntries(app.get(Database), ACCOUNT)
      await legacy.addFood(legacyUserId, EGGS)

      await importLegacy()

      expect(entriesOf(await dailyLog())).toEqual([
        expect.objectContaining({ name: '3 huevos estrellados' }),
      ])
      expect(await servingSizeNames()).toEqual(['1 serving'])
    })

    it('gives the same data when run again', async () => {
      await legacy.addFood(legacyUserId, EGGS)
      await legacy.addWater(legacyUserId, { logDate: LOG_DATE, ounces: '16' })

      await importLegacy()
      const first = entriesOf(await dailyLog())
      await importLegacy()

      expect(entriesOf(await dailyLog())).toEqual(first)
    })

    it('changes nothing when an entry of the old app cannot be read', async () => {
      await seedEntries(app.get(Database), ACCOUNT)
      const before = entriesOf(await dailyLog())
      await legacy.addFood(legacyUserId, EGGS)
      await legacy.addWater(legacyUserId, { logDate: 'not a date', ounces: '16' })

      await expect(importLegacy()).rejects.toThrow()

      expect(entriesOf(await dailyLog())).toEqual(before)
    })

    it('reports how many of each it imported', async () => {
      await legacy.addFood(legacyUserId, EGGS)
      await legacy.addFood(legacyUserId, EGGS)
      await legacy.addWater(legacyUserId, { logDate: LOG_DATE, ounces: '16' })

      expect(await importLegacy()).toEqual({ foodEntries: 2, waterEntries: 1, dailyGoals: 0 })
    })
  })
})
