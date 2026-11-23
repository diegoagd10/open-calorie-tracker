import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  CreateWaterEntryInput,
  WaterEntryInput,
  WaterLogEntry,
} from '@open-calorie-tracker/shared'
import { and, eq, lt } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { type WaterEntry, waterEntries } from '../db/schema.js'

export const toWaterLogEntry = ({ id, loggedAt, amount }: WaterEntry): WaterLogEntry => ({
  id,
  type: 'water',
  loggedAt: loggedAt.toISOString(),
  amount,
})

const ownedBy = (userId: number, id: number) =>
  and(eq(waterEntries.id, id), eq(waterEntries.userId, userId))

@Injectable()
export class WaterEntriesService {
  constructor(private readonly database: Database) {}

  async find(userId: number, id: number): Promise<Omit<WaterLogEntry, 'type'>> {
    const entry = await this.database.db
      .select()
      .from(waterEntries)
      .where(ownedBy(userId, id))
      .get()
    if (entry === undefined) throw new NotFoundException()
    return { id, loggedAt: entry.loggedAt.toISOString(), amount: entry.amount }
  }

  async create(
    userId: number,
    { amount, loggedAt, requestId, attempt = 1 }: CreateWaterEntryInput,
  ): Promise<WaterLogEntry> {
    const entry = await this.database.db
      .insert(waterEntries)
      .values({
        userId,
        loggedAt: loggedAt === undefined ? new Date() : new Date(loggedAt),
        amount,
        requestId,
        attempt,
      })
      .onConflictDoUpdate({
        target: [waterEntries.userId, waterEntries.requestId],
        set: { amount, attempt },
        setWhere: lt(waterEntries.attempt, attempt),
      })
      .returning()
      .get()
    return entry === undefined ? this.createdBy(userId, requestId) : toWaterLogEntry(entry)
  }

  private async createdBy(userId: number, requestId: string | undefined): Promise<WaterLogEntry> {
    const entry = await this.database.db
      .select()
      .from(waterEntries)
      .where(and(eq(waterEntries.userId, userId), eq(waterEntries.requestId, requestId ?? '')))
      .get()
    if (entry === undefined) throw new NotFoundException()
    return toWaterLogEntry(entry)
  }

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
