import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateMaintenanceCalories,
  formatNutritionValue,
  parseQuantity,
  scaleNutrition,
  summarizeNutrition,
} from "../src/domain/nutrition.js";

test("quantity input normalizes decimals and mixed fractions", () => {
  assert.equal(parseQuantity("0.5", "serving").display, "1/2");
  assert.equal(parseQuantity("1.25", "cup").display, "1 1/4");
  assert.equal(parseQuantity("1 1/2", "item").value, 1.5);
});

test("scaling preserves unknown nutrients instead of turning them into zero", () => {
  const scaled = scaleNutrition({ calories: 184, protein: 13, sodium: null }, 0.5);
  assert.deepEqual(scaled, {
    calories: 92,
    protein: 6.5,
    carbohydrates: null,
    fat: null,
    fiber: null,
    addedSugar: null,
    sugar: null,
    saturatedFat: null,
    sodium: null,
  });
});

test("daily summary uses fixed ordering, full precision, and missing-data warnings", () => {
  const summary = summarizeNutrition([
    { calories: 100.4, protein: 1.25, sodium: null },
    { calories: 100.4, protein: 1.25, sodium: 120.6 },
  ]);
  assert.deepEqual(summary.nutrients.map((item) => item.label), [
    "Calories",
    "Protein",
    "Total carbohydrates",
    "Fat",
    "Fiber",
    "Added sugar",
    "Total sugar",
    "Saturated fat",
    "Sodium",
  ]);
  assert.equal(summary.nutrients[0].display, "201");
  assert.equal(summary.nutrients[1].display, "2.5");
  assert.equal(summary.nutrients[8].display, "121");
  assert.equal(summary.nutrients[8].missing, true);
  assert.equal(summary.hasMissingData, true);
});

test("display formatting rounds only at the final surface", () => {
  assert.equal(formatNutritionValue("calories", 184.6), "185");
  assert.equal(formatNutritionValue("protein", 13.04), "13.0");
  assert.equal(formatNutritionValue("sodium", 140.6), "141");
});

test("adult maintenance estimate follows the selected NASEM equation and activity", () => {
  const calories = estimateMaintenanceCalories({
    age: 30,
    sex: "female",
    heightCm: 165,
    weightKg: 65,
    activity: "Inactive",
  });
  assert.equal(Math.round(calories), 2080);
});
