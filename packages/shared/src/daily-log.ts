export type Nutrient = 'protein' | 'carbohydrate' | 'fat' | 'fiber' | 'sugar' | 'sodium'

export type DailyGoals = Record<'calories' | Nutrient | 'water', number>

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

export type DailyTotals = DailyGoals & { foodEntries: number }

export type FoodLogEntry = {
  id: number
  type: 'food'
  loggedAt: string
  name: string
  source: 'manual'
  servingSize: string
  quantity: number
  calories: number
} & Record<Nutrient, number | null>

export type WaterLogEntry = { id: number; type: 'water'; loggedAt: string; amount: number }

export type LogEntry = FoodLogEntry | WaterLogEntry

export type DailyLog = {
  date: string
  timeZone: string
  goals: DailyGoals
  totals: DailyTotals
  entries: LogEntry[]
}

export const DAILY_SUMMARIES_MAX_DAYS = 31

export type DaySummary = { date: string; calories: number; foodEntries: number }

export type DailySummaries = {
  from: string
  to: string
  timeZone: string
  goals: DailyGoals
  days: DaySummary[]
}
