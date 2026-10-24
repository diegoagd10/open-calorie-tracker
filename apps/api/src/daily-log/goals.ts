import type { DailyGoals } from '@open-calorie-tracker/shared'

// Every user gets these until goals can be changed.
export const DEFAULT_DAILY_GOALS: DailyGoals = {
  calories: 1600,
  protein: 120,
  carbohydrate: 230,
  fat: 70,
  fiber: 25,
  sugar: 50,
  sodium: 2300,
  water: 64,
}
