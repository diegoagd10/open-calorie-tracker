import { z } from 'zod'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

// Weights are in pounds, with at most one decimal.
export const MIN_WEIGHT = 50
export const MAX_WEIGHT = 999

export const WEIGHT_RANGE_ERROR = `Enter a weight from ${MIN_WEIGHT} to ${MAX_WEIGHT} lb`

export const WEIGHT_GOAL_ORDER_ERROR = 'Goal weight must be less than starting weight'

export const weightSchema = z
  .number({ error: WEIGHT_RANGE_ERROR })
  .min(MIN_WEIGHT, WEIGHT_RANGE_ERROR)
  .max(MAX_WEIGHT, WEIGHT_RANGE_ERROR)
  .refine(hasAtMostOneDecimal, 'Weight can have one decimal')

// The body of PUT /v1/settings/weight-goal. `date` is today in the browser: the goal starts on it
// when the starting weight changes. Only losing weight is supported, so the goal is under the
// starting weight. Validated by the Settings form before calling the server, and again by the API.
export const weightGoalUpdateSchema = z
  .strictObject({ startWeight: weightSchema, goalWeight: weightSchema, date: z.iso.date() })
  .refine(({ startWeight, goalWeight }) => goalWeight < startWeight, {
    message: WEIGHT_GOAL_ORDER_ERROR,
    path: ['goalWeight'],
  })

export type WeightGoalUpdate = z.infer<typeof weightGoalUpdateSchema>

// Dates are YYYY-MM-DD, calendar days in the user's time zone.
export type WeightGoal = { startWeight: number; goalWeight: number; startDate: string }

export type WeightEntry = { date: string; weight: number }

// Each null until it can be worked out: `current` needs a weigh-in, the others a goal too.
export type WeightStats = {
  current: number | null
  lost: number | null
  toGo: number | null
  // 0 to 100.
  progress: number | null
}

// Response of GET /v1/weight-history and of the get_weight_history tool.
export type WeightHistory = {
  // Oldest first. The trend is the average of the weigh-ins of the 7 calendar days up to the entry.
  entries: (WeightEntry & { trend: number })[]
  goal: WeightGoal | null
  stats: WeightStats
}

// What a weight field shows when its value would change from `previous` to `next`: only digits
// and one decimal, and nothing over the maximum, in which case the field keeps its previous value.
export const filterWeightInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_WEIGHT)
