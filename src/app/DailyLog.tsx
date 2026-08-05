"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  aggregateFoodLogs,
  currentLocalDate,
  scaleNutrition,
  waterGlasses,
  type DailyNutritionTotals,
  type DailyTargetStatuses,
  type DailyTargetVersion,
  type FoodLogEntry,
  type NutrientKey,
} from "@/lib/domain";
import TargetForm from "@/app/settings/TargetForm";
import styles from "./daily-log.module.css";

type DaySummary = {
  date: string;
  entries: FoodLogEntry[];
  totals: DailyNutritionTotals;
  water: { date: string; totalFluidOz: number; updatedAt: string };
  target: DailyTargetVersion | null;
  statuses: DailyTargetStatuses | null;
};

type SnapshotDraft = {
  titleSnapshot: string;
  servingDescriptionSnapshot: string;
  quantity: string;
} & Record<NutrientKey, string>;

const FOOD_NUTRIENTS: Array<{
  key: NutrientKey;
  totalKey: keyof ReturnType<typeof aggregateFoodLogs>;
  label: string;
  unit: string;
}> = [
  { key: "caloriesPerServingCal", totalKey: "caloriesCal", label: "Calories", unit: "cal" },
  { key: "proteinPerServingG", totalKey: "proteinG", label: "Protein", unit: "g" },
  { key: "carbsPerServingG", totalKey: "carbsG", label: "Carbs", unit: "g" },
  { key: "fatPerServingG", totalKey: "fatG", label: "Fat", unit: "g" },
  { key: "fiberPerServingG", totalKey: "fiberG", label: "Fiber", unit: "g" },
  { key: "sugarPerServingG", totalKey: "sugarG", label: "Sugar", unit: "g" },
  { key: "sodiumPerServingMg", totalKey: "sodiumMg", label: "Sodium", unit: "mg" },
];

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function snapshotDraftFromEntry(entry: FoodLogEntry): SnapshotDraft {
  return {
    titleSnapshot: entry.titleSnapshot,
    servingDescriptionSnapshot: entry.servingDescriptionSnapshot,
    quantity: String(entry.quantity),
    caloriesPerServingCal: String(entry.caloriesPerServingCal),
    proteinPerServingG: String(entry.proteinPerServingG),
    carbsPerServingG: String(entry.carbsPerServingG),
    fatPerServingG: String(entry.fatPerServingG),
    fiberPerServingG: String(entry.fiberPerServingG),
    sugarPerServingG: String(entry.sugarPerServingG),
    sodiumPerServingMg: String(entry.sodiumPerServingMg),
  };
}

async function loadDay(date: string, signal?: AbortSignal): Promise<DaySummary> {
  const response = await fetch(`/api/v1/day?date=${date}`, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load this day");
  return body;
}

function statusLabel(status: string): string {
  return status.replace("-", " ");
}

function MetricStatus({ status }: { status: string }) {
  return <span className={`${styles.status} ${styles[`status-${status}`]}`}>{statusLabel(status)}</span>;
}

function SnapshotEditor({
  entry,
  onCancel,
  onSaved,
}: {
  entry: FoodLogEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => snapshotDraftFromEntry(entry));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function update(field: keyof SnapshotDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/food-log/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleSnapshot: draft.titleSnapshot,
          servingDescriptionSnapshot: draft.servingDescriptionSnapshot,
          quantity: draft.quantity,
          ...Object.fromEntries(
            FOOD_NUTRIENTS.map((nutrient) => [nutrient.key, draft[nutrient.key]]),
          ),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update this entry");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update this entry");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={styles.editor} onSubmit={save} noValidate>
      <div className={styles.editorHeading}>
        <div>
          <span>Editing saved snapshot</span>
          <strong>{entry.titleSnapshot}</strong>
        </div>
        <button className={styles.textButton} type="button" onClick={onCancel}>Cancel</button>
      </div>
      <div className={styles.editorGrid}>
        <label>Food title<input value={draft.titleSnapshot} onChange={(event) => update("titleSnapshot", event.target.value)} required /></label>
        <label>Serving description<input value={draft.servingDescriptionSnapshot} onChange={(event) => update("servingDescriptionSnapshot", event.target.value)} required /></label>
        <label>Quantity<input type="number" min="0.01" step="any" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} required /></label>
        {FOOD_NUTRIENTS.map((nutrient) => (
          <label key={nutrient.key}>{nutrient.label} / serving ({nutrient.unit})<input type="number" min="0" step="any" value={draft[nutrient.key]} onChange={(event) => update(nutrient.key, event.target.value)} required /></label>
        ))}
      </div>
      <div className={styles.editorActions}>
        <button className={styles.primaryButton} type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save entry"}</button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}

export default function DailyLog({ initialDate }: { initialDate?: string }) {
  const today = currentLocalDate();
  const [date, setDate] = useState(() => initialDate ?? today);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualWater, setManualWater] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    loadDay(date, controller.signal)
      .then(setSummary)
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [date]);

  function selectDate(value: string) {
    if (!value || value > today) {
      setError("Choose today or a past date. Future dates are not available.");
      return;
    }
    setNotice("");
    setError("");
    setIsLoading(true);
    setSummary(null);
    setDate(value);
  }

  async function refresh() {
    setSummary(await loadDay(date));
  }

  async function addWater(amount: number) {
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/water?date=${date}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update water");
      await refresh();
      setNotice(`${formatNumber(amount, 0)} fl oz added to ${formatDate(date)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update water");
    } finally {
      setIsSaving(false);
    }
  }

  async function addManualWater(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(manualWater);
    await addWater(amount);
    setManualWater("");
  }

  async function deleteEntry(entry: FoodLogEntry) {
    if (!window.confirm(`Delete ${entry.titleSnapshot} from this day?`)) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/food-log/${entry.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete this entry");
      await refresh();
      setNotice("The saved snapshot was removed from this day.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this entry");
    } finally {
      setIsSaving(false);
    }
  }

  const target = summary?.target;
  const statuses = summary?.statuses;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{target ? "Build the day you can see" : "Start with your daily boundaries"}</h1>
          <p className={styles.lede}>
            {target
              ? "Food entries become independent snapshots. Water stays on its own line. Past dates remain editable without changing the catalog."
              : "Before the ledger can evaluate your intake, enter the daily comparison points that make sense for you."}
          </p>
        </div>
        <div className={styles.dayPicker}>
          <label htmlFor="selected-date">Selected date</label>
          <input id="selected-date" type="date" value={date} max={today} onChange={(event) => selectDate(event.target.value)} />
          <span>{date === today ? "Today" : date > today ? "Unavailable" : "Past day"}</span>
        </div>
      </header>

      {isLoading ? (
        <p className={styles.statusMessage} role="status">Loading your day…</p>
      ) : error && !summary ? (
        <p className={styles.errorMessage} role="alert">{error}</p>
      ) : !target ? (
        <TargetForm
          key="first-run-targets"
          existing={null}
          firstRun
          onSaved={() => {
            loadDay(date).then(setSummary).catch((loadError: Error) => setError(loadError.message));
          }}
        />
      ) : summary ? (
        <>
          <section className={styles.summaryBoard} aria-labelledby="daily-total-heading">
            <div className={styles.totalLead}>
              <span className={styles.leadLabel}>{formatDate(date)}</span>
              <strong id="daily-total-heading">{formatNumber(summary.totals.caloriesCal, 0)}</strong>
              <span>cal logged</span>
              <small>{formatNumber(target.calorieMaximumCal, 0)} cal maximum</small>
            </div>
            <div className={styles.nutrientGrid}>
              {FOOD_NUTRIENTS.slice(1).map((nutrient) => {
                const metric = statuses?.[nutrient.label.toLowerCase() as keyof typeof statuses];
                return (
                  <div key={nutrient.key}>
                    <span>{nutrient.label}</span>
                    <strong>{formatNumber(summary.totals[nutrient.totalKey])} {nutrient.unit}</strong>
                    {metric && <MetricStatus status={metric.status} />}
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.targetStrip} aria-label="Target status">
            <div><span>Calories</span><strong>{formatNumber(summary.totals.caloriesCal, 0)} / {formatNumber(target.calorieMaximumCal, 0)} cal</strong><MetricStatus status={statuses?.calories.status ?? "within-limit"} /></div>
            <div><span>Protein</span><strong>{formatNumber(summary.totals.proteinG)} / {formatNumber(target.proteinMinimumG)} g</strong><MetricStatus status={statuses?.protein.status ?? "below-target"} /></div>
            <div><span>Carbs</span><strong>{formatNumber(summary.totals.carbsG)} / {formatNumber(target.carbsMaximumG)} g</strong><MetricStatus status={statuses?.carbs.status ?? "within-limit"} /></div>
            <div><span>Fiber</span><strong>{formatNumber(summary.totals.fiberG)} / {formatNumber(target.fiberMaximumG)} g</strong><MetricStatus status={statuses?.fiber.status ?? "within-limit"} /></div>
            <div><span>Sugar</span><strong>{formatNumber(summary.totals.sugarG)} / {formatNumber(target.sugarMaximumG)} g</strong><MetricStatus status={statuses?.sugar.status ?? "within-limit"} /></div>
            <div><span>Sodium</span><strong>{formatNumber(summary.totals.sodiumMg)} / {formatNumber(target.sodiumMaximumMg)} mg</strong><MetricStatus status={statuses?.sodium.status ?? "within-limit"} /></div>
          </section>

          <section className={styles.waterBoard} aria-labelledby="water-heading">
            <div>
              <h2 id="water-heading">Water, kept separate</h2>
              <p>Stored in fluid ounces. One glass is 8 fl oz; one bottle is 16 fl oz.</p>
            </div>
            <div className={styles.waterReadout}>
              <strong>{formatNumber(summary.water.totalFluidOz)}</strong>
              <span>fl oz · {formatNumber(waterGlasses(summary.water.totalFluidOz))} glasses</span>
              <small>Minimum {formatNumber(target.waterMinimumFlOz)} fl oz</small>
              {statuses?.water && <MetricStatus status={statuses.water.status} />}
            </div>
            <div className={styles.waterActions}>
              <button type="button" onClick={() => addWater(8)} disabled={isSaving}>Add glass <span>+8 fl oz</span></button>
              <button type="button" onClick={() => addWater(16)} disabled={isSaving}>Add bottle <span>+16 fl oz</span></button>
              <form onSubmit={addManualWater}>
                <label htmlFor="manual-water">Manual amount</label>
                <div><input id="manual-water" type="number" min="0.01" step="any" inputMode="decimal" value={manualWater} onChange={(event) => setManualWater(event.target.value)} placeholder="12" required /><button type="submit" disabled={isSaving}>Add</button></div>
              </form>
            </div>
          </section>

          <section className={styles.logBoard} aria-labelledby="food-log-heading">
            <div className={styles.sectionHeading}>
              <div><h2 id="food-log-heading">Food log</h2><p>{summary.entries.length ? `${summary.entries.length} independent snapshot${summary.entries.length === 1 ? "" : "s"}` : "Nothing recorded for this date"}</p></div>
              <Link className={styles.primaryButton} href={`/foods?date=${date}`}>+ Add food</Link>
            </div>
            {summary.entries.length === 0 ? (
              <div className={styles.empty}><strong>This day is clear.</strong><span>Choose a saved product or create one in the Food Database.</span></div>
            ) : (
              <ol className={styles.entryList}>
                {summary.entries.map((entry) => {
                  const totals = scaleNutrition({
                    caloriesPerServingCal: entry.caloriesPerServingCal,
                    proteinPerServingG: entry.proteinPerServingG,
                    carbsPerServingG: entry.carbsPerServingG,
                    fatPerServingG: entry.fatPerServingG,
                    fiberPerServingG: entry.fiberPerServingG,
                    sugarPerServingG: entry.sugarPerServingG,
                    sodiumPerServingMg: entry.sodiumPerServingMg,
                  }, entry.quantity);
                  return (
                    <li key={entry.id} className={styles.entry}>
                      {editingId === entry.id ? (
                        <SnapshotEditor entry={entry} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); refresh().catch((loadError: Error) => setError(loadError.message)); }} />
                      ) : (
                        <div className={styles.entryRow}>
                          <div className={styles.entryMain}><strong>{entry.titleSnapshot}</strong><span>{formatNumber(entry.quantity)} {entry.quantity === 1 ? "serving" : "servings"} · {entry.servingDescriptionSnapshot}</span></div>
                          <div className={styles.entryTotal}><strong>{formatNumber(totals.caloriesPerServingCal, 0)} cal</strong><span>{formatNumber(totals.proteinPerServingG)} g protein</span></div>
                          <div className={styles.entryActions}><button type="button" onClick={() => setEditingId(entry.id)}>Edit</button><button type="button" onClick={() => deleteEntry(entry)} disabled={isSaving}>Delete</button></div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      ) : null}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && summary && <p className={styles.errorMessage} role="alert">{error}</p>}
    </div>
  );
}
