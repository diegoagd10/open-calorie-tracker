import { parseIsoLocalDate } from "../food-log/date";
import {
  validateSetupFields,
  WATER_UNIT_OPTIONS,
  waterTargetMicrolitersFromDisplay,
  DISPLAY_UNITS,
  type DisplayUnits,
  type SetupFields,
} from "../setup/validation";
import type {
  CanonicalGoalValues,
  GoalReplacement,
} from "./goal-version.server";

export type GoalVersionFields = Omit<SetupFields, "timeZone"> & {
  effectiveDate: string;
  waterSourceUnits?: string;
  waterSourceValue?: string;
};

export type GoalVersionValidationResult =
  | {
      data: GoalReplacement & { effectiveDate: string };
      success: true;
    }
  | { error: string; field: keyof GoalVersionFields; success: false };

type CanonicalGoal = CanonicalGoalValues & {
  effectiveDate: string;
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

function waterFieldFromCanonical(
  waterTargetMicroliters: number,
  displayUnits: DisplayUnits,
): string {
  const waterThousandths =
    displayUnits === "metric"
      ? BigInt(waterTargetMicroliters)
      : roundDivide(
          BigInt(waterTargetMicroliters) *
            WATER_UNIT_OPTIONS.us.canonicalDenominator,
          WATER_UNIT_OPTIONS.us.canonicalNumerator,
        );
  return formatThousandths(waterThousandths);
}

export function convertWaterDisplay(
  value: string,
  fromUnits: DisplayUnits,
  toUnits: DisplayUnits,
): string | undefined {
  const canonical = waterTargetMicrolitersFromDisplay(value, fromUnits);
  return canonical === undefined
    ? undefined
    : waterFieldFromCanonical(canonical, toUnits);
}

export function goalFieldsFromCanonical(
  goal: CanonicalGoal,
  displayUnits: DisplayUnits,
): Omit<GoalVersionFields, "displayUnits"> {
  return {
    calories: formatThousandths(goal.calorieTargetMilliKcal),
    carbohydrate: formatThousandths(goal.carbohydrateTargetMilligrams),
    effectiveDate: goal.effectiveDate,
    fat: formatThousandths(goal.fatTargetMilligrams),
    fiber: formatThousandths(goal.fiberTargetMilligrams),
    protein: formatThousandths(goal.proteinTargetMilligrams),
    sodium: String(goal.sodiumMaximumMilligrams),
    sugar: formatThousandths(goal.sugarMaximumMilligrams),
    water: waterFieldFromCanonical(
      goal.waterTargetMicroliters,
      displayUnits,
    ),
  };
}

export function validateGoalVersionFields(
  fields: GoalVersionFields,
  timeZone: string,
  sourceGoal?: CanonicalGoal,
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
  if (
    sourceGoal &&
    fields.water.trim() ===
      goalFieldsFromCanonical(sourceGoal, setup.data.displayUnits).water
  ) {
    replacement.waterTargetMicroliters = sourceGoal.waterTargetMicroliters;
  } else {
    const sourceUnits = DISPLAY_UNITS.find(
      (candidate) => candidate === fields.waterSourceUnits,
    );
    const sourceCanonical = sourceUnits
      ? waterTargetMicrolitersFromDisplay(
          fields.waterSourceValue ?? "",
          sourceUnits,
        )
      : undefined;
    if (
      sourceCanonical !== undefined &&
      fields.water.trim() ===
        waterFieldFromCanonical(sourceCanonical, setup.data.displayUnits)
    ) {
      replacement.waterTargetMicroliters = sourceCanonical;
    }
  }
  return {
    data: { ...replacement, effectiveDate },
    success: true,
  };
}
