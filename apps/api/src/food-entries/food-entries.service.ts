import { BadRequestException, Injectable } from '@nestjs/common'
import type { FoodEntryInput, FoodLogEntry } from '@open-calorie-tracker/shared'
import { sql } from 'drizzle-orm'
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

// Rounds away floating point noise, e.g. 1.5 × 0.3 = 0.44999999999999996.
const round = (value: number) => Math.round(value * 100) / 100

@Injectable()
export class FoodEntriesService {
  constructor(
    private readonly database: Database,
    private readonly servingSizes: ServingSizesService,
  ) {}

  // Logged now, as manual: the client cannot choose either. The input is per serving and the
  // entry stores what all its servings add up to.
  async create(
    userId: number,
    { name, servingSizeId, quantity, calories, ...nutrients }: FoodEntryInput,
  ): Promise<FoodLogEntry> {
    const servingSize = await this.servingSizes.find(userId, servingSizeId)
    if (servingSize === undefined) throw new BadRequestException(['Unknown serving size'])

    const times = (value: number | undefined) =>
      value === undefined ? null : round(value * quantity)
    const entry = await this.database.db
      .insert(foodEntries)
      .values({
        userId,
        loggedAt: new Date(),
        name,
        sourceId: sourceIdOf('manual'),
        servingSizeId,
        quantity,
        calories: round(calories * quantity),
        protein: times(nutrients.protein),
        carbohydrate: times(nutrients.carbohydrate),
        fat: times(nutrients.fat),
        fiber: times(nutrients.fiber),
        sugar: times(nutrients.sugar),
        sodium: times(nutrients.sodium),
      })
      .returning()
      .get()
    return toFoodLogEntry({ ...entry, servingSize: servingSize.name, source: 'manual' })
  }
}
