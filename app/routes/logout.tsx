import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import {
  getAuthenticatedSession,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getAuthenticatedSession(request);

  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }

  const formData = await request.formData();
  // Stryker disable next-line StringLiteral: every placeholder for a missing opaque token is rejected identically.
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
