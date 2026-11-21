import { MAX_SERVINGS, MIN_SERVINGS, SERVINGS_STEP } from '@open-calorie-tracker/shared'
import { formatNumber } from '@/components/food-log/format'

export const roundTenths = (value: number) => Math.round(value * 10) / 10

export const canAddServing = (servings: number) => servings + SERVINGS_STEP <= MAX_SERVINGS

export const canRemoveServing = (servings: number) => servings - SERVINGS_STEP >= MIN_SERVINGS

export const addServing = (servings: number) => servings + SERVINGS_STEP

export const removeServing = (servings: number) => servings - SERVINGS_STEP

export const perServingValue = (value: string) => {
  const number = Number(value)
  return value === '' || Number.isNaN(number) ? undefined : number
}

export const goalStatus = (today: number, goal: number) => {
  if (today < goal) return `${formatNumber(roundTenths(goal - today))} to go`
  if (today === goal) return 'goal reached'
  return `${formatNumber(roundTenths(today - goal))} over`
}
