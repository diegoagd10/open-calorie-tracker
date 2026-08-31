export type AuthoritativeNutrientValue = {
  amount: number;
  fixedPointMultiplier: number;
};

function decimalFraction(value: number): {
  denominator: bigint;
  numerator: bigint;
} {
  const text = String(value).toLowerCase();
  const exponentMarker = text.indexOf("e");
  const coefficient =
    exponentMarker === -1 ? text : text.slice(0, exponentMarker);
  const scientificExponent =
    exponentMarker === -1 ? 0 : Number(text.slice(exponentMarker + 1));
  const decimalPoint = coefficient.indexOf(".");
  const fractionLength =
    decimalPoint === -1 ? 0 : coefficient.length - decimalPoint - 1;
  const digits = BigInt(
    decimalPoint === -1
      ? coefficient
      : coefficient.slice(0, decimalPoint) + coefficient.slice(decimalPoint + 1),
  );
  const exponent = scientificExponent - fractionLength;
  return {
    denominator: 10n ** BigInt(Math.max(-exponent, 0)),
    numerator: digits * 10n ** BigInt(Math.max(exponent, 0)),
  };
}

export function quantityMicrounitsFromDecimal(value: string): number | undefined {
  const match = /^(\d{1,2})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const result = whole * 1_000_000n + fraction;
  if (result <= 0n || result > 99_000_000n) return undefined;
  return Number(result);
}

export function scaleCatalogNutrient(
  value: AuthoritativeNutrientValue | null,
  measurementBaseQuantityMicrounits: number,
  quantityMicrounits: number,
  authoritativeBaseQuantityMicrounits: number,
): number | null {
  if (value === null) return null;
  if (
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    !Number.isSafeInteger(value.fixedPointMultiplier) ||
    value.fixedPointMultiplier <= 0
  ) {
    throw new Error("Catalog nutrient is invalid");
  }
  const amount = decimalFraction(value.amount);
  const denominator =
    amount.denominator *
    BigInt(authoritativeBaseQuantityMicrounits) *
    1_000_000n;
  const numerator =
    amount.numerator *
    BigInt(value.fixedPointMultiplier) *
    BigInt(measurementBaseQuantityMicrounits) *
    BigInt(quantityMicrounits);
  const scaled = (numerator + denominator / 2n) / denominator;
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Food Entry exceeds storage limits");
  }
  return result;
}
