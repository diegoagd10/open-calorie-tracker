"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./page.module.css";

type Entry = {
  id: number;
  name: string;
  calories: number;
  date: string;
};

type DaySummary = {
  entries: Entry[];
  total: number;
};

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export default function Home() {
  const [date, setDate] = useState(localDate);
  const [summary, setSummary] = useState<DaySummary>({ entries: [], total: 0 });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    fetch(`/api/entries?date=${date}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load this day");
        const nextSummary = await response.json();
        if (isActive) setSummary(nextSummary);
      })
      .catch((requestError: Error) => {
        if (isActive && requestError.name !== "AbortError") {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [date]);

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");

    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          calories: Number(data.get("calories")),
          date,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Could not save this entry");
        return;
      }

      setSummary((current) => ({
        entries: [result, ...current.entries],
        total: current.total + result.calories,
      }));
      form.reset();
    } catch {
      setError("Could not reach the calorie log. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.mark} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>Daily Intake</p>
        <span className={styles.headerNote}>A simple food ledger</span>
      </header>

      <section className={styles.board}>
        <div className={styles.summary}>
          <label htmlFor="entry-date">Calories for</label>
          <input
            id="entry-date"
            type="date"
            value={date}
            disabled={isSaving}
            onChange={(event) => {
              setDate(event.target.value);
              setSummary({ entries: [], total: 0 });
              setIsLoading(true);
              setError("");
            }}
            aria-label="Day to view"
          />
          <div className={styles.total} aria-live="polite">
            <strong>{summary.total.toLocaleString()}</strong>
            <span>kcal</span>
          </div>
          <p>
            {summary.entries.length === 1
              ? "1 food recorded"
              : `${summary.entries.length} foods recorded`}
          </p>
        </div>

        <form className={styles.form} onSubmit={addEntry}>
          <h1>What did you eat?</h1>
          <p>Log one item at a time. Your daily total updates as you go.</p>

          <label htmlFor="food-name">Food</label>
          <input
            id="food-name"
            name="name"
            type="text"
            placeholder="e.g. Greek yogurt"
            autoComplete="off"
            required
          />

          <label htmlFor="food-calories">Calories</label>
          <div className={styles.calorieInput}>
            <input
              id="food-calories"
              name="calories"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="140"
              required
            />
            <span>kcal</span>
          </div>

          <button type="submit" disabled={isSaving || isLoading || !date}>
            {isSaving ? "Adding…" : "Add entry"}
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>

        <div className={styles.log}>
          <div className={styles.logHeading}>
            <h2>Food log</h2>
            <span>Newest first</span>
          </div>

          {isLoading ? (
            <p className={styles.status} role="status">
              Loading your day…
            </p>
          ) : summary.entries.length === 0 ? (
            <div className={styles.empty}>
              <p>No food recorded for this day.</p>
              <span>Add your first item above to start the ledger.</span>
            </div>
          ) : (
            <ol>
              {summary.entries.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.name}</span>
                  <strong>{entry.calories.toLocaleString()} kcal</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}
