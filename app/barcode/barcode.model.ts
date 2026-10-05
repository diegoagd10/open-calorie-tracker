import { z } from "zod";

/**
 * Numbers OFF usually sends as JSON numbers but has historically sent as numeric text; the label
 * rules decide whether a value is usable, so either spelling reaches them.
 */
const offNumberSchema = z.union([z.number(), z.string()]);

/** One declared nutrient; an entry of any other shape is dropped instead of failing the reply. */
const offNutrientSchema = z.object({
  unit: z.string().optional(),
  value: offNumberSchema.nullable().optional(),
  modifier: z.string().optional(),
}).nullable().catch(null);

/**
 * One nutrition table of a product. Open strings for `source`, `preparation`, `per` and `per_unit`
 * are deliberate: unsupported values must reach the label rules and be excluded, not fail the reply.
 */
const offNutritionInputSetSchema = z.object({
  /** `"packaging"`, `"estimate"`, … */
  source: z.string().optional(),
  /** `"as_sold"` or `"prepared"`. */
  preparation: z.string().optional(),
  /** `"100g"`, `"100ml"` or `"serving"`. */
  per: z.string().optional(),
  per_quantity: offNumberSchema.optional(),
  /** `"g"` or `"ml"`. */
  per_unit: z.string().optional(),
  nutrients: z.record(z.string(), offNutrientSchema).nullable().optional(),
}).nullable().catch(null);

export const offProductSchema = z.object({
  code: z.string(),
  product_name: z.string().nullable().optional(),
  product_name_en: z.string().nullable().optional(),
  product_name_es: z.string().nullable().optional(),
  brands: z.string().nullable().optional(),
  countries: z.string().nullable().optional(),
  serving_quantity: offNumberSchema.nullable().optional(),
  serving_quantity_unit: z.string().nullable().optional(),
  /** `"on"` (or `true`) when the packaging declares no nutrition facts. */
  no_nutrition_data: z.union([z.boolean(), z.string()]).nullable().optional(),
  created_t: z.number().nullable().optional(),
  last_modified_t: z.number().nullable().optional(),
  nutrition: z.object({
    input_sets: z.array(offNutritionInputSetSchema).nullable().optional(),
  }).nullable().optional(),
});

/** The body of `GET /api/v3.5/product/{barcode}` that barcode lookup reads. */
export const offProductResponseSchema = z.object({
  product: offProductSchema,
});

export type OffProduct = z.infer<typeof offProductSchema>;
export type OffNutritionInputSet = NonNullable<z.infer<typeof offNutritionInputSetSchema>>;
export type OffNutrient = NonNullable<z.infer<typeof offNutrientSchema>>;

/** The `fields=` list of the product request: exactly what the label rules read. */
export const OFF_PRODUCT_FIELDS: readonly (keyof OffProduct)[] = [
  "code",
  "product_name",
  "product_name_en",
  "product_name_es",
  "brands",
  "countries",
  "serving_quantity",
  "serving_quantity_unit",
  "no_nutrition_data",
  "created_t",
  "last_modified_t",
  "nutrition",
];
