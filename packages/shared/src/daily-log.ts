// Response of GET /v1/daily-log, read by the web app, and the goals it reports.

export type Nutrient = 'protein' | 'carbohydrate' | 'fat' | 'fiber' | 'sugar' | 'sodium'

// Calories in kcal, sodium in mg, water in US fl oz, every other nutrient in g.
export type DailyGoals = Record<'calories' | Nutrient | 'water', number>

// The goals of a user who never changed them.
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

// A nutrient is null when the entry has no data for it.
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
  // YYYY-MM-DD in timeZone.
  date: string
  timeZone: string
  goals: DailyGoals
  totals: DailyTotals
  // Newest first.
  entries: LogEntry[]
}
