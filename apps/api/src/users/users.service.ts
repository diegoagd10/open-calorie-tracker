import { Injectable, type OnModuleInit } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { hashPassword } from '../auth/password.js'
import { AppConfig } from '../config.js'
import { Database } from '../db/database.js'
import { type User, users } from '../db/schema.js'

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    const { seedUser } = this.config
    if (seedUser === undefined) return

    const passwordHash = await hashPassword(seedUser.password)
    await this.database.db
      .insert(users)
      .values({ username: seedUser.username, passwordHash })
      .onConflictDoUpdate({ target: users.username, set: { passwordHash } })
  }

  findByUsername(username: string): Promise<User | undefined> {
    return this.database.db.query.users.findFirst({ where: eq(users.username, username) })
  }
}
