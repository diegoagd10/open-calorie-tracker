import { describe, expect, it } from 'vite-plus/test'
import { MAX_DAILY_GOAL, dailyGoalsUpdateSchema } from './daily-goals'

describe('dailyGoalsUpdateSchema', () => {
  it.each([1, MAX_DAILY_GOAL])('accepts a goal of %s', (calories) => {
    expect(dailyGoalsUpdateSchema.parse({ calories })).toEqual({ calories })
  })

  it.each([0, MAX_DAILY_GOAL + 1, 12.5])('rejects a goal of %s', (calories) => {
    expect(dailyGoalsUpdateSchema.safeParse({ calories }).success).toBe(false)
  })
})
