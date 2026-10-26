import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import {
  type ChangePasswordInput,
  INCORRECT_CURRENT_PASSWORD_MESSAGE,
  type NewUser,
} from '@open-calorie-tracker/shared'
import { eq, sql } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { Database } from '../db/database.js'
import { type User, users } from '../db/schema.js'

// Usernames are stored and looked up in lowercase, so they match regardless of case.
export const normalizeUsername = (username: string) => username.toLowerCase()

const userExists = () => new ConflictException('An account already exists')

@Injectable()
export class UsersService {
  constructor(private readonly database: Database) {}

  async findByUsername(username: string): Promise<User | undefined> {
    return this.database.db.query.users.findFirst({
      where: eq(users.username, normalizeUsername(username)),
    })
  }

  // Replaces the user's password once the current one proves it is them. Tokens already issued,
  // including the one making this request, stay valid until they expire.
  async changePassword(
    id: number,
    { currentPassword, newPassword }: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.database.db.query.users.findFirst({ where: eq(users.id, id) })
    if (user === undefined || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ForbiddenException(INCORRECT_CURRENT_PASSWORD_MESSAGE)
    }

    const passwordHash = await hashPassword(newPassword)
    await this.database.db.update(users).set({ passwordHash }).where(eq(users.id, id))
  }

  async hasAny(): Promise<boolean> {
    return (await this.database.db.query.users.findFirst({ columns: { id: true } })) !== undefined
  }

  // The app has a single user, created on first run. Returns the new user's id.
  async register({ username, password }: NewUser): Promise<number> {
    // Skips the slow hash when the answer is already known.
    if (await this.hasAny()) throw userExists()

    const passwordHash = await hashPassword(password)
    // Inserts only while there is no user, in a single statement so two concurrent
    // registrations cannot both succeed. Bare column names: SQLite rejects table-qualified ones
    // in INSERT and RETURNING.
    const column = (name: string) => sql.identifier(name)
    const [created] = await this.database.db.all<{ id: number }>(sql`
      INSERT INTO ${users} (${column(users.username.name)}, ${column(users.passwordHash.name)})
      SELECT ${normalizeUsername(username)}, ${passwordHash}
      WHERE NOT EXISTS (SELECT 1 FROM ${users})
      RETURNING ${column(users.id.name)}
    `)
    if (created === undefined) throw userExists()
    return created.id
  }
}
