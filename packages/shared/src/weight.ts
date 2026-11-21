import { z } from 'zod'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

export const MIN_WEIGHT = 50
export const MAX_WEIGHT = 999

export const WEIGHT_RANGE_ERROR = `Enter a weight from ${MIN_WEIGHT} to ${MAX_WEIGHT} lb`

export const WEIGHT_GOAL_ORDER_ERROR = 'Goal weight must be less than starting weight'

export const weightSchema = z
  .number({ error: WEIGHT_RANGE_ERROR })
  .min(MIN_WEIGHT, WEIGHT_RANGE_ERROR)
  .max(MAX_WEIGHT, WEIGHT_RANGE_ERROR)
  .refine(hasAtMostOneDecimal, 'Weight can have one decimal')

export const weightGoalUpdateSchema = z
  .strictObject({ startWeight: weightSchema, goalWeight: weightSchema, date: z.iso.date() })
  .refine(({ startWeight, goalWeight }) => goalWeight < startWeight, {
    message: WEIGHT_GOAL_ORDER_ERROR,
    path: ['goalWeight'],
  })

export type WeightGoalUpdate = z.infer<typeof weightGoalUpdateSchema>

export type WeightGoal = { startWeight: number; goalWeight: number; startDate: string }

export type WeightEntry = { date: string; weight: number }

export type WeightStats = {
  current: number | null
  lost: number | null
  toGo: number | null
  progress: number | null
}

export type WeightHistory = {
  entries: (WeightEntry & { trend: number })[]
  goal: WeightGoal | null
  stats: WeightStats
}

export const filterWeightInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_WEIGHT)
