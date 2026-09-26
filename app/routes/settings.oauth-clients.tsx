import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/settings.oauth-clients";
import { getApplicationMutationSession, readApplicationMutationForm, requireApplicationSession } from "../auth/http.server";
import { listPublicClients, registerPublicClient, type PublicOAuthClient, type RegistrationErrors } from "../oauth/client-registration.server";
import { connectedDailyLogClients, revokeDailyLogClient } from "../oauth/authorization.server";
import styles from "../account.module.css";

type ActionData = {
  client?: PublicOAuthClient;
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
    clients: listPublicClients(session.user.id),
    connections: connectedDailyLogClients(session.user.id),
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
    const result = registerPublicClient(session.user.id, {
      name: String(form.get("name") ?? ""),
      redirectUris: String(form.get("redirectUris") ?? ""),
    });
    if (!result.ok) return data<ActionData>({ errors: result.errors }, { status: 400 });
    return data<ActionData>({ client: result.client }, { status: 201 });
  } catch {
    return data<ActionData>({ error: "The client could not be registered. Please try again." }, { status: 503 });
  }
}

export default function OAuthClientsSettings({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="oauth-clients-title">
        <Link className={styles.backLink} to="/settings/goals">Back to settings</Link>
        <h1 id="oauth-clients-title">OAuth clients</h1>
        <p>Review apps connected to your Food Log and register public clients for account holders to authorize.</p>
        <h2>Connected clients</h2>
        <p>These clients can read your daily Food Log. Revoking a connection stops its current and future tokens.</p>
        {loaderData.connections.length ? (
          <ul className={styles.keyList}>
            {loaderData.connections.map((connection) => (
              <li className={styles.keyRow} key={connection.clientId}>
                <div>
                  <strong>{connection.name}</strong>
                  <p>Permission: {connection.scope === "daily-log:read" ? "Read your daily Food Log" : connection.scope}</p>
                  <p>Client ID: <code>{connection.clientId}</code></p>
                  <Form method="post">
                    <input type="hidden" name="intent" value="revoke" />
                    <input type="hidden" name="clientId" value={connection.clientId} />
                    <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
                    <button type="submit">Revoke {connection.name}</button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        ) : <p>No connected clients yet.</p>}
        {result?.revokedClient ? <p role="status">Revoked {result.revokedClient.name}.</p> : null}
        <h2>Registered public clients</h2>
        <p>Registration alone gives a client no Food Log access.</p>
        {loaderData.clients.length ? (
          <ul className={styles.keyList}>
            {loaderData.clients.map((client) => (
              <li className={styles.keyRow} key={client.id}>
                <div>
                  <strong>{client.name}</strong>
                  <p>Client ID: <code>{client.id}</code></p>
                  <p>Public client · No client secret</p>
                  <ul>{client.redirectUris.map((uri) => <li key={uri}><code>{uri}</code></li>)}</ul>
                </div>
              </li>
            ))}
          </ul>
        ) : <p>No clients registered yet.</p>}
        <h2>Register a public client</h2>
        <Form className={styles.form} method="post">
          <input type="hidden" name="intent" value="register" />
          <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
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
          {result?.client ? <p role="status">Registered {result.client.name}. Its client ID is {result.client.id}.</p> : null}
          <button className={styles.submit} type="submit">Register public client</button>
        </Form>
      </section>
    </main>
  );
}
