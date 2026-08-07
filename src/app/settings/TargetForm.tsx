"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { fatLimitForCalories, type DailyTargetVersion } from "@/lib/domain";
import styles from "./settings.module.css";

type TargetDraft = {
  calorieMaximumCal: string;
  proteinMinimumG: string;
  carbsMaximumG: string;
  fiberMaximumG: string;
  sugarMaximumG: string;
  sodiumMaximumMg: string;
  waterMinimumFlOz: string;
};

type TargetTone = "calories" | "protein" | "carbs" | "fiber" | "sugar" | "sodium" | "water";

const FIELDS: Array<{
  key: keyof TargetDraft;
  label: string;
  unit: string;
  hint: string;
  tone: TargetTone;
}> = [
  {
    key: "calorieMaximumCal",
    label: "Calorie maximum",
    unit: "cal",
    hint: "A daily ceiling",
    tone: "calories",
  },
  {
    key: "proteinMinimumG",
    label: "Protein minimum",
    unit: "g",
    hint: "A daily floor",
    tone: "protein",
  },
  {
    key: "carbsMaximumG",
    label: "Carbohydrate maximum",
    unit: "g",
    hint: "A daily ceiling",
    tone: "carbs",
  },
  {
    key: "fiberMaximumG",
    label: "Fiber maximum",
    unit: "g",
    hint: "A daily ceiling",
    tone: "fiber",
  },
  {
    key: "sugarMaximumG",
    label: "Sugar maximum",
    unit: "g",
    hint: "A daily ceiling",
    tone: "sugar",
  },
  {
    key: "sodiumMaximumMg",
    label: "Sodium maximum",
    unit: "mg",
    hint: "A daily ceiling",
    tone: "sodium",
  },
  {
    key: "waterMinimumFlOz",
    label: "Water minimum",
    unit: "fl oz",
    hint: "A daily floor",
    tone: "water",
  },
];

function draftFromTarget(target: DailyTargetVersion | null): TargetDraft {
  return {
    calorieMaximumCal: target ? String(target.calorieMaximumCal) : "",
    proteinMinimumG: target ? String(target.proteinMinimumG) : "",
    carbsMaximumG: target ? String(target.carbsMaximumG) : "",
    fiberMaximumG: target ? String(target.fiberMaximumG) : "",
    sugarMaximumG: target ? String(target.sugarMaximumG) : "",
    sodiumMaximumMg: target ? String(target.sodiumMaximumMg) : "",
    waterMinimumFlOz: target ? String(target.waterMinimumFlOz) : "",
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

export default function TargetForm({
  existing,
  firstRun = false,
  onSaved,
}: {
  existing: DailyTargetVersion | null;
  firstRun?: boolean;
  onSaved?: (target: DailyTargetVersion) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => draftFromTarget(existing));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const calorieValue = Number(draft.calorieMaximumCal);
  const fatLimit =
    Number.isFinite(calorieValue) && calorieValue >= 0
      ? fatLimitForCalories(calorieValue)
      : null;

  function updateField(key: keyof TargetDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/v1/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save targets");
      onSaved?.(body.target);
      if (!onSaved) router.push("/");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save targets. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={styles.targetForm} onSubmit={save} noValidate>
      <div className={styles.formIntro}>
        <div>
          <h2>{firstRun ? "Set the boundaries for your day" : "Daily targets"}</h2>
          <p>
            {firstRun
              ? "Start with the numbers you want to compare against. You can change them later without rewriting past days."
              : "Saving creates a new version effective today. Past days keep the targets they used at the time."}
          </p>
        </div>
        <span className={styles.versionNote}>
          {existing ? `Current since ${existing.effectiveDate}` : "First version · today"}
        </span>
      </div>

      <div className={styles.targetGrid}>
        {FIELDS.map((field) => (
          <label className={`${styles.field} ${styles[`tone-${field.tone}`]}`} key={field.key}>
            <span>{field.label}</span>
            <div className={styles.inputWithUnit}>
              <input
                name={field.key}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={draft[field.key]}
                onChange={(event) => updateField(field.key, event.target.value)}
                required
                aria-describedby={`${field.key}-hint`}
              />
              <b>{field.unit}</b>
            </div>
            <small id={`${field.key}-hint`}>{field.hint}</small>
          </label>
        ))}
        <div className={`${styles.field} ${styles.readOnlyField} ${styles["tone-fat"]}`}>
          <span>Fat limit</span>
          <strong>{fatLimit === null ? "—" : `${formatNumber(fatLimit)} g`}</strong>
          <small>Read-only · 30% of calorie maximum ÷ 9</small>
        </div>
      </div>

      <div className={styles.formActions}>
        <p className={styles.formNote}>
          These are comparison thresholds, not medical advice or a safety rating.
        </p>
        <button className={styles.primaryButton} type="submit" disabled={isSaving}>
          {isSaving ? "Saving targets…" : firstRun ? "Save targets" : "Save new version"}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
