import {
  type DailyGoalsUpdate,
  dailyGoalsUpdateSchema,
  newUserSchema,
  servingSizeSchema,
} from '@open-calorie-tracker/shared'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import { sourceIdOf } from '../food-entries/food-entries.service.js'
import { ServingSizesService } from '../serving-sizes/serving-sizes.service.js'
import { DailyGoalsService } from '../settings/daily-goals/daily-goals.service.js'
import { normalizeUsername } from '../users/users.service.js'
import type { Database } from './database.js'
import { type FoodSource, foodEntries, users, waterEntries } from './schema.js'

export type SeedUser = { username: string; password: string }

const parseOrThrow = <T>(
  result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
) => {
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('\n'))
  }
  return result.data
}

// Development and test data only: the API itself never seeds users or entries. Users follow the
// same rules as registration, so it never creates a user that could not have been registered.
export const seedUser = async (database: Database, user: SeedUser) => {
  const parsed = parseOrThrow(newUserSchema.safeParse(user))

  const username = normalizeUsername(parsed.username)
  const passwordHash = await hashPassword(parsed.password)
  await database.db
    .insert(users)
    .values({ username, passwordHash })
    .onConflictDoUpdate({ target: users.username, set: { passwordHash } })
}

type ForUser<T> = Omit<T, 'id' | 'userId'> & { username: string }

// Takes the serving size as text and the source by name, as the API returns them.
export type SeedFoodEntry = ForUser<
  Omit<typeof foodEntries.$inferInsert, 'servingSizeId' | 'sourceId'>
> & { servingSize: string; source?: FoodSource }
export type SeedWaterEntry = ForUser<typeof waterEntries.$inferInsert>

const userIdOf = async (database: Database, username: string) => {
  const user = await database.db.query.users.findFirst({
    where: eq(users.username, normalizeUsername(username)),
  })
  if (user === undefined) throw new Error(`No user named "${username}"`)
  return user.id
}

// The serving size follows the same rules as the API and is added to the user's, or reused when
// they already have it regardless of case.
export const seedFoodEntry = async (
  database: Database,
  { username, servingSize, source = 'manual', ...entry }: SeedFoodEntry,
) => {
  const input = parseOrThrow(servingSizeSchema.safeParse({ name: servingSize }))
  const userId = await userIdOf(database, username)
  const { servingSize: stored } = await new ServingSizesService(database).findOrCreate(
    userId,
    input,
  )
  await database.db.insert(foodEntries).values({
    ...entry,
    userId,
    servingSizeId: stored.id,
    sourceId: sourceIdOf(source),
  })
}

export const seedWaterEntry = async (
  database: Database,
  { username, ...entry }: SeedWaterEntry,
) => {
  await database.db
    .insert(waterEntries)
    .values({ ...entry, userId: await userIdOf(database, username) })
}

// Follows the same rules as the API, so it never stores goals the user could not have saved.
export const seedDailyGoals = async (
  database: Database,
  { username, ...goals }: DailyGoalsUpdate & { username: string },
) => {
  const changes = parseOrThrow(dailyGoalsUpdateSchema.safeParse(goals))
  await new DailyGoalsService(database).update(await userIdOf(database, username), changes)
}
