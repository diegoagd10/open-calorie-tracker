import { z } from 'zod'
import { filterDecimalInput, hasAtMostOneDecimal } from './decimal'

// Food entries are entered per serving, as the label prints them: calories in kcal, sodium in mg,
// every other nutrient in g.

export const MAX_FOOD_NAME_LENGTH = 100

export const MAX_SERVING_SIZE_LENGTH = 100

// The most calories, or of any nutrient, a single serving can have.
export const MAX_PER_SERVING = 9_999

// How many servings an entry can have, in steps of SERVINGS_STEP.
export const MIN_SERVINGS = 0.5
export const MAX_SERVINGS = 20
export const SERVINGS_STEP = 0.5

const perServing = z
  .number()
  .min(0, 'Must be 0 or more')
  .max(MAX_PER_SERVING, `Must be at most ${MAX_PER_SERVING}`)
  .refine(hasAtMostOneDecimal, 'Can have one decimal')

// A nutrient is left out when the label doesn't say.
const nutrient = perServing.optional()

// Editable food fields, per serving. Validated by the web form before calling the
// server, and again by the API, which multiplies by the servings.
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

// POST accepts a selected-day instant with a timezone; omission uses the server clock.
// PATCH uses foodEntrySchema so an entry cannot be moved to another day.
export const createFoodEntrySchema = foodEntrySchema.extend({
  loggedAt: z.iso.datetime({ offset: true }).optional(),
})

export type CreateFoodEntryInput = z.infer<typeof createFoodEntrySchema>

// Trims a serving size and leaves single spaces inside it, keeping its case: "  1   cup " → "1 cup".
export const normalizeServingSize = (name: string) => name.trim().replaceAll(/\s+/g, ' ')

// The body of POST /v1/serving-sizes.
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

// A serving size of the user, as GET /v1/serving-sizes returns it.
export type ServingSize = { id: number; name: string }

// What the calories and nutrient fields show when their value would change from `previous` to
// `next`, by typing or by pasting.
export const filterPerServingInput = (previous: string, next: string) =>
  filterDecimalInput(previous, next, MAX_PER_SERVING)
