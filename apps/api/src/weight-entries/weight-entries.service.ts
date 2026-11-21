import { Injectable } from '@nestjs/common'
import {
  type WeightEntry,
  type WeightGoal,
  type WeightHistory,
  type WeightStats,
  weightSchema,
} from '@open-calorie-tracker/shared'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { calendarDate, timeZone, todayIn } from '../daily-log/day.js'
import { Database } from '../db/database.js'
import { weightEntries } from '../db/schema.js'
import { WeightGoalService } from '../settings/weight-goal/weight-goal.service.js'

// oxlint-disable-next-line local/no-comments
// Zod also runs object refinements when a field failed, so an invalid time zone gets here.
const isNotFuture = ({ date, timeZone }: { date?: string | undefined; timeZone: string }) => {
  if (date === undefined) return true
  try {
    return date <= todayIn(timeZone)
  } catch {
    return true
  }
}

export const logWeightSchema = z
  .strictObject({ weight: weightSchema, date: calendarDate('date').optional(), timeZone })
  .refine(isNotFuture, { message: 'date must not be in the future', path: ['date'] })

export type LogWeightInput = z.infer<typeof logWeightSchema>

export const weightHistoryQuerySchema = z
  .strictObject({ from: calendarDate('from').optional(), to: calendarDate('to').optional() })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    'to must not be before from',
  )

export type WeightHistoryQuery = z.infer<typeof weightHistoryQuerySchema>

const TREND_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS

const roundToTenth = (value: number) => Math.round(value * 10) / 10

const withTrend = (entries: WeightEntry[]) => {
  let first = 0
  let sum = 0
  return entries.map((entry, index) => {
    sum += entry.weight
    const oldest = dayNumber(entry.date) - (TREND_DAYS - 1)
    while (dayNumber(entries[first]?.date ?? entry.date) < oldest) {
      sum -= entries[first]?.weight ?? 0
      first++
    }
    return { ...entry, trend: roundToTenth(sum / (index - first + 1)) }
  })
}

const statsOf = (last: WeightEntry | undefined, goal: WeightGoal | null): WeightStats => {
  if (last === undefined) return { current: null, lost: null, toGo: null, progress: null }
  if (goal === null) return { current: last.weight, lost: null, toGo: null, progress: null }
  const lost = goal.startWeight - last.weight
  const progress = Math.round((lost / (goal.startWeight - goal.goalWeight)) * 100)
  return {
    current: last.weight,
    lost: roundToTenth(lost),
    toGo: roundToTenth(Math.max(0, last.weight - goal.goalWeight)),
    progress: Math.min(100, Math.max(0, progress)),
  }
}

@Injectable()
export class WeightEntriesService {
  constructor(
    private readonly database: Database,
    private readonly weightGoal: WeightGoalService,
  ) {}

  async log(userId: number, { weight, date, timeZone }: LogWeightInput): Promise<WeightEntry> {
    const entry = { date: date ?? todayIn(timeZone), weight }
    await this.database.db
      .insert(weightEntries)
      .values({ ...entry, userId })
      .onConflictDoUpdate({ target: [weightEntries.userId, weightEntries.date], set: { weight } })
    return entry
  }

  async history(userId: number, { from, to }: WeightHistoryQuery): Promise<WeightHistory> {
    const entries = await this.database.db
      .select({ date: weightEntries.date, weight: weightEntries.weight })
      .from(weightEntries)
      .where(eq(weightEntries.userId, userId))
      .orderBy(asc(weightEntries.date))
    const goal = await this.weightGoal.goalOf(userId)
    return {
      entries: withTrend(entries).filter(
        ({ date }) => (from === undefined || date >= from) && (to === undefined || date <= to),
      ),
      goal,
      stats: statsOf(entries.at(-1), goal),
    }
  }
}
