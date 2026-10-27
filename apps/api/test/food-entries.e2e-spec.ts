import {
  type FoodLogEntry,
  MAX_FOOD_NAME_LENGTH,
  MAX_PER_SERVING,
  MAX_SERVINGS,
  SERVINGS_STEP,
} from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { foodEntries } from '../src/db/schema.js'
import { seedUser } from '../src/db/seed.js'
import { INVALID_TOKENS, type TestApp, accessTokenFor, createTestApp, withBearer } from './app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const TIME_ZONE = 'America/New_York'

// The API stamps new entries with its own clock, so the day they land on is the real today.
const todayInNewYork = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())

type DailyLog = { entries: FoodLogEntry[]; totals: Record<string, number> }

describe('food entries (e2e)', () => {
  let app: TestApp
  let database: Database
  let token: string
  // diego's "1 cup (245 g)".
  let servingSizeId: number

  beforeEach(async () => {
    app = await createTestApp()
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    token = await accessTokenFor(app, USERNAME, PASSWORD)
    servingSizeId = await createServingSize('1 cup (245 g)', token)
  })

  afterEach(async () => {
    await app.close()
  })

  const createServingSize = async (name: string, bearer: string) => {
    const response = await withBearer(
      request(app.getHttpServer()).post('/v1/serving-sizes').send({ name }),
      bearer,
    )
    expect(response.status).toBe(201)
    return (response.body as { id: number }).id
  }

  // Sends diego's token unless the test passes another one, or null for none.
  type Bearer = string | null | undefined

  const withToken = (pending: request.Test, bearer: Bearer) =>
    withBearer(pending, bearer === undefined ? token : bearer)

  const create = (body: object, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).post('/v1/food-entries').send(body), bearer)

  const update = (id: number | string, body: object, bearer?: Bearer) =>
    withToken(request(app.getHttpServer()).patch(`/v1/food-entries/${id}`).send(body), bearer)

  const dailyLog = async () => {
    const response = await withBearer(
      request(app.getHttpServer())
        .get('/v1/daily-log')
        .query({ date: todayInNewYork(), timeZone: TIME_ZONE }),
      token,
    )
    expect(response.status).toBe(200)
    return response.body as DailyLog
  }

  const storedEntries = () => database.db.select().from(foodEntries)

  // Per serving, as the label prints it.
  const greekYogurt = () => ({
    name: 'Greek yogurt with honey',
    servingSizeId,
    quantity: 1.5,
    calories: 180,
    protein: 17,
    carbohydrate: 20,
    fat: 4,
    fiber: 0,
    sugar: 18,
    sodium: 85,
  })

  it('creates an entry at the current time with 201, multiplied by the servings', async () => {
    const before = Date.now()

    const response = await create(greekYogurt())

    const after = Date.now()
    expect(response.status).toBe(201)
    const entry = response.body as FoodLogEntry
    expect(entry).toEqual({
      id: expect.any(Number) as unknown,
      type: 'food',
      loggedAt: expect.any(String) as unknown,
      name: 'Greek yogurt with honey',
      source: 'manual',
      servingSize: '1 cup (245 g)',
      quantity: 1.5,
      calories: 270,
      protein: 25.5,
      carbohydrate: 30,
      fat: 6,
      fiber: 0,
      sugar: 27,
      sodium: 127.5,
    })
    expect(Date.parse(entry.loggedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(entry.loggedAt)).toBeLessThanOrEqual(after)
    expect((await dailyLog()).entries).toEqual([entry])
  })

  it('stores omitted nutrients as no data and accepts 0 kcal', async () => {
    const response = await create({
      name: 'Black coffee',
      servingSizeId,
      quantity: 2,
      calories: 0,
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual(
      expect.objectContaining({
        calories: 0,
        protein: null,
        carbohydrate: null,
        fat: null,
        fiber: null,
        sugar: null,
        sodium: null,
      }),
    )
    const { totals } = await dailyLog()
    expect(totals).toEqual(expect.objectContaining({ calories: 0, protein: 0, foodEntries: 1 }))
  })

  describe('PATCH /v1/food-entries/:id', () => {
    it('replaces the entry with 200, multiplied by the servings, keeping its time and source', async () => {
      const created = (await create(greekYogurt())).body as FoodLogEntry

      const response = await update(created.id, {
        name: 'Skyr',
        servingSizeId,
        quantity: 2,
        calories: 100,
        protein: 10,
      })

      expect(response.status).toBe(200)
      const entry = response.body as FoodLogEntry
      expect(entry).toEqual({
        id: created.id,
        type: 'food',
        loggedAt: created.loggedAt,
        name: 'Skyr',
        source: 'manual',
        servingSize: '1 cup (245 g)',
        quantity: 2,
        calories: 200,
        protein: 20,
        carbohydrate: null,
        fat: null,
        fiber: null,
        sugar: null,
        sodium: null,
      })
      expect((await dailyLog()).entries).toEqual([entry])
    })

    it("moves the entry to another of the user's serving sizes", async () => {
      const created = (await create(greekYogurt())).body as FoodLogEntry
      const bowl = await createServingSize('1 bowl', token)

      const response = await update(created.id, { ...greekYogurt(), servingSizeId: bowl })

      expect(response.status).toBe(200)
      expect((response.body as FoodLogEntry).servingSize).toBe('1 bowl')
    })
  })

  describe('validation', () => {
    const INVALID_CHANGES = [
      ['an empty name', { name: '' }],
      ['a name that is too long', { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH + 1) }],
      ['a missing serving size', { servingSizeId: undefined }],
      ['a serving size id sent as text', { servingSizeId: '7' }],
      ['a serving size that does not exist', { servingSizeId: 99_999 }],
      ['servings off the 0.5 steps', { quantity: 0.25 }],
      ['more servings than the maximum', { quantity: MAX_SERVINGS + SERVINGS_STEP }],
      ['negative calories', { calories: -1 }],
      ['more calories than the maximum', { calories: MAX_PER_SERVING + 1 }],
      ['a nutrient with two decimals', { protein: 12.55 }],
      ['an unknown key', { source: 'manual' }],
    ] as const

    // Another user's serving size, created with their token.
    const theirServingSize = async () =>
      createServingSize('1 burrito', await accessTokenFor(app, OTHER_USERNAME, PASSWORD))

    it.each(INVALID_CHANGES)(
      'rejects creating %s with 400 and stores nothing',
      async (_case, change) => {
        const response = await create({ ...greekYogurt(), ...change })

        expect(response.status).toBe(400)
        expect(await storedEntries()).toEqual([])
      },
    )

    it("rejects creating with another user's serving size with 400 and stores nothing", async () => {
      const response = await create({ ...greekYogurt(), servingSizeId: await theirServingSize() })

      expect(response.status).toBe(400)
      expect(await storedEntries()).toEqual([])
    })

    it.each(INVALID_CHANGES)(
      'rejects changing to %s with 400 and changes nothing',
      async (_case, change) => {
        const { id } = (await create(greekYogurt())).body as FoodLogEntry
        const stored = await storedEntries()

        const response = await update(id, { ...greekYogurt(), ...change })

        expect(response.status).toBe(400)
        expect(await storedEntries()).toEqual(stored)
      },
    )

    it("rejects changing to another user's serving size with 400 and changes nothing", async () => {
      const { id } = (await create(greekYogurt())).body as FoodLogEntry
      const stored = await storedEntries()

      const response = await update(id, {
        ...greekYogurt(),
        servingSizeId: await theirServingSize(),
      })

      expect(response.status).toBe(400)
      expect(await storedEntries()).toEqual(stored)
    })
  })

  describe("other users' entries and unknown ids", () => {
    it("answers PATCH on another user's entry with 404 and changes nothing", async () => {
      const theirToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)
      const theirs = await createServingSize('1 cup (245 g)', theirToken)
      const { id } = (await create({ ...greekYogurt(), servingSizeId: theirs }, theirToken))
        .body as FoodLogEntry
      const stored = await storedEntries()

      const response = await update(id, greekYogurt())

      expect(response.status).toBe(404)
      expect(await storedEntries()).toEqual(stored)
    })

    it('answers PATCH on an id that does not exist with 404', async () => {
      expect((await update(99_999, greekYogurt())).status).toBe(404)
    })

    it('answers PATCH on an id that is not a number with 400', async () => {
      expect((await update('abc', greekYogurt())).status).toBe(400)
    })
  })

  describe('authentication', () => {
    const requests = [
      ['POST', (bearer?: Bearer) => create(greekYogurt(), bearer)],
      ['PATCH', (bearer?: Bearer) => update(1, greekYogurt(), bearer)],
    ] as const

    it.each(requests)('rejects %s without a token with 401', async (_method, send) => {
      expect((await send(null)).status).toBe(401)
    })

    it.each(
      requests.flatMap(([method, send]) =>
        INVALID_TOKENS.map(
          ([invalidCase, invalid]) => [method, invalidCase, send, invalid] as const,
        ),
      ),
    )('rejects %s with %s with 401', async (_method, _case, send, invalid) => {
      expect((await send(await invalid())).status).toBe(401)
    })
  })
})
