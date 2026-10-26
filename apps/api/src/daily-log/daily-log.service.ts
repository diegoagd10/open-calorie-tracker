import { Injectable } from '@nestjs/common'
import {
  type DailyLog,
  type DailyTotals,
  type LogEntry,
  type Nutrient,
} from '@open-calorie-tracker/shared'
import { and, eq, getTableColumns, gte, lt } from 'drizzle-orm'
import { Database } from '../db/database.js'
import {
  type WaterEntry,
  foodEntries,
  foodSources,
  servingSizes,
  waterEntries,
} from '../db/schema.js'
import { type StoredFood, toFoodLogEntry } from '../food-entries/food-entries.service.js'
import { toWaterLogEntry } from '../water-entries/water-entries.service.js'
import { DailyGoalsService } from '../settings/daily-goals/daily-goals.service.js'
import { type DayQuery, dayRange } from './day.js'

const NUTRIENTS: Nutrient[] = ['protein', 'carbohydrate', 'fat', 'fiber', 'sugar', 'sodium']

// Rounds away floating point noise, e.g. 10 + 6.9 = 16.900000000000002.
const round = (value: number) => Math.round(value * 100) / 100

const sum = (values: (number | null)[]) =>
  round(values.reduce<number>((total, value) => total + (value ?? 0), 0))

const totalsOf = (food: StoredFood[], water: WaterEntry[]): DailyTotals => ({
  calories: sum(food.map((entry) => entry.calories)),
  ...(Object.fromEntries(
    NUTRIENTS.map((nutrient) => [nutrient, sum(food.map((entry) => entry[nutrient]))]),
  ) as Record<Nutrient, number>),
  water: sum(water.map((entry) => entry.amount)),
  foodEntries: food.length,
})

@Injectable()
export class DailyLogService {
  constructor(
    private readonly database: Database,
    private readonly dailyGoals: DailyGoalsService,
  ) {}

  async dailyLog(userId: number, day: DayQuery): Promise<DailyLog> {
    const { start, end } = dayRange(day)
    const [food, water, goals] = await Promise.all([
      this.database.db
        .select({
          ...getTableColumns(foodEntries),
          servingSize: servingSizes.name,
          source: foodSources.name,
        })
        .from(foodEntries)
        .innerJoin(servingSizes, eq(foodEntries.servingSizeId, servingSizes.id))
        .innerJoin(foodSources, eq(foodEntries.sourceId, foodSources.id))
        .where(
          and(
            eq(foodEntries.userId, userId),
            gte(foodEntries.loggedAt, start),
            lt(foodEntries.loggedAt, end),
          ),
        ),
      this.database.db
        .select()
        .from(waterEntries)
        .where(
          and(
            eq(waterEntries.userId, userId),
            gte(waterEntries.loggedAt, start),
            lt(waterEntries.loggedAt, end),
          ),
        ),
      this.dailyGoals.goalsOf(userId),
    ])

    const entries: LogEntry[] = [...food.map(toFoodLogEntry), ...water.map(toWaterLogEntry)]
    // ISO 8601 UTC strings sort chronologically.
    entries.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))

    return { ...day, goals, totals: totalsOf(food, water), entries }
  }
}
