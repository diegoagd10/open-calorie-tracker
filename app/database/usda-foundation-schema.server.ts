import { z } from "zod";

const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/u);
const label = z.string().trim().min(1).max(500);
const boundedNumber = z.number().finite().nonnegative().max(999_999_999);
const nutrientValueSchema = z
  .object({
    amount: boundedNumber,
    fixedPointMultiplier: z.number().int().positive().max(1_000_000),
  })
  .strict()
  .nullable();

export const foundationCatalogFoodSchema = z
  .object({
    authoritativeBaseQuantityMicrounits: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    authoritativeBaseUnit: z.literal("g"),
    barcode: z.null(),
    brand: z.null(),
    catalogGeneration: identifier,
    calculationUnavailableReason: label.optional(),
    dataType: z.literal("Foundation"),
    isSelectable: z.boolean(),
    marketCountry: z.null(),
    measurementSummary: label,
    measurements: z
      .array(
        z
          .object({
            baseQuantityMicrounits: z
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER),
            id: identifier,
            label,
            unit: z.enum(["g", "ml", "serving"]),
          })
          .strict(),
      )
      .max(100),
    name: label,
    nutritionPerAuthoritativeBase: z
      .object({
        carbohydrateMilligrams: nutrientValueSchema,
        energyMilliKcal: nutrientValueSchema,
        fatMilligrams: nutrientValueSchema,
        fiberMilligrams: nutrientValueSchema,
        proteinMilligrams: nutrientValueSchema,
        sodiumMilligrams: nutrientValueSchema,
        sugarMilligrams: nutrientValueSchema,
      })
      .strict(),
    originalName: label,
    provider: z.literal("usda-fdc"),
    providerFoodId: z.string().regex(/^[1-9]\d*$/u).max(20),
    providerModifiedDate: z.null(),
    providerPublishedDate: z.iso.date(),
  })
  .strict();
