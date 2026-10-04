import { formatOunceThousandths } from "../../water-event/water-event.utils";
import type { DailyGoalTargets } from "../daily-goal.model";
import styles from "./daily-goal-inputs.module.css";

/** What each goal input holds, keyed by the target it edits. */
export type DailyGoalInputValues = Record<keyof DailyGoalTargets, string>;

type FieldSpec = {
  name: keyof DailyGoalTargets;
  label: string;
  qualifier: "target" | "maximum";
  unit: string;
  max: string;
  /** Canonical units per typed unit; water is kept as fluid-ounce text. */
  scale: 1 | 1_000 | null;
};

const FIELDS: readonly FieldSpec[] = [
  { name: "calorieTarget", label: "Calories", qualifier: "target", unit: "kcal", max: "20000", scale: 1_000 },
  { name: "waterTarget", label: "Water", qualifier: "target", unit: "fl oz", max: "500", scale: null },
  { name: "proteinTarget", label: "Protein", qualifier: "target", unit: "g", max: "2000", scale: 1_000 },
  { name: "carbohydrateTarget", label: "Carbohydrate", qualifier: "target", unit: "g", max: "2000", scale: 1_000 },
  { name: "fatTarget", label: "Fat", qualifier: "target", unit: "g", max: "2000", scale: 1_000 },
  { name: "fiberTarget", label: "Fiber", qualifier: "target", unit: "g", max: "2000", scale: 1_000 },
  { name: "sugarMaximum", label: "Sugar", qualifier: "maximum", unit: "g", max: "2000", scale: 1_000 },
  { name: "sodiumMaximum", label: "Sodium", qualifier: "maximum", unit: "mg", max: "100000", scale: 1 },
];

/** Setup's suggested goal: 2,050 kcal and 80 fl oz of water. */
export const DAILY_GOAL_DEFAULTS: DailyGoalInputValues = {
  calorieTarget: "2050",
  waterTarget: "80",
  proteinTarget: "120",
  carbohydrateTarget: "230",
  fatTarget: "70",
  fiberTarget: "25",
  sugarMaximum: "50",
  sodiumMaximum: "2300",
};

/** The element that describes a rejected goal input. */
const DAILY_GOAL_ERROR_ID = "daily-goal-error";

/** The eight goal inputs; the rejected one is marked invalid and described by the error below them. */
export function DailyGoalInputs({ error, values }: {
  values: DailyGoalInputValues;
  error?: { field: keyof DailyGoalTargets; message: string };
}) {
  return (
    <>
      <div className={styles.goalGrid}>
        {FIELDS.map((field) => (
          <label key={field.name}>
            <span>
              {field.label} <small>{field.qualifier}</small>
            </span>
            <span className={styles.numberInput}>
              <input
                aria-describedby={error?.field === field.name ? DAILY_GOAL_ERROR_ID : undefined}
                aria-invalid={error?.field === field.name || undefined}
                defaultValue={values[field.name]}
                inputMode="decimal"
                max={field.max}
                min={field.scale === 1 ? "1" : "0.001"}
                name={field.name}
                required
                step={field.scale === 1 ? "1" : "0.001"}
                type="number"
              />
              <em>{field.unit}</em>
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p className={styles.error} id={DAILY_GOAL_ERROR_ID} role="alert">
          {error.message}
        </p>
      ) : null}
    </>
  );
}

const WHOLE_AMOUNT = /^(0|[1-9]\d*)$/;
const THOUSANDTHS_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/;

/** A typed amount in canonical units, such as `"2050"` kcal as 2,050,000, or NaN when it is unreadable. */
function canonicalNumber(value: string, scale: 1 | 1_000): number {
  const match = (scale === 1 ? WHOLE_AMOUNT : THOUSANDTHS_AMOUNT).exec(value.trim());
  if (!match) return Number.NaN;
  return Number(BigInt(match[1]) * BigInt(scale) + BigInt((match[2] ?? "").padEnd(3, "0")));
}

/** The submitted goal inputs as targets in canonical units; `DailyGoalService.save` validates them. */
export function dailyGoalTargetsFromForm(form: FormData): DailyGoalTargets {
  const targets = Object.fromEntries(FIELDS.map((field) => {
    const value = String(form.get(field.name) ?? "");
    return [field.name, field.scale === null ? value.trim() : canonicalNumber(value, field.scale)];
  }));
  return targets as DailyGoalTargets;
}

/** A saved goal as the values its inputs show. */
export function dailyGoalInputValues(goal: DailyGoalTargets): DailyGoalInputValues {
  const values = Object.fromEntries(FIELDS.map((field) => {
    const value = goal[field.name];
    return [field.name, field.scale === 1_000 ? formatOunceThousandths(BigInt(value)) : String(value)];
  }));
  return values as DailyGoalInputValues;
}
