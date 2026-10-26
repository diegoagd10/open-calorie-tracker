import { MAX_SERVINGS, MIN_SERVINGS, SERVINGS_STEP } from '@open-calorie-tracker/shared'
import { formatNumber } from '@/components/food-log/format'

// Rounds to tenths, so 1240 + 0.1 × 3 is 1240.3 and not 1240.3000000000002.
export const roundTenths = (value: number) => Math.round(value * 10) / 10

export const canAddServing = (servings: number) => servings + SERVINGS_STEP <= MAX_SERVINGS

export const canRemoveServing = (servings: number) => servings - SERVINGS_STEP >= MIN_SERVINGS

export const addServing = (servings: number) => servings + SERVINGS_STEP

export const removeServing = (servings: number) => servings - SERVINGS_STEP

// The calories or nutrient a field holds, or undefined while it is empty or only a point.
export const perServingValue = (value: string) => {
  const number = Number(value)
  return value === '' || Number.isNaN(number) ? undefined : number
}

// Where today's calories stand against the goal: "360 to go", "goal reached" or "100 over".
export const goalStatus = (today: number, goal: number) => {
  if (today < goal) return `${formatNumber(roundTenths(goal - today))} to go`
  if (today === goal) return 'goal reached'
  return `${formatNumber(roundTenths(today - goal))} over`
}
