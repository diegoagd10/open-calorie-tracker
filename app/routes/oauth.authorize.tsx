import { Form, redirect } from "react-router";
import type { Route } from "./+types/oauth.authorize";
import { getApplicationMutationSession, getSessionForApplicationAccess, readApplicationMutationForm } from "../auth/http.server";
import { approvePublicAuthorization, authorizationRedirect, readPublicAuthorizationRequest } from "../oauth/authorization.server";
import styles from "../account.module.css";

export function meta() {
  return [{ title: "Authorize client · Open Calorie Tracker" }];
}

export function headers() {
  return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
}

function invalidAuthorizationRequest() {
  return Response.json({ error: "invalid_request" }, { status: 400, headers: headers() });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const authorization = readPublicAuthorizationRequest(url.searchParams);
  if (!authorization) return invalidAuthorizationRequest();
  const session = await getSessionForApplicationAccess(request);
  if (!session) throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  return {
    client: { id: authorization.clientId, name: authorization.clientName },
    permission: "Read your daily Food Log",
    scope: "daily-log:read" as const,
    csrfToken: session.csrfToken,
    action: url.pathname + url.search,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  const authorization = readPublicAuthorizationRequest(new URL(request.url).searchParams);
  if (!authorization) return invalidAuthorizationRequest();
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "deny") return invalidAuthorizationRequest();
  const destination = decision === "approve"
    ? authorizationRedirect(authorization, { code: approvePublicAuthorization(session.user.id, authorization) })
    : authorizationRedirect(authorization, { error: "access_denied" });
  return redirect(destination, { headers: headers() });
}

export default function OAuthConsent({ loaderData }: Route.ComponentProps) {
  if (loaderData instanceof Response) return null;
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="consent-title">
        <h1 id="consent-title">Authorize {loaderData.client.name}?</h1>
        <p>This public client is requesting permission to <strong>{loaderData.permission.toLowerCase()}</strong>.</p>
        <p>It can read your Food Log for dates it requests. It cannot edit your Food Log.</p>
        <p>Client ID: <code>{loaderData.client.id}</code></p>
        <Form action={loaderData.action} className={styles.form} method="post">
          <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
          <button className={styles.submit} type="submit" name="decision" value="approve">Approve</button>
          <button type="submit" name="decision" value="deny">Decline</button>
        </Form>
      </section>
    </main>
  );
}
