import { describe, expect, it } from "vitest";
import {
  aggregateFoodLogs,
  calculateTargetStatuses,
  fatLimitForCalories,
  normalizeProductDraft,
  normalizeFoodLogCreateInput,
  resolveTargetVersion,
  scaleNutrition,
  waterGlasses,
  type DailyTargetVersion,
} from "./domain";

const nutrition = {
  caloriesPerServingCal: 140,
  proteinPerServingG: 16,
  carbsPerServingG: 9,
  fatPerServingG: 0.5,
  fiberPerServingG: 0,
  sugarPerServingG: 6,
  sodiumPerServingMg: 65,
};

const target: DailyTargetVersion = {
  id: "target-1",
  effectiveDate: "2026-08-04",
  calorieMaximumCal: 1600,
  proteinMinimumG: 140,
  carbsMaximumG: 200,
  fiberMaximumG: 30,
  sugarMaximumG: 40,
  sodiumMaximumMg: 2300,
  waterMinimumFlOz: 64,
  fatRule: "calorie-30-percent",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

describe("Daily Intake domain", () => {
  it("trims product text and accepts decimal nutrition", () => {
    expect(
      normalizeProductDraft({
        name: "  Greek yogurt ",
        servingDescription: "  1 cup ",
        ...nutrition,
      }),
    ).toMatchObject({
      name: "Greek yogurt",
      servingDescription: "1 cup",
      fatPerServingG: 0.5,
    });
  });

  it("scales every nutrient for fractional servings", () => {
    expect(scaleNutrition(nutrition, 1.5)).toEqual({
      caloriesPerServingCal: 210,
      proteinPerServingG: 24,
      carbsPerServingG: 13.5,
      fatPerServingG: 0.75,
      fiberPerServingG: 0,
      sugarPerServingG: 9,
      sodiumPerServingMg: 97.5,
    });
  });

  it("aggregates independent snapshots instead of products", () => {
    expect(
      aggregateFoodLogs([
        { ...nutrition, quantity: 1 },
        { ...nutrition, quantity: 0.5 },
      ]),
    ).toEqual({
      caloriesCal: 210,
      proteinG: 24,
      carbsG: 13.5,
      fatG: 0.75,
      fiberG: 0,
      sugarG: 9,
      sodiumMg: 97.5,
    });
  });

  it("uses maximum and minimum semantics at the boundary", () => {
    const statuses = calculateTargetStatuses(
      {
        caloriesCal: 1600,
        proteinG: 140,
        carbsG: 200,
        fatG: fatLimitForCalories(1600),
        fiberG: 30,
        sugarG: 40,
        sodiumMg: 2300,
      },
      64,
      target,
    );
    expect(statuses.calories.status).toBe("within-limit");
    expect(statuses.protein.status).toBe("met");
    expect(statuses.fat.status).toBe("within-limit");
    expect(statuses.water.status).toBe("met");
  });

  it("resolves the latest target effective on or before a date", () => {
    const next = { ...target, id: "target-2", effectiveDate: "2026-08-05", calorieMaximumCal: 1800 };
    expect(resolveTargetVersion([next, target], "2026-08-04")?.id).toBe("target-1");
    expect(resolveTargetVersion([next, target], "2026-08-05")?.id).toBe("target-2");
  });

  it("rejects future food dates and converts ounces to glasses", () => {
    expect(() => normalizeFoodLogCreateInput({ productId: "p", date: "2026-08-06", quantity: 1 }, "2026-08-05")).toThrow("Future dates");
    expect(waterGlasses(16)).toBe(2);
  });
});
