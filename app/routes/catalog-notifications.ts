import { redirect } from "react-router";
import type { Route } from "./+types/catalog-notifications";
import { getSessionForApplicationAccess, requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { getCatalogManagement } from "../catalog-management/runtime.server";

const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);
  if (!session) throw redirect("/login");
  const outcomes = [getCatalogManagement(), getCatalogManagement("open-food-facts")]
    .flatMap(catalog => catalog.outcomes())
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.jobId.localeCompare(b.jobId));
  const notifications = session.user.role === "admin"
    ? { csrfToken: session.csrfToken, outcomes }
    : { outcomes: outcomes.filter(outcome => outcome.phase === "succeeded").map(({ provider, jobId, phase, completedAt, operation }) => ({ provider, jobId, phase, completedAt, operation })) };
  return Response.json(notifications, { headers: privateHeaders });
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const form = await request.formData();
  if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) throw new Response("CSRF token rejected.", { status: 403 });
  const provider = form.get("provider");
  if (provider !== "usda-fdc" && provider !== "open-food-facts") return Response.json({ error: "Unknown catalog." }, { status: 400, headers: privateHeaders });
  const acknowledged = getCatalogManagement(provider).acknowledgeOutcome(String(form.get("jobId") ?? ""), String(form.get("completedAt") ?? ""));
  return Response.json(acknowledged ? { acknowledged: true } : { error: "This outcome changed. Refresh notifications and try again." }, { status: acknowledged ? 200 : 409, headers: privateHeaders });
}
