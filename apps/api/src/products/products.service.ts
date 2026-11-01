import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common'
import {
  GENERIC_ERROR_MESSAGE,
  INVALID_BARCODE_MESSAGE,
  MAX_FOOD_NAME_LENGTH,
  MAX_PER_SERVING,
  MAX_SERVING_SIZE_LENGTH,
  type Nutrient,
  PRODUCT_NOT_FOUND_MESSAGE,
  type Product,
  normalizeServingSize,
} from '@open-calorie-tracker/shared'
import { z } from 'zod'
import { AppConfig } from '../config/config.js'

// What GET /v1/products/:barcode and get_product take: EAN-8, UPC-A, EAN-13 or GTIN-14, without
// the spaces around it.
export const barcodeSchema = z
  .string({ error: INVALID_BARCODE_MESSAGE })
  .trim()
  .regex(/^\d{8,14}$/, INVALID_BARCODE_MESSAGE)

// How long Open Food Facts has to answer.
const TIMEOUT_MS = 5000

const KJ_PER_KCAL = 4.184

const FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,nutriments'

// Each nutrient's name in Open Food Facts, and what turns its value into the app's unit: Open Food
// Facts has every nutrient in g, the app has sodium in mg.
const NUTRIENTS: Record<Nutrient, [name: string, factor: number]> = {
  protein: ['proteins', 1],
  carbohydrate: ['carbohydrates', 1],
  fat: ['fat', 1],
  fiber: ['fiber', 1],
  sugar: ['sugars', 1],
  sodium: ['sodium', 1000],
}

// A field Open Food Facts leaves out or answers with something else counts as missing.
const text = z.string().optional().catch(undefined)

// Open Food Facts answers a code it deems invalid with 200 and no product.
const answerSchema = z.object({
  product: z
    .object({
      product_name: text,
      product_name_en: text,
      generic_name: text,
      brands: text,
      serving_size: text,
      nutriments: z.record(z.string(), z.unknown()).catch({}),
    })
    .optional(),
})

type OpenFoodFactsProduct = NonNullable<z.output<typeof answerSchema>['product']>

// One decimal, or null for a value the app would not accept.
const valueOf = (value: unknown, factor = 1): number | null => {
  if (typeof value !== 'number') return null
  const rounded = Math.round(value * factor * 10) / 10
  return rounded >= 0 && rounded <= MAX_PER_SERVING ? rounded : null
}

const firstFilled = (...values: (string | undefined)[]) =>
  values.map((value) => value?.trim()).find((value) => value !== undefined && value !== '')

// Per serving when the product has a serving size the app accepts and its calories, otherwise per
// 100 g.
const translate = (barcode: string, product: OpenFoodFactsProduct): Product => {
  const { nutriments } = product
  const caloriesPer = (basis: string) =>
    valueOf(nutriments[`energy-kcal_${basis}`]) ??
    valueOf(nutriments[`energy-kj_${basis}`], 1 / KJ_PER_KCAL)

  const servingSize = normalizeServingSize(product.serving_size ?? '')
  const perServing =
    servingSize !== '' &&
    servingSize.length <= MAX_SERVING_SIZE_LENGTH &&
    caloriesPer('serving') !== null
  const basis = perServing ? 'serving' : '100g'

  const nutrients = Object.fromEntries(
    Object.entries(NUTRIENTS).map(([nutrient, [name, factor]]) => [
      nutrient,
      valueOf(nutriments[`${name}_${basis}`], factor),
    ]),
  ) as Record<Nutrient, number | null>

  return {
    barcode,
    name:
      firstFilled(product.product_name, product.product_name_en, product.generic_name)?.slice(
        0,
        MAX_FOOD_NAME_LENGTH,
      ) ?? null,
    brand: firstFilled(product.brands?.split(',')[0]) ?? null,
    servingSize: perServing ? servingSize : '100 g',
    calories: caloriesPer(basis),
    ...nutrients,
  }
}

// Looks products up in Open Food Facts, which the API only reads.
@Injectable()
export class ProductsService {
  constructor(private readonly config: AppConfig) {}

  // The product with this barcode, which barcodeSchema already validated. Answers 404 when Open
  // Food Facts does not have it, and 502 when it fails.
  async find(barcode: string): Promise<Product> {
    const { url, userAgent } = this.config.openFoodFacts
    let answer: unknown
    try {
      const response = await fetch(`${url}/api/v2/product/${barcode}?fields=${FIELDS}`, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.status === 404) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE)
      if (!response.ok) throw new BadGatewayException(GENERIC_ERROR_MESSAGE)
      answer = await response.json()
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new BadGatewayException(GENERIC_ERROR_MESSAGE)
    }

    const parsed = answerSchema.safeParse(answer)
    if (!parsed.success) throw new BadGatewayException(GENERIC_ERROR_MESSAGE)
    if (parsed.data.product === undefined) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE)
    return translate(barcode, parsed.data.product)
  }
}
