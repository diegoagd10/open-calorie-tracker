import {
  type DailyGoalsUpdate,
  dailyGoalsUpdateSchema,
  newUserSchema,
} from '@open-calorie-tracker/shared'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import { DailyGoalsService } from '../settings/daily-goals/daily-goals.service.js'
import { normalizeUsername } from '../users/users.service.js'
import type { Database } from './database.js'
import {
  type FoodSource,
  foodEntries,
  foodSources,
  servingSizes,
  users,
  waterEntries,
} from './schema.js'

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

// Reuses the serving size when another entry already has the same text.
const servingSizeIdOf = async (database: Database, name: string) =>
  (
    await database.db
      .insert(servingSizes)
      .values({ name })
      .onConflictDoUpdate({ target: servingSizes.name, set: { name } })
      .returning({ id: servingSizes.id })
      .get()
  ).id

export const seedFoodEntry = async (
  database: Database,
  { username, servingSize, source = 'manual', ...entry }: SeedFoodEntry,
) => {
  await database.db.insert(foodEntries).values({
    ...entry,
    userId: await userIdOf(database, username),
    servingSizeId: await servingSizeIdOf(database, servingSize),
    // The migration adds every source, so the lookup always finds one.
    sourceId: sql<number>`(SELECT ${foodSources.id} FROM ${foodSources} WHERE ${foodSources.name} = ${source})`,
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
