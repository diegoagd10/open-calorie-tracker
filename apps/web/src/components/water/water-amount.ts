import { MAX_WATER_AMOUNT, WATER_PRESETS, waterEntrySchema } from '@open-calorie-tracker/shared'

// The amount the field holds, when a water entry can have it.
export const loggableAmount = (value: string) => {
  const parsed = waterEntrySchema.safeParse({ amount: Number(value) })
  return parsed.success ? parsed.data.amount : undefined
}

export type WaterName = (typeof WATER_PRESETS)[number]['name'] | 'Water'

// The preset an amount matches, e.g. 16 → Bottle, or "Water" when it matches none.
export const waterName = (amount: number): WaterName =>
  WATER_PRESETS.find((preset) => preset.amount === amount)?.name ?? 'Water'

// Adds in tenths, so 12.5 + 1 is 13.5 and not 13.499999999999998.
export const addAmounts = (a: number, b: number) => Math.round((a + b) * 10) / 10

// What the − and + buttons change the amount by.
const STEP = 1

// An empty or unfinished field counts as 0, so + starts at 1.
const numberIn = (value: string) => Number(value) || 0

export const canStepUp = (value: string) => addAmounts(numberIn(value), STEP) <= MAX_WATER_AMOUNT

export const canStepDown = (value: string) => numberIn(value) > STEP

export const stepUp = (value: string) => String(addAmounts(numberIn(value), STEP))

export const stepDown = (value: string) => String(addAmounts(numberIn(value), -STEP))
