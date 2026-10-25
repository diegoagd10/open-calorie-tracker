import type { DailyGoals, Nutrient } from '@open-calorie-tracker/shared'

type Goal<Key extends keyof DailyGoals> = { key: Key; label: string; unit: string; color: string }

// How each goal is named and drawn, wherever goals are shown.
export const NUTRIENT_GOALS: Goal<Nutrient>[] = [
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--protein)' },
  { key: 'carbohydrate', label: 'Carbohydrate', unit: 'g', color: 'var(--carbohydrate)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--fat)' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'var(--fiber)' },
  { key: 'sugar', label: 'Sugar max', unit: 'g', color: 'var(--sugar)' },
  { key: 'sodium', label: 'Sodium max', unit: 'mg', color: 'var(--sodium)' },
]

export const GOALS: Goal<keyof DailyGoals>[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'var(--accent)' },
  ...NUTRIENT_GOALS,
  { key: 'water', label: 'Water', unit: 'fl oz', color: 'var(--water)' },
]
