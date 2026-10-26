// Whole numbers or one decimal, e.g. 12 or 12.5 but not 12.55.
export const hasAtMostOneDecimal = (value: number) => /^\d+(\.\d)?$/.test(String(value))

// What a decimal field shows when its value would change from `previous` to `next`, by typing or
// by pasting: only digits and one decimal point, at most one decimal, and nothing over `max`, in
// which case the field keeps its previous value.
export const filterDecimalInput = (previous: string, next: string, max: number) => {
  const [whole = '', ...decimals] = next.replaceAll(/[^\d.]/g, '').split('.')
  const filtered = decimals.length === 0 ? whole : `${whole}.${decimals.join('').slice(0, 1)}`
  return Number(filtered) > max ? previous : filtered
}
