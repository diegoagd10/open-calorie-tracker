import { data, Form, Link, useActionData } from "react-router";
import type { Route } from "./+types/settings.oauth-clients";
import { getApplicationMutationSession, readApplicationMutationForm, requireApplicationSession } from "../auth/http.server";
import { listPublicClients, registerPublicClient, type PublicOAuthClient, type RegistrationErrors } from "../oauth/client-registration.server";
import styles from "../account.module.css";

type ActionData = {
  client?: PublicOAuthClient;
  errors?: RegistrationErrors;
  error?: string;
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
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
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
        <p>Register an app that can ask an account holder for Food Log read access. Registration alone gives it no access.</p>
        <h2>Registered public clients</h2>
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
