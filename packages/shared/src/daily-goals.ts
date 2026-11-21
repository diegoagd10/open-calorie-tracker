import { z } from 'zod'
import type { DailyGoals } from './daily-log'

export const MAX_DAILY_GOAL = 99_999

const MAX_GOAL_DIGITS = String(MAX_DAILY_GOAL).length

export const DAILY_GOAL_ERROR = `Enter a number from 1 to ${MAX_DAILY_GOAL}`

const goal = z
  .number({ error: DAILY_GOAL_ERROR })
  .int(DAILY_GOAL_ERROR)
  .min(1, DAILY_GOAL_ERROR)
  .max(MAX_DAILY_GOAL, DAILY_GOAL_ERROR)
  .exactOptional()

export const dailyGoalsUpdateSchema = z.strictObject({
  calories: goal,
  protein: goal,
  carbohydrate: goal,
  fat: goal,
  fiber: goal,
  sugar: goal,
  sodium: goal,
  water: goal,
} satisfies Record<keyof DailyGoals, typeof goal>)

export type DailyGoalsUpdate = z.infer<typeof dailyGoalsUpdateSchema>

export const filterDailyGoalInput = (value: string) =>
  value.replaceAll(/\D/g, '').slice(0, MAX_GOAL_DIGITS)
