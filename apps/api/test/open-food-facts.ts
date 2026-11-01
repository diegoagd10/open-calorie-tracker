import type { Product } from '@open-calorie-tracker/shared'
import { vi } from 'vite-plus/test'

// A product as Open Food Facts' API v2 answers it, with the fields the API asks for.
export type OpenFoodFactsProduct = {
  code?: string | undefined
  product_name?: string | undefined
  product_name_en?: string | undefined
  generic_name?: string | undefined
  brands?: string | undefined
  serving_size?: string | undefined
  nutriments?: Record<string, unknown>
}

export const NUTELLA_BARCODE = '3017620422003'

// The Background's product: per serving and per 100 g, with no fiber.
export const NUTELLA: OpenFoodFactsProduct = {
  code: NUTELLA_BARCODE,
  product_name: 'Nutella',
  brands: 'Ferrero,Nutella',
  serving_size: '15 g',
  nutriments: {
    'energy-kcal_serving': 80,
    proteins_serving: 0.945,
    carbohydrates_serving: 8.6,
    fat_serving: 4.6,
    sugars_serving: 8.4,
    sodium_serving: 0.0068,
    'energy-kcal_100g': 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    sugars_100g: 56.3,
    sodium_100g: 0.0428,
  },
}

// NUTELLA in the app's model.
export const NUTELLA_PRODUCT: Product = {
  barcode: NUTELLA_BARCODE,
  name: 'Nutella',
  brand: 'Ferrero',
  servingSize: '15 g',
  calories: 80,
  protein: 0.9,
  carbohydrate: 8.6,
  fat: 4.6,
  fiber: null,
  sugar: 8.4,
  sodium: 6.8,
}

const defined = (object: object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

// NUTELLA with some fields replaced and its nutriments merged with `nutriments`, where undefined
// leaves a field out.
export const nutellaWith = (
  fields: Omit<OpenFoodFactsProduct, 'nutriments'>,
  nutriments: Record<string, unknown> = {},
): OpenFoodFactsProduct => ({
  ...defined({ ...NUTELLA, ...fields }),
  nutriments: defined({ ...NUTELLA.nutriments, ...nutriments }),
})

// A JSON answer of Open Food Facts.
export const json = (body: object, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Answers like Open Food Facts for the products given by barcode, and 404 for any other.
export const answeringWith =
  (products: Record<string, OpenFoodFactsProduct>) =>
  (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input)
    const code = /\/api\/v2\/product\/([^/?]+)/.exec(url.pathname)?.[1] ?? ''
    const product = products[code]
    return Promise.resolve(
      product === undefined
        ? json({ code, status: 0, status_verbose: 'product not found' }, 404)
        : json({ code, status: 1, status_verbose: 'product found', product }, 200),
    )
  }

// Replaces fetch, which the API only uses to reach Open Food Facts, with one that has NUTELLA. A
// test changes what it answers with mockImplementation(answeringWith(…)) or any other fake.
export const fakeOpenFoodFacts = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(answeringWith({ [NUTELLA_BARCODE]: NUTELLA }))

export type FakeFetch = ReturnType<typeof fakeOpenFoodFacts>

// The URL and the User-Agent header of each request made through the fake.
export const requestsOf = (fetch: FakeFetch) =>
  fetch.mock.calls.map(([input, init]) => {
    const request = input instanceof Request ? input : new Request(input, init)
    return { url: request.url, userAgent: request.headers.get('User-Agent') }
  })
