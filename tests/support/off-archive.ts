import { gzipSync } from "node:zlib";

export const offProduct = {
  code: "0012345678905", product_name: 'Oats\twith "bran"', brands: "Example", countries: "United States",
  quantity: "500 g", product_quantity: "500", serving_size: "30 g", serving_quantity: "30",
  created_t: "1704067200", last_modified_t: "1735689600", no_nutrition_data: "",
  "energy-kcal_100g": "400", proteins_100g: "10", carbohydrates_100g: "60", fat_100g: "12", fiber_100g: "0", sugars_100g: "", sodium_100g: "0.01",
};
export function offArchive(rows: Record<string, string>[] = [offProduct], extraRows: string[] = []) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return gzipSync([columns.join("\t"), ...rows.map(row => columns.map(key => quote(row[key] ?? "")).join("\t")), ...extraRows].join("\n") + "\n");
}

// OFF's explicit nutrition input-set CSV projection, separate from ambiguous legacy _100g columns.
export function offWithBasis(per: "100g" | "100ml" | "serving", code = offProduct.code): Record<string, string> {
  const prefix = `nutrition.input_sets.packaging.as_sold.${per}.nutrients.`;
  return { ...offProduct, code, ...Object.fromEntries(Object.entries({ "energy-kcal": [400, "kcal"], proteins: [10, "g"], carbohydrates: [60, "g"], fat: [12, "g"], fiber: [0, "g"], sodium: [10, "mg"] }).flatMap(([name, [value, unit]]) => [[`${prefix}${name}.value`, String(value)], [`${prefix}${name}.unit`, String(unit)]])) };
}
