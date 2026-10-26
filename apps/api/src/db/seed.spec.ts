import {
  MAX_DAILY_GOAL,
  MAX_SERVING_SIZE_LENGTH,
  PASSWORD_MIN_LENGTH,
  servingSizeSchema,
} from '@open-calorie-tracker/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from './database.js'
import { foodSources, servingSizes } from './schema.js'
import { type SeedFoodEntry, seedDailyGoals, seedFoodEntry, seedUser } from './seed.js'

const PASSWORD = 'correct-horse-battery-staple'

describe('seedUser', () => {
  let database: Database

  beforeEach(async () => {
    database = await Database.connect(':memory:')
  })

  afterEach(() => {
    database.close()
  })

  const storedUsernames = async () =>
    (await database.db.query.users.findMany()).map((user) => user.username)

  it('stores the username in lowercase', async () => {
    await seedUser(database, { username: 'Ana', password: PASSWORD })

    expect(await storedUsernames()).toEqual(['ana'])
  })

  // The seed follows the same rules as registration, so it never creates an account that
  // could not have been registered.
  it.each([
    ['an underscore', 'ana_1'],
    ['a space', 'ana 1'],
    ['an accent', 'josé'],
    ['an ñ', 'peña'],
  ])('rejects a username with %s and creates no user', async (_case, username) => {
    await expect(seedUser(database, { username, password: PASSWORD })).rejects.toThrow(
      'Username can only contain letters and numbers',
    )
    expect(await storedUsernames()).toEqual([])
  })

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters and creates no user`, async () => {
    await expect(
      seedUser(database, { username: 'ana', password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1) }),
    ).rejects.toThrow(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    expect(await storedUsernames()).toEqual([])
  })
})

describe('seedFoodEntry', () => {
  let database: Database

  beforeEach(async () => {
    database = await Database.connect(':memory:')
    await seedUser(database, { username: 'ana', password: PASSWORD })
  })

  afterEach(() => {
    database.close()
  })

  const entry = (overrides: Partial<SeedFoodEntry> = {}): SeedFoodEntry => ({
    username: 'ana',
    loggedAt: new Date('2026-10-24T14:53:00Z'),
    name: '2 tortillas de maíz',
    servingSize: '1 serving',
    quantity: 1,
    calories: 100,
    ...overrides,
  })

  const storedEntries = () =>
    database.db.query.foodEntries.findMany({ columns: { servingSizeId: true, sourceId: true } })

  const storedServingSizes = async () =>
    (await database.db.select().from(servingSizes)).map(({ id, userId, name }) => ({
      id,
      userId,
      name,
    }))

  const userIdOf = async (username: string) =>
    (
      await database.db.query.users.findFirst({
        where: (table, { eq }) => eq(table.username, username),
      })
    )?.id

  it("adds the serving size to the user's own and reuses it regardless of case", async () => {
    await seedFoodEntry(database, entry())
    await seedFoodEntry(database, entry({ name: 'Manzana', servingSize: '1 SERVING' }))
    await seedFoodEntry(database, entry({ name: 'Leche', servingSize: '  1   cup ' }))

    const anaId = await userIdOf('ana')
    const sizes = await storedServingSizes()
    expect(sizes.map(({ userId, name }) => ({ userId, name }))).toEqual([
      { userId: anaId, name: '1 serving' },
      { userId: anaId, name: '1 cup' },
    ])
    expect((await storedEntries()).map((stored) => stored.servingSizeId)).toEqual([
      sizes[0]?.id,
      sizes[0]?.id,
      sizes[1]?.id,
    ])
  })

  it('gives each user their own serving size for the same text', async () => {
    await seedUser(database, { username: 'bob', password: PASSWORD })

    await seedFoodEntry(database, entry())
    await seedFoodEntry(database, entry({ username: 'bob' }))

    const sizes = await storedServingSizes()
    expect(sizes.map(({ userId, name }) => ({ userId, name }))).toEqual([
      { userId: await userIdOf('ana'), name: '1 serving' },
      { userId: await userIdOf('bob'), name: '1 serving' },
    ])
  })

  // The seed follows the same rules as the API, so it never stores a serving size the user could
  // not have saved.
  it.each([
    ['a blank serving size', '   '],
    ['a serving size that is too long', 'a'.repeat(MAX_SERVING_SIZE_LENGTH + 1)],
  ])('rejects %s with the message of the API and stores nothing', async (_case, servingSize) => {
    const apiError = servingSizeSchema.safeParse({ name: servingSize }).error?.issues[0]?.message
    expect(apiError).toEqual(expect.any(String))

    await expect(seedFoodEntry(database, entry({ servingSize }))).rejects.toThrow(apiError)
    expect(await storedEntries()).toEqual([])
    expect(await storedServingSizes()).toEqual([])
  })

  it('stores the entry as manual when no source is given', async () => {
    await seedFoodEntry(database, entry())

    const [manual] = await database.db.select().from(foodSources)
    expect(manual?.name).toBe('manual')
    expect((await storedEntries()).map((stored) => stored.sourceId)).toEqual([manual?.id])
  })

  it('finds the user regardless of case', async () => {
    await seedFoodEntry(database, entry({ username: 'Ana' }))

    expect(await storedEntries()).toHaveLength(1)
  })

  it('rejects an unknown user and stores no entry', async () => {
    await expect(seedFoodEntry(database, entry({ username: 'nadie' }))).rejects.toThrow(
      'No user named "nadie"',
    )
    expect(await storedEntries()).toEqual([])
  })
})

describe('seedDailyGoals', () => {
  let database: Database

  beforeEach(async () => {
    database = await Database.connect(':memory:')
    await seedUser(database, { username: 'ana', password: PASSWORD })
  })

  afterEach(() => {
    database.close()
  })

  // The seed follows the same rules as the API, so it never stores goals the user could not save.
  it('rejects a goal the app would reject', async () => {
    await expect(seedDailyGoals(database, { username: 'ana', calories: 0 })).rejects.toThrow(
      `Enter a number from 1 to ${MAX_DAILY_GOAL}`,
    )
  })
})
