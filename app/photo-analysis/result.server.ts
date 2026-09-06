import { z } from "zod";
import type { UsdaEvidence } from "../catalog/usda.server";
import type { PhotoSnapshot } from "../database/photo-analysis.server";
import {
  scaleCatalogNutrient,
  serializeCatalogMeasurements,
  serializeCatalogNutrition,
} from "../food-entry/snapshot.server";

const amount = z.number().finite().nonnegative().max(999999.999);
const nutritionSchema = z.object({
  energyKcal: amount,
  proteinGrams: amount,
  carbohydrateGrams: amount,
  fatGrams: amount,
  fiberGrams: amount.nullish(),
  sugarGrams: amount.nullish(),
  sodiumMilligrams: amount.nullish(),
});
const resultSchema = z.object({
  name: z.string().trim().min(1).max(200),
  consumedFraction: z.number().positive().max(1),
  assumptions: z.array(z.string().min(1).max(500)).max(40),
  components: z
    .array(
      z
        .object({
          id: z.string().min(1).max(100),
          name: z.string().trim().min(1).max(200),
          quantity: z.number().min(0.000001).max(10000),
          unit: z.enum(["g", "ml", "serving"]),
          includes: z.array(z.string().min(1).max(100)).max(30),
          source: z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("ai"),
              reason: z.string().min(1).max(500),
            }),
            z.object({
              kind: z.literal("usda"),
              fdcId: z.string().regex(/^[1-9]\d*$/),
            }),
          ]),
          supplements: z
            .array(
              z.object({
                nutrient: z.enum([
                  "energyKcal",
                  "proteinGrams",
                  "carbohydrateGrams",
                  "fatGrams",
                  "fiberGrams",
                  "sugarGrams",
                  "sodiumMilligrams",
                ]),
                amount,
                reason: z.string().min(1).max(500),
              }),
            )
            .max(7)
            .default([]),
          nutrition: nutritionSchema.optional(),
        })
        .refine(
          (component) =>
            component.source.kind === "usda" ||
            component.nutrition !== undefined,
          "AI estimates require nutrition",
        )
        .transform((component) => ({
          ...component,
          nutrition: component.nutrition ?? {
            energyKcal: 0,
            proteinGrams: 0,
            carbohydrateGrams: 0,
            fatGrams: 0,
            fiberGrams: null,
            sugarGrams: null,
            sodiumMilligrams: null,
          },
        })),
    )
    .min(1)
    .max(30),
});
export type PhotoResult = z.infer<typeof resultSchema>;

const nutrientFields = {
  energyMilliKcal: ["energyKcal", 1000],
  proteinMilligrams: ["proteinGrams", 1000],
  carbohydrateMilligrams: ["carbohydrateGrams", 1000],
  fatMilligrams: ["fatGrams", 1000],
  fiberMilligrams: ["fiberGrams", 1000],
  sugarMilligrams: ["sugarGrams", 1000],
  sodiumMilligrams: ["sodiumMilligrams", 1],
} as const;

type Component = PhotoResult["components"][number];
type NutrientKey = keyof typeof nutrientFields;
const nutrientKeys = Object.keys(nutrientFields) as NutrientKey[];

function validateDistinctComponents(components: Component[]) {
  const represented = new Set<string>();
  const names = new Set<string>();
  for (const component of components) {
    const name = component.name.toLocaleLowerCase("en-US");
    if (names.has(name)) throw new Error("Duplicate component");
    names.add(name);
    for (const id of [component.id, ...component.includes]) {
      if (represented.has(id)) throw new Error("Dish and ingredients overlap");
      represented.add(id);
    }
  }
}

function supplementedNutrient(
  component: Component,
  key: NutrientKey,
  value: number | null,
) {
  const [input, multiplier] = nutrientFields[key];
  const supplement = component.supplements.find(
    (item) => item.nutrient === input,
  );
  if (supplement && value !== null)
    throw new Error("Cannot override a USDA nutrient with an estimate");
  const amount = value === null ? supplement?.amount : value / multiplier;
  if (
    amount == null &&
    ["energyKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"].includes(
      input,
    )
  )
    throw new Error(
      "Required nutrient missing: supply an explicit AI supplement",
    );
  return amount ?? null;
}

function validateUsdaComponent(component: Component, evidence: UsdaEvidence[]) {
  if (component.source.kind !== "usda") return;
  const id = component.source.fdcId;
  const reference = evidence.find(
    (item) => item.food.providerFoodId === id,
  )?.food;
  if (!reference || component.unit !== reference.authoritativeBaseUnit)
    throw new Error("Invalid USDA reference or unit");
  for (const key of nutrientKeys) {
    const value = scaleCatalogNutrient(
      reference.nutritionPerAuthoritativeBase[key],
      Math.round(component.quantity * 1000000),
      1000000,
      reference.authoritativeBaseQuantityMicrounits,
    );
    Object.assign(component.nutrition, {
      [nutrientFields[key][0]]: supplementedNutrient(component, key, value),
    });
  }
}

function totalNutrient(
  components: Component[],
  key: NutrientKey,
  fraction: number,
) {
  const [input, multiplier] = nutrientFields[key];
  const values = components.map((component) => component.nutrition[input]);
  if (values.some((value) => value == null)) return null;
  const total = values.reduce<number>(
    (sum, value) =>
      sum +
      scaleCatalogNutrient(
        { amount: value!, fixedPointMultiplier: multiplier },
        1000000,
        fraction,
        1000000,
      )!,
    0,
  );
  if (total > 999999999) throw new Error("Nutrition exceeds storage bounds");
  return total;
}

export function validatePhotoResult(
  value: unknown,
  mealId: string,
  evidence: UsdaEvidence[],
) {
  const result = resultSchema.parse(value);
  validateDistinctComponents(result.components);
  for (const component of result.components)
    validateUsdaComponent(component, evidence);
  const fraction = Math.round(result.consumedFraction * 1000000);
  if (!fraction) throw new Error("Invalid consumed fraction");
  const totals = Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      totalNutrient(result.components, key, fraction),
    ]),
  ) as Record<NutrientKey, number | null>;
  const authoritativeNutrition = Object.fromEntries(
    nutrientKeys.map((key) => {
      const value = totals[key];
      const multiplier = nutrientFields[key][1];
      return [
        key,
        value === null
          ? null
          : { amount: value / multiplier, fixedPointMultiplier: multiplier },
      ];
    }),
  ) as Parameters<typeof serializeCatalogNutrition>[0];
  const measurement = {
    id: "plate",
    label: "Analyzed plate",
    unit: "serving" as const,
    baseQuantityMicrounits: 1000000,
  };
  const snapshot: PhotoSnapshot = {
    ...totals,
    originalName: result.name,
    provider: "ai-photo",
    providerFoodId: mealId,
    sourceDataType: "AI analysis",
    authoritativeBaseUnit: "serving",
    authoritativeBaseQuantityMicrounits: 1000000,
    authoritativeNutrition: serializeCatalogNutrition(authoritativeNutrition),
    selectedMeasurementId: measurement.id,
    selectedMeasurementLabel: measurement.label,
    selectedMeasurementUnit: measurement.unit,
    selectedMeasurementBaseQuantityMicrounits: 1000000,
    supportedMeasurements: serializeCatalogMeasurements([measurement]),
    quantityMicrounits: 1000000,
  };
  return { result, snapshot };
}
