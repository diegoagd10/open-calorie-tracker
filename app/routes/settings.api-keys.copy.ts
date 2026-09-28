import type { Route } from "./+types/settings.api-keys.copy";
import { getApplicationMutationSession, readApplicationMutationForm } from "../auth/http.server";
import { parseApiKeyId } from "../api-keys/api-keys.server";
import { getApiKeys } from "../api-keys/runtime.server";

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  const keyId = parseApiKeyId(form.get("keyId"));
  const key = keyId === undefined ? undefined : (await getApiKeys()).reveal(session.user.id, keyId);
  if (!key) return Response.json({ error: "This key is no longer available." }, { status: 404, headers: noStore });
  return Response.json({ key }, { headers: noStore });
}
