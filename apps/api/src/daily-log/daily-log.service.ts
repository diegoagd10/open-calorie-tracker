import { Injectable } from '@nestjs/common'
import {
  type DailyLog,
  type DailySummaries,
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
import { type DayQuery, type RangeQuery, datesBetween, dayRange } from './day.js'

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

  // Each day's calories, from the user's food entries between the first and the last midnight.
  async dailySummaries(userId: number, range: RangeQuery): Promise<DailySummaries> {
    const days = datesBetween(range.from, range.to).map((date) => ({
      date,
      end: dayRange({ date, timeZone: range.timeZone }).end,
      calories: [] as number[],
    }))
    const start = dayRange({ date: range.from, timeZone: range.timeZone }).start
    const [food, goals] = await Promise.all([
      this.database.db
        .select({ calories: foodEntries.calories, loggedAt: foodEntries.loggedAt })
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, userId),
            gte(foodEntries.loggedAt, start),
            lt(foodEntries.loggedAt, days.at(-1)?.end ?? start),
          ),
        ),
      this.dailyGoals.goalsOf(userId),
    ])

    // Days are in order, so an entry belongs to the first one ending after it.
    for (const entry of food) {
      days.find((day) => entry.loggedAt < day.end)?.calories.push(entry.calories)
    }

    return {
      ...range,
      goals,
      days: days.map((day) => ({
        date: day.date,
        calories: sum(day.calories),
        foodEntries: day.calories.length,
      })),
    }
  }
}
