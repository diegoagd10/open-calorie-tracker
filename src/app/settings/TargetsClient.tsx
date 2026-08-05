"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { currentLocalDate, type DailyTargetVersion } from "@/lib/domain";
import TargetForm from "./TargetForm";
import styles from "./settings.module.css";

export default function TargetsClient() {
  const [target, setTarget] = useState<DailyTargetVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/targets?date=${currentLocalDate()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load targets");
        setTarget(body.target);
      })
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Targets</h1>
            <p>
              Set the daily comparison points for calories, macros, sodium, and
              water. Your ledger keeps each version with the days it covered.
            </p>
          </div>
          <Link className={styles.backLink} href="/">
            Back to Daily Log
          </Link>
        </header>
        {isLoading ? (
          <p className={styles.empty} role="status">
            Loading your target history…
          </p>
        ) : error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          <TargetForm
            key={target?.id ?? "first-target"}
            existing={target}
            firstRun={!target}
            onSaved={setTarget}
          />
        )}
      </div>
    </div>
  );
}
