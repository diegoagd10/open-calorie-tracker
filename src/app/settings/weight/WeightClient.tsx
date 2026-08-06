"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  currentLocalDate,
  type UserSettings,
  type WeightEntry,
} from "@/lib/domain";
import styles from "../settings.module.css";

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    value,
  );
}

function Chart({ entries, targetWeight }: { entries: WeightEntry[]; targetWeight: number | null }) {
  const width = Math.max(520, entries.length * 92);
  const height = 230;
  const padding = { top: 26, right: 24, bottom: 34, left: 38 };
  const values = entries.map((entry) => entry.weightLb);
  if (targetWeight !== null) values.push(targetWeight);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const spread = Math.max(rawMax - rawMin, 4);
  const min = rawMin - spread * 0.15;
  const max = rawMax + spread * 0.15;
  const x = (index: number) =>
    entries.length <= 1
      ? width / 2
      : padding.left + (index / (entries.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) =>
    padding.top + ((max - value) / (max - min)) * (height - padding.top - padding.bottom);
  const points = entries.map((entry, index) => `${x(index)},${y(entry.weightLb)}`).join(" ");

  return (
    <div className={styles.chartScroll}>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          entries.length
            ? `Weight trend from ${entries[0].weightLb} to ${entries[entries.length - 1].weightLb} pounds`
            : "Weight trend is empty"
        }
      >
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="var(--line-strong)" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="var(--line-strong)" />
        {targetWeight !== null && (
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={y(targetWeight)}
            y2={y(targetWeight)}
            stroke="var(--accent)"
            strokeDasharray="5 5"
          />
        )}
        {entries.length > 1 && (
          <polyline points={points} fill="none" stroke="var(--foreground)" strokeWidth="2.5" />
        )}
        {entries.map((entry, index) => (
          <g key={entry.date}>
            <circle cx={x(index)} cy={y(entry.weightLb)} r="4.5" fill="var(--accent)" />
            <text x={x(index)} y={height - 13} textAnchor="middle" fill="var(--quiet)" fontSize="10">
              {entry.date.slice(5)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function WeightClient() {
  const today = currentLocalDate();
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/v1/weights", { signal: controller.signal }),
      fetch("/api/v1/settings", { signal: controller.signal }),
    ])
      .then(async ([weightsResponse, settingsResponse]) => {
        const weightsBody = await weightsResponse.json();
        const settingsBody = await settingsResponse.json();
        if (!weightsResponse.ok) throw new Error(weightsBody.error ?? "Could not load weights");
        if (!settingsResponse.ok) throw new Error(settingsBody.error ?? "Could not load settings");
        setEntries(weightsBody.entries);
        const nextSettings = settingsBody.settings;
        setSettings(nextSettings);
        setTargetWeight(nextSettings?.targetWeightLb == null ? "" : String(nextSettings.targetWeightLb));
      })
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, []);

  async function saveWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/v1/weights", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, weightLb: Number(weight) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save weight");
      setEntries((current) => {
        const next = current.filter((entry) => entry.date !== body.date);
        return [...next, body].sort((a, b) => a.date.localeCompare(b.date));
      });
      setNotice(`Weight for ${date} saved. Same-date entries replace the previous value.`);
      setWeight("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save weight");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetWeightLb: targetWeight === "" ? null : Number(targetWeight) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save target weight");
      setSettings(body.settings);
      setNotice(body.settings.targetWeightLb == null ? "Target weight removed." : "Target weight updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save target weight");
    } finally {
      setIsSaving(false);
    }
  }

  const current = entries.at(-1);
  const distance =
    current && settings?.targetWeightLb != null
      ? current.weightLb - settings.targetWeightLb
      : null;

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Weight</h1>
            <p>
              Keep one canonical reading per date. The line is a record of change,
              not a judgment about what the number should mean.
            </p>
          </div>
          <Link className={styles.backLink} href="/">
            Back to Daily Log
          </Link>
        </header>

        {isLoading ? (
          <p className={styles.empty} role="status">Loading your weight history…</p>
        ) : (
          <>
            <section className={styles.settingsPanel} aria-labelledby="record-weight-heading">
              <div className={styles.settingsHeading}>
                <div>
                  <h2 id="record-weight-heading">Record a reading</h2>
                  <p>Weights are stored in pounds and dated locally.</p>
                </div>
              </div>
              <form className={styles.weightForm} onSubmit={saveWeight}>
                <label>
                  Date
                  <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} required />
                </label>
                <label>
                  Weight
                  <input type="number" min="0.1" step="0.1" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="182.4" required />
                </label>
                <button className={styles.primaryButton} type="submit" disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save reading"}
                </button>
              </form>
            </section>

            <section className={styles.settingsPanel} aria-labelledby="target-weight-heading">
              <div className={styles.settingsHeading}>
                <div>
                  <h2 id="target-weight-heading">Optional target weight</h2>
                  <p>Set or clear one current target. It appears as a horizontal line on the chart.</p>
                </div>
              </div>
              <form className={styles.weightForm} onSubmit={saveTarget}>
                <label>
                  Target in pounds
                  <input type="number" min="0.1" step="0.1" inputMode="decimal" value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} placeholder="Optional" />
                </label>
                <button className={styles.secondaryButton} type="submit" disabled={isSaving}>
                  {isSaving ? "Saving…" : targetWeight === "" ? "Clear target" : "Save target"}
                </button>
              </form>
            </section>

            <section className={styles.settingsPanel} aria-labelledby="trend-heading">
              <div className={styles.chartHeading}>
                <div>
                  <h2 id="trend-heading">Progress over time</h2>
                  <p>{entries.length ? `${entries.length} dated reading${entries.length === 1 ? "" : "s"}` : "Your first reading will start the line."}</p>
                </div>
                {settings?.targetWeightLb != null && <span>Target line · {formatNumber(settings.targetWeightLb)} lb</span>}
              </div>
              {entries.length ? <Chart entries={entries} targetWeight={settings?.targetWeightLb ?? null} /> : <p className={styles.empty}>No weight readings yet.</p>}
              {current && distance != null && (
                <div className={styles.distanceLine}>
                  <span>Latest reading · {formatNumber(current.weightLb)} lb</span>
                  <strong>{distance === 0 ? "At target" : `${formatNumber(Math.abs(distance))} lb ${distance > 0 ? "above" : "below"} target`}</strong>
                </div>
              )}
            </section>
          </>
        )}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </div>
  );
}
