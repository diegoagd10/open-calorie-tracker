import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenFoodFactsProduct } from "../src/adapters/open-food-facts.js";

test("Open Food Facts lookup normalization renders trail mix serving values", () => {
  const candidate = normalizeOpenFoodFactsProduct({
    code: "078742231587",
    product_name: "Trail mix",
    nutrition_data_per: "serving",
    serving_size: "40 g",
    nutriments: {
      "energy-kcal_serving": 184,
      proteins_serving: 13,
      sodium_serving: 0.14,
      sodium_unit: "g",
      "vitamin-a_serving": 1.04,
      "vitamin-a_unit": "mg",
    },
  });
  assert.equal(candidate.nutrients.calories, 184);
  assert.equal(candidate.nutrients.protein, 13);
  assert.equal(candidate.nutrients.sodium, 140);
  assert.equal(candidate.complete, true);
});
