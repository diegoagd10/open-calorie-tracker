import { describe, expect, it } from 'vite-plus/test'
import { MAX_WATER_AMOUNT, filterWaterAmountInput, waterEntrySchema } from './water'

describe('waterEntrySchema', () => {
  it.each([0.1, 12.5, 16, MAX_WATER_AMOUNT])('accepts %s fl oz', (amount) => {
    expect(waterEntrySchema.parse({ amount })).toEqual({ amount })
  })

  it.each([
    ['zero', { amount: 0 }],
    ['a negative amount', { amount: -8 }],
    ['more than the maximum', { amount: MAX_WATER_AMOUNT + 0.1 }],
    ['more than one decimal', { amount: 12.55 }],
    ['an amount sent as text', { amount: '16' }],
    ['a missing amount', {}],
  ])('rejects %s', (_case, body) => {
    expect(waterEntrySchema.safeParse(body).success).toBe(false)
  })
})

// What the amount field shows when its value would change from `previous` to `next`, whether the
// change comes from typing or from pasting.
describe('filterWaterAmountInput', () => {
  it.each([
    ['12.5', '', '12.5'],
    ['12.55', '12.5', '12.5'],
    ['1a', '1', '1'],
    ['1a2', '', '12'],
    ['-5', '', '5'],
    ['1.2.', '1.2', '1.2'],
    ['1.2.3', '', '1.2'],
    ['16 oz', '', '16'],
    ['7.25', '', '7.2'],
    [String(MAX_WATER_AMOUNT), '', String(MAX_WATER_AMOUNT)],
    ['0', '', '0'],
    ['.', '', '.'],
    ['', '16', ''],
  ])('turns %j, entered over %j, into %j', (next, previous, expected) => {
    expect(filterWaterAmountInput(previous, next)).toBe(expected)
  })

  it.each([
    ['typing a digit', String(MAX_WATER_AMOUNT), `${MAX_WATER_AMOUNT}0`],
    ['pasting', '', String(MAX_WATER_AMOUNT * 2)],
  ])('keeps the previous value when %s would go over the maximum', (_case, previous, next) => {
    expect(filterWaterAmountInput(previous, next)).toBe(previous)
  })
})
