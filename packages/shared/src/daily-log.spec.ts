import { describe, expect, it } from 'vite-plus/test'
import { DEFAULT_DAILY_GOALS } from './daily-log'

describe('DEFAULT_DAILY_GOALS', () => {
  // The Food Log divides by each goal to fill its progress bars.
  it.each(Object.entries(DEFAULT_DAILY_GOALS))(
    'sets %s to a positive whole number',
    (_goal, value) => {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    },
  )
})
