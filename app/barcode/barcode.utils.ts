const supportedCommercialBarcodeLengths = new Set([7, 8, 12, 13, 14]);
const gtinLengths = new Set([8, 12, 13, 14]);

export function isSupportedCommercialBarcode(value: string): boolean {
  return !/\D/.test(value) && supportedCommercialBarcodeLengths.has(value.length);
}

function matchesGtinCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value) || !gtinLengths.has(value.length)) return false;

  const payload = value.slice(0, -1);
  let sum = 0;
  let weight = 3;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    sum += Number(payload[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(value.at(-1));
}

function expandUpce(value: string): string | undefined {
  if (!/^\d{8}$/.test(value) || (value[0] !== "0" && value[0] !== "1")) {
    return undefined;
  }

  const [numberSystem, first, second, third, fourth, fifth, sixth, check] = value;
  if (sixth === "0" || sixth === "1" || sixth === "2") {
    return `${numberSystem}${first}${second}${sixth}00` +
      `00${third}${fourth}${fifth}${check}`;
  }
  if (sixth === "3") {
    return `${numberSystem}${first}${second}${third}00` +
      `000${fourth}${fifth}${check}`;
  }
  if (sixth === "4") {
    return `${numberSystem}${first}${second}${third}${fourth}0` +
      `0000${fifth}${check}`;
  }
  // For UPC-E values ending in 5–9, the EAN-8 and expanded UPC-A check
  // calculations are identical, so matchesGtinCheckDigit already handled them.
  return undefined;
}

export function hasValidGtinCheckDigit(value: string): boolean {
  if (matchesGtinCheckDigit(value)) return true;
  const expandedUpce = expandUpce(value);
  return expandedUpce !== undefined && matchesGtinCheckDigit(expandedUpce);
}
