// Response of GET /v1/daily-log, read by the web app.

export type Nutrient = 'protein' | 'carbohydrate' | 'fat' | 'fiber' | 'sugar' | 'sodium'

// Calories in kcal, sodium in mg, water in US fl oz, every other nutrient in g.
export type DailyGoals = Record<'calories' | Nutrient | 'water', number>

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
