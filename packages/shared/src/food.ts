import { z } from 'zod'
import type { Nutrient } from './daily-log'
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

// A nutrient is left out, or null, when the label doesn't say.
const nutrient = perServing.nullish()

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
// PATCH ignores loggedAt (updateFoodEntrySchema), so an entry cannot be moved to another day.
export const createFoodEntrySchema = foodEntrySchema.extend({
  loggedAt: z.iso.datetime({ offset: true }).optional(),
})

export type CreateFoodEntryInput = z.infer<typeof createFoodEntrySchema>

// GET /v1/food-entries/:id answers an entry per serving, as PATCH takes it back.
export type EditableFoodEntry = {
  id: number
  loggedAt: string
  name: string
  servingSizeId: number
  servingSize: string
  quantity: number
  calories: number
} & Record<Nutrient, number | null>

// GET /v1/products/:barcode answers a product of Open Food Facts as a food per serving, as
// log_food takes it, or per "100 g" when Open Food Facts has no serving. What it does not know is
// null.
export type Product = {
  barcode: string
  name: string | null
  brand: string | null
  servingSize: string
  calories: number | null
} & Record<Nutrient, number | null>

// The body of PATCH /v1/food-entries/:id. It ignores the fields of an EditableFoodEntry that PATCH
// does not change, so a client can send back what it read; any other unknown key is rejected.
export const updateFoodEntrySchema = foodEntrySchema
  .extend({
    id: z.unknown().optional(),
    loggedAt: z.unknown().optional(),
    servingSize: z.unknown().optional(),
  })
  .transform(({ id: _id, loggedAt: _loggedAt, servingSize: _servingSize, ...input }) => input)

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
