import { hashPassword } from '../auth/password.js'
import type { Database } from './database.js'
import { users } from './schema.js'

export type SeedUser = { username: string; password: string }

// Development and test data only: the API itself never seeds users.
export const seedUser = async (database: Database, { username, password }: SeedUser) => {
  const passwordHash = await hashPassword(password)
  await database.db
    .insert(users)
    .values({ username, passwordHash })
    .onConflictDoUpdate({ target: users.username, set: { passwordHash } })
}
