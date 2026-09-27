import { data, Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/oauth.authorize";
import { getApplicationMutationSession, getSessionForApplicationAccess, readApplicationMutationForm } from "../auth/http.server";
import { approveOAuthAuthorization, authorizationRedirect, DAILY_LOG_READ_SCOPE, readOAuthAuthorizationRequest } from "../oauth/authorization.server";
import styles from "../oauth/consent.module.css";

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
  const authorization = readOAuthAuthorizationRequest(url.searchParams);
  if (!authorization) return invalidAuthorizationRequest();
  const session = await getSessionForApplicationAccess(request);
  if (!session) throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  return {
    client: { id: authorization.clientId, name: authorization.clientName },
    permission: "Read your daily Food Log",
    scope: DAILY_LOG_READ_SCOPE,
    csrfToken: session.csrfToken,
    action: url.pathname + url.search,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  const authorization = readOAuthAuthorizationRequest(new URL(request.url).searchParams);
  if (!authorization) return invalidAuthorizationRequest();
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "deny") return invalidAuthorizationRequest();
  const selectedScopes = form.getAll("scope");
  if (decision === "approve" && (selectedScopes.length !== 1 || selectedScopes[0] !== DAILY_LOG_READ_SCOPE)) {
    return data({ error: "Select the Food Log permission before allowing access." }, { status: 400, headers: headers() });
  }
  const destination = decision === "approve"
    ? authorizationRedirect(authorization, { code: approveOAuthAuthorization(session.user.id, authorization) })
    : authorizationRedirect(authorization, { error: "access_denied" });
  return redirect(destination, { headers: headers() });
}

export default function OAuthConsent({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  if (loaderData instanceof Response) return null;
  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="consent-title">
        <header className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">OC</span>
          <span>Open Calorie Tracker</span>
        </header>
        <Form id="oauth-decline-form" action={loaderData.action} method="post">
          <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
        </Form>
        <Form action={loaderData.action} method="post">
          <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
          <div className={styles.content}>
            <div className={styles.intro}>
              <div className={styles.appMark} aria-hidden="true">{loaderData.client.name.slice(0, 1).toUpperCase()}</div>
              <p className={styles.eyebrow}>Connection request</p>
              <h1 id="consent-title">{loaderData.client.name} wants access to your Food Log</h1>
              <p>Review the permission before you decide whether to connect this app.</p>
              <div className={styles.accountLabel}>Your private Food Log</div>
              <p className={styles.clientId}>Client ID <code>{loaderData.client.id}</code></p>
            </div>
            <div className={styles.permissionSection}>
              <fieldset className={styles.permissions}>
                <legend>Choose what {loaderData.client.name} can access</legend>
                <label className={styles.permissionRow}>
                  <input type="checkbox" name="scope" value={loaderData.scope} required />
                  <span>
                    <strong>{loaderData.permission}</strong>
                    <small>View food entries, water, and nutrition totals for the dates it requests. It cannot add, edit, or delete your Food Log.</small>
                  </span>
                </label>
              </fieldset>
              <p className={styles.help}>Select this permission to allow access. You can revoke the connection later in Settings → OAuth clients.</p>
              {result && "error" in result ? <p className={styles.error} role="alert">{result.error}</p> : null}
            </div>
          </div>
          <footer className={styles.actions}>
            <button className={styles.decline} type="submit" form="oauth-decline-form" name="decision" value="deny">Decline</button>
            <button className={styles.allow} type="submit" name="decision" value="approve">Allow access</button>
          </footer>
        </Form>
      </section>
    </main>
  );
}
