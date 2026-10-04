import type { DailyGoalTargets } from "./daily-goal.model";

/**
 * The largest accepted value of each target in its canonical unit: 20,000 kcal, 2,000 g of each
 * nutrient, 100,000 mg of sodium, and 500 fl oz of water in thousandths.
 */
export const DAILY_GOAL_MAXIMUMS: Record<keyof DailyGoalTargets, number> = {
  calorieTarget: 20_000_000,
  waterTarget: 500_000,
  proteinTarget: 2_000_000,
  carbohydrateTarget: 2_000_000,
  fatTarget: 2_000_000,
  fiberTarget: 2_000_000,
  sugarMaximum: 2_000_000,
  sodiumMaximum: 100_000,
};
