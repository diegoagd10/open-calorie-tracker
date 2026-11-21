import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { type NewUser, type Profile } from '@open-calorie-tracker/shared'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import { Database } from '../db/database.js'
import { type User, users } from '../db/schema.js'

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

  async findById(id: number): Promise<User | undefined> {
    return this.database.db.query.users.findFirst({ where: eq(users.id, id) })
  }

  async profileOf(id: number): Promise<Profile> {
    const user = await this.findById(id)
    if (user === undefined) throw new UnauthorizedException()
    return { username: user.username }
  }

  async setPassword(id: number, password: string): Promise<void> {
    const passwordHash = await hashPassword(password)
    await this.database.db.update(users).set({ passwordHash }).where(eq(users.id, id))
  }

  async hasAny(): Promise<boolean> {
    return (await this.database.db.query.users.findFirst({ columns: { id: true } })) !== undefined
  }

  async register({ username, password }: NewUser): Promise<number> {
    if (await this.hasAny()) throw userExists()

    const passwordHash = await hashPassword(password)
    // oxlint-disable-next-line local/no-comments
    // Bare column names: SQLite rejects table-qualified ones in INSERT and RETURNING.
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
