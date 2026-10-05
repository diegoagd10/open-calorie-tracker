import { Form, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/settings.catalogs";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import type { CatalogState, FoundationReleaseMetadata } from "../catalog-management/catalog-management.server";
import { getCatalogManagement } from "../catalog-management/runtime.server";
import { BarcodeContactSection, type BarcodeContactResult } from "../barcode";
import { BarcodeContactInvalidError, getBarcodeService } from "../barcode/index.server";
import { SettingsDestinations, SettingsShell } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "./settings.catalogs.module.css";
import { navigationToday } from "../setup/runtime.server";

export function meta() { return [{ title: "Food Catalogs · Open Calorie Tracker" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  const catalog = getCatalogManagement();
  await catalog.checkForUpdate();
  return { csrfToken: session.csrfToken, today: navigationToday(session.user.id), catalog: catalogInformation(catalog.read()), offContact: getBarcodeService().contact() };
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const requestContentType = request.headers.get("Content-Type") ?? "";
  if (requestContentType.startsWith("application/x-www-form-urlencoded") || requestContentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) throw new Response("CSRF token rejected.", { status: 403 });
    const intent = form.get("intent");
    if (intent === "save-off-contact" || intent === "remove-off-contact") return contactAction(intent, form);
    if (intent !== "check-usda-update") return Response.json({ error: "Unsupported action." }, { status: 400, headers: headers() });
    await getCatalogManagement().checkForUpdate({ force: true });
    return Response.json({ checked: true }, { headers: headers() });
  }
  if (!getAuthenticationService().verifyCsrfToken(session.token, request.headers.get("X-CSRF-Token") ?? "")) throw new Response("CSRF token rejected.", { status: 403 });
  return Response.json({ error: "Catalog installation is available through terminal commands only." }, { status: 400, headers: headers() });
}

function contactAction(intent: "save-off-contact" | "remove-off-contact", form: FormData): Response {
  const barcode = getBarcodeService();
  if (intent === "remove-off-contact") {
    barcode.removeContact();
    return Response.json({ contact: "removed" } satisfies BarcodeContactResult, { headers: headers() });
  }
  const value = String(form.get("email") ?? "");
  const configured = barcode.isConfigured();
  try {
    barcode.saveContact(value);
  } catch (error) {
    if (!(error instanceof BarcodeContactInvalidError)) throw error;
    return Response.json({ contact: "invalid", error: error.message, value } satisfies BarcodeContactResult, { status: 400, headers: headers() });
  }
  return Response.json({ contact: configured ? "updated" : "enabled" } satisfies BarcodeContactResult, { headers: headers() });
}

type CatalogInformation = Pick<CatalogState, "installed" | "updateCheck">;
function catalogInformation({ installed, updateCheck }: CatalogState): CatalogInformation {
  return { installed, updateCheck };
}

function releaseLabel(release: Pick<FoundationReleaseMetadata, "identifier" | "releasedOn" | "releasePeriod"> | undefined): string {
  if (!release) return "Unknown";
  return `${release.identifier ?? `Foundation ${release.releasePeriod}`} · ${release.releasedOn ?? release.releasePeriod}`;
}
function CatalogCard({ catalog, csrfToken }: { catalog: CatalogInformation; csrfToken: string }) {
  const navigation = useNavigation();
  const checking = navigation.formData?.get("intent") === "check-usda-update";
  return <section className={styles.card} aria-labelledby="usda-fdc-heading">
        <div className={styles.heading}><h2 id="usda-fdc-heading">USDA Foundation</h2><span className={catalog.installed ? styles.connected : styles.disconnected}>{catalog.installed ? "Installed" : "Not installed"}</span></div>
        <p>Download the Foundation CSV ZIP, then install it with the terminal command.</p>
        <a href="https://fdc.nal.usda.gov/download-datasets/" target="_blank" rel="noreferrer">Official USDA downloads ↗</a>
        {catalog.installed ? <div>
          <p><strong>{catalog.installed.foodCount.toLocaleString()} foods installed</strong></p>
          <p>Archive: {catalog.installed.filename}</p>
          <p>Food publication dates: {catalog.installed.publicationDateRange.earliest} – {catalog.installed.publicationDateRange.latest}</p>
          <details><summary>Source snapshot fingerprint</summary><p style={{ overflowWrap: "anywhere" }}>SHA-256: {catalog.installed.sha256}</p></details>
          <p>Installed: {new Date(catalog.installed.installedAt).toLocaleString()}</p>
          <p>Import a newer Foundation archive, or deliberately reimport this archive, while the installed catalog remains available.</p>
        </div> : null}
        <div>
          <h3>Update availability</h3>
          <p>Installed official release: {releaseLabel(catalog.installed?.sourceRelease)}</p>
          <p>Available official release: {releaseLabel(catalog.updateCheck?.availableRelease ?? undefined)}</p>
          {!catalog.installed ? <p>Install a Foundation archive before comparing it with USDA&apos;s declared release.</p>
            : !catalog.installed.sourceRelease ? <p>The installed archive could not be tied to a declared USDA release.</p>
              : catalog.updateCheck?.status === "newer" ? <p>A newer USDA Foundation release is available.</p>
                : catalog.updateCheck?.status === "unchanged" ? <p>No newer declared USDA Foundation release was found.</p>
                  : catalog.updateCheck?.status === "unavailable" ? <p>USDA release metadata is temporarily unavailable.</p>
                    : catalog.updateCheck ? <p>USDA release metadata cannot be compared safely.</p>
                      : <p>USDA update status has not been checked.</p>}
          {catalog.updateCheck ? <p>Last checked: {new Date(catalog.updateCheck.checkedAt).toLocaleString()}</p> : null}
          <Form method="post" action="/settings/catalogs" className={styles.actions}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button type="submit" name="intent" value="check-usda-update" disabled={checking}>{checking ? "Checking USDA updates…" : catalog.updateCheck ? "Check USDA updates again" : "Check USDA updates"}</button>
          </Form>
          <p>Checking retrieves source metadata only. Download the archive from USDA in a new tab, then install it with the terminal command; the app never downloads or installs it automatically.</p>
        </div>
        <p className={styles.note}>Saved Food Entries keep their original nutrition and measurements.</p>
      </section>;
}

export default function CatalogSettings({ loaderData }: Route.ComponentProps) {
  const { catalog, offContact, csrfToken, today } = loaderData;
  const actionData = useActionData<typeof action>() as BarcodeContactResult | undefined;
  return <SettingsShell
    active="catalogs"
    csrfToken={csrfToken}
    isAdministrator={true}
    skipLabel="Skip to Food Catalogs"
    skipTarget="catalog-settings"
    today={today}
  >
    <main className={shellStyles.appSurface} id="catalog-settings">
      <header className={shellStyles.mobileHeader}><div className={shellStyles.titleLine}><h1>Food Catalogs</h1></div><p className={shellStyles.selectedDateLabel}>Shared reference foods for local search and logging.</p></header>
      <CatalogCard catalog={catalog} csrfToken={csrfToken} />
      <BarcodeContactSection csrfToken={csrfToken} email={offContact} result={actionData && "contact" in actionData ? actionData : undefined} />
      <SettingsDestinations active="catalogs" csrfToken={csrfToken} isAdministrator />
    </main>
  </SettingsShell>;
}
