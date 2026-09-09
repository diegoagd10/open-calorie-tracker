import { useCallback, useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { CatalogOutcome } from "./catalog-management.server";
import styles from "./notifications.module.css";

type NotificationData = { csrfToken: string; outcomes: CatalogOutcome[] };
const endpoint = "/catalog-notifications";

function Outcome({ outcome, csrfToken, onAcknowledged }: { outcome: CatalogOutcome; csrfToken: string; onAcknowledged: () => void }) {
  const acknowledgement = useFetcher<{ error?: string; acknowledged?: boolean }>();
  useEffect(() => { if (acknowledgement.data?.acknowledged) onAcknowledged(); }, [acknowledgement.data, onAcknowledged]);
  const name = outcome.provider === "usda-fdc" ? "USDA" : "Open Food Facts";
  const installed = outcome.installed;
  const succeeded = outcome.phase === "succeeded";
  const activeDescription = !installed ? "No catalog was active at completion."
    : installed.generation === outcome.jobId ? "The replacement catalog is active."
      : "The previous catalog remains active.";
  return <li className={styles.outcome}>
    <h3>{name} update {outcome.phase}</h3>
    <p>{outcome.filename} · {new Date(outcome.completedAt).toLocaleString()}</p>
    <p>{succeeded ? "This snapshot activated successfully." : activeDescription}</p>
    {outcome.error ? <p>{outcome.error}</p> : null}
    {installed ? <details><summary>{succeeded ? "Installed snapshot" : "Active snapshot at completion"}: {installed.filename}</summary>
      <p>{installed.foodCount.toLocaleString()} foods · Installed {new Date(installed.installedAt).toLocaleString()}</p>
      {installed.sourceRelease ? <p>Official release: {installed.sourceRelease.identifier ?? installed.sourceRelease.releasePeriod}</p> : null}
      <p>SHA-256: {installed.sha256}</p>
    </details> : null}
    <Link to={`/settings/catalogs#${outcome.provider}-heading`}>Manage {name} catalog</Link>
    {outcome.acknowledgedAt ? <p>Acknowledged</p> : <acknowledgement.Form method="post" action={endpoint}>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="provider" value={outcome.provider} />
      <input type="hidden" name="jobId" value={outcome.jobId} />
      <input type="hidden" name="completedAt" value={outcome.completedAt} />
      <button disabled={acknowledgement.state !== "idle"}>Acknowledge {name} update</button>
    </acknowledgement.Form>}
    {acknowledgement.data?.error ? <p role="alert">{acknowledgement.data.error}</p> : null}
  </li>;
}

function useNotifications() {
  const [data, setData] = useState<NotificationData>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Notifications unavailable");
        const next = await response.json() as NotificationData;
        if (!controller.signal.aborted) { setData(next); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { pending = false; }
    };
    const pollNow = () => { void poll(); };
    pollNow();
    const timer = setInterval(pollNow, 3000);
    window.addEventListener("online", pollNow);
    window.addEventListener("focus", pollNow);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("online", pollNow); window.removeEventListener("focus", pollNow); };
  }, [revision]);
  return { data, error, refresh };
}

export function CatalogNotifications() {
  const { data, error, refresh } = useNotifications();
  const unread = data?.outcomes.filter(outcome => !outcome.acknowledgedAt) ?? [];
  const acknowledged = data?.outcomes.filter(outcome => outcome.acknowledgedAt) ?? [];
  return <aside className={styles.notifications} aria-label="Catalog notifications">
    <details>
      <summary>Catalog updates <span aria-live="polite">({unread.length} unread)</span></summary>
      <div className={styles.panel}>
        <h2>Catalog updates</h2>
        <p>Outcomes and acknowledgements are shared by installation administrators. Older outcomes describe the catalog at that time.</p>
        {error ? <p role="status">Catalog updates could not refresh. Reconnecting automatically.</p> : null}
        {data ? <>
          {unread.length ? <ul>{unread.map(outcome => <Outcome key={`${outcome.provider}:${outcome.jobId}`} outcome={outcome} csrfToken={data.csrfToken} onAcknowledged={refresh} />)}</ul> : <p>No unread catalog updates.</p>}
          {acknowledged.length ? <details><summary>Acknowledged updates ({acknowledged.length})</summary><ul>{acknowledged.map(outcome => <Outcome key={`${outcome.provider}:${outcome.jobId}`} outcome={outcome} csrfToken={data.csrfToken} onAcknowledged={refresh} />)}</ul></details> : null}
        </> : <p>Loading catalog updates…</p>}
      </div>
    </details>
  </aside>;
}
