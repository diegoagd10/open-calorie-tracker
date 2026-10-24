import { Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { type User, users } from '../db/schema.js'

@Injectable()
export class UsersService {
  constructor(private readonly database: Database) {}

  findByUsername(username: string): Promise<User | undefined> {
    return this.database.db.query.users.findFirst({ where: eq(users.username, username) })
  }
}
