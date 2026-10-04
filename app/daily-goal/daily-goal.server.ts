import { formatOunceThousandths, ounceThousandths } from "../water-event/water-event.utils";
import type { DailyGoal, DailyGoalTargets } from "./daily-goal.model";
import type { DailyGoalRepository } from "./daily-goal.repository.server";
import { DailyGoalValidationError } from "./daily-goal.exceptions";
import { DAILY_GOAL_MAXIMUMS } from "./daily-goal.utils";

/** The message shown when a target is outside its accepted range. */
const DAILY_GOAL_ERRORS: Record<keyof DailyGoalTargets, string> = {
  calorieTarget: "Calories must be from 0.001 to 20,000 kcal.",
  waterTarget: "Water must be from 0.001 to 500 fl oz.",
  proteinTarget: "Protein must be from 0.001 to 2,000 g.",
  carbohydrateTarget: "Carbohydrate must be from 0.001 to 2,000 g.",
  fatTarget: "Fat must be from 0.001 to 2,000 g.",
  fiberTarget: "Fiber must be from 0.001 to 2,000 g.",
  sugarMaximum: "Sugar maximum must be from 0.001 to 2,000 g.",
  sodiumMaximum: "Sodium maximum must be from 1 to 100,000 mg.",
};

/** Every target in form order, so the first rejected one is the first the account holder sees. */
const TARGET_FIELDS = Object.keys(DAILY_GOAL_MAXIMUMS) as (keyof DailyGoalTargets)[];

/** A target in its canonical integer unit; water counts thousandths of a fluid ounce. */
function canonicalAmount(targets: DailyGoalTargets, field: keyof DailyGoalTargets): number | bigint | null {
  const value = targets[field];
  if (field === "waterTarget") return typeof value === "string" ? ounceThousandths(value) : null;
  return Number.isSafeInteger(value) ? (value as number) : null;
}

/** The targets in canonical form; throws for the first one outside its range. */
function validTargets(targets: DailyGoalTargets): DailyGoalTargets {
  for (const field of TARGET_FIELDS) {
    const amount = canonicalAmount(targets, field);
    if (amount === null || amount < 1 || amount > DAILY_GOAL_MAXIMUMS[field]) {
      throw new DailyGoalValidationError(field, DAILY_GOAL_ERRORS[field]);
    }
  }
  const water = ounceThousandths(targets.waterTarget)!;
  return {
    calorieTarget: targets.calorieTarget,
    waterTarget: formatOunceThousandths(water),
    proteinTarget: targets.proteinTarget,
    carbohydrateTarget: targets.carbohydrateTarget,
    fatTarget: targets.fatTarget,
    fiberTarget: targets.fiberTarget,
    sugarMaximum: targets.sugarMaximum,
    sodiumMaximum: targets.sodiumMaximum,
  };
}

/** The account's one Daily Goal, shared by Setup, Settings, the Food Log, REST, and MCP. */
export class DailyGoalService {
  readonly #repository: DailyGoalRepository;

  constructor(repository: DailyGoalRepository) {
    this.#repository = repository;
  }

  /** The account's goal, or null until Setup saves its first one. */
  read(userId: number): DailyGoal | null {
    return this.#repository.find(userId);
  }

  /** Creates or replaces the account's goal; throws `DailyGoalValidationError` for a target out of range. */
  save(userId: number, targets: DailyGoalTargets): DailyGoal {
    return this.#repository.save(userId, validTargets(targets));
  }
}
