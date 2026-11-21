export const hasAtMostOneDecimal = (value: number) => /^\d+(\.\d)?$/.test(String(value))

export const filterDecimalInput = (previous: string, next: string, max: number) => {
  const [whole = '', ...decimals] = next.replaceAll(/[^\d.]/g, '').split('.')
  const filtered = decimals.length === 0 ? whole : `${whole}.${decimals.join('').slice(0, 1)}`
  return Number(filtered) > max ? previous : filtered
}
