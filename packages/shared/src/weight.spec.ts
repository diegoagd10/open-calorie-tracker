import { describe, expect, it } from 'vite-plus/test'
import {
  WEIGHT_GOAL_ORDER_ERROR,
  filterWeightInput,
  weightGoalUpdateSchema,
  weightSchema,
} from './weight'

describe('weightSchema', () => {
  it.each([50, 179.4, 999])('accepts %s lb', (weight) => {
    expect(weightSchema.parse(weight)).toBe(weight)
  })

  it.each([49.9, 999.1, 179.45, '180', null])('rejects %j', (weight) => {
    expect(weightSchema.safeParse(weight).success).toBe(false)
  })
})

describe('weightGoalUpdateSchema', () => {
  const goal = { startWeight: 180, goalWeight: 150, date: '2026-10-26' }

  it('accepts a goal under the starting weight', () => {
    expect(weightGoalUpdateSchema.parse(goal)).toEqual(goal)
  })

  it.each([180, 185])('rejects a goal of %s for a starting weight of 180', (goalWeight) => {
    const result = weightGoalUpdateSchema.safeParse({ ...goal, goalWeight })

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([WEIGHT_GOAL_ORDER_ERROR])
  })

  it.each([
    ['a date that does not exist', { ...goal, date: '2026-02-30' }],
    ['no date', { startWeight: 180, goalWeight: 150 }],
    ['an unknown field', { ...goal, deadline: '2027-01-01' }],
  ])('rejects %s', (_case, body) => {
    expect(weightGoalUpdateSchema.safeParse(body).success).toBe(false)
  })
})

describe('filterWeightInput', () => {
  it.each([
    ['', 'a17x9.45.6', '179.4'],
    ['999', '9999', '999'],
    ['17', '170', '170'],
  ])('from %j, typing %j shows %j', (previous, next, shown) => {
    expect(filterWeightInput(previous, next)).toBe(shown)
  })
})
