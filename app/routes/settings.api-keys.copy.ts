import type { Route } from "./+types/settings.api-keys.copy";
import { getApplicationMutationSession, readApplicationMutationForm } from "../auth/http.server";
import { getApiKeys } from "../api-keys/runtime.server";

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  const keyId = Number(form.get("keyId"));
  const key = Number.isSafeInteger(keyId) && keyId > 0
    ? (await getApiKeys()).reveal(session.user.id, keyId)
    : undefined;
  if (!key) return Response.json({ error: "This key is no longer available." }, { status: 404, headers: noStore });
  return Response.json({ key }, { headers: noStore });
}
