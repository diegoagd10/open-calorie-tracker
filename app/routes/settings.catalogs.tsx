import { useActionData } from "react-router";
import type { Route } from "./+types/settings.catalogs";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import type { CatalogState } from "../catalog-management/catalog-management.server";
import { getCatalogManagement } from "../catalog-management/runtime.server";
import { UsdaCatalogCard } from "../catalog-management/usda-catalog-card";
import type { UsdaCatalogInformation } from "../catalog-management/usda-catalog-status";
import { BarcodeContactSection, type BarcodeContactResult } from "../barcode";
import { BarcodeContactInvalidError } from "../catalog/open-food-facts.exceptions";
import { getOpenFoodFactsClient } from "../catalog/runtime.server";
import { SettingsDestinations, SettingsShell } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import { navigationToday } from "../setup/runtime.server";

export function meta() { return [{ title: "Food Catalogs · Open Calorie Tracker" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  const catalog = getCatalogManagement();
  await catalog.checkForUpdate();
  return { csrfToken: session.csrfToken, today: navigationToday(session.user.id), catalog: catalogInformation(catalog.read()), renderedAt: new Date().toISOString(), offContact: getOpenFoodFactsClient().contact() };
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
  const barcode = getOpenFoodFactsClient();
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

function catalogInformation({ installed, updateCheck }: CatalogState): UsdaCatalogInformation {
  return { installed, updateCheck };
}

export default function CatalogSettings({ loaderData }: Route.ComponentProps) {
  const { catalog, offContact, csrfToken, today, renderedAt } = loaderData;
  const actionData = useActionData<typeof action>() as BarcodeContactResult | { checked: true } | undefined;
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
      <UsdaCatalogCard catalog={catalog} csrfToken={csrfToken} renderedAt={renderedAt} rechecked={actionData !== undefined && "checked" in actionData} />
      <BarcodeContactSection csrfToken={csrfToken} email={offContact} result={actionData && "contact" in actionData ? actionData : undefined} />
      <SettingsDestinations active="catalogs" csrfToken={csrfToken} isAdministrator />
    </main>
  </SettingsShell>;
}
