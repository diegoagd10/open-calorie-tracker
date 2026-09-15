import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogOutcome } from "./catalog-management.server";
import styles from "./notifications.module.css";

type CatalogNotification = Pick<CatalogOutcome, "provider" | "jobId" | "completedAt" | "phase" | "operation"> & Partial<Pick<CatalogOutcome, "acknowledgedAt">>;
type NotificationData = { outcomes: CatalogNotification[] };
const endpoint = "/catalog-notifications";
const duration = 6000;

function outcomeKey(outcome: CatalogNotification, viewerId: number) {
  return `catalog-toast:${viewerId}:${JSON.stringify([outcome.provider, outcome.jobId, outcome.completedAt, outcome.phase])}`;
}

function legacyOutcomeKey(outcome: CatalogNotification) {
  return `catalog-toast:${JSON.stringify([outcome.provider, outcome.jobId, outcome.completedAt, outcome.phase])}`;
}

function browserStorages() {
  const storages: Storage[] = [];
  try { storages.push(window.localStorage); }
  catch { /* Local storage can be disabled by browser privacy settings. */ }
  try { storages.push(window.sessionStorage); }
  catch { /* Session storage can be disabled independently. */ }
  return storages;
}

function storageHas(key: string) {
  for (const storage of browserStorages()) {
    try { if (storage.getItem(key) !== null) return true; }
    catch { /* Try the other browser storage before falling back to memory. */ }
  }
  return false;
}

function storeDisplayed(key: string) {
  for (const storage of browserStorages()) {
    try { storage.setItem(key, "displayed"); }
    catch { /* The other browser storage or in-memory set still deduplicates. */ }
  }
}

export function CatalogNotifications({ viewerId }: { viewerId: number }) {
  const [queue, setQueue] = useState<CatalogNotification[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const seen = useRef(new Set<string>());
  const current = queue[0];

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as NotificationData;
        if (controller.signal.aborted) return;
        const latestSuccessProviders = new Set<CatalogNotification["provider"]>();
        const candidates = data.outcomes.filter(outcome => {
          if (outcome.phase !== "succeeded") return true;
          if (latestSuccessProviders.has(outcome.provider)) return false;
          latestSuccessProviders.add(outcome.provider);
          return true;
        });
        const fresh = candidates.reverse().filter(outcome => {
          const key = outcomeKey(outcome, viewerId);
          if ((outcome.phase !== "succeeded" && outcome.acknowledgedAt) || seen.current.has(key) || storageHas(key) || storageHas(legacyOutcomeKey(outcome))) return false;
          seen.current.add(key);
          storeDisplayed(key);
          return true;
        });
        if (fresh.length) setQueue(previous => [...previous, ...fresh]);
      } catch {
        // Retry quietly: a connection problem is not a catalog update event.
      } finally { pending = false; }
    };
    const pollNow = () => { void poll(); };
    pollNow();
    const timer = setInterval(pollNow, 3000);
    window.addEventListener("online", pollNow);
    window.addEventListener("focus", pollNow);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("online", pollNow);
      window.removeEventListener("focus", pollNow);
    };
  }, [viewerId]);

  const dismiss = useCallback(() => {
    if (!current) return;
    storeDisplayed(outcomeKey(current, viewerId));
    setQueue(previous => previous.slice(1));
    setHovered(false);
    setFocused(false);
    setLeaving(false);
  }, [current, viewerId]);

  useEffect(() => {
    setLeaving(false);
    if (!current || hovered || focused) return;
    const fade = setTimeout(() => setLeaving(true), duration - 180);
    const timer = setTimeout(dismiss, duration);
    return () => { clearTimeout(fade); clearTimeout(timer); };
  }, [current, dismiss, hovered, focused]);

  const name = current?.provider === "usda-fdc" ? "USDA Foundation" : "Open Food Facts";
  const message = current?.phase === "succeeded" ? `${name} catalog ${current.operation === "install" ? "installed" : "updated"}.`
    : current?.phase === "interrupted" ? `${name} import interrupted. Inspect the terminal and retry the command.`
      : `${name} import failed. Inspect the terminal and retry the command.`;

  return <div className={styles.region} role={current ? "status" : undefined} aria-live="polite" aria-atomic="true">
    {current ? <div
      key={outcomeKey(current, viewerId)}
      className={styles.toast}
      data-phase={current.phase}
      data-leaving={leaving}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {current.phase === "succeeded" ? <path d="m6 12 4 4 8-8" /> : <><path d="M12 7v6" /><path d="M12 17h.01" /></>}
        </svg>
      </span>
      <p>{message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={dismiss}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </div> : null}
  </div>;
}
