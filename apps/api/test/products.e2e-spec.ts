import {
  API_SCOPES,
  type ApiKey,
  GENERIC_ERROR_MESSAGE,
  INSUFFICIENT_SCOPE_MESSAGE,
  INVALID_BARCODE_MESSAGE,
  MAX_FOOD_NAME_LENGTH,
  MAX_SERVING_SIZE_LENGTH,
  PRODUCT_NOT_FOUND_MESSAGE,
  type Product,
} from '@open-calorie-tracker/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppConfig } from '../src/config/config.js'
import { Database } from '../src/db/database.js'
import { seedApiKey, seedUser } from '../src/db/seed.js'
import {
  INVALID_TOKENS,
  TEST_ENV,
  type TestApp,
  accessTokenFor,
  createTestApp,
  signAccessToken,
  userIdOf,
  withBearer,
} from './app.js'
import {
  type FakeFetch,
  NUTELLA,
  NUTELLA_BARCODE,
  NUTELLA_PRODUCT,
  type OpenFoodFactsProduct,
  answeringWith,
  fakeOpenFoodFacts,
  nutellaWith,
  requestsOf,
} from './open-food-facts.js'

const USERNAME = 'diego'
const PASSWORD = 'correct-horse-battery-staple'

const FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,nutriments'

// A barcode NUTELLA's variants are looked up with.
const BARCODE = '12345670'

const NUTRIENTS = ['protein', 'carbohydrate', 'fat', 'fiber', 'sugar', 'sodium'] as const

describe('products (e2e)', () => {
  let app: TestApp
  let database: Database
  let fetch: FakeFetch
  // A token exchanged from diego's "Zapier" key, and its scopes.
  let token: string
  let scopes: string[]

  const start = async (options?: Parameters<typeof createTestApp>[0]) => {
    app = await createTestApp(options)
    database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    const zapier: ApiKey = await seedApiKey(
      database,
      { username: USERNAME, name: 'Zapier', expiresIn: 'never' },
      TEST_ENV.API_KEY_SECRET,
    )
    const response = await http().post('/v1/token').send({ apiKey: zapier.key })
    expect(response.status).toBe(200)
    ;({ accessToken: token, scopes } = response.body as { accessToken: string; scopes: string[] })
  }

  beforeEach(async () => {
    fetch = fakeOpenFoodFacts()
    await start()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  const get = (barcode: string, bearer: string | null = token) =>
    withBearer(http().get(`/v1/products/${barcode}`), bearer)

  // Looks up `barcode`, which Open Food Facts has as `product`, and returns the answer.
  const lookUp = async (product: OpenFoodFactsProduct, barcode = BARCODE) => {
    fetch.mockImplementation(answeringWith({ [barcode]: product }))
    const response = await get(barcode)
    expect(response.status).toBe(200)
    return response.body as Product
  }

  describe('A — REST lookup', () => {
    it("A1 — a barcode answers the product in the app's model, per serving", async () => {
      const response = await get(NUTELLA_BARCODE)

      expect(response.status).toBe(200)
      expect(response.body).toEqual(NUTELLA_PRODUCT)
    })

    it('A2 — the API asks Open Food Facts for only the fields it translates, with its User-Agent', async () => {
      await get(NUTELLA_BARCODE)

      expect(requestsOf(fetch)).toEqual([
        {
          url: `https://off.test/api/v2/product/${NUTELLA_BARCODE}?fields=${FIELDS}`,
          userAgent: TEST_ENV.OPEN_FOOD_FACTS_USER_AGENT,
        },
      ])
    })

    it('A3 — the answer is a valid food for log_food once given servings', async () => {
      const {
        barcode: _barcode,
        brand: _brand,
        servingSize,
        ...food
      } = await lookUp(NUTELLA, NUTELLA_BARCODE)
      const servingSizeResponse = await withBearer(
        http().post('/v1/serving-sizes').send({ name: servingSize }),
        token,
      )
      expect(servingSizeResponse.status).toBe(201)

      const response = await withBearer(
        http()
          .post('/v1/food-entries')
          .send({
            ...food,
            quantity: 1,
            servingSizeId: (servingSizeResponse.body as { id: number }).id,
          }),
        token,
      )

      expect(response.status).toBe(201)
    })
  })

  describe('B — translation', () => {
    it('B1 — sodium is converted from g to mg and every value is rounded to one decimal', async () => {
      const product = await lookUp(
        nutellaWith({}, { sodium_serving: 0.0068, proteins_serving: 0.945 }),
      )

      expect(product.sodium).toBe(6.8)
      expect(product.protein).toBe(0.9)
    })

    it('B2 — without per-serving calories the product comes per 100 g', async () => {
      const product = await lookUp(
        {
          code: '5449000000996',
          product_name: 'Coca-Cola',
          brands: 'Coca-Cola',
          serving_size: '330 ml',
          nutriments: {
            sugars_serving: 35,
            sodium_serving: 0.033,
            'energy-kcal_100g': 42,
            proteins_100g: 0,
            carbohydrates_100g: 10.6,
            fat_100g: 0,
            sugars_100g: 10.6,
            sodium_100g: 0,
          },
        },
        '5449000000996',
      )

      expect(product).toEqual({
        barcode: '5449000000996',
        name: 'Coca-Cola',
        brand: 'Coca-Cola',
        servingSize: '100 g',
        calories: 42,
        protein: 0,
        carbohydrate: 10.6,
        fat: 0,
        fiber: null,
        sugar: 10.6,
        sodium: 0,
      })
    })

    it.each<[string, string | undefined, boolean, string, number]>([
      ['"15 g" with per-serving calories', '15 g', true, '15 g', 80],
      ['a spaced serving size', '  1   cup (240ml) ', true, '1 cup (240ml)', 80],
      ['no serving size', undefined, true, '100 g', 539],
      ['"15 g" without per-serving calories', '15 g', false, '100 g', 539],
      [
        `a serving size of ${MAX_SERVING_SIZE_LENGTH + 1} characters`,
        'a'.repeat(MAX_SERVING_SIZE_LENGTH + 1),
        true,
        '100 g',
        539,
      ],
    ])(
      'B3 — %s comes per serving or per 100 g',
      async (_case, servingSize, perServing, expected, calories) => {
        const product = await lookUp(
          nutellaWith(
            { serving_size: servingSize },
            perServing ? {} : { 'energy-kcal_serving': undefined },
          ),
        )

        expect(product.servingSize).toBe(expected)
        expect(product.calories).toBe(calories)
      },
    )

    it('B4 — calories are worked out from kJ when kcal is missing', async () => {
      const product = await lookUp(
        nutellaWith(
          { serving_size: '15 g' },
          { 'energy-kcal_serving': undefined, 'energy-kj_serving': 335 },
        ),
      )

      expect(product.servingSize).toBe('15 g')
      expect(product.calories).toBe(80.1)
    })

    it.each<[unknown, number | null]>([
      [-1, null],
      [9999, 9999],
      [10_000, null],
      ['abc', null],
    ])('B5 — a fat_serving of %j answers fat %j', async (value, fat) => {
      const product = await lookUp(nutellaWith({}, { fat_serving: value }))

      expect(product.fat).toBe(fat)
    })

    it.each<[string | undefined, string | undefined, string | undefined, string | null]>([
      ['Nutella', 'Nutella', 'Hazelnut spread', 'Nutella'],
      ['', 'Nutella', 'Hazelnut spread', 'Nutella'],
      [undefined, undefined, 'Hazelnut spread', 'Hazelnut spread'],
      [undefined, undefined, undefined, null],
    ])(
      'B6 — product_name %j, product_name_en %j and generic_name %j answer the name %j',
      async (name, en, generic, expected) => {
        const product = await lookUp(
          nutellaWith({ product_name: name, product_name_en: en, generic_name: generic }),
        )

        expect(product.name).toBe(expected)
      },
    )

    it(`B7 — a name over ${MAX_FOOD_NAME_LENGTH} characters is cut at ${MAX_FOOD_NAME_LENGTH}`, async () => {
      const product = await lookUp(nutellaWith({ product_name: `  ${'a'.repeat(120)}` }))

      expect(product.name).toBe('a'.repeat(MAX_FOOD_NAME_LENGTH))
    })

    it.each<[string | undefined, string | null]>([
      ['Ferrero,Nutella', 'Ferrero'],
      [' Ferrero , X', 'Ferrero'],
      [undefined, null],
      ['', null],
    ])('B8 — brands %j answer the brand %j', async (brands, brand) => {
      const product = await lookUp(nutellaWith({ brands }))

      expect(product.brand).toBe(brand)
    })
  })

  describe('C — missing data', () => {
    it('C1 — a product with no nutrition answers every nutrient as null, not as an error', async () => {
      const product = await lookUp(
        { code: '0000000000017', product_name: 'Mystery bar' },
        '0000000000017',
      )

      expect(product).toEqual({
        barcode: '0000000000017',
        name: 'Mystery bar',
        brand: null,
        servingSize: '100 g',
        calories: null,
        ...Object.fromEntries(NUTRIENTS.map((nutrient) => [nutrient, null])),
      })
    })
  })

  describe('D — validation and failures', () => {
    it.each(['1234567', '123456789012345', '30176204220ab', '3017-620422003'])(
      'D1 — %s is rejected without calling Open Food Facts',
      async (barcode) => {
        const response = await get(barcode)

        expect(response.status).toBe(400)
        expect((response.body as { message: unknown }).message).toEqual([INVALID_BARCODE_MESSAGE])
        expect(fetch).not.toHaveBeenCalled()
      },
    )

    it.each([
      ['12345670', '12345670'],
      ['12345678901234', '12345678901234'],
      ['%203017620422003%20', '3017620422003'],
    ])('D2 — %s is asked for as %s', async (barcode, sent) => {
      fetch.mockImplementation(answeringWith({ [sent]: NUTELLA }))

      const response = await get(barcode)

      expect(response.status).toBe(200)
      expect((response.body as Product).barcode).toBe(sent)
      expect(requestsOf(fetch).map(({ url }) => url)).toEqual([
        `https://off.test/api/v2/product/${sent}?fields=${FIELDS}`,
      ])
    })

    it('D2b — the answer keeps the barcode as asked, not the code Open Food Facts answers', async () => {
      const product = await lookUp(nutellaWith({ code: '0012345678905' }), '012345678905')

      expect(product.barcode).toBe('012345678905')
    })

    it('D3 — a product Open Food Facts does not have answers 404', async () => {
      const response = await get('12345670')

      expect(response.status).toBe(404)
      expect((response.body as { message: unknown }).message).toBe(PRODUCT_NOT_FOUND_MESSAGE)
    })

    // Waits on the request's abort signal, so only the API's timeout ends it.
    const hanging = (input: string | URL | Request, init?: RequestInit) => {
      const signal = input instanceof Request ? input.signal : init?.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as Error))
      })
    }

    it.each<[string, (input: string | URL | Request, init?: RequestInit) => Promise<Response>]>([
      ['answers 500', () => Promise.resolve(new Response('', { status: 500 }))],
      ['answers 503', () => Promise.resolve(new Response('', { status: 503 }))],
      ['is unreachable', () => Promise.reject(new TypeError('fetch failed'))],
      ['takes more than 5 seconds to answer', hanging],
      [
        'answers 200 with a body that is not JSON',
        () =>
          Promise.resolve(
            new Response('<html></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
          ),
      ],
    ])(
      'D4 — Open Food Facts that %s answers 502 with the generic message',
      async (_case, failure) => {
        fetch.mockImplementation(failure)

        const response = await get(NUTELLA_BARCODE)

        expect(response.status).toBe(502)
        expect((response.body as { message: unknown }).message).toBe(GENERIC_ERROR_MESSAGE)
      },
      10_000,
    )
  })

  describe('E — access', () => {
    it('E1 — "products:read" is the last of the API scopes, and exchanged tokens carry it', async () => {
      expect(API_SCOPES.at(-1)).toBe('products:read')

      expect(scopes).toContain('products:read')
    })

    it('E2 — a web login token can look up products', async () => {
      const loginToken = await accessTokenFor(app, USERNAME, PASSWORD)

      expect((await get(NUTELLA_BARCODE, loginToken)).status).toBe(200)
    })

    it.each<[string, () => Promise<string | null>]>([
      ['no Authorization header', () => Promise.resolve(null)],
      ...INVALID_TOKENS.map(([name, token]): [string, () => Promise<string>] => [name, token]),
    ])('E3 — %s answers 401 without calling Open Food Facts', async (_case, bearer) => {
      const response = await get(NUTELLA_BARCODE, await bearer())

      expect(response.status).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('E4 — a token without "products:read" answers 403', async () => {
      const scoped = await signAccessToken({
        subject: String(await userIdOf(database, USERNAME)),
        scope: 'daily-log:read',
      })

      const response = await get(NUTELLA_BARCODE, scoped)

      expect(response.status).toBe(403)
      expect((response.body as { message: unknown }).message).toBe(INSUFFICIENT_SCOPE_MESSAGE)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('G — environments', () => {
    const { OPEN_FOOD_FACTS_USER_AGENT: _userAgent, ...withoutUserAgent } = TEST_ENV

    it.each([
      ['missing', withoutUserAgent],
      ['empty', { ...TEST_ENV, OPEN_FOOD_FACTS_USER_AGENT: '' }],
    ])('G1 — the API refuses to start when OPEN_FOOD_FACTS_USER_AGENT is %s', (_case, env) => {
      expect(() => AppConfig.fromEnv(env)).toThrow(/OPEN_FOOD_FACTS_USER_AGENT/)
    })

    it('G2 — OPEN_FOOD_FACTS_URL defaults to the world database', async () => {
      await app.close()
      await start({ unset: ['OPEN_FOOD_FACTS_URL'] })

      await get(NUTELLA_BARCODE)

      expect(requestsOf(fetch).map(({ url }) => url)).toEqual([
        `https://world.openfoodfacts.org/api/v2/product/${NUTELLA_BARCODE}?fields=${FIELDS}`,
      ])
    })
  })
})
