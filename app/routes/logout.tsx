import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import {
  getSessionForAccountAccess,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getSessionForAccountAccess(request);

  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }

  const formData = await request.formData();
  const csrfToken = String(formData.get("csrfToken") ?? "");

  if (
    !getAuthenticationService().verifyCsrfToken(session.token, csrfToken)
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  getAuthenticationService().revokeSession(session.token);

  return redirect("/login", {
    headers: { "Set-Cookie": serializeClearedSessionCookie() },
  });
}

export function loader() {
  return redirect("/");
}
