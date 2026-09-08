import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/settings.catalogs";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { CatalogManagementError, type CatalogState } from "../catalog-management/catalog-management.server";
import { getCatalogManagement } from "../catalog-management/runtime.server";
import { AppNavigation } from "../app-navigation";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

export function meta() { return [{ title: "Food Catalogs · Open Calorie Tracker" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return { csrfToken: session.csrfToken, today: new Date().toISOString().slice(0, 10), catalog: getCatalogManagement().read(), offCatalog: getCatalogManagement("open-food-facts").read() };
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  if (!getAuthenticationService().verifyCsrfToken(session.token, request.headers.get("X-CSRF-Token") ?? "")) throw new Response("CSRF token rejected.", { status: 403 });
  const provider = request.headers.get("X-Catalog-Provider") ?? "usda-fdc";
  if (provider !== "usda-fdc" && provider !== "open-food-facts") return Response.json({ error: "Unknown catalog." }, { status: 400, headers: headers() });
  const contentType = provider === "usda-fdc" ? "application/zip" : "application/gzip";
  if (!request.body || request.headers.get("Content-Type") !== contentType) return Response.json({ error: "Choose an archive matching this catalog." }, { status: 400, headers: headers() });
  try {
    const encodedName = request.headers.get("X-Archive-Name") ?? "";
    let filename: string;
    try { filename = decodeURIComponent(encodedName); } catch { throw new CatalogManagementError("Invalid archive filename."); }
    const size = request.headers.get("Content-Length");
    await getCatalogManagement(provider).submitArchive({ filename, stream: Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), size: size === null ? undefined : Number(size) });
    return Response.json({ accepted: true }, { status: 202, headers: headers() });
  } catch (error) {
    if (error instanceof CatalogManagementError) return Response.json({ error: error.message }, { status: 409, headers: headers() });
    throw error;
  }
}

const phaseLabels = { uploading: "Receiving archive", queued: "Queued for import", validating: "Validating archive", importing: "Importing foods and nutrition", indexing: "Building search index", activating: "Activating catalog", succeeded: "installation complete", failed: "installation failed", interrupted: "installation interrupted" };
function CatalogCard({ catalog, csrfToken, provider }: { catalog: CatalogState; csrfToken: string; provider: "usda-fdc" | "open-food-facts" }) {
  const off = provider === "open-food-facts";
  const name = off ? "Open Food Facts" : "USDA Foundation";
  const archiveLabel = off ? "OFF tab-separated CSV GZIP" : "Foundation CSV ZIP";
  const revalidator = useRevalidator();
  const [upload, setUpload] = useState<{ bytes: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!catalog.busy && !upload) return;
    const timer = setInterval(() => { if (revalidator.state === "idle") void revalidator.revalidate(); }, 1000);
    return () => clearInterval(timer);
  }, [catalog.busy, upload, revalidator]);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("archive");
    if (!(file instanceof File) || !file.size) { setError(`Choose a ${archiveLabel} archive.`); return; }
    setError(null); setUpload({ bytes: 0, total: file.size });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/settings/catalogs");
    xhr.setRequestHeader("Content-Type", off ? "application/gzip" : "application/zip");
    xhr.setRequestHeader("X-Catalog-Provider", provider);
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.setRequestHeader("X-Archive-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = progress => setUpload({ bytes: progress.loaded, total: file.size });
    xhr.onload = () => {
      if (xhr.status !== 202) {
        let message = "Upload was rejected. Reload Settings and try again.";
        try { const result = JSON.parse(xhr.responseText) as { error?: string }; message = result.error ?? message; } catch { /* HTML authorization failures contain no public upload error. */ }
        setError(message);
      }
      setUpload(null); void revalidator.revalidate();
    };
    xhr.onerror = () => { setError("Upload connection failed. Return to Settings to check the server outcome before retrying."); setUpload(null); void revalidator.revalidate(); };
    xhr.send(file);
  }
  return <section className={styles.card} aria-labelledby={`${provider}-heading`}>
        <div className={styles.heading}><h2 id={`${provider}-heading`}>{name}</h2><span className={catalog.installed ? styles.connected : styles.disconnected}>{catalog.installed ? "Installed" : "Not installed"}</span></div>
        <p>Download the {archiveLabel}, then upload it here.</p>
        <a href={off ? "https://world.openfoodfacts.org/data" : "https://fdc.nal.usda.gov/download-datasets/"} target="_blank" rel="noreferrer">Official {off ? "OFF" : "USDA"} downloads ↗</a>
        {off ? <p>Open Food Facts data is available under the Open Database License (ODbL). Products without an explicit nutrition basis can be reviewed but cannot be used for calculated logging.</p> : null}
        {catalog.installed ? <div>
          <p><strong>{catalog.installed.foodCount.toLocaleString()} foods installed</strong></p>
          <p>Archive: {catalog.installed.filename}</p>
          {off ? <><p>Product modification dates: {catalog.installed.sourceDateRange?.earliest ?? "Unknown"} – {catalog.installed.sourceDateRange?.latest ?? "Unknown"}</p><p>These dates describe products, not an official dump release.</p></> : <p>Food publication dates: {catalog.installed.publicationDateRange.earliest} – {catalog.installed.publicationDateRange.latest}</p>}
          <details><summary>Source snapshot fingerprint</summary><p style={{ overflowWrap: "anywhere" }}>SHA-256: {catalog.installed.sha256}</p></details>
          <p>Installed: {new Date(catalog.installed.installedAt).toLocaleString()}</p>
          <p>Catalog replacement is not available yet.</p>
        </div> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {catalog.job?.error ? <p role="alert" className={styles.error}>{catalog.job.error}</p> : null}
        <div role="status" aria-live="polite">
          {upload ? <p>Uploading: {upload.bytes.toLocaleString()} / {upload.total.toLocaleString()} bytes<progress aria-label="Archive upload" value={upload.bytes} max={upload.total} /></p> : null}
          {catalog.job ? <><p>{["succeeded", "failed", "interrupted"].includes(catalog.job.phase) ? `${off ? "Open Food Facts" : "USDA"} ${phaseLabels[catalog.job.phase]}` : phaseLabels[catalog.job.phase]}</p><p>{catalog.job.receivedBytes.toLocaleString()} bytes received · {catalog.job.processedRecords.toLocaleString()} records processed</p></> : null}
          {catalog.busy && !upload ? <p>You can leave this page. Import continues on the server; return here for the outcome.</p> : null}
        </div>
        {catalog.job && Object.keys(catalog.job.exclusions).length ? <details><summary>Excluded records and unavailable data</summary><ul>{Object.entries(catalog.job.exclusions).map(([reason, count]) => <li key={reason}>{reason.replaceAll("_", " ")}: {count.toLocaleString()}</li>)}</ul><p>These counts describe individual records or values; an archive failure is shown separately above.</p></details> : null}
        {!catalog.installed ? <form onSubmit={submit} className={styles.actions}>
          <label>{archiveLabel}<input type="file" name="archive" accept={off ? ".gz,application/gzip" : ".zip,application/zip"} required disabled={catalog.busy || upload !== null} /></label>
          <button className={styles.primary} type="submit" disabled={catalog.busy || upload !== null}>Install {name}</button>
          <noscript>Enable JavaScript to upload a catalog and view import progress.</noscript>
        </form> : null}
        <p className={styles.note}>Saved Food Entries keep their original nutrition and measurements.</p>
      </section>;
}

export default function CatalogSettings({ loaderData }: Route.ComponentProps) {
  const { catalog, offCatalog, csrfToken, today } = loaderData;
  return <div className={shellStyles.shell}>
    <a className={shellStyles.skipLink} href="#catalog-settings">Skip to Food Catalogs</a>
    <AppNavigation active="settings" csrfToken={csrfToken} selectedDate={today} today={today} />
    <main className={shellStyles.appSurface} id="catalog-settings">
      <header className={shellStyles.mobileHeader}><div className={shellStyles.titleLine}><h1>Food Catalogs</h1></div><p className={shellStyles.selectedDateLabel}>Install shared reference foods for local search and logging.</p></header>
      <CatalogCard catalog={catalog} csrfToken={csrfToken} provider="usda-fdc" />
      <CatalogCard catalog={offCatalog} csrfToken={csrfToken} provider="open-food-facts" />
      <SettingsDestinations active="catalogs" csrfToken={csrfToken} isAdministrator />
    </main>
  </div>;
}
