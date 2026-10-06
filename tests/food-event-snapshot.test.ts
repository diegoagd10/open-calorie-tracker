import { expect, test } from "vitest";

import {
  favoriteFromRow,
  favoriteSnapshotJson,
  foodEventFromRow,
  serializeCatalogMeasurements,
  snapshotFromColumns,
  type FoodEventRow,
} from "../app/food-event/snapshot.server";

function row(change: Partial<FoodEventRow> = {}): FoodEventRow {
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
    copiedFromEventId: null,
    id: 1,
    logDate: "2026-08-29T18:00:00.000Z",
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
    sourceFavoriteId: null,
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
    expect(snapshotFromColumns(row({ supportedMeasurements }))).toMatchObject({
      measurements: [
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
  const snapshot = snapshotFromColumns(
    row({
      selectedMeasurementBaseQuantityMicrounits: 100_000_000,
      selectedMeasurementId: "base:g:100000000",
      selectedMeasurementLabel: "100 g",
    }),
  );
  expect(snapshot.measurements).toEqual([
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
    snapshotFromColumns(
      row({ supportedMeasurements: JSON.stringify(stored) }),
    ).measurements,
  ).toEqual(stored);
});

/** A favorite stored by Saved Foods before Food Events, byte for byte. */
const legacyFavoriteJson = JSON.stringify({
  authoritativeBaseQuantityMicrounits: 1_000_000,
  authoritativeBaseUnit: "serving",
  authoritativeNutrition: '{"carbohydrateMilligrams":null,"energyMilliKcal":{"amount":50,"fixedPointMultiplier":1000},"fatMilligrams":null,"fiberMilligrams":null,"proteinMilligrams":{"amount":1.5,"fixedPointMultiplier":1000},"sodiumMilligrams":null,"sugarMilligrams":null}',
  barcode: null,
  brand: null,
  carbohydrateMilligrams: null,
  editedName: "Edited tortilla",
  energyMilliKcal: 100_000,
  fatMilligrams: null,
  fiberMilligrams: null,
  marketCountry: null,
  originalName: "Mexican tortilla",
  proteinMilligrams: 3_000,
  provider: "manual",
  providerFoodId: "saved-manual-tortilla",
  providerModifiedDate: null,
  providerPublishedDate: null,
  quantityMicrounits: 2_000_000,
  selectedMeasurementBaseQuantityMicrounits: 1_000_000,
  selectedMeasurementId: "serving",
  selectedMeasurementLabel: "1 serving",
  selectedMeasurementUnit: "serving",
  sodiumMilligrams: null,
  sourceDataType: "User entered",
  sugarMilligrams: null,
  supportedMeasurements: '[{"baseQuantityMicrounits":1000000,"id":"serving","label":"1 serving","unit":"serving"}]',
});

test("a legacy flat favorite reads as a snapshot and is written back in the same bytes", () => {
  const favorite = favoriteFromRow({
    id: 4,
    userId: 1,
    sourceEventId: 9,
    name: "Edited tortilla",
    snapshot: legacyFavoriteJson,
    createdAt: "2026-08-27T12:00:00.000Z",
  });

  expect(favorite).toMatchObject({
    id: 4,
    name: "Edited tortilla",
    sourceEventId: 9,
    snapshot: {
      source: { provider: "manual", providerFoodId: "saved-manual-tortilla", dataType: "User entered" },
      originalName: "Mexican tortilla",
      editedName: "Edited tortilla",
      authority: { unit: "serving", quantityMicrounits: 1_000_000, nutrition: { energyMilliKcal: { amount: 50, fixedPointMultiplier: 1_000 } } },
      measurement: { id: "serving", label: "1 serving" },
      quantityMicrounits: 2_000_000,
      nutrients: { energyMilliKcal: 100_000, proteinMilligrams: 3_000, sodiumMilligrams: null },
    },
  });
  expect(favoriteSnapshotJson(favorite.snapshot)).toBe(legacyFavoriteJson);
});

test("an event row carries its favorite link and copy provenance beside the snapshot", () => {
  expect(foodEventFromRow(row({ copiedFromEventId: 3, editedName: "Renamed" }), 8)).toMatchObject({
    id: 1,
    name: "Renamed",
    originalName: "Boundary food",
    logDate: "2026-08-29T18:00:00.000Z",
    favoriteId: 8,
    copiedFromId: 3,
  });
});
