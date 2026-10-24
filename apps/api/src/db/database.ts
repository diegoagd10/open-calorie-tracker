import type { OnApplicationShutdown } from '@nestjs/common'
import { type Client, createClient } from '@libsql/client'
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

// Resolves to apps/api/drizzle from both src/db (tests) and dist/db (build).
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

// How long a write waits for another connection's lock, e.g. a seed script's, before failing with
// SQLITE_BUSY. Without it, it fails immediately.
const BUSY_TIMEOUT_MS = 5_000

export class Database implements OnApplicationShutdown {
  private constructor(
    private readonly client: Client,
    readonly db: LibSQLDatabase<typeof schema>,
  ) {}

  static async connect(url: string): Promise<Database> {
    const client = createClient({ url, timeout: BUSY_TIMEOUT_MS })
    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    return new Database(client, db)
  }

  close() {
    this.client.close()
  }

  onApplicationShutdown() {
    this.close()
  }
}
