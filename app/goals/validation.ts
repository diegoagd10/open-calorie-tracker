import { parseIsoLocalDate } from "../food-log/date";
import {
  validateSetupFields,
  WATER_UNIT_OPTIONS,
  type DisplayUnits,
  type SetupFields,
} from "../setup/validation";
import type { GoalReplacement } from "./goal-version.server";

export type GoalVersionFields = Omit<SetupFields, "timeZone"> & {
  effectiveDate: string;
};

export type GoalVersionValidationResult =
  | {
      data: GoalReplacement & { effectiveDate: string };
      success: true;
    }
  | { error: string; field: keyof GoalVersionFields; success: false };

type CanonicalGoal = {
  calorieTargetMilliKcal: number;
  carbohydrateTargetMilligrams: number;
  effectiveDate: string;
  fatTargetMilligrams: number;
  fiberTargetMilligrams: number;
  proteinTargetMilligrams: number;
  sodiumMaximumMilligrams: number;
  sugarMaximumMilligrams: number;
  waterTargetMicroliters: number;
};

function formatThousandths(value: number | bigint): string {
  const fixedPoint = BigInt(value);
  const whole = fixedPoint / 1_000n;
  const fraction = String(fixedPoint % 1_000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function goalFieldsFromCanonical(
  goal: CanonicalGoal,
  displayUnits: DisplayUnits,
): Omit<GoalVersionFields, "displayUnits"> {
  const waterThousandths =
    displayUnits === "metric"
      ? BigInt(goal.waterTargetMicroliters)
      : roundDivide(
          BigInt(goal.waterTargetMicroliters) *
            WATER_UNIT_OPTIONS.us.canonicalDenominator,
          WATER_UNIT_OPTIONS.us.canonicalNumerator,
        );

  return {
    calories: formatThousandths(goal.calorieTargetMilliKcal),
    carbohydrate: formatThousandths(goal.carbohydrateTargetMilligrams),
    effectiveDate: goal.effectiveDate,
    fat: formatThousandths(goal.fatTargetMilligrams),
    fiber: formatThousandths(goal.fiberTargetMilligrams),
    protein: formatThousandths(goal.proteinTargetMilligrams),
    sodium: String(goal.sodiumMaximumMilligrams),
    sugar: formatThousandths(goal.sugarMaximumMilligrams),
    water: formatThousandths(waterThousandths),
  };
}

export function validateGoalVersionFields(
  fields: GoalVersionFields,
  timeZone: string,
): GoalVersionValidationResult {
  const effectiveDate = parseIsoLocalDate(fields.effectiveDate);
  if (!effectiveDate) {
    return {
      error: "Enter a valid effective date.",
      field: "effectiveDate",
      success: false,
    };
  }

  const setup = validateSetupFields({ ...fields, timeZone });
  if (!setup.success) {
    return {
      error: setup.error,
      field: setup.field === "timeZone" ? "effectiveDate" : setup.field,
      success: false,
    };
  }

  const { timeZone: _timeZone, ...replacement } = setup.data;
  return {
    data: { ...replacement, effectiveDate },
    success: true,
  };
}
