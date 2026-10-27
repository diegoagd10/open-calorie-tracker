import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FoodEntryInput, FoodLogEntry } from '@open-calorie-tracker/shared'
import { and, eq, sql } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { type FoodEntry, type FoodSource, foodEntries, foodSources } from '../db/schema.js'
import { ServingSizesService } from '../serving-sizes/serving-sizes.service.js'

// A food entry with the names of its serving size and source.
export type StoredFood = FoodEntry & { servingSize: string; source: FoodSource }

export const toFoodLogEntry = ({
  userId: _userId,
  servingSizeId: _servingSizeId,
  sourceId: _sourceId,
  loggedAt,
  ...entry
}: StoredFood): FoodLogEntry => ({
  ...entry,
  type: 'food',
  loggedAt: loggedAt.toISOString(),
})

// The id of a source by name. The migration adds every source, so the lookup always finds one.
export const sourceIdOf = (source: FoodSource) =>
  sql<number>`(SELECT ${foodSources.id} FROM ${foodSources} WHERE ${foodSources.name} = ${source})`

// Another user's entry answers like a missing one, so ids reveal nothing about other users.
const ownedBy = (userId: number, id: number) =>
  and(eq(foodEntries.id, id), eq(foodEntries.userId, userId))

// Rounds away floating point noise, e.g. 1.5 × 0.3 = 0.44999999999999996.
const round = (value: number) => Math.round(value * 100) / 100

@Injectable()
export class FoodEntriesService {
  constructor(
    private readonly database: Database,
    private readonly servingSizes: ServingSizesService,
  ) {}

  // The columns an input sets, once it is checked to use one of the user's serving sizes. The input
  // is per serving and the entry stores what all its servings add up to.
  private async valuesOf(
    userId: number,
    { name, servingSizeId, quantity, calories, ...nutrients }: FoodEntryInput,
  ) {
    const servingSize = await this.servingSizes.find(userId, servingSizeId)
    if (servingSize === undefined) throw new BadRequestException(['Unknown serving size'])

    const times = (value: number | undefined) =>
      value === undefined ? null : round(value * quantity)
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

  // Logged now, as manual: the client cannot choose either.
  async create(userId: number, input: FoodEntryInput): Promise<FoodLogEntry> {
    const { values, servingSize } = await this.valuesOf(userId, input)
    const entry = await this.database.db
      .insert(foodEntries)
      .values({ ...values, userId, loggedAt: new Date(), sourceId: sourceIdOf('manual') })
      .returning()
      .get()
    return toFoodLogEntry({ ...entry, servingSize, source: 'manual' })
  }

  // Replaces what the user entered; the entry keeps its time and source.
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
}
