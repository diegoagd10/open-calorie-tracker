import type { OnApplicationShutdown } from '@nestjs/common'
import { type Client, createClient } from '@libsql/client'
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

// Resolves to apps/api/drizzle from both src/db (tests) and dist/db (build).
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export class Database implements OnApplicationShutdown {
  private constructor(
    private readonly client: Client,
    readonly db: LibSQLDatabase<typeof schema>,
  ) {}

  static async connect(url: string): Promise<Database> {
    const client = createClient({ url })
    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    return new Database(client, db)
  }

  onApplicationShutdown() {
    this.client.close()
  }
}
