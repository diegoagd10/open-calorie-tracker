import { describe, expect, it } from 'vite-plus/test'
import {
  MAX_FOOD_NAME_LENGTH,
  MAX_PER_SERVING,
  MAX_SERVING_SIZE_LENGTH,
  MAX_SERVINGS,
  MIN_SERVINGS,
  SERVINGS_STEP,
  createFoodEntrySchema,
  filterPerServingInput,
  foodEntrySchema,
  servingSizeSchema,
} from './food'

const NUTRIENTS = ['protein', 'carbohydrate', 'fat', 'fiber', 'sugar', 'sodium'] as const

const GREEK_YOGURT = {
  name: 'Greek yogurt with honey',
  servingSizeId: 7,
  quantity: 1.5,
  calories: 180,
  protein: 17,
  carbohydrate: 20,
  fat: 4,
  fiber: 0,
  sugar: 18,
  sodium: 85,
}

describe('servings', () => {
  it('go from 0.5 to 20 in steps of 0.5', () => {
    expect([MIN_SERVINGS, MAX_SERVINGS, SERVINGS_STEP]).toEqual([0.5, 20, 0.5])
  })
})

describe('foodEntrySchema', () => {
  it('accepts an entry with every nutrient, per serving', () => {
    expect(foodEntrySchema.parse(GREEK_YOGURT)).toEqual(GREEK_YOGURT)
  })

  it('accepts an entry without nutrients and with 0 kcal', () => {
    const coffee = { name: 'Black coffee', servingSizeId: 7, quantity: 1, calories: 0 }

    expect(foodEntrySchema.parse(coffee)).toEqual(coffee)
  })

  it('trims the name', () => {
    expect(foodEntrySchema.parse({ ...GREEK_YOGURT, name: '  Greek yogurt  ' }).name).toBe(
      'Greek yogurt',
    )
  })

  it.each([
    ['the longest name', { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH) }],
    ['the fewest servings', { quantity: MIN_SERVINGS }],
    ['the most servings', { quantity: MAX_SERVINGS }],
    ['one decimal of calories', { calories: 12.5 }],
    ['the most calories', { calories: MAX_PER_SERVING }],
    ['the most of a nutrient', { sodium: MAX_PER_SERVING }],
  ])('accepts %s', (_case, change) => {
    expect(foodEntrySchema.safeParse({ ...GREEK_YOGURT, ...change }).success).toBe(true)
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a name that is too long', { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH + 1) }],
    ['a missing serving size', { servingSizeId: undefined }],
    ['a serving size id sent as text', { servingSizeId: '7' }],
    ['a serving size id that is not a whole number', { servingSizeId: 1.5 }],
    ['no servings', { quantity: 0 }],
    ['servings off the 0.5 steps', { quantity: 0.25 }],
    ['more servings than the maximum', { quantity: MAX_SERVINGS + SERVINGS_STEP }],
    ['servings sent as text', { quantity: '1' }],
    ['missing calories', { calories: undefined }],
    ['negative calories', { calories: -1 }],
    ['calories with two decimals', { calories: 12.55 }],
    ['more calories than the maximum', { calories: MAX_PER_SERVING + 1 }],
    ['calories sent as text', { calories: '180' }],
    ['an unknown key', { source: 'manual' }],
  ])('rejects %s', (_case, change) => {
    expect(foodEntrySchema.safeParse({ ...GREEK_YOGURT, ...change }).success).toBe(false)
  })

  it.each(
    NUTRIENTS.flatMap((nutrient) =>
      [-1, 12.55, MAX_PER_SERVING + 0.1].map((value) => [nutrient, value] as const),
    ),
  )('rejects %s of %s', (nutrient, value) => {
    expect(foodEntrySchema.safeParse({ ...GREEK_YOGURT, [nutrient]: value }).success).toBe(false)
  })
})

describe('createFoodEntrySchema', () => {
  it('keeps existing normalization when the timestamp is omitted', () => {
    expect(createFoodEntrySchema.parse({ ...GREEK_YOGURT, name: '  Yogurt  ' })).toEqual({
      ...GREEK_YOGURT,
      name: 'Yogurt',
    })
  })

  it.each(['2020-01-02T01:30:00.123Z', '2020-01-01T20:30:00-05:00'])(
    'accepts an explicit instant %s only for creation',
    (loggedAt) => {
      expect(createFoodEntrySchema.parse({ ...GREEK_YOGURT, loggedAt })).toEqual({
        ...GREEK_YOGURT,
        loggedAt,
      })
      expect(foodEntrySchema.safeParse({ ...GREEK_YOGURT, loggedAt }).success).toBe(false)
    },
  )
})

describe('servingSizeSchema', () => {
  it('trims the name and leaves single spaces inside it', () => {
    expect(servingSizeSchema.parse({ name: '  1   bowl ' })).toEqual({ name: '1 bowl' })
  })

  it('keeps the case of the name', () => {
    expect(servingSizeSchema.parse({ name: '1 Cup (245 g)' })).toEqual({ name: '1 Cup (245 g)' })
  })

  it('accepts the longest name', () => {
    const name = 'a'.repeat(MAX_SERVING_SIZE_LENGTH)

    expect(servingSizeSchema.parse({ name })).toEqual({ name })
  })

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a name that is too long', { name: 'a'.repeat(MAX_SERVING_SIZE_LENGTH + 1) }],
    ['a missing name', {}],
    ['an unknown key', { name: '1 cup', userId: 2 }],
  ])('rejects %s', (_case, body) => {
    expect(servingSizeSchema.safeParse(body).success).toBe(false)
  })
})

// What the calories and nutrient fields show when their value would change from `previous` to
// `next`, whether the change comes from typing or from pasting.
describe('filterPerServingInput', () => {
  it.each([
    ['180', '', '180'],
    ['0', '', '0'],
    ['12.55', '12.5', '12.5'],
    ['abc-1,8', '', '18'],
    ['1.2.3', '', '1.2'],
    [String(MAX_PER_SERVING), '', String(MAX_PER_SERVING)],
    ['', '180', ''],
  ])('turns %j, entered over %j, into %j', (next, previous, expected) => {
    expect(filterPerServingInput(previous, next)).toBe(expected)
  })

  it.each([
    ['typing a digit', '1000', '10000'],
    ['pasting', '', '10000'],
  ])('keeps the previous value when %s would go over the maximum', (_case, previous, next) => {
    expect(filterPerServingInput(previous, next)).toBe(previous)
  })
})
