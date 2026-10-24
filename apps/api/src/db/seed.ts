import { eq } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import type { Database } from './database.js'
import { foodEntries, users, waterEntries } from './schema.js'

export type SeedUser = { username: string; password: string }

// Development and test data only: the API itself never seeds users or entries.
export const seedUser = async (database: Database, { username, password }: SeedUser) => {
  const passwordHash = await hashPassword(password)
  await database.db
    .insert(users)
    .values({ username, passwordHash })
    .onConflictDoUpdate({ target: users.username, set: { passwordHash } })
}

type ForUser<T> = Omit<T, 'id' | 'userId' | 'source'> & { username: string }

export type SeedFoodEntry = ForUser<typeof foodEntries.$inferInsert>
export type SeedWaterEntry = ForUser<typeof waterEntries.$inferInsert>

const userIdOf = async (database: Database, username: string) => {
  const user = await database.db.query.users.findFirst({ where: eq(users.username, username) })
  if (user === undefined) throw new Error(`No user named "${username}"`)
  return user.id
}

export const seedFoodEntry = async (database: Database, { username, ...entry }: SeedFoodEntry) => {
  await database.db
    .insert(foodEntries)
    .values({ ...entry, userId: await userIdOf(database, username) })
}

export const seedWaterEntry = async (
  database: Database,
  { username, ...entry }: SeedWaterEntry,
) => {
  await database.db
    .insert(waterEntries)
    .values({ ...entry, userId: await userIdOf(database, username) })
}
