import { type Client, createClient } from '@libsql/client'
import { MAX_SERVINGS, MIN_SERVINGS, SERVINGS_STEP } from '@open-calorie-tracker/shared'
import { type SQL, eq, sql } from 'drizzle-orm'
import type { Database } from './database.js'
import {
  dailyGoals,
  foodEntries,
  foodSources,
  servingSizes,
  users,
  waterEntries,
} from './schema.js'

// What one import brought into the account.
export type LegacyImportSummary = { foodEntries: number; waterEntries: number; dailyGoals: number }

// The old app (open-calory-tracker) stored amounts as integers: quantities in millionths
// (microunits), kcal and grams in thousandths (milli-kcal, milligrams), sodium in whole milligrams.
const MICRO = 1_000_000
const MILLI = 1_000

type LegacyFoodRow = {
  id: number
  log_date: string
  original_name: string
  edited_name: string | null
  selected_measurement_label: string
  selected_measurement_unit: 'g' | 'ml' | 'serving'
  selected_measurement_base_quantity_microunits: number
  quantity_microunits: number
  authoritative_energy_milli_kcal: number | null
  authoritative_protein_milligrams: number | null
  authoritative_carbohydrate_milligrams: number | null
  authoritative_fat_milligrams: number | null
  authoritative_fiber_milligrams: number | null
  authoritative_sugar_milligrams: number | null
  authoritative_sodium_milligrams: number | null
}

type LegacyWaterRow = { id: number; log_date: string; ounces: string }

type LegacyGoalsRow = {
  calorie_target_milli_kcal: number
  water_target_ounces: string
  protein_target_milligrams: number
  carbohydrate_target_milligrams: number
  fat_target_milligrams: number
  fiber_target_milligrams: number
  sugar_maximum_milligrams: number
  sodium_maximum_milligrams: number
}

const rowsOf = async <T>(client: Client, query: string, args: (number | string)[] = []) =>
  (await client.execute({ sql: query, args })).rows as unknown as T[]

const instantOf = (logDate: string, what: string) => {
  const instant = new Date(logDate)
  if (Number.isNaN(instant.getTime())) throw new Error(`${what} has an invalid date: ${logDate}`)
  return instant
}

// At most three decimals, without trailing zeros: 3.8, 11.4, 60.
const decimal = (value: number) => String(Number(value.toFixed(3)))

const fromMilli = (value: number | null) => (value === null ? null : value / MILLI)

// The new app takes MIN_SERVINGS to MAX_SERVINGS servings in steps of SERVINGS_STEP. Any other
// quantity becomes 1 serving of what was eaten, so the entry stays editable with its totals.
const servingOf = (row: LegacyFoodRow): { servingSize: string; quantity: number } => {
  const label = row.selected_measurement_label
  const quantity = row.quantity_microunits / MICRO
  const inSteps = Number.isInteger(row.quantity_microunits / (SERVINGS_STEP * MICRO))
  if (inSteps && quantity >= MIN_SERVINGS && quantity <= MAX_SERVINGS) {
    return { servingSize: label, quantity }
  }

  const unit = row.selected_measurement_unit
  if (unit === 'serving') return { servingSize: `${decimal(quantity)} × ${label}`, quantity: 1 }
  const amount = (row.selected_measurement_base_quantity_microunits / MICRO) * quantity
  return { servingSize: `${decimal(amount)} ${unit}`, quantity: 1 }
}

const goalOf = (value: number) => Math.max(1, Math.round(value))

const readLegacy = async (legacyUrl: string) => {
  const client = createClient({ url: legacyUrl })
  try {
    const legacyUsers = await rowsOf<{ id: number }>(client, 'SELECT id FROM users')
    const [legacyUser] = legacyUsers
    if (legacyUsers.length !== 1 || legacyUser === undefined) {
      throw new Error('The old app must have exactly one user')
    }
    const userId = [Number(legacyUser.id)]
    return {
      foods: await rowsOf<LegacyFoodRow>(
        client,
        'SELECT * FROM food_events WHERE user_id = ? ORDER BY log_date, id',
        userId,
      ),
      waters: await rowsOf<LegacyWaterRow>(
        client,
        'SELECT id, log_date, ounces FROM water_events WHERE user_id = ? ORDER BY log_date, id',
        userId,
      ),
      goals: await rowsOf<LegacyGoalsRow>(
        client,
        'SELECT * FROM daily_goals WHERE user_id = ?',
        userId,
      ),
    }
  } finally {
    client.close()
  }
}

// Loads the food, water and daily goals of the old app's only user into the new app's only
// account, replacing that account's entries, serving sizes and goals. Users and passwords are
// never touched. Everything is written in one batch, so a failure changes nothing.
export const importLegacyData = async (
  database: Database,
  legacyUrl: string,
): Promise<LegacyImportSummary> => {
  const accounts = await database.db.select({ id: users.id }).from(users)
  const [account] = accounts
  if (accounts.length !== 1 || account === undefined) {
    throw new Error('The new app must have exactly one account')
  }
  const userId = account.id
  const { foods, waters, goals } = await readLegacy(legacyUrl)

  const foodValues = foods.map((row) => ({
    row,
    loggedAt: instantOf(row.log_date, `Food event ${row.id}`),
    ...servingOf(row),
  }))
  const waterValues = waters.map((row) => {
    const amount = Number(row.ounces)
    if (!Number.isFinite(amount)) throw new Error(`Water event ${row.id} has invalid ounces`)
    return { userId, loggedAt: instantOf(row.log_date, `Water event ${row.id}`), amount }
  })

  // One serving size per name regardless of case, named as it first appears.
  const servingSizeNames = new Map<string, string>()
  for (const { servingSize } of foodValues) {
    const key = servingSize.toLowerCase()
    if (!servingSizeNames.has(key)) servingSizeNames.set(key, servingSize)
  }

  // Ids the batch only knows once the rows exist, so they are looked up when inserting.
  const servingSizeId = (name: string): SQL =>
    sql`(SELECT ${servingSizes.id} FROM ${servingSizes} WHERE ${servingSizes.userId} = ${userId} AND ${servingSizes.name} = ${name} COLLATE NOCASE)`
  const manualSourceId = sql`(SELECT ${foodSources.id} FROM ${foodSources} WHERE ${foodSources.name} = 'manual')`

  const db = database.db
  const [legacyGoals] = goals
  await db.batch([
    db.delete(foodEntries).where(eq(foodEntries.userId, userId)),
    db.delete(waterEntries).where(eq(waterEntries.userId, userId)),
    db.delete(servingSizes).where(eq(servingSizes.userId, userId)),
    db.delete(dailyGoals).where(eq(dailyGoals.userId, userId)),
    ...[...servingSizeNames.values()].map((name) =>
      db.insert(servingSizes).values({ userId, name }),
    ),
    ...foodValues.map(({ row, loggedAt, servingSize, quantity }) =>
      db.insert(foodEntries).values({
        userId,
        loggedAt,
        name: row.edited_name ?? row.original_name,
        sourceId: manualSourceId,
        servingSizeId: servingSizeId(servingSize),
        quantity,
        calories: fromMilli(row.authoritative_energy_milli_kcal) ?? 0,
        protein: fromMilli(row.authoritative_protein_milligrams),
        carbohydrate: fromMilli(row.authoritative_carbohydrate_milligrams),
        fat: fromMilli(row.authoritative_fat_milligrams),
        fiber: fromMilli(row.authoritative_fiber_milligrams),
        sugar: fromMilli(row.authoritative_sugar_milligrams),
        sodium: row.authoritative_sodium_milligrams,
      }),
    ),
    ...waterValues.map((values) => db.insert(waterEntries).values(values)),
    ...(legacyGoals === undefined
      ? []
      : [
          db.insert(dailyGoals).values({
            userId,
            calories: goalOf(legacyGoals.calorie_target_milli_kcal / MILLI),
            protein: goalOf(legacyGoals.protein_target_milligrams / MILLI),
            carbohydrate: goalOf(legacyGoals.carbohydrate_target_milligrams / MILLI),
            fat: goalOf(legacyGoals.fat_target_milligrams / MILLI),
            fiber: goalOf(legacyGoals.fiber_target_milligrams / MILLI),
            sugar: goalOf(legacyGoals.sugar_maximum_milligrams / MILLI),
            sodium: goalOf(legacyGoals.sodium_maximum_milligrams),
            water: goalOf(Number(legacyGoals.water_target_ounces)),
          }),
        ]),
  ])

  return {
    foodEntries: foodValues.length,
    waterEntries: waterValues.length,
    dailyGoals: legacyGoals === undefined ? 0 : 1,
  }
}
