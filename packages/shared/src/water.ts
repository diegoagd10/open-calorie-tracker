import { z } from 'zod'

// Water amounts are in US fluid ounces.

// The most a single water entry can hold: one gallon.
export const MAX_WATER_AMOUNT = 128

// One tap on a preset logs its amount.
export const WATER_PRESETS = [
  { name: 'Glass', amount: 8 },
  { name: 'Bottle', amount: 16 },
  { name: 'Gallon', amount: MAX_WATER_AMOUNT },
] as const

// Whole numbers or one decimal, e.g. 12 or 12.5 but not 12.55.
const AT_MOST_ONE_DECIMAL = /^\d+(\.\d)?$/

// The body of POST /v1/water-entries and PATCH /v1/water-entries/:id. Validated by the web form
// before calling the server, and again by the API.
export const waterEntrySchema = z.object({
  amount: z
    .number()
    .positive('Amount must be more than 0')
    .max(MAX_WATER_AMOUNT, `Amount must be at most ${MAX_WATER_AMOUNT} fl oz`)
    .refine((amount) => AT_MOST_ONE_DECIMAL.test(String(amount)), 'Amount can have one decimal'),
})

export type WaterEntryInput = z.infer<typeof waterEntrySchema>

// What the amount field shows when its value would change from `previous` to `next`, by typing or
// by pasting: only digits and one decimal point, at most one decimal, and nothing over the maximum,
// in which case the field keeps its previous value.
export const filterWaterAmountInput = (previous: string, next: string) => {
  const [whole = '', ...decimals] = next.replaceAll(/[^\d.]/g, '').split('.')
  const filtered = decimals.length === 0 ? whole : `${whole}.${decimals.join('').slice(0, 1)}`
  return Number(filtered) > MAX_WATER_AMOUNT ? previous : filtered
}
