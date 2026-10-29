import { z } from 'zod'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

// Water amounts are in US fluid ounces.

// The most a single water entry can hold: one gallon.
export const MAX_WATER_AMOUNT = 128

// One tap on a preset logs its amount.
export const WATER_PRESETS = [
  { name: 'Glass', amount: 8 },
  { name: 'Bottle', amount: 16 },
  { name: 'Gallon', amount: MAX_WATER_AMOUNT },
] as const

// Editable water fields (PATCH /v1/water-entries/:id). Validated by the web form
// before calling the server, and again by the API.
export const waterEntrySchema = z.object({
  amount: z
    .number()
    .positive('Amount must be more than 0')
    .max(MAX_WATER_AMOUNT, `Amount must be at most ${MAX_WATER_AMOUNT} fl oz`)
    .refine(hasAtMostOneDecimal, 'Amount can have one decimal'),
})

export type WaterEntryInput = z.infer<typeof waterEntrySchema>

// POST accepts a selected-day instant with a timezone; omission uses the server clock.
// PATCH retains waterEntrySchema, which ignores extra keys and never changes the time.
export const createWaterEntrySchema = waterEntrySchema.extend({
  loggedAt: z.iso.datetime({ offset: true }).optional(),
})

export type CreateWaterEntryInput = z.infer<typeof createWaterEntrySchema>

// What the amount field shows when its value would change from `previous` to `next`, by typing or
// by pasting: only digits and one decimal point, at most one decimal, and nothing over the maximum,
// in which case the field keeps its previous value.
export const filterWaterAmountInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_WATER_AMOUNT)
