// Water amounts are in US fluid ounces.

// The most a single water entry can hold: one gallon.
export const MAX_WATER_AMOUNT = 128

// One tap on a preset logs its amount.
export const WATER_PRESETS = [
  { name: 'Glass', amount: 8 },
  { name: 'Bottle', amount: 16 },
  { name: 'Gallon', amount: MAX_WATER_AMOUNT },
] as const
