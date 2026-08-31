import { describe, expect, test } from "vitest";

import {
  quantityMicrounitsFromDecimal,
  scaleCatalogNutrient,
} from "../app/food-entry/nutrition";

describe("Food Entry quantity parsing", () => {
  test.each([
    ["0.000001", 1],
    ["1", 1_000_000],
    [" 1.2 ", 1_200_000],
    ["9.123456", 9_123_456],
    ["10", 10_000_000],
    ["99", 99_000_000],
  ] as const)("converts %s to %i microunits", (value, expected) => {
    expect(quantityMicrounitsFromDecimal(value)).toBe(expected);
  });

  test.each([
    "0",
    "0.000000",
    "99.000001",
    "100",
    "1.1234567",
    "1x",
    "x1",
    "-1",
    ".5",
  ])("rejects quantity %s", (value) => {
    expect(quantityMicrounitsFromDecimal(value)).toBeUndefined();
  });
});

describe("catalog nutrient fixed-point scaling", () => {
  test("preserves integer, decimal, and scientific coefficient forms", () => {
    expect(
      scaleCatalogNutrient(
        { amount: 12, fixedPointMultiplier: 1_000 },
        1_000_000,
        1_000_000,
        1_000_000,
      ),
    ).toBe(12_000);
    expect(
      scaleCatalogNutrient(
        { amount: 1.25, fixedPointMultiplier: 1_000 },
        1_000_000,
        1_000_000,
        1_000_000,
      ),
    ).toBe(1_250);
    expect(
      scaleCatalogNutrient(
        { amount: 1e-7, fixedPointMultiplier: 1_000_000_000 },
        1_000_000,
        1_000_000,
        1_000_000,
      ),
    ).toBe(100);
    expect(
      scaleCatalogNutrient(
        { amount: 1e21, fixedPointMultiplier: 1 },
        1,
        1_000_000,
        1_000_000_000_000_000,
      ),
    ).toBe(1_000_000);
  });

  test("null nutrients remain unavailable", () => {
    expect(scaleCatalogNutrient(null, 1, 1, 1)).toBeNull();
  });

  test.each([
    { amount: Number.NaN, fixedPointMultiplier: 1 },
    { amount: Number.POSITIVE_INFINITY, fixedPointMultiplier: 1 },
    { amount: -1, fixedPointMultiplier: 1 },
    { amount: 1, fixedPointMultiplier: 0 },
    { amount: 1, fixedPointMultiplier: -1 },
    { amount: 1, fixedPointMultiplier: 1.5 },
    { amount: 1, fixedPointMultiplier: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid authoritative nutrient %#", (value) => {
    expect(() => scaleCatalogNutrient(value, 1, 1_000_000, 1)).toThrow(
      "Catalog nutrient is invalid",
    );
  });

  test("accepts zero amount and the minimum positive multiplier", () => {
    expect(
      scaleCatalogNutrient(
        { amount: 0, fixedPointMultiplier: 1 },
        1,
        1_000_000,
        1,
      ),
    ).toBe(0);
  });

  test("rejects a scaled result outside safe integer storage", () => {
    expect(() =>
      scaleCatalogNutrient(
        { amount: Number.MAX_VALUE, fixedPointMultiplier: 1 },
        1_000_000,
        1_000_000,
        1,
      ),
    ).toThrow("Food Entry exceeds storage limits");
  });
});
