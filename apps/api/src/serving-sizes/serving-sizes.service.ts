import { Injectable } from '@nestjs/common'
import type { ServingSize, ServingSizeInput } from '@open-calorie-tracker/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { servingSizes } from '../db/schema.js'

const columns = { id: servingSizes.id, name: servingSizes.name }

const sameNameAs = (name: string) => sql`${servingSizes.name} = ${name} COLLATE NOCASE`

@Injectable()
export class ServingSizesService {
  constructor(private readonly database: Database) {}

  // Alphabetically, regardless of case.
  list(userId: number): Promise<ServingSize[]> {
    return this.database.db
      .select(columns)
      .from(servingSizes)
      .where(eq(servingSizes.userId, userId))
      .orderBy(sql`${servingSizes.name} COLLATE NOCASE`, asc(servingSizes.name))
  }

  // The user's serving size with this name regardless of case, added when they have none. The
  // name is already normalized by servingSizeSchema.
  async findOrCreate(
    userId: number,
    { name }: ServingSizeInput,
  ): Promise<{ servingSize: ServingSize; created: boolean }> {
    const created = await this.database.db
      .insert(servingSizes)
      .values({ userId, name })
      .onConflictDoNothing()
      .returning(columns)
      .get()
    if (created !== undefined) return { servingSize: created, created: true }

    const existing = await this.database.db
      .select(columns)
      .from(servingSizes)
      .where(and(eq(servingSizes.userId, userId), sameNameAs(name)))
      .get()
    // The insert only conflicts with an existing serving size of the user.
    if (existing === undefined) throw new Error(`Serving size "${name}" is missing`)
    return { servingSize: existing, created: false }
  }

  // Another user's serving size answers like a missing one.
  find(userId: number, id: number): Promise<ServingSize | undefined> {
    return this.database.db
      .select(columns)
      .from(servingSizes)
      .where(and(eq(servingSizes.id, id), eq(servingSizes.userId, userId)))
      .get()
  }
}
