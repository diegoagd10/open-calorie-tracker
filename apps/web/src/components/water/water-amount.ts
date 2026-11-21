import { MAX_WATER_AMOUNT, WATER_PRESETS, waterEntrySchema } from '@open-calorie-tracker/shared'

export const loggableAmount = (value: string) => {
  const parsed = waterEntrySchema.safeParse({ amount: Number(value) })
  return parsed.success ? parsed.data.amount : undefined
}

export type WaterName = (typeof WATER_PRESETS)[number]['name'] | 'Water'

export const waterName = (amount: number): WaterName =>
  WATER_PRESETS.find((preset) => preset.amount === amount)?.name ?? 'Water'

export const addAmounts = (a: number, b: number) => Math.round((a + b) * 10) / 10

const STEP = 1

const numberIn = (value: string) => Number(value) || 0

export const canStepUp = (value: string) => addAmounts(numberIn(value), STEP) <= MAX_WATER_AMOUNT

export const canStepDown = (value: string) => numberIn(value) > STEP

export const stepUp = (value: string) => String(addAmounts(numberIn(value), STEP))

export const stepDown = (value: string) => String(addAmounts(numberIn(value), -STEP))
