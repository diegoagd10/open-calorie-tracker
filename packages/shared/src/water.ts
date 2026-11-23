import { z } from 'zod'
import { createRequestSchema } from './create-request'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

export const MAX_WATER_AMOUNT = 128

export const WATER_PRESETS = [
  { name: 'Glass', amount: 8 },
  { name: 'Bottle', amount: 16 },
  { name: 'Gallon', amount: MAX_WATER_AMOUNT },
] as const

export const waterEntrySchema = z.object({
  amount: z
    .number()
    .positive('Amount must be more than 0')
    .max(MAX_WATER_AMOUNT, `Amount must be at most ${MAX_WATER_AMOUNT} fl oz`)
    .refine(hasAtMostOneDecimal, 'Amount can have one decimal'),
})

export type WaterEntryInput = z.infer<typeof waterEntrySchema>

export const createWaterEntrySchema = waterEntrySchema.extend({
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  ...createRequestSchema.shape,
})

export type CreateWaterEntryInput = z.infer<typeof createWaterEntrySchema>

export const filterWaterAmountInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_WATER_AMOUNT)
