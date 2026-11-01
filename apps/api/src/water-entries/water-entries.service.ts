import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  CreateWaterEntryInput,
  WaterEntryInput,
  WaterLogEntry,
} from '@open-calorie-tracker/shared'
import { and, eq } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { type WaterEntry, waterEntries } from '../db/schema.js'

export const toWaterLogEntry = ({ id, loggedAt, amount }: WaterEntry): WaterLogEntry => ({
  id,
  type: 'water',
  loggedAt: loggedAt.toISOString(),
  amount,
})

// Another user's entry answers like a missing one, so ids reveal nothing about other users.
const ownedBy = (userId: number, id: number) =>
  and(eq(waterEntries.id, id), eq(waterEntries.userId, userId))

@Injectable()
export class WaterEntriesService {
  constructor(private readonly database: Database) {}

  // The entry as PATCH takes it back, which ignores the id and the time.
  async find(userId: number, id: number): Promise<Omit<WaterLogEntry, 'type'>> {
    const entry = await this.database.db
      .select()
      .from(waterEntries)
      .where(ownedBy(userId, id))
      .get()
    if (entry === undefined) throw new NotFoundException()
    return { id, loggedAt: entry.loggedAt.toISOString(), amount: entry.amount }
  }

  // Logged at the selected instant, defaulting to now for existing clients.
  async create(
    userId: number,
    { amount, loggedAt }: CreateWaterEntryInput,
  ): Promise<WaterLogEntry> {
    const entry = await this.database.db
      .insert(waterEntries)
      .values({
        userId,
        loggedAt: loggedAt === undefined ? new Date() : new Date(loggedAt),
        amount,
      })
      .returning()
      .get()
    return toWaterLogEntry(entry)
  }

  // Changes the amount only; the entry keeps its time.
  async update(userId: number, id: number, { amount }: WaterEntryInput): Promise<WaterLogEntry> {
    const entry = await this.database.db
      .update(waterEntries)
      .set({ amount })
      .where(ownedBy(userId, id))
      .returning()
      .get()
    if (entry === undefined) throw new NotFoundException()
    return toWaterLogEntry(entry)
  }

  async remove(userId: number, id: number): Promise<void> {
    const deleted = await this.database.db
      .delete(waterEntries)
      .where(ownedBy(userId, id))
      .returning({ id: waterEntries.id })
    if (deleted.length === 0) throw new NotFoundException()
  }
}
