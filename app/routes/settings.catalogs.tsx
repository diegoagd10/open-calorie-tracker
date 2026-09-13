import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/settings.catalogs";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import type { CatalogState, FoundationReleaseMetadata } from "../catalog-management/catalog-management.server";
import { getCatalogManagement } from "../catalog-management/runtime.server";
import { AppNavigation } from "../app-navigation";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

export function meta() { return [{ title: "Food Catalogs · Open Calorie Tracker" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  const catalog = getCatalogManagement();
  const offCatalog = getCatalogManagement("open-food-facts");
  await Promise.all([catalog.checkForUpdate(), offCatalog.checkForUpdate()]);
  return { csrfToken: session.csrfToken, today: new Date().toISOString().slice(0, 10), catalog: catalogInformation(catalog.read()), offCatalog: catalogInformation(offCatalog.read()) };
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const requestContentType = request.headers.get("Content-Type") ?? "";
  if (requestContentType.startsWith("application/x-www-form-urlencoded") || requestContentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) throw new Response("CSRF token rejected.", { status: 403 });
    const intent = form.get("intent");
    if (intent !== "check-usda-update" && intent !== "check-off-update") return Response.json({ error: "Unsupported action." }, { status: 400, headers: headers() });
    await getCatalogManagement(intent === "check-off-update" ? "open-food-facts" : "usda-fdc").checkForUpdate({ force: true });
    return Response.json({ checked: true }, { headers: headers() });
  }
  if (!getAuthenticationService().verifyCsrfToken(session.token, request.headers.get("X-CSRF-Token") ?? "")) throw new Response("CSRF token rejected.", { status: 403 });
  return Response.json({ error: "Catalog installation is available through terminal commands only." }, { status: 400, headers: headers() });
}

type CatalogInformation = Pick<CatalogState, "installed" | "updateCheck">;
function catalogInformation({ installed, updateCheck }: CatalogState): CatalogInformation {
  return { installed, updateCheck };
}

function releaseLabel(release: Pick<FoundationReleaseMetadata, "identifier" | "releasedOn" | "releasePeriod"> | undefined): string {
  if (!release) return "Unknown";
  return `${release.identifier ?? `Foundation ${release.releasePeriod}`} · ${release.releasedOn ?? release.releasePeriod}`;
}
function OffSnapshotAvailability({ catalog }: { catalog: CatalogInformation }) {
  const messages = {
    newer: "A newer OFF export snapshot is available.",
    unchanged: "No change detected in the OFF export.",
    unavailable: "OFF snapshot metadata is temporarily unavailable.",
    indeterminate: "OFF snapshot metadata cannot be compared safely.",
  };
  const installed = catalog.installed?.sourceSnapshot;
  const available = catalog.updateCheck?.availableSnapshot;
  return <>
    <p>Installed official snapshot: {installed?.lastModified ?? (installed ? "Matched export; date unknown" : "Unknown")}</p>
    <p>Available export last modified: {available?.lastModified ?? "Unknown"}</p>
    <p>{catalog.updateCheck ? messages[catalog.updateCheck.status] : "OFF update status has not been checked."}</p>
    {!installed ? <p>The installed archive has not been matched to an official OFF snapshot. Download and import the current export to establish a comparison when its checksum is available.</p> : null}
    <p>OFF publishes a rolling export. Its last-modified time describes the export object, not a dated release or the newest product. Changed metadata without reliable chronology remains incomparable.</p>
  </>;
}
function CatalogCard({ catalog, csrfToken, provider }: { catalog: CatalogInformation; csrfToken: string; provider: "usda-fdc" | "open-food-facts" }) {
  const off = provider === "open-food-facts";
  const name = off ? "Open Food Facts" : "USDA Foundation";
  const archiveLabel = off ? "OFF tab-separated CSV GZIP" : "Foundation CSV ZIP";
  const navigation = useNavigation();
  const checkIntent = off ? "check-off-update" : "check-usda-update";
  const checkLabel = off ? "OFF" : "USDA";
  const checking = navigation.formData?.get("intent") === checkIntent;
  return <section className={styles.card} aria-labelledby={`${provider}-heading`}>
        <div className={styles.heading}><h2 id={`${provider}-heading`}>{name}</h2><span className={catalog.installed ? styles.connected : styles.disconnected}>{catalog.installed ? "Installed" : "Not installed"}</span></div>
        <p>Download the {archiveLabel}, then install it with the terminal command.</p>
        <a href={off ? "https://world.openfoodfacts.org/data" : "https://fdc.nal.usda.gov/download-datasets/"} target="_blank" rel="noreferrer">Official {off ? "OFF" : "USDA"} downloads ↗</a>
        {off ? <p>Open Food Facts data is available under the Open Database License (ODbL). Products without an explicit nutrition basis can be reviewed but cannot be used for calculated logging.</p> : null}
        {catalog.installed ? <div>
          <p><strong>{catalog.installed.foodCount.toLocaleString()} foods installed</strong></p>
          <p>Archive: {catalog.installed.filename}</p>
          {off ? <><p>Product modification dates: {catalog.installed.sourceDateRange?.earliest ?? "Unknown"} – {catalog.installed.sourceDateRange?.latest ?? "Unknown"}</p><p>These dates describe products, not an official dump release.</p></> : <p>Food publication dates: {catalog.installed.publicationDateRange.earliest} – {catalog.installed.publicationDateRange.latest}</p>}
          <details><summary>Source snapshot fingerprint</summary><p style={{ overflowWrap: "anywhere" }}>SHA-256: {catalog.installed.sha256}</p></details>
          <p>Installed: {new Date(catalog.installed.installedAt).toLocaleString()}</p>
          <p>Import a newer {off ? "OFF" : "Foundation"} archive, or deliberately reimport this archive, while the installed catalog remains available.</p>
        </div> : null}
        <div>
          <h3>Update availability</h3>
          {off ? <OffSnapshotAvailability catalog={catalog} /> : <>
          <p>Installed official release: {releaseLabel(catalog.installed?.sourceRelease)}</p>
          <p>Available official release: {releaseLabel(catalog.updateCheck?.availableRelease ?? undefined)}</p>
          {!catalog.installed ? <p>Install a Foundation archive before comparing it with USDA&apos;s declared release.</p>
            : !catalog.installed.sourceRelease ? <p>The installed archive could not be tied to a declared USDA release.</p>
              : catalog.updateCheck?.status === "newer" ? <p>A newer USDA Foundation release is available.</p>
                : catalog.updateCheck?.status === "unchanged" ? <p>No newer declared USDA Foundation release was found.</p>
                  : catalog.updateCheck?.status === "unavailable" ? <p>USDA release metadata is temporarily unavailable.</p>
                    : catalog.updateCheck ? <p>USDA release metadata cannot be compared safely.</p>
                      : <p>USDA update status has not been checked.</p>}
          </>}
          {catalog.updateCheck ? <p>Last checked: {new Date(catalog.updateCheck.checkedAt).toLocaleString()}</p> : null}
          <Form method="post" action="/settings/catalogs" className={styles.actions}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value={checkIntent} disabled={checking}>{checking ? `Checking ${checkLabel} updates…` : catalog.updateCheck ? `Check ${checkLabel} updates again` : `Check ${checkLabel} updates`}</button>
          </Form>
          <p>Checking retrieves source metadata only. Download the archive from {checkLabel} in a new tab, then install it with the terminal command; the app never downloads or installs it automatically.</p>
        </div>
        <p className={styles.note}>Saved Food Entries keep their original nutrition and measurements.</p>
      </section>;
}

export default function CatalogSettings({ loaderData }: Route.ComponentProps) {
  const { catalog, offCatalog, csrfToken, today } = loaderData;
  return <div className={shellStyles.shell}>
    <a className={shellStyles.skipLink} href="#catalog-settings">Skip to Food Catalogs</a>
    <AppNavigation active="settings" csrfToken={csrfToken} selectedDate={today} today={today} />
    <main className={shellStyles.appSurface} id="catalog-settings">
      <header className={shellStyles.mobileHeader}><div className={shellStyles.titleLine}><h1>Food Catalogs</h1></div><p className={shellStyles.selectedDateLabel}>Shared reference foods for local search and logging.</p></header>
      <CatalogCard catalog={catalog} csrfToken={csrfToken} provider="usda-fdc" />
      <CatalogCard catalog={offCatalog} csrfToken={csrfToken} provider="open-food-facts" />
      <SettingsDestinations active="catalogs" csrfToken={csrfToken} isAdministrator />
    </main>
  </div>;
}
