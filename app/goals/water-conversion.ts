export const DISPLAY_UNITS = ["us", "metric"] as const;
export type DisplayUnits = (typeof DISPLAY_UNITS)[number];

export const WATER_UNIT_OPTIONS = {
  metric: {
    canonicalDenominator: 1n,
    canonicalNumerator: 1n,
    defaultValue: "2366",
    displayMaximum: "15000",
    error: "Water must be from 0.001 to 15,000 ml.",
    maximumThousandths: 15_000_000n,
    unit: "ml",
  },
  us: {
    canonicalDenominator: 10_000_000_000n,
    canonicalNumerator: 295_735_295_625n,
    defaultValue: "80",
    displayMaximum: "500",
    error: "Water must be from 0.001 to 500 fl oz.",
    maximumThousandths: 500_000n,
    unit: "fl oz",
  },
} as const satisfies Record<
  DisplayUnits,
  {
    canonicalDenominator: bigint;
    canonicalNumerator: bigint;
    defaultValue: string;
    displayMaximum: string;
    error: string;
    maximumThousandths: bigint;
    unit: string;
  }
>;

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function waterTargetMicrolitersFromThousandths(
  waterThousandths: bigint,
  displayUnits: DisplayUnits,
): bigint {
  const option = WATER_UNIT_OPTIONS[displayUnits];
  return roundDivide(
    waterThousandths * option.canonicalNumerator,
    option.canonicalDenominator,
  );
}

export function waterTargetThousandthsFromMicroliters(
  waterTargetMicroliters: number,
  displayUnits: DisplayUnits,
): bigint {
  const option = WATER_UNIT_OPTIONS[displayUnits];
  return roundDivide(
    BigInt(waterTargetMicroliters) * option.canonicalDenominator,
    option.canonicalNumerator,
  );
}
