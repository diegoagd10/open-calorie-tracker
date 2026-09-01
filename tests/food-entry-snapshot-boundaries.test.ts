import { expect, test } from "vitest";

import {
  foodEntrySnapshot,
  serializeCatalogMeasurements,
  type FoodEntryRow,
} from "../app/food-entry/snapshot.server";

function row(change: Partial<FoodEntryRow> = {}): FoodEntryRow {
  return {
    authoritativeBaseQuantityMicrounits: 100_000_000,
    authoritativeBaseUnit: "g",
    authoritativeNutrition:
      '{"carbohydrateMilligrams":null,"energyMilliKcal":null,"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":null,"sodiumMilligrams":null,"sugarMilligrams":null}',
    barcode: null,
    brand: null,
    carbohydrateMilligrams: null,
    createdAt: "2026-08-29T18:00:00.000Z",
    editedName: null,
    energyMilliKcal: null,
    fatMilligrams: null,
    fiberMilligrams: null,
    foodLogDate: "2026-08-29",
    id: 1,
    idempotencyKey: "snapshot-boundary",
    localEventTime: "14:00:00",
    marketCountry: null,
    originalName: "Boundary food",
    proteinMilligrams: null,
    provider: "usda-fdc",
    providerFoodId: "700",
    providerModifiedDate: null,
    providerPublishedDate: null,
    quantityMicrounits: 1_000_000,
    selectedMeasurementBaseQuantityMicrounits: 25_000_000,
    selectedMeasurementId: "portion:1",
    selectedMeasurementLabel: "1 portion",
    selectedMeasurementUnit: "g",
    sodiumMilligrams: null,
    sourceDataType: "Foundation",
    sugarMilligrams: null,
    supportedMeasurements: "[]",
    updatedAt: "2026-08-29T18:00:00.000Z",
    userId: 1,
    ...change,
  };
}

test("measurement serialization accepts mass, volume, and serving authority", () => {
  const measurements = [
    {
      baseQuantityMicrounits: 25_000_000,
      id: "portion:1",
      label: "1 portion",
      unit: "g" as const,
    },
    {
      baseQuantityMicrounits: 50_000_000,
      id: "volume:1",
      label: "1 cup",
      unit: "ml" as const,
    },
    {
      baseQuantityMicrounits: 1_000_000,
      id: "serving",
      label: "1 serving",
      unit: "serving" as const,
    },
  ];
  expect(JSON.parse(serializeCatalogMeasurements(measurements))).toEqual(
    measurements,
  );
  expect(() => serializeCatalogMeasurements([])).toThrow();
  expect(() =>
    serializeCatalogMeasurements([
      { ...measurements[0], unit: "oz" as "g" },
    ]),
  ).toThrow();
});

test.each(["[]", "{}"])(
  "an unusable %s measurement snapshot reconstructs selected and base choices",
  (supportedMeasurements) => {
    expect(foodEntrySnapshot(row({ supportedMeasurements }))).toMatchObject({
      supportedMeasurements: [
        {
          baseQuantityMicrounits: 25_000_000,
          id: "portion:1",
          label: "1 portion",
          unit: "g",
        },
        {
          baseQuantityMicrounits: 100_000_000,
          id: "base:g:100000000",
          label: "100 g",
          unit: "g",
        },
      ],
    });
  },
);

test("fallback does not duplicate a selected base measurement", () => {
  const snapshot = foodEntrySnapshot(
    row({
      selectedMeasurementBaseQuantityMicrounits: 100_000_000,
      selectedMeasurementId: "base:g:100000000",
      selectedMeasurementLabel: "100 g",
    }),
  );
  expect(snapshot.supportedMeasurements).toEqual([
    {
      baseQuantityMicrounits: 100_000_000,
      id: "base:g:100000000",
      label: "100 g",
      unit: "g",
    },
  ]);
});

test("a valid stored measurement snapshot is returned unchanged", () => {
  const stored = [
    {
      baseQuantityMicrounits: 10_000_000,
      id: "portion:stored",
      label: "Stored portion",
      unit: "g",
    },
  ];
  expect(
    foodEntrySnapshot(
      row({ supportedMeasurements: JSON.stringify(stored) }),
    ).supportedMeasurements,
  ).toEqual(stored);
});
