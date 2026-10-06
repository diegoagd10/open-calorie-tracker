import { useEffect, useRef, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";

import type { CatalogFood, CatalogNutrientValue } from "../../catalog/food-catalog.server";
import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import type { FoodEventActionData, NutrientField } from "../food-event.model";
import { foodLogHref, type FOOD_EVENT_FETCHERS } from "../links";
import { NUTRIENT_FIELDS } from "../nutrition";

/** Form controls shared by the Add Food stages and the Food Event editor. */

/**
 * The keyed fetcher a Food Event form posts to `/food-events` with. Its refusal stays visible
 * while the form is mounted, and is cleared once the form closes so it never reappears later.
 */
export function useFoodEventFetcher(key: (typeof FOOD_EVENT_FETCHERS)[keyof typeof FOOD_EVENT_FETCHERS]) {
  const fetcher = useFetcher<FoodEventActionData>({ key });
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });
  useEffect(() => () => {
    if (latest.current.state === "idle") latest.current.reset();
  }, []);
  return fetcher;
}

export type NutrientFieldValues = Record<NutrientField, string>;

export function FoodNameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className={eventStyles.stackedField}>
    <span>Food name</span>
    <input maxLength={200} name="name" onChange={event => onChange(event.target.value)} required value={value} />
  </label>;
}

export function FoodNutritionInputs({
  fields,
  onChange,
  required,
}: {
  fields: NutrientFieldValues;
  onChange: (name: NutrientField, value: string) => void;
  required: (name: NutrientField) => boolean | undefined;
}) {
  return (
    <div className={eventStyles.editNutritionGrid}>
      {NUTRIENT_FIELDS.map(({ field, label, wholeMilligrams }) => (
        <label className={eventStyles.stackedField} key={field}>
          <span>{label}</span>
          <input
            inputMode="decimal"
            max={wholeMilligrams ? "9999999" : "999999.999"}
            min="0"
            name={field}
            onChange={(event) => onChange(field, event.target.value)}
            required={required(field)}
            step={wholeMilligrams ? "1" : "0.001"}
            type="number"
            value={fields[field]}
          />
        </label>
      ))}
    </div>
  );
}

/** A rejected save's message, then Cancel back to the day and the stage's submit button. */
export function FoodFormActions({ date, message, children }: { date: string; message?: string; children: ReactNode }) {
  return <>
    {message ? <p className={styles.catalogError} role="alert">{message}</p> : null}
    <div className={eventStyles.dialogActions}>
      <Link className={styles.secondaryButton} to={foodLogHref(date)}>Cancel</Link>
      {children}
    </div>
  </>;
}

/** A catalog food's nutrition for the chosen amount, before it is saved. */
export function NutritionPreview({
  carbohydrateLabel = "Carbohydrate",
  food,
  includeAdditional = false,
  multiplier,
}: {
  carbohydrateLabel?: string;
  food: CatalogFood;
  includeAdditional?: boolean;
  multiplier: number;
}) {
  const nutrition = food.nutritionPerAuthoritativeBase;
  const fields: Array<[string, CatalogNutrientValue | null, number, string]> = [
    ["Calories", nutrition.energyMilliKcal, 1_000, "kcal"],
    ["Protein", nutrition.proteinMilligrams, 1_000, "g"],
    [carbohydrateLabel, nutrition.carbohydrateMilligrams, 1_000, "g"],
    ["Fat", nutrition.fatMilligrams, 1_000, "g"],
  ];
  if (includeAdditional) {
    fields.push(
      ["Fiber", nutrition.fiberMilligrams, 1_000, "g"],
      ["Sugar", nutrition.sugarMilligrams, 1_000, "g"],
      ["Sodium", nutrition.sodiumMilligrams, 1, "mg"],
    );
  }
  return (
    <dl className={eventStyles.nutritionPreview}>
      {fields.map(([label, value, divisor, unit]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value === null
              ? "Not reported"
              : `${new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: 1,
                }).format(
                  (value.amount * value.fixedPointMultiplier * multiplier) /
                    divisor,
                )} ${unit}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FoodDetailSkeleton() {
  return (
    <div
      aria-label="Loading food details"
      aria-live="polite"
      className={eventStyles.foodDetailSkeleton}
      role="status"
    >
      <span className={eventStyles.pendingLabel}>Loading food details…</span>
      <div className={eventStyles.skeletonBackLink} />
      <div className={eventStyles.skeletonIdentity}>
        <span className={eventStyles.skeletonChip} />
        <span className={eventStyles.skeletonTitle} />
        <span className={eventStyles.skeletonText} />
      </div>
      <div className={eventStyles.skeletonNote} />
      <div className={eventStyles.skeletonFieldGrid}>
        <span className={eventStyles.skeletonField} />
        <span className={eventStyles.skeletonField} />
      </div>
      <div className={eventStyles.skeletonNutritionGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <span className={eventStyles.skeletonNutrition} key={index} />
        ))}
      </div>
      <div className={eventStyles.skeletonActions}>
        <span />
        <span />
      </div>
    </div>
  );
}

/** The provider attribution a catalog stage ends with. */
export function ProviderAttribution({ href, name }: { href: string; name: string }) {
  return (
    <p className={eventStyles.providerAttribution}>
      Food data from{" "}
      <a href={href} rel="noreferrer" target="_blank">{name}</a>
    </p>
  );
}
