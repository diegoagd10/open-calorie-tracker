import { z } from 'zod'
import type { Nutrient } from './daily-log'
import { createRequestSchema } from './create-request'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

export const MAX_FOOD_NAME_LENGTH = 100

export const MAX_SERVING_SIZE_LENGTH = 100

export const MAX_PER_SERVING = 9_999

export const MIN_SERVINGS = 0.5
export const MAX_SERVINGS = 20
export const SERVINGS_STEP = 0.5

const perServing = z
  .number()
  .min(0, 'Must be 0 or more')
  .max(MAX_PER_SERVING, `Must be at most ${MAX_PER_SERVING}`)
  .refine(hasAtMostOneDecimal, 'Can have one decimal')

const nutrient = perServing.nullish()

export const foodEntrySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Enter the food's name")
    .max(MAX_FOOD_NAME_LENGTH, `Food can be at most ${MAX_FOOD_NAME_LENGTH} characters`),
  servingSizeId: z.number().int().positive(),
  quantity: z
    .number()
    .min(MIN_SERVINGS)
    .max(MAX_SERVINGS)
    .refine(
      (quantity) => Number.isInteger(quantity / SERVINGS_STEP),
      'Servings go in steps of 0.5',
    ),
  calories: perServing,
  protein: nutrient,
  carbohydrate: nutrient,
  fat: nutrient,
  fiber: nutrient,
  sugar: nutrient,
  sodium: nutrient,
})

export type FoodEntryInput = z.infer<typeof foodEntrySchema>

export const createFoodEntrySchema = foodEntrySchema.extend({
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  ...createRequestSchema.shape,
})

export type CreateFoodEntryInput = z.infer<typeof createFoodEntrySchema>

export type EditableFoodEntry = {
  id: number
  loggedAt: string
  name: string
  servingSizeId: number
  servingSize: string
  quantity: number
  calories: number
} & Record<Nutrient, number | null>

export type Product = {
  barcode: string
  name: string | null
  brand: string | null
  servingSize: string
  calories: number | null
} & Record<Nutrient, number | null>

export const updateFoodEntrySchema = foodEntrySchema
  .extend({
    id: z.unknown().optional(),
    loggedAt: z.unknown().optional(),
    servingSize: z.unknown().optional(),
  })
  .transform(({ id: _id, loggedAt: _loggedAt, servingSize: _servingSize, ...input }) => input)

export const normalizeServingSize = (name: string) => name.trim().replaceAll(/\s+/g, ' ')

export const servingSizeSchema = z.strictObject({
  name: z
    .string()
    .transform(normalizeServingSize)
    .pipe(
      z
        .string()
        .min(1, 'Enter a serving size')
        .max(
          MAX_SERVING_SIZE_LENGTH,
          `Serving size can be at most ${MAX_SERVING_SIZE_LENGTH} characters`,
        ),
    ),
})

export type ServingSizeInput = z.infer<typeof servingSizeSchema>

export type ServingSize = { id: number; name: string }

export const filterPerServingInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_PER_SERVING)
