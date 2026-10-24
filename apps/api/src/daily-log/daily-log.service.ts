import { Injectable } from '@nestjs/common'
import type {
  DailyLog,
  DailyTotals,
  FoodLogEntry,
  LogEntry,
  Nutrient,
  WaterLogEntry,
} from '@open-calorie-tracker/shared'
import { and, eq, gte, lt } from 'drizzle-orm'
import { Database } from '../db/database.js'
import { type FoodEntry, type WaterEntry, foodEntries, waterEntries } from '../db/schema.js'
import { type DayQuery, dayRange } from './day.js'
import { DEFAULT_DAILY_GOALS } from './goals.js'

const NUTRIENTS: Nutrient[] = ['protein', 'carbohydrate', 'fat', 'fiber', 'sugar', 'sodium']

const toFoodLogEntry = ({ userId: _userId, loggedAt, ...entry }: FoodEntry): FoodLogEntry => ({
  ...entry,
  type: 'food',
  loggedAt: loggedAt.toISOString(),
})

const toWaterLogEntry = ({ id, loggedAt, amount }: WaterEntry): WaterLogEntry => ({
  id,
  type: 'water',
  loggedAt: loggedAt.toISOString(),
  amount,
})

// Rounds away floating point noise, e.g. 10 + 6.9 = 16.900000000000002.
const round = (value: number) => Math.round(value * 100) / 100

const sum = (values: (number | null)[]) =>
  round(values.reduce<number>((total, value) => total + (value ?? 0), 0))

const totalsOf = (food: FoodEntry[], water: WaterEntry[]): DailyTotals => ({
  calories: sum(food.map((entry) => entry.calories)),
  ...(Object.fromEntries(
    NUTRIENTS.map((nutrient) => [nutrient, sum(food.map((entry) => entry[nutrient]))]),
  ) as Record<Nutrient, number>),
  water: sum(water.map((entry) => entry.amount)),
  foodEntries: food.length,
})

@Injectable()
export class DailyLogService {
  constructor(private readonly database: Database) {}

  async dailyLog(userId: number, day: DayQuery): Promise<DailyLog> {
    const { start, end } = dayRange(day)
    const [food, water] = await Promise.all([
      this.database.db
        .select()
        .from(foodEntries)
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
    ])

    const entries: LogEntry[] = [...food.map(toFoodLogEntry), ...water.map(toWaterLogEntry)]
    // ISO 8601 UTC strings sort chronologically.
    entries.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))

    return { ...day, goals: DEFAULT_DAILY_GOALS, totals: totalsOf(food, water), entries }
  }
}
