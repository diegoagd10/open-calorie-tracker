import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/settings.oauth-clients";
import { getApplicationMutationSession, readApplicationMutationForm, requireApplicationSession } from "../auth/http.server";
import { listOAuthClients, registerOAuthClient, type OAuthClientSummary, type RegistrationErrors } from "../oauth/client-registration.server";
import { connectedDailyLogClients, revokeDailyLogClient } from "../oauth/authorization.server";
import { AppNavigation } from "../app-navigation";
import { SettingsSideNav } from "../settings-destinations";
import { navigationToday } from "../goals/runtime.server";
import styles from "../account.module.css";
import shellStyles from "../food-log.module.css";

const integrationGuideUrl = "https://diegoagd10.github.io/open-calory-tracker-docs/";

type ActionData = {
  client?: OAuthClientSummary;
  clientSecret?: string;
  errors?: RegistrationErrors;
  error?: string;
  revokedClient?: { clientId: string; name: string };
};

export function meta() {
  return [{ title: "OAuth clients · Open Calorie Tracker" }];
}

export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireApplicationSession(request);
  return {
    csrfToken: session.csrfToken,
    isAdministrator: session.user.role === "admin",
    today: navigationToday(session.user.id),
    clients: listOAuthClients(session.user.id),
    connections: connectedDailyLogClients(session.user.id),
    view: new URL(request.url).searchParams.get("view") === "new" ? "new" : "list",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  if (form.get("intent") === "revoke") {
    const clientId = form.get("clientId");
    if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(clientId)) {
      return data<ActionData>({ error: "Connection is no longer available. Refresh and try again." }, { status: 400 });
    }
    const revokedClient = revokeDailyLogClient(session.user.id, clientId);
    if (!revokedClient) {
      return data<ActionData>({ error: "Connection is no longer available. Refresh and try again." }, { status: 404 });
    }
    return data<ActionData>({ revokedClient }, { status: 200 });
  }
  if (form.get("intent") !== "register") {
    return data<ActionData>({ error: "Unsupported action." }, { status: 400 });
  }
  try {
    const result = registerOAuthClient(session.user.id, {
      clientType: String(form.get("clientType") ?? "public"),
      name: String(form.get("name") ?? ""),
      redirectUris: String(form.get("redirectUris") ?? ""),
    });
    if (!result.ok) return data<ActionData>({ errors: result.errors }, { status: 400 });
    return data<ActionData>({ client: result.client, ...(result.clientSecret ? { clientSecret: result.clientSecret } : {}) }, { status: 201 });
  } catch {
    return data<ActionData>({ error: "The client could not be registered. Please try again." }, { status: 503 });
  }
}

export default function OAuthClientsSettings({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const registered = loaderData.view === "new" ? result?.client : undefined;
  return (
    <div className={`${shellStyles.shell} ${shellStyles.settingsShell}`}>
      <a className={shellStyles.skipLink} href="#oauth-clients-settings">
        Skip to OAuth clients
      </a>
      <AppNavigation
        active="settings"
        csrfToken={loaderData.csrfToken}
        selectedDate={loaderData.today}
        today={loaderData.today}
      />
      <SettingsSideNav active="oauth" isAdministrator={loaderData.isAdministrator} />
      <main className={shellStyles.appSurface} id="oauth-clients-settings">
      <section className={styles.settingsPanel} aria-labelledby="oauth-clients-title">
        {registered ? (
          <>
            <Link className={styles.backLink} to="/settings/oauth-clients">All OAuth clients</Link>
            <div className={styles.confirmation} role="status">
              <h1 id="oauth-clients-title">Client registered</h1>
              <p>{registered.name} was saved. Use these details to configure your app.</p>
            </div>
            <div className={styles.detailBlock}>
              <h2>Client ID</h2>
              <code className={styles.credential}>{registered.id}</code>
              <p>This ID is also available in your registered clients list.</p>
            </div>
            {result?.clientSecret ? (
              <div className={styles.detailBlock}>
                <h2>Client secret</h2>
                <code className={styles.credential}>{result.clientSecret}</code>
                <p>Copy this secret now. It will not be shown again.</p>
              </div>
            ) : null}
            <div className={styles.detailBlock}>
              <h2>Allowed redirect URIs</h2>
              <ul className={styles.uriList}>{registered.redirectUris.map((uri) => <li key={uri}><code>{uri}</code></li>)}</ul>
            </div>
            <Link className={styles.primaryLink} to="/settings/oauth-clients">View registered clients</Link>
          </>
        ) : loaderData.view === "new" ? (
          <>
            <Link className={styles.backLink} to="/settings/oauth-clients">All OAuth clients</Link>
            <h1 id="oauth-clients-title">Register a client</h1>
            <p>Register an app to get its Client ID. Registration alone does not give it access to a Food Log.</p>
            <p><a className={styles.guideLink} href={integrationGuideUrl} target="_blank" rel="noopener noreferrer">Read the integration guide (new tab)</a> for callback rules and the authorization flow.</p>
            <Form className={styles.form} method="post">
              <input type="hidden" name="intent" value="register" />
              <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
              <div className={styles.field}>
                <label htmlFor="client-type">Client type</label>
                <select id="client-type" name="clientType" defaultValue="public">
                  <option value="public">Public client</option>
                  <option value="confidential">Confidential server client</option>
                </select>
                {result?.errors?.clientType ? <p role="alert">{result.errors.clientType}</p> : null}
              </div>
              <div className={styles.field}>
                <label htmlFor="client-name">Client name</label>
                <input id="client-name" name="name" required maxLength={80} />
                {result?.errors?.name ? <p role="alert">{result.errors.name}</p> : null}
              </div>
              <div className={styles.field}>
                <label htmlFor="redirect-uris">Allowed redirect URIs, one per line</label>
                <textarea id="redirect-uris" name="redirectUris" required rows={4} />
                <p>Use HTTPS, or HTTP for localhost, 127.0.0.1, or [::1]. Fragments and wildcards are not allowed.</p>
                {result?.errors?.redirectUris ? <p role="alert">{result.errors.redirectUris}</p> : null}
              </div>
              {result?.error ? <p role="alert">{result.error}</p> : null}
              <button className={styles.submit} type="submit">Register client</button>
            </Form>
          </>
        ) : (
          <>
            <Link className={styles.backLink} to="/settings/goals">Back to settings</Link>
            <h1 id="oauth-clients-title">OAuth clients</h1>
            <p>Manage the apps you registered and the apps connected to your Food Log.</p>
            <p><a className={styles.guideLink} href={integrationGuideUrl} target="_blank" rel="noopener noreferrer">Read the integration guide (new tab)</a> to connect an app to your Food Log.</p>
            <Link className={styles.primaryLink} to="/settings/oauth-clients?view=new">Register client</Link>
            <h2>Registered clients</h2>
            <p>These apps have a Client ID. Registration alone gives them no Food Log access.</p>
            {loaderData.clients.length ? (
              <ul className={styles.clientList}>
                {loaderData.clients.map((client) => (
                  <li className={styles.clientCard} key={client.id}>
                    <h3>{client.name}</h3>
                    <p>{client.type === "public" ? "Public client · No client secret" : "Confidential server client · Secret shown only at registration"}</p>
                    <strong>Client ID</strong>
                    <code className={styles.credential}>{client.id}</code>
                    <strong>Allowed redirect URIs</strong>
                    <ul className={styles.uriList}>{client.redirectUris.map((uri) => <li key={uri}><code>{uri}</code></li>)}</ul>
                  </li>
                ))}
              </ul>
            ) : <p>No clients registered yet. Register one to get a Client ID.</p>}
            <h2>Connected clients</h2>
            <p>These apps can read your daily Food Log. Revoking a connection stops its current and future tokens.</p>
            {result?.revokedClient ? <p role="status" className={styles.success}>Revoked {result.revokedClient.name}.</p> : null}
            {result?.error ? <p role="alert" className={styles.error}>{result.error}</p> : null}
            {loaderData.connections.length ? (
              <ul className={styles.clientList}>
                {loaderData.connections.map((connection) => (
                  <li className={styles.clientCard} key={connection.clientId}>
                    <h3>{connection.name}</h3>
                    <p>Permission: {connection.scope === "daily-log:read" ? "Read your daily Food Log" : connection.scope}</p>
                    <strong>Client ID</strong>
                    <code className={styles.credential}>{connection.clientId}</code>
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="clientId" value={connection.clientId} />
                      <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
                      <button type="submit">Revoke {connection.name}</button>
                    </Form>
                  </li>
                ))}
              </ul>
            ) : <p>No connected clients yet.</p>}
          </>
        )}
      </section>
      </main>
    </div>
  );
}
