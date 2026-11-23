import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  CreateFoodEntryInput,
  EditableFoodEntry,
  FoodEntryInput,
  FoodLogEntry,
} from '@open-calorie-tracker/shared'
import { and, eq, getTableColumns, lt, sql } from 'drizzle-orm'
import { Database } from '../db/database.js'
import {
  type FoodEntry,
  type FoodSource,
  foodEntries,
  foodSources,
  servingSizes,
} from '../db/schema.js'
import { ServingSizesService } from '../serving-sizes/serving-sizes.service.js'

export type StoredFood = FoodEntry & { servingSize: string; source: FoodSource }

export const toFoodLogEntry = ({
  userId: _userId,
  servingSizeId: _servingSizeId,
  sourceId: _sourceId,
  requestId: _requestId,
  attempt: _attempt,
  loggedAt,
  ...entry
}: StoredFood): FoodLogEntry => ({
  ...entry,
  type: 'food',
  loggedAt: loggedAt.toISOString(),
})

export const sourceIdOf = (source: FoodSource) =>
  sql<number>`(SELECT ${foodSources.id} FROM ${foodSources} WHERE ${foodSources.name} = ${source})`

const ownedBy = (userId: number, id: number) =>
  and(eq(foodEntries.id, id), eq(foodEntries.userId, userId))

const round = (value: number) => Math.round(value * 100) / 100

@Injectable()
export class FoodEntriesService {
  constructor(
    private readonly database: Database,
    private readonly servingSizes: ServingSizesService,
  ) {}

  private async valuesOf(
    userId: number,
    { name, servingSizeId, quantity, calories, ...nutrients }: FoodEntryInput,
  ) {
    const servingSize = await this.servingSizes.find(userId, servingSizeId)
    if (servingSize === undefined) throw new BadRequestException(['Unknown serving size'])

    const times = (value: number | null | undefined) =>
      value === undefined || value === null ? null : round(value * quantity)
    const values = {
      name,
      servingSizeId,
      quantity,
      calories: round(calories * quantity),
      protein: times(nutrients.protein),
      carbohydrate: times(nutrients.carbohydrate),
      fat: times(nutrients.fat),
      fiber: times(nutrients.fiber),
      sugar: times(nutrients.sugar),
      sodium: times(nutrients.sodium),
    }
    return { values, servingSize: servingSize.name }
  }

  async find(userId: number, id: number): Promise<EditableFoodEntry> {
    const entry = await this.database.db
      .select({ entry: foodEntries, servingSize: servingSizes.name })
      .from(foodEntries)
      .innerJoin(servingSizes, eq(foodEntries.servingSizeId, servingSizes.id))
      .where(ownedBy(userId, id))
      .get()
    if (entry === undefined) throw new NotFoundException()

    const { quantity, loggedAt } = entry.entry
    const perServing = (value: number) => Math.round((value / quantity) * 10) / 10
    const nutrient = (value: number | null) => (value === null ? null : perServing(value))
    return {
      id,
      loggedAt: loggedAt.toISOString(),
      name: entry.entry.name,
      servingSizeId: entry.entry.servingSizeId,
      servingSize: entry.servingSize,
      quantity,
      calories: perServing(entry.entry.calories),
      protein: nutrient(entry.entry.protein),
      carbohydrate: nutrient(entry.entry.carbohydrate),
      fat: nutrient(entry.entry.fat),
      fiber: nutrient(entry.entry.fiber),
      sugar: nutrient(entry.entry.sugar),
      sodium: nutrient(entry.entry.sodium),
    }
  }

  async create(userId: number, input: CreateFoodEntryInput): Promise<FoodLogEntry> {
    const { values, servingSize } = await this.valuesOf(userId, input)
    const { requestId, attempt = 1 } = input
    const entry = await this.database.db
      .insert(foodEntries)
      .values({
        ...values,
        userId,
        loggedAt: input.loggedAt === undefined ? new Date() : new Date(input.loggedAt),
        sourceId: sourceIdOf('manual'),
        requestId,
        attempt,
      })
      .onConflictDoUpdate({
        target: [foodEntries.userId, foodEntries.requestId],
        set: { ...values, attempt },
        setWhere: lt(foodEntries.attempt, attempt),
      })
      .returning()
      .get()
    if (entry === undefined) return this.createdBy(userId, requestId)
    return toFoodLogEntry({ ...entry, servingSize, source: 'manual' })
  }

  private async createdBy(userId: number, requestId: string | undefined): Promise<FoodLogEntry> {
    const entry = await this.database.db
      .select({
        ...getTableColumns(foodEntries),
        servingSize: servingSizes.name,
        source: foodSources.name,
      })
      .from(foodEntries)
      .innerJoin(servingSizes, eq(foodEntries.servingSizeId, servingSizes.id))
      .innerJoin(foodSources, eq(foodEntries.sourceId, foodSources.id))
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.requestId, requestId ?? '')))
      .get()
    if (entry === undefined) throw new NotFoundException()
    return toFoodLogEntry(entry)
  }

  async update(userId: number, id: number, input: FoodEntryInput): Promise<FoodLogEntry> {
    const { values, servingSize } = await this.valuesOf(userId, input)
    const entry = await this.database.db
      .update(foodEntries)
      .set(values)
      .where(ownedBy(userId, id))
      .returning()
      .get()
    if (entry === undefined) throw new NotFoundException()
    const source = await this.database.db
      .select({ name: foodSources.name })
      .from(foodSources)
      .where(eq(foodSources.id, entry.sourceId))
      .get()
    return toFoodLogEntry({ ...entry, servingSize, source: source?.name ?? 'manual' })
  }

  async remove(userId: number, id: number): Promise<void> {
    const deleted = await this.database.db
      .delete(foodEntries)
      .where(ownedBy(userId, id))
      .returning({ id: foodEntries.id })
    if (deleted.length === 0) throw new NotFoundException()
  }
}
